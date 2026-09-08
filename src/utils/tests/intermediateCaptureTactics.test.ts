import { expect, test } from "vitest";
import {
    intermediateCaptureProof,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "@/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";

const examples = [
    {
        fen: "2k1r2R/ppp5/4p3/5nb1/3Pb3/2P5/PP1QNP2/2KR4 b - - 0 24",
        line: ["g5d2", "d1d2", "e8h8"],
        gain: 1070,
    },
    {
        fen: "1r1q1rk1/R3nppp/3pb3/1p1Np3/4P2P/2P1b3/1P3PP1/3QKB1R w K - 0 18",
        line: ["d5e7", "g8h8", "f2e3"],
        gain: 650,
    },
];
test.each(examples)("real move-order proof: $line", ({ fen, line, gain }) => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(3);
    expect(intermediateCaptureProof(steps[0])).toMatchObject({ gain });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs[0]).toMatchObject({
        id: "intermezzo",
        confidence: "high",
        ply: 1,
    });
    const primary = classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs[0];
    expect(primary.evidence).toContain("Playing");
    expect(tacticalBoardEvidence(fen, line, primary)?.arrows).toEqual([
        { from: line[2].slice(0, 2), to: line[2].slice(2, 4) },
    ]);
});

test("the same cause survives a queen capture of the checking knight", () => {
    const fen = examples[1].fen;
    const pvUci = ["d5e7", "d8e7", "a7e7"];
    expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "intermezzo", value: 650 });
    expect(result.motifs[0].evidence).toContain("before fxe3");
});

test("a cooperative king move cannot hide the safe queen recapture", () => {
    const fen = "1r1q1rk1/4nppp/3pb3/1p1Np3/4P2P/2P1b3/1P3PP1/3QKB1R w K - 0 18";
    expect(replayTacticalLine(fen, examples[1].line)).toHaveLength(3);
    expect(replayTacticalLine(fen, ["d5e7", "d8e7", "f2e3"])).toHaveLength(3);
    expect(intermediateCaptureProof(replayTacticalLine(fen, examples[1].line)[0])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: examples[1].line }).motifs.map((m) => m.id),
    ).not.toContain("intermezzo");
});

test("two captures are not an intermediate check if the first does not check", () => {
    const fen = "1r1qr2k/R3nppp/3pb3/1p1Np3/4P2P/2P1b3/1P3PP1/3QKB1R w K - 0 18";
    const line = ["d5e7", "f7f6", "f2e3"];
    expect(replayTacticalLine(fen, line)).toHaveLength(3);
    expect(intermediateCaptureProof(replayTacticalLine(fen, line)[0])).toBeNull();
});

test("a checking capture is not a move-order lesson when the victim cannot escape anyway", () => {
    const fen = "1r1q1rk1/R3pppp/3pP3/1p1Np3/4P2P/2P1b3/1P3PP1/3QKB1R w K - 0 18";
    expect(replayTacticalLine(fen, examples[1].line)).toHaveLength(3);
    expect(intermediateCaptureProof(replayTacticalLine(fen, examples[1].line)[0])).toBeNull();
});

test("the bounded proof does not return a partial result after exhaustion", () => {
    const step = replayTacticalLine(examples[0].fen, examples[0].line)[0];
    expect(intermediateCaptureProof(step)).not.toBeNull();
    expect(intermediateCaptureProof(step, 0)).toBeNull();
});
