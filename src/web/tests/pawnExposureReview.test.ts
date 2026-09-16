import { expect, test } from "vitest";
import { parsePgnDatabase } from "../pgn";
import { createPhoneReviewCard } from "../mistakeReview";
import { sharedReviewDeck } from "../sharedReview";
import { positionSchema } from "@/components/files/opening";
import { migrateMistakeReviewDeckMotifClassifications } from "@/utils/mistakeReview";
import { pawnExposureBefore } from "@/utils/tests/fixtures/pawnExposure";

test("a missed pawn opportunity keeps actual preceding history across phone, desktop and saved migration", async () => {
    const game = parsePgnDatabase(
        "pawn",
        `[White "Tester"]\n[Black "Opponent"]\n[SetUp "1"]\n[FEN "${pawnExposureBefore}"]\n\n1... e5 2. Rb1 *`,
    ).games[0];
    const line = (move: string, san: string, cp: number) => ({
        source: "stockfish" as const,
        depth: 16,
        multipv: 1,
        uciMoves: [move],
        sanMoves: [san],
        score: { type: "cp" as const, value: cp },
    });
    const card = createPhoneReviewCard(
        game,
        1,
        "Tester",
        line("d4e5", "dxe5", 150),
        line("e5d4", "exd4", 0),
    )!;
    expect(card.explanation).toContain("Hanging Pawn");
    expect(card.previousFen).toBe(pawnExposureBefore);
    expect(card.previousMoveUci).toBe("e7e5");
    const deck = sharedReviewDeck([card]);
    const position = deck.positions[0];
    position.mistakeReview = positionSchema.shape.mistakeReview.parse(
        JSON.parse(
            JSON.stringify({
                ...position.mistakeReview,
                missedMotifs: [],
                motifClassifierVersion: "site-55.adapter-114",
            }),
        ),
    );
    const migrated = await migrateMistakeReviewDeckMotifClassifications(deck);
    expect(migrated.deck.positions[0].mistakeReview?.missedMotifs?.[0].label).toBe("Hanging Pawn");
    expect(migrated.deck.positions[0].card).toEqual(position.card);
});
