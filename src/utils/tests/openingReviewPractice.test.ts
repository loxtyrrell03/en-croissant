import { INITIAL_FEN } from "chessops/fen";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import type { ChessDbCloudMove } from "@/utils/chessdb/api";
import { assessOpeningReviewMove, isOpeningReviewSavedMove } from "@/utils/openingReviewPractice";

const BLACK_TO_MOVE_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";

function position(overrides: Partial<Position> = {}): Position {
    return {
        fen: INITIAL_FEN,
        answer: "e4",
        answerUci: "e2e4",
        card: createEmptyCard(),
        ...overrides,
    };
}

function cloudMove(
    san: string,
    uci: string,
    scoreCpForWhite: number,
    rank: number,
): ChessDbCloudMove {
    return {
        san,
        uci,
        scoreCpForWhite,
        rank,
        note: null,
        winrate: null,
    };
}

describe("opening review practice move assessment", () => {
    test("keeps the saved answer as correct", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "e4", uci: "e2e4" }, null);

        expect(assessment.quality).toBe("correct");
        expect(assessment.bestMoveSan).toBe("e4");
    });

    test("normalizes a saved SAN answer before deciding it is different", () => {
        const saved = position({ answer: "e4!", answerUci: undefined });
        const playedMove = { san: "e4", uci: "e2e4" };

        expect(isOpeningReviewSavedMove(saved, playedMove)).toBe(true);
        expect(assessOpeningReviewMove(saved, playedMove, null).quality).toBe("correct");
    });

    test("marks a close ChessDB alternative as OK, not correct", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "d4", uci: "d2d4" }, [
            cloudMove("e4", "e2e4", 35, 1),
            cloudMove("d4", "d2d4", -25, 2),
        ]);

        expect(assessment.quality).toBe("ok");
        expect(assessment.bestMoveSan).toBe("e4");
        expect(assessment.moveLossCp).toBe(60);
    });

    test("marks a ChessDB top alternative as best, not OK", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "d4", uci: "d2d4" }, [
            cloudMove("d4", "d2d4", 45, 1),
            cloudMove("e4", "e2e4", 20, 2),
        ]);

        expect(assessment.quality).toBe("best");
        expect(assessment.bestMoveSan).toBe("d4");
        expect(assessment.moveLossCp).toBe(0);
    });

    test("accepts the saved engine best move before the database answer", () => {
        const assessment = assessOpeningReviewMove(
            position({
                answer: "Bd3",
                answerUci: "f1d3",
                engine: {
                    source: "chessdb",
                    bestMoveSan: "Qc2",
                    bestMoveUci: "d1c2",
                },
            }),
            { san: "Qc2", uci: "d1c2" },
            null,
        );

        expect(assessment.quality).toBe("best");
        expect(assessment.bestMoveSan).toBe("Qc2");
        expect(assessment.bestMoveUci).toBe("d1c2");
        expect(assessment.moveLossCp).toBe(0);
    });

    test("keeps a large ChessDB drop as incorrect", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "h4", uci: "h2h4" }, [
            cloudMove("e4", "e2e4", 40, 1),
            cloudMove("h4", "h2h4", -90, 7),
        ]);

        expect(assessment.quality).toBe("incorrect");
        expect(assessment.bestMoveSan).toBe("e4");
        expect(assessment.moveLossCp).toBe(130);
    });

    test("scores black moves from black's point of view", () => {
        const assessment = assessOpeningReviewMove(
            position({ fen: BLACK_TO_MOVE_FEN, answer: "e5", answerUci: "e7e5" }),
            { san: "c5", uci: "c7c5" },
            [cloudMove("e5", "e7e5", -50, 1), cloudMove("c5", "c7c5", 10, 2)],
        );

        expect(assessment.quality).toBe("ok");
        expect(assessment.bestMoveSan).toBe("e5");
        expect(assessment.moveLossCp).toBe(60);
    });
});
