import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

type Case = {
    id: string;
    fen: string;
    line: string[];
    depth?: number;
    cp?: number | null;
    mate?: number | null;
    labels: Record<string, boolean | null>;
};

const input = process.env.DECISION_MOTIF_TRANSFER_INPUT;
const output = process.env.DECISION_MOTIF_TRANSFER_OUTPUT;

test.runIf(input && output)("replays the current motif verifier on exact reviewed lines", () => {
    const suites = JSON.parse(readFileSync(input!, "utf8")) as Record<string, Case[]>;
    const results = Object.fromEntries(Object.entries(suites)
        .filter(([name]) => name.endsWith("-source") || name.endsWith("-engine"))
        .map(([name, cases]) => [name, Object.fromEntries(cases.map(row => {
            const depth = row.depth ?? 18;
            const started = performance.now();
            const scan = buildLiveTacticalScan({
                fen: row.fen, pvUci: row.line, depth, engineName: "Motif transfer replay",
                variations: [{ depth, pvUci: row.line, cp: row.cp, mate: row.mate }],
            });
            const line = scan.variations[0];
            expect(line.lineUci[0]).toBe(row.line[0]);
            return [row.id, {
                root: [...new Set(line.motifs.filter(motif => motif.ply === 1 && motif.moveUci === row.line[0])
                    .map(motif => motif.id))],
                durationMs: performance.now() - started,
            }];
        }))]));
    writeFileSync(output!, JSON.stringify(results), { flag: "wx" });
}, 360_000);
