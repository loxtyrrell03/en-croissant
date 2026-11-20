import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { nominatePasserFlight } from "@/utils/tacticalMotifs/decisionPasserFlight";

type Row = DecisionAssessmentInput & { id: string };

test("the app nomination agrees with the research screen", () => {
    const datasets = JSON.parse(readFileSync(process.env.PASSER_FLIGHT_SCREEN!, "utf8")) as Record<
        string,
        Row[]
    >;
    const stats = Object.fromEntries(
        Object.entries(datasets).map(([name, rows]) => {
            const start = performance.now();
            const hits = rows.flatMap((row) => {
                const choices = row.comparisonCandidates ?? row.candidates ?? [];
                const better = choices[0];
                const played = choices.find((line) => line.pvUci[0] === row.playedMoveUci);
                if (!better || !played || better === played) return [];
                const replies =
                    row.replyProbes?.find((probe) => probe.moveUci === row.playedMoveUci)?.lines ??
                    [];
                return nominatePasserFlight(row.fen, better, played, replies, row.history)
                    ? [row.id]
                    : [];
            });
            return [name, { inputs: rows.length, hits, elapsedMs: performance.now() - start }];
        }),
    );
    expect(stats.archive.hits).toEqual(["passer-pair-24058c51cfa95ff0"]);
    expect(stats.fresh.hits).toEqual([]);
    expect(stats.stress.hits).toEqual([]);
    writeFileSync(process.env.PASSER_FLIGHT_OUTPUT!, JSON.stringify(stats), { flag: "wx" });
});
