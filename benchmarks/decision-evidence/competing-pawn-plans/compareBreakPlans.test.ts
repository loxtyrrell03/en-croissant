import { expect, test } from "vitest";
import fixtures from "./fixtures.json";
import { compareBreakPlans, findRepeatedBreak } from "./compareBreakPlans";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

type Fixture = Pick<DecisionAssessmentInput, "fen" | "candidates"> &
    Required<Pick<DecisionAssessmentInput, "replyProbes">>;

function move({ fen, candidates, replyProbes }: Fixture, delayed: boolean) {
    return findRepeatedBreak(fen, candidates[0], replyProbes[0].lines[0], delayed);
}

test("preserves the original recapture and rook file across quiet in-between moves", () => {
    expect(move(fixtures.lateRecapture, false)).toBeNull();
    const after = move(fixtures.lateRecapture, true);
    expect(after).toMatchObject({ target: "g4", file: "h", rookInBoth: true });
    expect(after?.description).toContain("Rh1");
    expect(after?.linesUci[0]).toContain("h1h3");
});

test("recovers a pawn on the exchange file without counting the exchange itself as rook use", () => {
    expect(move(fixtures.laterRookCapture, false)?.rookInBoth).toBe(false);
    expect(move(fixtures.laterRookCapture, true)).toMatchObject({
        target: "c5",
        file: "b",
        rookInBoth: true,
        description: expect.stringContaining("Rxb4"),
    });
});

test("keeps different breaks separate when viable roots attack the same central pawn", () => {
    const { fen, candidates } = fixtures.differentLevers;
    expect(compareBreakPlans(fen, candidates, false, true)).toMatchObject({
        mode: "different breaks",
        description: expect.stringMatching(/f5.*f-file.*d5.*d-file/),
    });
});

test("abstains on repeated rook use when the longer search recaptures with the queen", () => {
    expect(move(fixtures.differentSupport, true)).toMatchObject({
        target: "e4",
        file: "d",
        rookInBoth: false,
        rookInOne: false,
    });
});
