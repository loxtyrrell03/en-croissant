import { expect, test } from "vitest";
import { createPhoneReviewCard } from "../mistakeReview";
import { parsePgnDatabase } from "../pgn";
import { defensiveDeflectionFen } from "../../utils/tests/fixtures/defensiveDeflection";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../utils/tests/fixtures/mixedTargetFork";

test.each([false, true])(
    "review keeps player-relative chances but White-relative motif scores (%s)",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(defensiveDeflectionFen)
            : defensiveDeflectionFen;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const game = parsePgnDatabase(
            "constructed",
            `[White "${reflected ? "Tester" : "Opponent"}"]\n[Black "${reflected ? "Opponent" : "Tester"}"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n${reflected ? "1. Rb8" : "1... Rb1"} *`,
            1,
        ).games[0];
        expect(game.moves).toHaveLength(1);
        const card = createPhoneReviewCard(
            game,
            0,
            "Tester",
            {
                source: "stockfish", multipv: 1,
                depth: 16,
                score: { type: "cp", value: reflected ? 600 : -600 },
                uciMoves: ["f8f6", "g6f6", "g8h7"].map(move),
                sanMoves: [],
            },
            {
                source: "stockfish", multipv: 1,
                depth: 16,
                score: { type: "cp", value: 0 },
                uciMoves: ["h7g7", "g8h8", "g7h7", "h8g8", "h7g7"].map(move),
                sanMoves: [],
            },
        );
        expect(card).not.toBeNull();
        expect(card!.before).toBeGreaterThan(85);
        expect(card!.after).toBe(50);
        expect(card!.tacticalClassification!.allowedMotifs[0].id).toBe("perpetualCheck");
        expect(card!.tacticalClassification!.missedMotifs[0]).toMatchObject({
            id: "defensiveDeflection",
            value: 0,
        });
    },
);
