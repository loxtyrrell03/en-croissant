import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { nominateBlockedResources, verifyBlockedResource } from "blocked-resource";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";

type Row = DecisionAssessmentInput & { id: string };
type Compared = {
    id: string;
    resource: string;
    betterFen: string;
    playedFen: string;
    good: { lines: DecisionEngineLine[] };
    bad: { lines: DecisionEngineLine[] };
};
const input = process.env.BLOCKED_INPUT!;
const output = process.env.BLOCKED_OUTPUT!;
const checkpoints = process.env.BLOCKED_CHECKS!;

function assertWitnessAgainstControls(row: Row, proof: Compared, nomination: ReturnType<typeof nominateBlockedResources>[number]) {
    const probes = { better: proof.good.lines, played: proof.bad.lines };
    const withBadFen = { ...probes, played: [{ ...probes.played[0], fen: row.fen }] };
    const noRunnerUp = { ...probes, better: probes.better.slice(0, 1) };
    const shallow = { ...probes, played: [{ ...probes.played[0], depth: 12 }] };
    expect(verifyBlockedResource(row.fen, nomination, withBadFen, row.history)).toBeNull();
    expect(verifyBlockedResource(row.fen, nomination, noRunnerUp, row.history)).toBeNull();
    expect(verifyBlockedResource(row.fen, nomination, shallow, row.history)).toBeNull();
}

test("replays fixed histories and verifies the checkpoint and its competing replies", () => {
    const data = JSON.parse(readFileSync(input, "utf8")) as Row[];
    const rows = new Map(data.map((row) => [row.id, row]));
    const [, ...frames] = readFileSync(checkpoints, "utf8").trim().split(/\r?\n/);
    const results = frames.map((line) => {
        const proof = JSON.parse(line) as Compared;
        const row = rows.get(proof.id);
        if (!row) throw new Error("Missing root frame for " + proof.id);
        const [best, actual] = row.comparisonCandidates ?? [];
        const replies = (move: string) =>
            row.replyProbes?.find((q) => q.moveUci === move)?.lines ?? [];
        if (!best || !actual) return { id: row.id, unavailable: "missing-root-pair" };
        const nominees = nominateBlockedResources(row.fen, best, actual, replies(best.pvUci[0]), replies(actual.pvUci[0]), row.history);
        const nomination = nominees.find((item) => item.resource === proof.resource &&
            item.better.fen === proof.betterFen && item.played.fen === proof.playedFen);
        if (!nomination) return { id: row.id, unavailable: "unmatched-request" };
        const verified = verifyBlockedResource(row.fen, nomination, { better: proof.good.lines, played: proof.bad.lines }, row.history);
        if (verified) assertWitnessAgainstControls(row, proof, nomination);
        return { id: row.id, verified };
    });
    writeFileSync(output, JSON.stringify(results), { flag: "wx" });
});

test("rejects a landing obstacle when removing it leaves the defending piece pinned", () => {
    const root = "4r1k1/p7/8/8/1B6/8/4Q3/4K3 w - - 0 1";
    const better = { fen: root, cp: 0, depth: 20, pvUci: ["e1f1", "a7a6", "e2d2"] };
    const played = { fen: root, cp: -200, depth: 20, pvUci: ["b4d2", "a7a6", "d2f4"] };
    const bestReply = { ...better, fen: "4r1k1/p7/8/8/1B6/8/4Q3/5K2 b - - 1 1", pvUci: better.pvUci.slice(1) };
    const playedReply = { ...played, cp: 200, fen: "4r1k1/p7/8/8/8/8/3BQ3/4K3 b - - 1 1", pvUci: played.pvUci.slice(1) };
    expect(nominateBlockedResources(root, better, played, [bestReply], [playedReply])).toEqual([]);
});
test("recognises the physical landing obstruction when the same defender is free to move", () => {
    const root = "r5k1/p7/8/8/1B6/8/4Q3/4K3 w - - 0 1";
    const better = { fen: root, cp: 0, depth: 20, pvUci: ["e1f1", "a7a6", "e2d2"] };
    const played = { fen: root, cp: -200, depth: 20, pvUci: ["b4d2", "a7a6", "d2f4"] };
    const goodReply = { ...better, fen: "r5k1/p7/8/8/1B6/8/4Q3/5K2 b - - 1 1", pvUci: better.pvUci.slice(1) };
    const badReply = { ...played, cp: 200, fen: "r5k1/p7/8/8/8/8/3BQ3/4K3 b - - 1 1", pvUci: played.pvUci.slice(1) };
    const options = nominateBlockedResources(root, better, played, [goodReply], [badReply]);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ resource: "e2d2", blocker: { role: "bishop", kind: "landing" } });
});
