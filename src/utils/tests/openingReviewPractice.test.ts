import { INITIAL_FEN } from "chessops/fen";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import type { ChessDbCloudMove } from "@/utils/chessdb/api";
import type { LichessCloudMove } from "@/utils/lichess/api";
import {
    assessOpeningReviewMove,
    findReviewPracticePositionForBoard,
    isOpeningReviewSavedMove,
} from "@/utils/openingReviewPractice";

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

function lichessMove(
    san: string,
    uci: string,
    scoreCpForWhite: number,
    depth = 45,
): LichessCloudMove {
    return {
        san,
        uci,
        scoreCpForWhite,
        depth,
        mate: null,
    };
}

describe("opening review practice move assessment", () => {
    test("uses the scoped practice card when duplicate positions share a FEN", () => {
        const first = position({
            reviewKey: "first",
            answer: "e4",
            answerUci: "e2e4",
        });
        const scoped = position({
            reviewKey: "scoped",
            answer: "d4",
            answerUci: "d2d4",
        });

        const entry = findReviewPracticePositionForBoard([first, scoped], INITIAL_FEN, 1);

        expect(entry?.index).toBe(1);
        expect(entry?.position.reviewKey).toBe("scoped");
    });

    test("does not fall back to another duplicate when the scoped card is not on the board", () => {
        const first = position({ reviewKey: "first" });
        const scoped = position({
            reviewKey: "scoped",
            fen: BLACK_TO_MOVE_FEN,
            answer: "e5",
            answerUci: "e7e5",
        });

        const entry = findReviewPracticePositionForBoard([first, scoped], INITIAL_FEN, 1);

        expect(entry).toBeNull();
    });

    test("keeps the saved answer as correct", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "e4", uci: "e2e4" }, null);

        expect(assessment.quality).toBe("correct");
        expect(assessment.label).toBe("best");
        expect(assessment.passed).toBe(true);
        expect(assessment.bestMoveSan).toBe("e4");
    });

    test("normalizes a saved SAN answer before deciding it is different", () => {
        const saved = position({ answer: "e4!", answerUci: undefined });
        const playedMove = { san: "e4", uci: "e2e4" };

        expect(isOpeningReviewSavedMove(saved, playedMove)).toBe(true);
        expect(assessOpeningReviewMove(saved, playedMove, null).quality).toBe("correct");
    });

    test("marks a good ChessDB alternative as passing, not exact", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "d4", uci: "d2d4" }, [
            cloudMove("e4", "e2e4", 35, 1),
            cloudMove("d4", "d2d4", 5, 2),
        ]);

        expect(assessment.quality).toBe("ok");
        expect(assessment.label).toBe("good");
        expect(assessment.passed).toBe(true);
        expect(assessment.bestMoveSan).toBe("e4");
        expect(assessment.moveLossCp).toBe(30);
    });

    test("labels an okay ChessDB alternative but keeps it due for review", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "d4", uci: "d2d4" }, [
            cloudMove("e4", "e2e4", 35, 1),
            cloudMove("d4", "d2d4", -10, 2),
        ]);

        expect(assessment.quality).toBe("ok");
        expect(assessment.label).toBe("okay");
        expect(assessment.passed).toBe(false);
        expect(assessment.moveLossCp).toBe(45);
    });

    test("marks a ChessDB top alternative as best, not OK", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "d4", uci: "d2d4" }, [
            cloudMove("d4", "d2d4", 45, 1),
            cloudMove("e4", "e2e4", 20, 2),
        ]);

        expect(assessment.quality).toBe("best");
        expect(assessment.label).toBe("best");
        expect(assessment.passed).toBe(true);
        expect(assessment.bestMoveSan).toBe("d4");
        expect(assessment.moveLossCp).toBe(0);
    });

    test("uses Lichess Cloud ahead of saved and ChessDB moves during practice", () => {
        const assessment = assessOpeningReviewMove(
            position(),
            { san: "d4", uci: "d2d4" },
            [cloudMove("e4", "e2e4", 35, 1), cloudMove("d4", "d2d4", -25, 2)],
            [lichessMove("d4", "d2d4", 80), lichessMove("e4", "e2e4", -40)],
        );

        expect(assessment.quality).toBe("best");
        expect(assessment.bestMoveSan).toBe("d4");
        expect(assessment.bestMoveUci).toBe("d2d4");
        expect(assessment.bestMoveSource).toBe("lichess");
        expect(assessment.label).toBe("best");
        expect(assessment.moveLossCp).toBe(0);
    });

    test("falls back to ChessDB when Lichess Cloud has no move for the position", () => {
        const assessment = assessOpeningReviewMove(
            position(),
            { san: "d4", uci: "d2d4" },
            [cloudMove("d4", "d2d4", 45, 1), cloudMove("e4", "e2e4", 20, 2)],
            null,
        );

        expect(assessment.quality).toBe("best");
        expect(assessment.label).toBe("best");
        expect(assessment.bestMoveSan).toBe("d4");
        expect(assessment.bestMoveSource).toBe("chessdb");
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
        expect(assessment.label).toBe("best");
        expect(assessment.bestMoveSan).toBe("Qc2");
        expect(assessment.bestMoveUci).toBe("d1c2");
        expect(assessment.moveLossCp).toBe(0);
    });

    test("keeps saved Lichess best move ahead of ChessDB best for good alternatives", () => {
        const assessment = assessOpeningReviewMove(
            position({
                fen: BLACK_TO_MOVE_FEN,
                answer: "a6",
                answerUci: "a7a6",
                engine: {
                    source: "lichess",
                    bestMoveSan: "g6",
                    bestMoveUci: "g7g6",
                    depth: 50,
                    lossCp: 280,
                },
            }),
            { san: "Nf6", uci: "g8f6" },
            [cloudMove("a6", "a7a6", -100, 1), cloudMove("Nf6", "g8f6", -75, 2)],
        );

        expect(assessment.quality).toBe("ok");
        expect(assessment.label).toBe("good");
        expect(assessment.passed).toBe(true);
        expect(assessment.bestMoveSan).toBe("g6");
        expect(assessment.bestMoveUci).toBe("g7g6");
        expect(assessment.chessDbBestMoveSan).toBe("a6");
    });

    test("does not promote ChessDB best to best when saved engine disagrees", () => {
        const assessment = assessOpeningReviewMove(
            position({
                fen: BLACK_TO_MOVE_FEN,
                answer: "Nf6",
                answerUci: "g8f6",
                engine: {
                    source: "lichess",
                    bestMoveSan: "g6",
                    bestMoveUci: "g7g6",
                    depth: 50,
                    lossCp: 280,
                },
            }),
            { san: "a6", uci: "a7a6" },
            [cloudMove("a6", "a7a6", -100, 1), cloudMove("Nf6", "g8f6", -40, 2)],
        );

        expect(assessment.quality).toBe("ok");
        expect(assessment.label).toBe("good");
        expect(assessment.bestMoveSan).toBe("g6");
        expect(assessment.moveLossCp).toBe(0);
    });

    test("keeps a large ChessDB drop as incorrect", () => {
        const assessment = assessOpeningReviewMove(position(), { san: "h4", uci: "h2h4" }, [
            cloudMove("e4", "e2e4", 40, 1),
            cloudMove("h4", "h2h4", -90, 7),
        ]);

        expect(assessment.quality).toBe("incorrect");
        expect(assessment.label).toBe("mistake");
        expect(assessment.passed).toBe(false);
        expect(assessment.bestMoveSan).toBe("e4");
        expect(assessment.moveLossCp).toBe(130);
    });

    test("scores black moves from black's point of view", () => {
        const assessment = assessOpeningReviewMove(
            position({ fen: BLACK_TO_MOVE_FEN, answer: "e5", answerUci: "e7e5" }),
            { san: "c5", uci: "c7c5" },
            [cloudMove("e5", "e7e5", -50, 1), cloudMove("c5", "c7c5", -20, 2)],
        );

        expect(assessment.quality).toBe("ok");
        expect(assessment.label).toBe("good");
        expect(assessment.passed).toBe(true);
        expect(assessment.bestMoveSan).toBe("e5");
        expect(assessment.moveLossCp).toBe(30);
    });
});
