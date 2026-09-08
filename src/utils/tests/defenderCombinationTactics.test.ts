import { expect, test } from "vitest";
import {
    proveDefenderCombination,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalExchangeGain,
} from "@/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";

const fen = "3r1rk1/1b2n1p1/pb2P2p/1p1n1p2/2p1BN1B/5N1P/P4PP1/3RR1K1 w - - 0 26";
const line = ["e4d5", "d8d5", "h4e7", "d5d1", "e1d1"];

test("real Bxd5 explains removal, simultaneous attack, and the rook behind the target", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0]).toMatchObject({ id: "capturingDefender", ply: 1, value: 160 });
    expect(result.motifs[0].evidence).toContain("knight on d5 that defended the knight on e7");
    expect(result.motifs[0].evidence).toContain("bishop on b7");
    expect(result.motifs[0].evidence).toContain("rook on d8");
    expect(result.motifs[0].evidence).not.toContain("pawn on c4");
    expect(tacticalBoardEvidence(fen, line, result.motifs[0])).toEqual({
        square: "d5",
        arrows: [
            { from: "d5", to: "e7" },
            { from: "h4", to: "e7" },
        ],
    });
});

test.each([
    ["d8d5", "h4e7"], // Rxd5: take the now undefended knight.
    ["e7d5", "h4d8"], // Nxd5: take the rook behind the knight.
    ["g7g5", "d5b7"], // Block Bh4: take the simultaneous bishop target.
    ["f8f6", "d5b7"], // Defend Ne7: the bishop remains available.
])("the headline is stable for the actual defensive choice %s", (reply, answer) => {
    const pvUci = ["e4d5", reply, answer];
    expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
    expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]?.id).toBe("capturingDefender");
});

test("a checking counter-capture has a real legal answer, not an ignored check", () => {
    const pvUci = ["e4d5", "b6f2", "g1f2", "e7d5", "h4d8"];
    expect(replayTacticalLine(fen, pvUci)).toHaveLength(5);
    expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]?.id).toBe("capturingDefender");
});

test.each([
    "3r1rk1/1b2n1p1/pb2P2p/1p1n1p2/2p1BN2/5N1P/P4PP1/3RR1K1 w - - 0 26",
    "3r1rk1/4n1p1/pb2P2p/1p1n1p2/2p1BN1B/5N1P/P4PP1/3RR1K1 w - - 0 26",
])("withholds the extended removal when a causal attacking resource is missing", (controlFen) => {
    const result = classifyPositionTacticalMotifs({ fen: controlFen, pvUci: ["e4d5"] });
    expect(result.motifs.map((motif) => motif.id)).not.toContain("capturingDefender");
});

test("the combination needs its extra targets and cannot reuse a larger-budget success", () => {
    const step = replayTacticalLine(fen, ["e4d5"])[0];
    expect(tacticalExchangeGain(step.before, step.move)).toBe(-10);
    expect(proveDefenderCombination(step, [52, 59, 49], [31, 35])).toBe(160);
    expect(proveDefenderCombination(step, [52, 59, 49], [31, 35], 0)).toBeNull();
    expect(proveDefenderCombination(step, [52], [31])).toBeNull();
});
