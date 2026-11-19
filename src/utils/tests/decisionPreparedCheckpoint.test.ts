import { expect, test } from "vitest";
import publicFixtures from "../../../benchmarks/decision-evidence/prepared-tactical-checkpoint/public-fixtures.json";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";

type Fixture = DecisionAssessmentInput & {
    id: string;
    preparedCheckpoint: NonNullable<DecisionAssessmentInput["preparedCheckpoint"]>;
};

const fixtures: Fixture[] = publicFixtures;
const worldAmateur = fixtures.find(({ id }) => id.includes("e8d4d116"))!;
const aruba = fixtures.find(({ id }) => id.includes("0f4e6828"))!;

test("a seven-ply fork supports position character after searching the critical move", () => {
    const original = assessChessDecision({ ...worldAmateur, preparedCheckpoint: undefined })!;
    expect(original.position.category).toBe("unclear");
    expect(original.position.preparedCheckpointRequest?.prefix).toEqual([
        "e3d5",
        "f7f6",
        "d6c6",
        "f6c6",
    ]);
    const verified = assessChessDecision(worldAmateur)!;
    expect(verified.position.category).toBe("tactical");
    expect(verified.position.preparedCheckpoint?.lineUci.slice(-3)).toEqual([
        "d5e7",
        "c8c7",
        "e7c6",
    ]);
    expect(verified.position.tactical.reasons[0]).toContain("3.21");
    expect(verified.moves).toEqual(original.moves);
    expect(verified.mistake).toEqual(original.mistake);
});

test("a costly failure to deflect the queen adds tactical evidence to a positional result", () => {
    const original = assessChessDecision({ ...aruba, preparedCheckpoint: undefined })!;
    expect(original.position.category).toBe("positional");
    const verified = assessChessDecision(aruba)!;
    expect(verified.position.category).toBe("mixed");
    expect(verified.position.positional).toEqual(original.position.positional);
    expect(verified.position.tactical.reasons[0]).toContain("axb6");
});

test("small gaps between viable replies leave the tactical axis unestablished", () => {
    for (const control of fixtures.filter(
        (fixture) => fixture !== worldAmateur && fixture !== aruba,
    )) {
        const original = assessChessDecision({ ...control, preparedCheckpoint: undefined })!;
        expect(original.position.preparedCheckpointRequest).toBeDefined();
        const checked = assessChessDecision(control)!;
        expect(checked.position.category).toBe(original.position.category);
        expect(checked.position.preparedCheckpoint).toBeUndefined();
    }
});

test("the checkpoint search belongs to the exact position in the repeated line", () => {
    const checked = assessChessDecision({
        ...worldAmateur,
        preparedCheckpoint: aruba.preparedCheckpoint,
    })!;
    expect(checked.position.category).toBe("unclear");
    expect(checked.position.preparedCheckpoint).toBeUndefined();
});

test("a single or uncorroborated continuation cannot establish a critical choice", () => {
    const [best] = worldAmateur.preparedCheckpoint;
    expect(
        assessChessDecision({ ...worldAmateur, preparedCheckpoint: [best] })?.position.category,
    ).toBe("unclear");
    expect(
        assessChessDecision({ ...worldAmateur, replyProbes: [] })?.position
            .preparedCheckpointRequest,
    ).toBeUndefined();
});
