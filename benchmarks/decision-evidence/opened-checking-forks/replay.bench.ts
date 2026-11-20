import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { compareOpenedCheckingAttack } from "@/utils/tacticalMotifs/decisionOpenedCheckingAttack";
import { compareOpenedCheckingAttack as stationaryOnly } from "./stationary";

type Case = DecisionAssessmentInput & { id: string };

function measureArms(input: Case) {
    const pair = input.comparisonCandidates ?? input.candidates;
    const better = pair[0];
    const played = pair.find((line, index) => index > 0 && line.pvUci[0] === input.playedMoveUci);
    if (!better || !played) return null;
    const reply = (move: string) =>
        input.replyProbes?.find((probe) => probe.moveUci === move)?.lines[0];
    const betterReply = reply(better.pvUci[0]);
    const playedReply = reply(played.pvUci[0]);
    if (!betterReply || !playedReply) return null;
    const frames = [input.fen, better, played, betterReply, playedReply, input.history] as const;
    return {
        stationary: stationaryOnly(...frames) !== null,
        tracked: compareOpenedCheckingAttack(...frames) !== null,
    };
}

test.runIf(!!process.env.OPENED_OUTPUT)(
    "replays the decision worker and both verifiers",
    () => {
        const source = process.env.OPENED_INPUT ?? new URL("./reserve.json", import.meta.url);
        const rows = JSON.parse(readFileSync(source, "utf8")) as Case[];
        expect(rows.length).toBeGreaterThan(0);
        expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
        const output = rows.map(({ id, ...input }) => {
            const start = performance.now();
            const report = classify(input, "Stockfish 19", input.history);
            const ms = performance.now() - start;
            const arms = measureArms({ id, ...input });
            return { id, report, ms, arms };
        });
        writeFileSync(process.env.OPENED_OUTPUT!, JSON.stringify(output), { flag: "wx" });
    },
    250_000,
);
