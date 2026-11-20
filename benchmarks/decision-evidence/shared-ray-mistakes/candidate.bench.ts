import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { compareSharedRay, nominateSharedRay } from "./candidate";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("replays the candidate and accounts for cached versus restricted replies", () => {
    const rows = JSON.parse(readFileSync(process.env.RAY_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    const results = rows.map(row => {
        const [best, played] = row.comparisonCandidates ?? [];
        if (!best || !played || best.pvUci[0] !== row.candidates[0]?.pvUci[0]
            || played.pvUci[0] !== row.playedMoveUci)
            return { id: row.id };
        const reply = row.replyProbes?.find(probe => probe.moveUci === row.playedMoveUci)?.lines[0];
        if (!reply) return { id: row.id };
        const nomination = nominateSharedRay(row.fen, best, played, reply);
        if (!nomination) return { id: row.id };
        const cached = row.replyProbes?.find(probe => probe.moveUci === nomination.betterMoveUci)
            ?.lines.find(line => line.depth >= 16 && line.pvUci[0] === nomination.replyUci);
        return {
            id: row.id,
            nomination: cached ? "cached" : "restricted",
            result: compareSharedRay(
                row.fen, best, played, reply,
                cached ? { ...nomination, line: cached } : row.sharedReply,
            ),
        };
    });
    writeFileSync(process.env.RAY_OUTPUT!, JSON.stringify(results, null, 2) + "\n", { flag: "wx" });
}, 120_000);
