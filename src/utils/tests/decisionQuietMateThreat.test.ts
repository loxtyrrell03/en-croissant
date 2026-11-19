import { expect, test } from "vitest";
import examples from "../../../benchmarks/decision-evidence/quiet-mate-threats/examples.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { findQuietMateThreat } from "../tacticalMotifs/decisionQuietMateThreat";

test("a quiet move can demand a defence to a concrete mate", () => {
    const { montenegro } = examples;
    const report = assessChessDecision(montenegro);
    const evidence = {
        defenceLinesUci: [["e7h4", "f1e1"]],
        ignoredLineUci: ["e7h4", "c1c3", "h4h2"],
        exampleWasSearched: true,
        explanation: "Qh4 threatens Qh2#. Re1 stops immediate mate. Rc3 allows Qh2#.",
    };
    expect(report?.position).toMatchObject({
        category: "tactical",
        tactical: { basis: "bounded-proof" },
        quietMateThreat: evidence,
    });
    expect(report?.moves[0]).toMatchObject({ category: "tactical", quietMateThreat: evidence });
    expect(report?.mistake).toBeNull();
    expect(
        assessChessDecision({ ...montenegro, replyProbes: [] })?.position.quietMateThreat,
    ).toBeUndefined();
});

test("independent searches can corroborate the threat with two different defences", () => {
    const report = assessChessDecision(examples.twoDefences);
    expect(report?.position.quietMateThreat).toMatchObject({
        defenceLinesUci: [
            ["g7g5", "e2e1"],
            ["g7g5", "e2f2"],
        ],
        exampleWasSearched: false,
        explanation: expect.stringContaining("Re1 and Rf2 each stop immediate mate."),
    });
    expect(report?.mistakeStatus).toBe("best-supplied-choice");
});

test("positional evidence can remain supported alongside the quiet threat", () => {
    const report = assessChessDecision(examples.mixed);
    expect(report?.position).toMatchObject({
        category: "mixed",
        tactical: { basis: "bounded-proof", support: "supported" },
        positional: { support: "supported" },
        quietMateThreat: { explanation: expect.stringContaining("Qg4 threatens Qxg7#.") },
    });
});

test("rejects the wrong child board, a losing candidate, and a failed principal defence", () => {
    const { fen, candidates, replyProbes } = examples.montenegro;
    const [main, ...rest] = replyProbes[0].lines;
    expect(findQuietMateThreat(fen, candidates[0], [{ ...main, fen }, ...rest])).toBeNull();
    expect(findQuietMateThreat(fen, { ...candidates[0], cp: -800 }, [main, ...rest])).toBeNull();
    expect(
        findQuietMateThreat(fen, candidates[0], [{ ...main, pvUci: rest[1].pvUci }, ...rest]),
    ).toBeNull();
});
