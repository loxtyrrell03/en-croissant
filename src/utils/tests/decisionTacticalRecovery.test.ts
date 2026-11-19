import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import cases from "../../../benchmarks/decision-evidence/compared-exchange-outcomes/input.json";
import deeper from "../../../benchmarks/decision-evidence/tactical-recovery/deeper.json";
import notation from "../../../benchmarks/decision-evidence/conditional-recovery/san-variance.json";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import { compareTacticalRecovery } from "../tacticalMotifs/decisionTacticalRecovery";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";

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

test("an independent lower-ranked opponent reply can corroborate the recorded mistake", () => {
    const input = deeper.find(({ id }) => id.includes("dd622ad81f48cc4a"))!;
    const better = input.comparisonCandidates[0];
    const probes = input.replyProbes.map((probe) =>
        probe.moveUci === better.pvUci[0] ? { ...probe, lines: probe.lines.slice(0, 1) } : probe,
    );
    const leaderOnly = assessChessDecision({ ...input, replyProbes: probes });
    const all = assessChessDecision(input);
    expect(leaderOnly?.mistake?.tacticalRecovery).toBeUndefined();
    expect(all?.mistake?.tacticalRecovery?.confirmedBetterLineUci.slice(0, 3)).toEqual([
        "g2g1",
        "c2a1",
        "f3e5",
    ]);
    expect(all?.position).toEqual(leaderOnly?.position);
});

test("the same cached analysis can independently explain the position", () => {
    const { playedMoveUci, ...input } = deeper.find(({ id }) => id.includes("bbaeca114c6d471d"))!;
    const report = assessChessDecision(input);
    expect(report?.position).toMatchObject({
        category: "tactical",
        tactical: { basis: "engine-supported" },
        tacticalRecovery: { explanation: expect.stringContaining("the rook still occupies g8") },
    });
    expect(report?.position).toEqual(assessChessDecision({ ...input, playedMoveUci })?.position);
    expect(report?.mistake).toBeNull();
});

test("the common capture is shown with check only on the correct board", () => {
    const { fen, better, alternative, confirmBetter, confirmAlternative } = notation;
    const evidence = compareTacticalRecovery(
        fen,
        better,
        alternative,
        confirmBetter,
        confirmAlternative,
    );
    expect(evidence?.explanation).toContain(
        "Bxf7+ after Kg8 and Bxf7 after Kh8 take the same rook.",
    );
});

test("moving the same king to a different square can preserve an equivalent recapture", () => {
    const fen = "k7/p7/8/8/6b1/8/P3R3/4K3 w - - 0 1";
    const better = {
        fen,
        depth: 20,
        cp: 0,
        pvUci: ["e1d1", "g4e2", "d1e2", "a8b7", "e2f3", "b7c6", "f3e4", "a7a5"],
    };
    const alternative = {
        fen,
        depth: 20,
        cp: -500,
        pvUci: ["e1f1", "g4e2", "f1g1", "a7a5", "g1f2", "e2b5", "f2e3", "a8b7"],
    };
    const child = (line: typeof better) => ({
        ...line,
        fen: makeFen(replayTacticalLine(fen, line.pvUci)[0].after.toSetup()),
        cp: -line.cp,
        pvUci: line.pvUci.slice(1),
    });
    expect(replayTacticalLine(fen, ["e1f1", "g4e2", "f1e2"])).toHaveLength(3);
    expect(
        compareTacticalRecovery(fen, better, alternative, child(better), child(alternative)),
    ).toBeNull();
});
