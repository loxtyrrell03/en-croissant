import { describe, expect, test } from "vitest";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

describe("judged material tactics", () => {
    test("a pawn exploits the knight's absolute pin", () => {
        const fen = "4k3/4n3/8/3P4/2B5/8/8/4R1K1 w - - 0 1";
        const pvUci = ["d5d6", "e8f8", "d6e7"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]?.id).toBe("pin");
        const board = buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Regression" });
        expect(board.labels[0].square).toBe("e7");
        expect(board.arrows).toEqual([
            expect.objectContaining({ from: "d5", to: "d6" }),
            expect.objectContaining({ from: "e1", to: "e8" }),
        ]);
    });
    test("a rook can capture the pawn that appears to exploit the pin", () => {
        const fen = "4k3/4n3/r7/3P4/2B5/8/8/4R1K1 w - - 0 1";
        const pvUci = ["d5d6", "e8f8", "d6e7"];
        expect(replayTacticalLine(fen, ["d5d6", "a6d6"])).toHaveLength(2);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs).toEqual([]);
    });
    test("promotion counterplay outweighs winning the pinned knight", () => {
        const fen = "4k3/4n3/8/3P4/2B5/8/p5K1/4R3 w - - 0 1";
        const pvUci = ["d5d6", "e8f8", "d6e7"];
        const reply = replayTacticalLine(fen, ["d5d6", "a2a1q"]);
        expect(reply).toHaveLength(2);
        expect(reply[1].after.isCheck()).toBe(false);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs).toEqual([]);
    });
    test("a checking bishop skewers king and queen", () => {
        const fen = "8/7q/8/5k2/2B5/8/8/6K1 w - - 0 1";
        const pvUci = ["c4d3", "f5g5", "d3h7"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]?.id).toBe("skewer");
    });
    test("a pawn interposition refutes the apparent skewer", () => {
        const fen = "8/7q/8/4pk2/2B5/8/8/6K1 w - - 0 1";
        const pvUci = ["c4d3", "f5g5", "d3h7"];
        expect(replayTacticalLine(fen, ["c4d3", "e5e4"])).toHaveLength(2);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs).toEqual([]);
    });
    test("taking a supported skewering bishop with the queen still loses material", () => {
        const fen = "1k6/7r/8/5q2/2B5/8/2P2PPP/6K1 w - - 0 1";
        const pvUci = ["c4d3", "f5d3", "c2d3"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]?.id).toBe("skewer");
    });
    test("the queen can safely take an unsupported skewering bishop", () => {
        const fen = "1k6/7r/8/5q2/2B5/8/5PPP/6K1 w - - 0 1";
        const pvUci = ["c4d3", "f5e6", "d3h7"];
        expect(replayTacticalLine(fen, ["c4d3", "f5d3"])).toHaveLength(2);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs).toEqual([]);
    });
    test("capturing the queen's defender with check explains the larger gain", () => {
        const fen = "8/6k1/5n2/3qP1P1/8/8/8/3R2K1 w - - 0 1";
        const pvUci = ["e5f6", "g7f7", "d1d5"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
        const primary = classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0];
        expect(primary?.id).toBe("capturingDefender");
        expect(primary?.evidence).toContain(
            "knight on f6 that defended the queen on d5, with check",
        );
    });
    test("an already pinned piece was not a legal defender of the queen", () => {
        const fen = "8/6k1/5n2/3qB1P1/8/8/8/3R2K1 w - - 0 1";
        const pvUci = ["e5f6", "g7f7", "d1d5"];
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci }).motifs.map((m) => m.id),
        ).not.toContain("capturingDefender");
    });
    test("when the queen can flee, the proven win is the captured knight", () => {
        const fen = "7k/8/5n2/3qP1P1/8/8/8/3R2K1 w - - 0 1";
        const pvUci = ["e5f6", "h8g8", "d1d5"];
        expect(replayTacticalLine(fen, ["e5f6", "d5e6"])).toHaveLength(2);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]?.id).toBe("hangingPiece");
    });
    test("a later promotion is attached only to its actual ply", () => {
        const fen = "4k3/4n3/8/3P4/2B5/8/8/4R1K1 w - - 0 1";
        const pvUci = ["d5d6", "e8d7", "d6e7", "d7e8", "c4b5", "e8f7", "e7e8q"];
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0].id).toBe("pin");
        expect(result.timeline?.filter((m) => m.id === "promotion")).toEqual([
            expect.objectContaining({ ply: 7, moveUci: "e7e8q" }),
        ]);
    });
    test("ignores arbitrary engine continuations after the skewer reaches a dead draw", () => {
        const fen = "8/7q/8/5k2/2B5/8/8/6K1 w - - 0 1";
        const pvUci = [
            "c4d3",
            "f5e6",
            "d3h7",
            "e6d5",
            "h7d3",
            "d5d4",
            "g1g2",
            "d4c3",
            "g2f3",
            "c3d3",
        ];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(10);
        expect(replayTacticalLine(fen, pvUci)[2].after.isInsufficientMaterial()).toBe(true);
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0].id).toBe("skewer");
        expect(result.timeline?.every((m) => (m.ply ?? 0) <= 3)).toBe(true);
    });
});
