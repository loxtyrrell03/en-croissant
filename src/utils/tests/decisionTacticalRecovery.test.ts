import { expect, test } from "vitest";
import cases from "../../../benchmarks/decision-evidence/compared-exchange-outcomes/input.json";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import { compareTacticalRecovery } from "../tacticalMotifs/decisionTacticalRecovery";

function example(event: "karlstad" | "lorca") {
    const key = event === "karlstad" ? "dd622ad81f48cc4a" : "bbaeca114c6d471d";
    const row = cases.find(({ id }) => id.includes(key))!;
    const input: DecisionAssessmentInput = {
        ...row,
        comparisonCandidates: row.comparisonCandidates ?? undefined,
    };
    const better = input.comparisonCandidates![0];
    const played = input.comparisonCandidates!.find(
        ({ pvUci }) => pvUci[0] === input.playedMoveUci,
    )!;
    const reply = (move: string) =>
        input.replyProbes!.find(({ moveUci }) => moveUci === move)!.lines[0];
    return {
        input,
        better,
        played,
        betterReply: reply(better.pvUci[0]),
        playedReply: reply(played.pvUci[0]),
    };
}

test.each([
    [
        "karlstad",
        "c2a1",
        "Ne5",
        "the rook that started on d8",
        "the knight on f3 is pinned to the king",
    ],
    ["lorca", "g5f7", "Kg8", "the queen that started on f4", "the rook still occupies g8"],
] as const)(
    "shows the legal recovery after the shared capture in %s",
    (event, capture, move, victim, reason) => {
        const { input, better, played, betterReply, playedReply } = example(event);
        const evidence = compareTacticalRecovery(
            input.fen,
            better,
            played,
            betterReply,
            playedReply,
        );
        expect(evidence?.explanation).toContain(`${move} is legal immediately`);
        expect(evidence?.explanation).toContain(victim);
        expect(evidence?.explanation).toContain(reason);
        expect([
            evidence?.betterLineUci[1],
            evidence?.playedLineUci[1],
            evidence?.confirmedBetterLineUci[1],
            evidence?.confirmedPlayedLineUci[1],
        ]).toEqual([capture, capture, capture, capture]);
    },
);

test("rejects divergent searches, incomplete recovery, and a probe for the wrong board", () => {
    const { input, better, played, betterReply, playedReply } = example("karlstad");
    for (const change of [
        { fen: input.fen },
        { cp: -150 },
        { depth: 12 },
        { pvUci: betterReply.pvUci.slice(0, 5) },
        { pvUci: playedReply.pvUci },
        { upperbound: true },
    ]) {
        expect(
            compareTacticalRecovery(
                input.fen,
                better,
                played,
                { ...betterReply, ...change },
                playedReply,
            ),
        ).toBeNull();
    }
});

test("attaches the evidence to the played mistake and preserves the position and move assessments", () => {
    const { input, better } = example("karlstad");
    const missingConfirmation = {
        ...input,
        replyProbes: input.replyProbes!.filter(({ moveUci }) => moveUci !== better.pvUci[0]),
    };
    const confirmed = assessChessDecision(input);
    const partial = assessChessDecision(missingConfirmation);
    expect(confirmed?.mistake).toMatchObject({
        category: "tactical",
        tactical: { basis: "engine-supported" },
        tacticalRecovery: { explanation: expect.stringContaining("the knight on f3 is pinned") },
    });
    expect(partial?.mistake?.tacticalRecovery).toBeUndefined();
    expect(confirmed?.position).toEqual(partial?.position);
    expect(confirmed?.moves).toEqual(partial?.moves);
});
