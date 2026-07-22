import { createEmptyCard } from "ts-fsrs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Position } from "@/components/files/opening";

const mocks = vi.hoisted(() => ({
    scoreMistakeReviewMove: vi.fn(),
}));

vi.mock("@/bindings", () => ({
    commands: {
        scoreMistakeReviewMove: mocks.scoreMistakeReviewMove,
    },
}));

vi.mock("@/utils/unwrap", () => ({
    unwrap<T>(result: { status: "ok"; data: T } | { status: "error"; error: string }): T {
        if (result.status === "ok") return result.data;
        throw new Error(result.error);
    },
}));

import { assessMistakeReviewMoveWithEngine } from "@/utils/mistakeReviewPractice";

function mistakePosition(overrides: Partial<Position> = {}): Position {
    return {
        fen: "r4b1r/ppQ1pkp1/n2p1n1p/3b4/8/2B1qP2/PPP1B1PP/RN2K2R w KQ - 2 14",
        answer: "Bd2",
        answerUci: "c3d2",
        card: createEmptyCard(),
        reviewKey: "qa5-blunder",
        mistakeReview: {
            playedMoveSan: "Qa5",
            playedMoveUci: "c7a5",
            bestMoveSan: "Bd2",
            bestMoveUci: "c3d2",
            severity: "blunder",
            cpLoss: 433,
            winProbabilityDrop: 23,
            enginePath: "stockfish",
            requestedDepth: 17,
            reachedDepth: 17,
            multiPv: 3,
            thresholds: { inaccuracy: 50, mistake: 100, blunder: 200 },
        },
        ...overrides,
    };
}

describe("mistake review practice assessment", () => {
    beforeEach(() => {
        mocks.scoreMistakeReviewMove.mockReset();
    });

    test("accepts the saved mistake-review answer without live engine re-scoring", async () => {
        const assessment = await assessMistakeReviewMoveWithEngine(mistakePosition(), {
            san: "Bd2",
            uci: "c3d2",
        });

        expect(mocks.scoreMistakeReviewMove).not.toHaveBeenCalled();
        expect(assessment).toMatchObject({
            label: "best",
            passed: true,
            bestMoveSan: "Bd2",
            bestMoveUci: "c3d2",
        });
    });

    test("keeps the saved best move when live scoring disagrees with the scan", async () => {
        mocks.scoreMistakeReviewMove.mockResolvedValue({
            status: "ok",
            data: {
                label: "blunder",
                passed: false,
                bestMoveSan: "Qa5",
                bestMoveUci: "c7a5",
                playedMoveSan: "Bc4",
                playedMoveUci: "f1c4",
                cpLoss: 260,
                winProbabilityDrop: 16,
                cpBefore: 80,
                cpAfter: -180,
                requestedDepth: 17,
                reachedDepth: 17,
                engineName: "Stockfish",
            },
        });

        const assessment = await assessMistakeReviewMoveWithEngine(mistakePosition(), {
            san: "Bc4",
            uci: "f1c4",
        });

        expect(mocks.scoreMistakeReviewMove).toHaveBeenCalledOnce();
        expect(assessment).toMatchObject({
            label: "blunder",
            passed: false,
            bestMoveSan: "Bd2",
            bestMoveUci: "c3d2",
            moveLossCp: 260,
            winProbabilityDrop: 16,
        });
    });
});
