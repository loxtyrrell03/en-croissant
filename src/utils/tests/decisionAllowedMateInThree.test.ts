import { expect, test } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/played-mate-in-three/fixtures.json";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import { findAllowedMateInThree } from "../tacticalMotifs/decisionAllowedMateInThree";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";

function prove(input: DecisionAssessmentInput) {
    return findAllowedMateInThree(
        input.fen,
        input.candidates[0],
        input.playedMoveUci,
        input.comparisonCandidates ?? [],
        [],
        input.history,
    );
}

test("the exact high-depth pair certifies mate when the separate reply is too shallow", () => {
    const fixture = fixtures.newYork;
    expect(fixture.candidates[0].depth).toBeLessThan(16);
    expect(assessChessDecision(fixture)?.mistake?.mateConsequence).toMatchObject({
        mateIn: 3,
        proof: "legal",
        avoidingLineUci: ["a6f1", "f3f2", "f1f2"],
    });
});

test("a quiet mating start and its legal defence are exposed without the played-reply search", () => {
    const fixture = fixtures.biel;
    const outcome = prove(fixture);
    expect(outcome).toMatchObject({
        kind: "allowed",
        mateIn: 3,
        proof: "legal",
        avoidingLineUci: ["d6d5", "d1h5", "g7h6"],
    });
    expect(outcome?.lineUci.slice(0, 2)).toEqual(["f6e4", "d1h5"]);
    const line = replayTacticalLine(fixture.fen, outcome!.lineUci);
    expect(line).toHaveLength(6);
    expect(line.at(-1)?.after.isCheckmate()).toBe(true);
});

test("a mate nomination alone cannot certify a shorter mate", () => {
    const fixture = fixtures.tooShort;
    const comparison = fixture.comparisonCandidates.map((line) =>
        line.pvUci[0] === fixture.playedMoveUci ? { ...line, cp: null, mate: -3 } : line,
    );
    expect(prove({ ...fixture, comparisonCandidates: comparison })).toBeNull();
});

test("a misleading finite score cannot hide a different short mate after the alternative", () => {
    const fixture = fixtures.bothLost;
    const candidate = { ...fixture.candidates[0], cp: -400, mate: null };
    const paired = { ...fixture.comparisonCandidates[0], cp: -400, mate: null };
    expect(
        prove({
            ...fixture,
            candidates: [candidate],
            comparisonCandidates: [paired, fixture.comparisonCandidates[1]],
        }),
    ).toBeNull();
});

test("an unrelated history cannot supply the defensive or mating proof", () => {
    expect(
        prove({
            ...fixtures.biel,
            history: { fen: fixtures.copa.fen, moves: [] },
        }),
    ).toBeNull();
});

test("a shallower complete pair can nominate a mate against the same leading choice", () => {
    const fixture = fixtures.separateDepth;
    expect(fixture.comparisonCandidates[0].depth).toBeLessThan(fixture.candidates[0].depth);
    expect(prove(fixture)).toMatchObject({
        mateIn: 3,
        proof: "legal",
        avoidingLineUci: ["e2g1", "d7h3", "g3h3"],
    });
});
