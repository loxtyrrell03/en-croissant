import { describe, expect, test } from "vitest";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
    buildMistakeReviewTacticalExplanation,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

describe("material tactic causation across the two choices", () => {
    test("moving the king out of the pin supplies a legal defence to the pawn attack", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k3/4n2p/8/3P4/2B5/8/8/4R1K1 b - - 0 1",
            bestMoveUci: "e8f8",
            playedMoveUci: "h7h6",
            pvUci: ["e8f8"],
            refutationUci: ["d5d6", "e8f8", "d6e7"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({ id: "pin", comparison: "prevented" });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("After Kf8");
        expect(result.allowedTimeline?.[0].comparisonEvidence).toBe(
            result.allowedMotifs[0].comparisonEvidence,
        );
    });
    test("does not blame a pin that persists after either supplied pawn move", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k3/p3n2p/8/3P4/2B5/8/8/4R1K1 b - - 0 1",
            bestMoveUci: "h7h6",
            playedMoveUci: "a7a6",
            pvUci: ["h7h6"],
            refutationUci: ["d5d6", "e8f8", "d6e7"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({ id: "pin", comparison: "persists" });
        expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
            "does not explain the difference",
        );
    });
    test("tracks the queen when the better move takes it out of the skewer", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "8/p6q/8/5k2/2B5/8/8/6K1 b - - 0 1",
            bestMoveUci: "h7h6",
            playedMoveUci: "a7a6",
            pvUci: ["h7h6"],
            refutationUci: ["c4d3", "f5g5", "d3h7"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({ id: "skewer", comparison: "prevented" });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("After Qh6");
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("queen on h6");
    });
    test("moving the queen prevents the defender-removal payoff without claiming the knight was saved", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "8/p5k1/5n2/3qP1P1/8/8/8/3R2K1 b - - 0 1",
            bestMoveUci: "d5e6",
            playedMoveUci: "a7a6",
            pvUci: ["d5e6"],
            refutationUci: ["e5f6", "g7f7", "d1d5"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "capturingDefender",
            comparison: "prevented",
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("queen on e6");
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("follow-up capture");
    });
    test("marks a checking better move as preventing the reply by legality", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "8/p6q/8/5k2/2B5/8/8/6K1 b - - 0 1",
            bestMoveUci: "h7g7",
            playedMoveUci: "a7a6",
            pvUci: ["h7g7"],
            refutationUci: ["c4d3", "f5g5", "d3h7"],
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toBe(
            "Qg7+ makes the immediate reply Bd3+ illegal.",
        );
    });
    test("tracks the rook relocated by castling when comparing a skewer", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k2r/Rp6/8/8/8/8/8/6K1 b k - 0 1",
            bestMoveUci: "e8g8",
            playedMoveUci: "b7b6",
            pvUci: ["e8g8"],
            refutationUci: ["a7a8", "e8f7", "a8h8"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({ id: "skewer", comparison: "prevented" });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("rook on f8");
    });
    test("distinguishes an engine-supported pin threat from a guaranteed capture", () => {
        const fen = "4k2r/4n3/7p/3P4/8/8/8/4R1K1 w k - 0 2";
        const pvUci = [
            "d5d6",
            "h8h7",
            "e1e6",
            "h7g7",
            "g1f2",
            "e8d7",
            "d6e7",
            "g7e7",
            "e6e7",
            "d7e7",
        ];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(10);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs).toEqual([]);
        expect(classifyPositionTacticalMotifs({ fen, pvUci, rootCp: -300 }).motifs).toEqual([]);
        const result = classifyPositionTacticalMotifs({ fen, pvUci, rootCp: -1 });
        expect(result.motifs[0]).toMatchObject({ id: "pin", confidence: "medium" });
        expect(result.motifs[0].evidence).toContain("not a guaranteed immediate win");
        const board = buildLiveTacticalScan({
            fen,
            pvUci,
            variations: [{ pvUci, cp: -1 }],
            depth: 16,
            engineName: "Regression",
        });
        expect(board.labels[0].square).toBe("e7");
        expect(board.arrows).toContainEqual(expect.objectContaining({ from: "e1", to: "e8" }));
    });
    test("a quiet mating countercheck is not dismissed as a delaying resource", () => {
        const fen = "4k2r/4n3/8/3P4/7q/8/5PP1/4RRK1 w k - 0 1";
        const counter = replayTacticalLine(fen, ["d5d6", "h4h2"]);
        expect(counter).toHaveLength(2);
        expect(counter[1].after.isCheckmate()).toBe(true);
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: ["d5d6", "e8f8", "d6e7"], rootCp: 300 })
                .motifs,
        ).toEqual([]);
    });
});
