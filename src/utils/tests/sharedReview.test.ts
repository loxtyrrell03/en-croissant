import { expect, test } from "vitest";
import { sharedReviewDeck } from "@/web/sharedReview";
import { selectDailyReview, gradePhoneReview, type PhoneReviewCard } from "@/web/mistakeReview";
import { getMistakeReviewDailyBatch } from "@/utils/mistakeReview";

test("desktop and phone select the same bounded cross-account daily collection", () => {
    const now = Date.now();
    const cards = Array.from(
        { length: 10 },
        (_, i) =>
            ({
                id: `game${i}:1:player`,
                gameKey: `game${i}`,
                gameTitle: "Test game",
                gameDate: "2026.09.01",
                fen: `8/8/8/8/8/8/K7/7k w - ${i}`,
                player: i % 2 ? "account-a" : "account-b",
                color: "white",
                ply: 10,
                played: "Ka1",
                best: "a2a3",
                bestSan: "Ka3",
                pv: [],
                pvSan: [],
                refutation: [],
                before: 60,
                after: 20,
                drop: 40,
                explanation: "",
                createdAt: now - i,
                due: now - 1,
                reviews: 0,
                streak: 0,
            }) as PhoneReviewCard,
    );
    cards[0] = gradePhoneReview(cards[0], "good", now);
    cards[1] = gradePhoneReview(cards[1], "hide", now);
    const deck = sharedReviewDeck(cards, "stockfish", now);
    const phone = selectDailyReview(cards, now);
    const desktop = getMistakeReviewDailyBatch(deck.positions, deck.daily, { now: new Date(now) });
    expect(phone).toHaveLength(3);
    expect(desktop.map((p) => p.reviewKey)).toEqual(phone.map((c) => `pc:${c.id}`));
});
