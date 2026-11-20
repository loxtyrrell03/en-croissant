import { expect, test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import fixtures from "../../../benchmarks/decision-evidence/interference-in-line/fixtures.json";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { findScoredLineRoutes } from "../tacticalMotifs/lineRouteEvidence";
import { corroborateDecisionLineRoutes } from "../tacticalMotifs/decisionLineRoutes";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { findInterferenceInLine } from "../tacticalMotifs/interferenceInLine";
import {
    mergeTacticalSequenceWitnesses,
    sameTacticalMechanism,
} from "../tacticalMotifs/tacticalSequenceEvidence";

type Frame = Required<Pick<DecisionAssessmentInput, "fen" | "candidates" | "replyProbes">>;
const routes = (frame: Frame) => {
    const [line] = frame.candidates;
    return findScoredLineRoutes(frame.fen, line.pvUci, line.cp, line.mate, line.depth).filter(
        ({ id }) => id === "interference",
    );
};
const repeated = (frame: Frame) =>
    corroborateDecisionLineRoutes(
        frame.fen,
        frame.candidates[0],
        frame.replyProbes[0].lines[0],
    ).filter(({ mechanism }) => mechanism === "interference");

test("proves the original queen recapture was closed off and then used", () => {
    expect(routes(fixtures.direct)[0]).toMatchObject({
        through: 3,
        text: expect.stringMatching(/Nc7\+ blocks the queen on c8.*c5.*Qxc5\+/),
    });
    const [repeatedWitness] = repeated(fixtures.direct);
    expect(repeatedWitness?.squares).toEqual(["c7", "c8", "c5", "b6"]);
    expect(repeatedWitness?.lineUci[0]).toBe(fixtures.direct.candidates[0].pvUci[0]);
});

test("keeps the actual ply when another exchange comes before the cut pays off", () => {
    expect(routes(fixtures.delayed)[0]).toMatchObject({ through: 5 });
    expect(repeated(fixtures.delayed)[0]).toMatchObject({ mechanismPly: 1, payoffPly: 5 });
});

test("separates line-specific use from an agreeing independent defence", () => {
    expect(routes(fixtures.oneSearch)).toHaveLength(1);
    expect(repeated(fixtures.oneSearch)).toHaveLength(0);
    expect(routes(fixtures.merelyAligned)).toHaveLength(0);
});

test("retains the positional reason when both searches confirm quiet interference", () => {
    const assessment = assessChessDecision(fixtures.quietMixed);
    expect(assessment?.position).toMatchObject({
        category: "mixed",
        tactical: { basis: "engine-supported" },
        positional: { basis: "heuristic" },
    });
    expect(assessment?.position.positionalFactors).toEqual(
        expect.arrayContaining([expect.objectContaining({ feature: "pawn-stable-minor" })]),
    );
    expect(assessment?.position.mechanisms).toEqual(
        expect.arrayContaining([expect.objectContaining({ mechanism: "interference" })]),
    );
});

test("does not duplicate a stronger interference lesson in the live scan", () => {
    const frame = fixtures.alreadyNamed;
    const [line] = frame.candidates;
    const scan = buildLiveTacticalScan({
        fen: frame.fen,
        pvUci: line.pvUci,
        depth: line.depth,
        engineName: "Stockfish 19",
        variations: [{ ...line, multipv: 1 }],
    });
    expect(scan.variations[0].motifs.filter((item) => item.id === "interference")).toHaveLength(1);
});

test("preserves different guard roles when routes share a square", () => {
    const [witness] = repeated(fixtures.direct);
    const switched = { ...witness, squares: ["c7", "c5", "c8", "b6"] };
    expect(sameTacticalMechanism(witness, switched)).toBe(false);
    expect(mergeTacticalSequenceWitnesses([witness, switched])).toHaveLength(2);
});

test("recognises the lost recapture in a legal mating branch", () => {
    const steps = replayTacticalLine("5n1k/p7/4N2b/8/4B3/8/8/K4RR1 w - - 0 1", [
        "e6g7",
        "a7a6",
        "f1f8",
    ]);
    expect(steps.map(({ san }) => san)).toEqual(["Ng7", "a6", "Rxf8#"]);
    expect(findInterferenceInLine(steps, false, true)).toMatchObject({
        id: "interference",
        through: 3,
        outcome: { mate: true },
        squares: [54, 47, 61, 5],
    });
});
