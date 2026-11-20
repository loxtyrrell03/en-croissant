import { describe, expect, test } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/defence-after-attack/fixtures.json";
import type { DecisionAssessmentInput } from "../tacticalMotifs/decisionAssessment";
import {
    confirmCheckingDefence,
    confirmPassedAdvance,
    nominateCheckingDefence,
} from "../tacticalMotifs/decisionCheckingDefence";

function exactChoices(input: DecisionAssessmentInput) {
    const [better, played] = input.comparisonCandidates!;
    const reply = (move: string) =>
        input.replyProbes!.find((probe) => probe.moveUci === move)!.lines[0];
    return [input.fen, better, played, reply(better.pvUci[0]), reply(played.pvUci[0])] as const;
}

describe("defensive capture against the same attack", () => {
    const pawn = fixtures.passedPawn;
    const choices = exactChoices(pawn.input);

    test("recognises that the same queen can take the checker from different squares", () => {
        const { input } = fixtures.sameQueenMoved;
        expect(nominateCheckingDefence(...exactChoices(input), input.history)).toBeNull();
    });

    test("verifies the rook defence and separately confirms restraint of the passed pawn", () => {
        expect(nominateCheckingDefence(...choices)).toMatchObject({
            better: { fen: pawn.expectedBoards[0], prefix: ["f8f7", "e6e7"] },
            played: { fen: pawn.expectedBoards[1], prefix: ["c6d7", "e6e7"] },
            captures: ["f7e7"],
        });
        const verified = confirmCheckingDefence(...choices, pawn.checkingDefence)!;
        expect(verified.episode.explanation).toMatch(/Kd7, Re7\+.*Rxe7\+.*Rf7/);
        expect(verified.episode.controlLineUci?.slice(0, 3)).toEqual(["f8f7", "e6e7", "f7e7"]);
        expect(verified.pawnRequest?.advance).toBe("d6d7");
        const positional = confirmPassedAdvance(
            choices[0],
            choices[1],
            choices[2],
            verified.pawnRequest!,
            pawn.passedAdvance,
        );
        expect(positional?.factor).toMatchObject({
            feature: "passed-pawn",
            interpretation: "heuristic",
            squareOrFile: "d",
        });
        expect(positional?.testedAdvanceLines.map((line) => line.slice(5, 7))).toEqual([
            ["d6d7", "f5d7"],
            ["d6d7", "f7d7"],
        ]);
    });

    test("requires both independent reply boards and the exact legal defensive capture", () => {
        const wrongBoard = { ...choices[4], fen: choices[3].fen };
        const [fen, best, played, betterReply] = choices;
        expect(nominateCheckingDefence(fen, best, played, betterReply, wrongBoard)).toBeNull();
        const uncaptured = { ...pawn.checkingDefence.capture, pvUci: ["f7f6"] };
        expect(
            confirmCheckingDefence(...choices, { ...pawn.checkingDefence, capture: uncaptured }),
        ).toBeNull();
        const weaker = fixtures.punishmentUnclear;
        expect(
            nominateCheckingDefence(...exactChoices(weaker.input), weaker.input.history),
        ).toBeTruthy();
        expect(
            confirmCheckingDefence(
                ...exactChoices(weaker.input),
                weaker.checkingDefence,
                weaker.input.history,
            ),
        ).toBeNull();
    });

    test("a tactical comparison can stand alone, while partial pawn checks cannot support the positional claim", () => {
        const control = fixtures.missingDefence;
        const verified = confirmCheckingDefence(
            ...exactChoices(control.input),
            control.checkingDefence,
            control.input.history,
        );
        expect(verified?.episode.explanation).toMatch(/Bd5\+.*exd5/);
        expect(verified?.pawnRequest).toBeNull();
        const request = confirmCheckingDefence(...choices, pawn.checkingDefence)!.pawnRequest!;
        const assess = (replies: typeof pawn.passedAdvance) =>
            confirmPassedAdvance(choices[0], choices[1], choices[2], request, replies);
        expect(assess(pawn.passedAdvance.slice(0, 1))).toBeNull();
        expect(assess(pawn.passedAdvance.toReversed())).toBeNull();
        expect(assess([pawn.passedAdvance[0], { ...pawn.passedAdvance[1], depth: 15 }])).toBeNull();
    });
});
