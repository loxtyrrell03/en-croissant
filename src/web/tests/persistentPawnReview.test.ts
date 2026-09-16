import { expect, test } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import { parsePgnDatabase } from "../pgn";
import { createPhoneReviewCard } from "../mistakeReview";
import { sharedReviewDeck } from "../sharedReview";
import {
    positionSchema,
    tacticalGameHistorySchema,
} from "@/components/files/opening";
import {
    classifyMistakeReviewNature,
    migrateMistakeReviewDeckMotifClassifications,
} from "@/utils/mistakeReview";

test("an older missed pawn opportunity retains complete history across phone, stored desktop review and migration", async () => {
    const game = parsePgnDatabase(
        "constructed",
        '[White "Opponent"]\n[Black "Tester"]\n\n1. e4 e5 2. Nf3 Nc6 3. a3 Nf6 4. Bc4 Be7 5. d3 *',
    ).games[0];
    const line = (uci: string, san: string, cp: number) => ({
        source: "stockfish" as const,
        depth: 16,
        multipv: 1,
        uciMoves: [uci],
        sanMoves: [san],
        score: { type: "cp" as const, value: cp },
    });
    const card = createPhoneReviewCard(
        game,
        7,
        "Tester",
        line("f6e4", "Nxe4", -150),
        line("d2d3", "d3", 0),
    )!;
    expect(card).not.toBeNull();
    expect(card.tacticalHistory).toEqual({
        fen: INITIAL_FEN,
        moves: game.moves.slice(0, 7).map((move) => move.uci),
    });
    expect(card.explanation).toContain("Hanging Pawn");
    const deck = sharedReviewDeck([card]);
    const position = deck.positions[0];
    position.mistakeReview = positionSchema.shape.mistakeReview.parse(
        JSON.parse(
            JSON.stringify({
                ...position.mistakeReview,
                missedMotifs: [],
                motifClassifierVersion: "site-55.adapter-127",
            }),
        ),
    );
    const migrated = await migrateMistakeReviewDeckMotifClassifications(deck);
    const restored = migrated.deck.positions[0];
    expect(restored.mistakeReview?.tacticalHistory).toEqual(
        card.tacticalHistory,
    );
    expect(restored.mistakeReview?.missedMotifs?.[0].label).toBe(
        "Hanging Pawn",
    );
    expect(restored.card).toEqual(position.card);
    expect(classifyMistakeReviewNature(restored).nature).toBe("tactical");
    const legacy = {
        ...restored,
        mistakeReview: {
            ...restored.mistakeReview!,
            tacticalHistory: undefined,
        },
    };
    expect(classifyMistakeReviewNature(legacy).nature).not.toBe("tactical");
});

test("missing moves are not silently deleted and oversized saved history is rejected", () => {
    expect(
        tacticalGameHistorySchema.safeParse({
            fen: INITIAL_FEN,
            moves: ["e2e4", null],
        }).success,
    ).toBe(false);
    expect(
        tacticalGameHistorySchema.safeParse({
            fen: INITIAL_FEN,
            moves: Array(1025).fill("e2e4"),
        }).success,
    ).toBe(false);
});
