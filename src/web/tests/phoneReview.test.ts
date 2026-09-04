import { describe, it, expect } from "vitest";
import {
    emptyPhoneReview,
    gradePhoneReview,
    playerKey,
    reviewChance,
    reviewCp,
    reviewGameKey,
    reviewPlayerColor,
    selectDailyReview,
    selectGameReviewCards,
    usefulReviewSwing,
    type PhoneReviewCard,
} from "../mistakeReview";
import { annotatePhoneMove } from "../phoneAnnotations";
import { parsePgnDatabase, webGameToLine } from "../pgn";
import { createEmptyWebState } from "../storage";
const now = new Date(2026, 8, 4, 12).getTime();
function card(i: number, patch: Partial<PhoneReviewCard> = {}): PhoneReviewCard {
    return {
        id: String(i),
        gameKey: String(i),
        gameTitle: "Game",
        gameDate: "2026.09.01",
        player: "Tester",
        color: "white",
        ply: 10,
        played: "a3",
        best: "a2a3",
        bestSan: "Ka3",
        pv: [],
        pvSan: [],
        refutation: [],
        before: 70,
        after: 30,
        drop: 40,
        explanation: "",
        createdAt: now,
        due: now,
        streak: 0,
        reviews: 0,
        ...patch,
        fen: patch.fen ?? `8/8/8/8/8/8/K7/7k ${i % 2 ? "b" : "w"} - ${i}`,
    };
}
describe("phone daily review quality and schedule", () => {
    it("rejects irrelevant winning and lost positions but keeps thrown wins", () => {
        expect(usefulReviewSwing(99, 92)).toBe(false);
        expect(usefulReviewSwing(99, 86)).toBe(false);
        expect(usefulReviewSwing(12, 0)).toBe(false);
        expect(usefulReviewSwing(50, 44)).toBe(false);
        expect(usefulReviewSwing(98, 45)).toBe(true);
        expect(usefulReviewSwing(55, 22)).toBe(true);
    });
    it("uses mover perspective with black evaluations", () => {
        expect(reviewChance(reviewCp({ type: "cp", value: 300 }, "white"))).toBeGreaterThan(70);
        expect(reviewChance(reviewCp({ type: "cp", value: 300 }, "black"))).toBeLessThan(30);
    });
    it("caps daily work and reserves space for fresh learning", () => {
        const cards = Array.from({ length: 20 }, (_, i) => card(i, { reviews: i < 10 ? 1 : 0 }));
        const queue = selectDailyReview(cards, now);
        expect(queue).toHaveLength(5);
        expect(queue.filter((c) => !c.reviews)).toHaveLength(2);
        const done = queue.map((c) => gradePhoneReview(c, "good", now));
        expect(
            selectDailyReview([...done, ...cards.filter((c) => !queue.includes(c))], now),
        ).toHaveLength(0);
    });
    it("does not let one game or repeated FEN fill the day", () => {
        const cards = Array.from({ length: 10 }, (_, i) => card(i, { gameKey: "same" }));
        expect(selectDailyReview(cards, now)).toHaveLength(2);
        expect(selectDailyReview([card(1), card(2, { fen: card(1).fen })], now)).toHaveLength(1);
    });
    it("spaces adjacent mistakes and keeps only three from a game", () => {
        const cards = Array.from({ length: 10 }, (_, i) => card(i, { ply: i * 2, drop: 40 - i }));
        expect(selectGameReviewCards(cards).map((c) => c.ply)).toEqual([0, 4, 8]);
    });
    it("reschedules forgotten cards tomorrow without making today endless", () => {
        const c = gradePhoneReview(card(1), "again", now);
        expect(c.due).toBe(now + 86400000);
        expect(selectDailyReview([c], now)).toHaveLength(0);
        expect(selectDailyReview([c], now + 86400000)).toHaveLength(1);
        expect(gradePhoneReview(c, "hide", now).hidden).toBe(true);
    });
    it("matches exact normalized identity and deduplicates repeated imports", () => {
        const pgn = '[White "Tester, Alice"]\n[Black "Opponent"]\n\n1. e4 e5 *';
        const a = parsePgnDatabase("one", pgn, 1).games[0],
            b = parsePgnDatabase("two", pgn, 2).games[0];
        expect(reviewGameKey(a)).toBe(reviewGameKey(b));
        expect(reviewPlayerColor(a, "Alice Tester")).toBe("white");
        expect(reviewPlayerColor(a, "Alice")).toBeNull();
        expect(playerKey("Testér, Alice")).toBe("alice tester");
        expect(emptyPhoneReview().cards).toEqual([]);
    });
});
describe("phone annotations", () => {
    it("retains headers, variations, clocks and notes in a reloadable PGN", () => {
        const imported = parsePgnDatabase(
            "notes",
            '[White "Alice"]\n[Black "Bob"]\n\n1. e4 {[%clk 0:04:59]} (1. d4 d5) e5 2. Nf3 *',
        );
        const game = imported.games[0];
        const initial = createEmptyWebState();
        initial.databases = [imported.database];
        initial.gamesByDatabase = { [game.databaseId]: [game] };
        initial.board = {
            ...initial.board,
            line: webGameToLine(game),
            sourceGameId: game.id,
            sourceDatabaseId: game.databaseId,
            cursor: 2,
        };
        const next = annotatePhoneMove(initial, 2, {
            comments: ["Watch the centre"],
            annotations: ["?!"],
        });
        const changed = next.gamesByDatabase[game.databaseId][0];
        expect(changed.pgn).toContain("Watch the centre");
        expect(changed.pgn).toContain('[White "Alice"]');
        expect(changed.pgn).toContain("d4");
        expect(changed.pgn).toContain("%clk");
        expect(parsePgnDatabase("reload", changed.pgn).games[0].moves[1].annotations).toContain(
            "?!",
        );
        expect(initial.board.line[1].comments ?? []).not.toContain("Watch the centre");
    });
});
