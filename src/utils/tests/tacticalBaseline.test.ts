import { describe, expect, test } from "vitest";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

describe("compare the actual tactical loss to the better line's baseline", () => {
    test("a double-check mate explains the king escape supplied by a non-checking defence", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "3rkr2/5p2/p7/8/8/8/4B1P1/4R1K1 b - - 0 1",
            bestMoveUci: "f8g8",
            playedMoveUci: "a6a5",
            pvUci: ["f8g8"],
            refutationUci: ["e2b5"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "doubleCheck",
            comparison: "prevented",
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Kf8");
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("no longer mate");
    });
    test("a pin and a discovered check can win the same already-lost queen", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "5q1k/7p/8/4R3/8/8/1B3PPP/6K1 b - - 0 1",
            bestMoveUci: "h8g7",
            playedMoveUci: "h7h6",
            pvUci: ["h8g7", "e5f5", "g7g8", "f5f8", "g8f8"],
            refutationUci: ["e5e8", "h8g8", "e8f8", "g8f8"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({ id: "pin", comparison: "persists" });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Rf5+");
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("queen on f8");
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
            "Tactical danger in the position",
        );
        expect(result.allowedTimeline?.[0].comparisonEvidence).toBe(
            result.allowedMotifs[0].comparisonEvidence,
        );
    });

    test("equal-valued but different queens do not establish persistent loss of the same target", () => {
        const fen = "r5kr/8/8/8/Q6Q/8/8/6K1 w - - 0 1";
        const pvUci = ["a4a5", "h8h4"];
        const refutationUci = ["a8a4"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(2);
        expect(replayTacticalLine(fen, ["h4h5", ...refutationUci])).toHaveLength(2);
        const result = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: "a4a5",
            playedMoveUci: "h4h5",
            pvUci,
            refutationUci,
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "hangingPiece",
            comparison: "prevented",
        });
    });

    test("tracks a relocated queen even when a different piece captures it", () => {
        const fen = "r5k1/8/8/1p6/Q7/8/7P/6K1 w - - 0 1";
        const result = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: "a4a5",
            playedMoveUci: "h2h3",
            pvUci: ["a4a5", "a8a5"],
            refutationUci: ["b5a4"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "hangingPiece",
            comparison: "persists",
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("queen on a5");
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Rxa5");
    });

    test("a smaller baseline loss does not excuse losing the same queen for less compensation", () => {
        const fen = "r5k1/8/8/1p6/Q7/8/7P/R5K1 w - - 0 1";
        const result = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: "a4a5",
            playedMoveUci: "h2h3",
            pvUci: ["a4a5", "a8a5", "a1a5"],
            refutationUci: ["b5a4", "a1a4"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "hangingPiece",
            comparison: "prevented",
        });
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
            "Why the move was tactically bad",
        );
    });

    test("an illegal reply in the better PV cannot establish an alternative way to win the queen", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "r5k1/8/8/1p6/Q7/8/7P/6K1 w - - 0 1",
            bestMoveUci: "a4a5",
            playedMoveUci: "h2h3",
            pvUci: ["a4a5", "b5a4", "a8a5"],
            refutationUci: ["b5a4"],
        });
        expect(result.allowedMotifs[0].comparison).toBe("prevented");
    });
});
