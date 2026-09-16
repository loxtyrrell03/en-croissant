import { expect, test } from "vitest";
import { parsePgnDatabase, playUciMove } from "../pgn";
import {
    createPhoneReviewCard,
    needsMissedAlternativeSearch,
    withTacticalReplyCandidates,
} from "../mistakeReview";
import { missedAlternativeInput } from "@/utils/tests/fixtures/missedAlternative";
import { sharedReviewDeck } from "../sharedReview";

test("both review readers preserve a missed alternative separately from the best line", () => {
    const fen = missedAlternativeInput.fen!;
    const game = parsePgnDatabase(
        "alternative",
        `[White "Opponent"]\n[Black "Tester"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n1... Kf7 *`,
    ).games[0];
    const line = (uci: string, cp: number, multipv: number) => ({
        source: "stockfish" as const,
        depth: 16,
        multipv,
        uciMoves: [uci],
        sanMoves: [playUciMove(fen, uci)!.san],
        score: { type: "cp" as const, value: -cp },
    });
    const best = withTacticalReplyCandidates(fen, [line("e5c3", 200, 1), line("f8a3", 160, 2)]);
    const reply = {
        ...best,
        score: { type: "cp" as const, value: 0 },
        uciMoves: ["d3d4"],
        sanMoves: ["d4"],
        tacticalCandidates: undefined,
    };
    const card = createPhoneReviewCard(game, 0, "Tester", best, reply)!;
    expect(card).toBeTruthy();
    expect(card.explanation).toContain("Another stronger move");
    expect(card.best).toBe("e5c3");
    expect(card.tacticalClassification?.missedMotifs[0].alternativeLine?.uci).toEqual(["f8a3"]);
    expect(card.bestTimeline?.some((m) => m.alternativeLine)).toBe(false);
    expect(needsMissedAlternativeSearch(card, best)).toBe(false);
    expect(needsMissedAlternativeSearch(null, best)).toBe(false);
    const empty = {
        ...card,
        tacticalClassification: { ...card.tacticalClassification!, missedMotifs: [] },
    };
    expect(needsMissedAlternativeSearch(empty, best)).toBe(true);
    expect(needsMissedAlternativeSearch(empty, { ...best, tacticalCandidatesRequested: 3 })).toBe(
        false,
    );
    const deck = sharedReviewDeck([card]);
    expect(deck.positions[0].mistakeReview?.bestCandidates).toEqual(best.tacticalCandidates);
    expect(deck.positions[0].mistakeReview?.missedMotifs?.[0].alternativeLine?.uci).toEqual([
        "f8a3",
    ]);
});
