import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { compareExchangeDefence } from "./exchangeDefence";
import development from "./development.json";

type Case = DecisionAssessmentInput & { id: string };

function compare(row: Case) {
    const pair = row.comparisonCandidates ?? row.candidates;
    const better = pair[0];
    const played = pair.find((line, index) => index > 0 && line.pvUci[0] === row.playedMoveUci);
    if (!better || !played) return null;
    const reply = (move: string) =>
        row.replyProbes?.find((probe) => probe.moveUci === move)?.lines[0];
    const before = reply(better.pvUci[0]);
    const after = reply(played.pvUci[0]);
    return before && after ? compareExchangeDefence(row.fen, better, played, before, after) : null;
}

test("corroborates the defended pawn capture and its stronger control", () => {
    const evidence = compare(development);
    expect(classify(development, "Stockfish 19")?.mistake?.category).toBe("positional");
    expect(evidence?.branchUci).toEqual(["c1b1", "h6f4", "g3f4", "e6h3", "g2h3", "a3f3"]);
    expect(evidence?.controlUci).toEqual(["f3d4", "h6f4", "g3f4", "e6h3", "g2h3"]);
    expect(evidence?.explanation).toContain("Rxf3 to win the knight on f3");
    expect(evidence?.throughPly).toBe(6);
});

test("refuses inconsistent or missing opponent searches", () => {
    const replies = development.replyProbes.map((entry) =>
        entry.moveUci === development.playedMoveUci
            ? { ...entry, lines: [{ ...entry.lines[0], fen: development.fen }] }
            : entry,
    );
    expect(compare({ ...development, replyProbes: replies })).toBeNull();
    expect(compare({ ...development, replyProbes: [] })).toBeNull();
});

test.runIf(!!process.env.EXCHANGE_OUTPUT)(
    "compares the current decision report and trial verifier",
    () => {
        const input = process.env.EXCHANGE_INPUT ?? new URL("./reserve.json", import.meta.url);
        const rows = JSON.parse(readFileSync(input, "utf8")) as Case[];
        expect(rows.length).toBeGreaterThan(0);
        expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
        const output = rows.map((row) => {
            const start = performance.now();
            const baseline = classify(row, "Stockfish 19", row.history);
            const baselineMs = performance.now() - start;
            const candidateStart = performance.now();
            const evidence = compare(row);
            return {
                id: row.id,
                baseline: baseline?.mistake ?? null,
                baselineStatus: baseline?.mistakeStatus ?? "invalid",
                evidence,
                baselineMs,
                candidateMs: performance.now() - candidateStart,
            };
        });
        writeFileSync(process.env.EXCHANGE_OUTPUT!, JSON.stringify(output), { flag: "wx" });
    },
    240_000,
);
