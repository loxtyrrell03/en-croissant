import { expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { proveCheckingCombination, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import {
    countercheckCaptureCases as cases,
    countercheckCaptureLine as line,
} from "./fixtures/checkingCountercheckCapture";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const inputs = [false, true].flatMap((reflected) =>
    cases.map((row) => ({
        ...row,
        id: `${row.id}${reflected ? ":reflected" : ""}`,
        fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
        pvUci: reflected ? line.map(reflectMixedForkMove) : line,
    })),
);

test.each(inputs)(
    "capture expendable countercheckers, without ignoring stronger resources: $id",
    (row) => {
        const steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(row.pvUci.length);
        const proof = proveCheckingCombination(steps);
        expect(Boolean(proof)).toBe(row.proved);
        if (!proof) return;
        expect(proof.gain).toBe(500);
        expect(proof.gain).toBe(Math.min(...proof.branches.map((branch) => branch.gain)));
        expect(proof.visits).toBeLessThanOrEqual(32768);
        expect(proof.branches).toHaveLength(
            [...steps[0].after.allDests()].reduce((sum, [, dests]) => sum + dests.size(), 0),
        );
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "forcingAttack", ply: 1 });
        // A pre-existing cheaper single-target proof can provide the live bound.
        // That bound must not exceed the independently checked combination.
        expect(result.motifs[0].value).toBeGreaterThanOrEqual(100);
        expect(result.motifs[0].value).toBeLessThanOrEqual(proof.gain);
        expect(result.timeline).toContainEqual(expect.objectContaining({ id: "skewer", ply: 5 }));
    },
);

test("incomplete nomination and exhausted budgets cannot reuse a successful certificate", () => {
    const steps = replayTacticalLine(inputs[0].fen, inputs[0].pvUci);
    expect(proveCheckingCombination(steps)).not.toBeNull();
    for (const limit of [0, 1, -1, NaN, Infinity])
        expect(proveCheckingCombination(steps, limit)).toBeNull();
    expect(proveCheckingCombination(steps.slice(0, 1))).toBeNull();
});

test.skipIf(!process.env.TACTICAL_COUNTERCHECK_PROBES)(
    "export every constructed branch and retained decision for engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const selected: string[] = JSON.parse(process.env.TACTICAL_COUNTERCHECK_CASES ?? "[]");
        const rows = inputs
            .filter((row) => !selected.length || selected.includes(row.id))
            .map((row) => {
                const steps = replayTacticalLine(row.fen, row.pvUci);
                const proof = proveCheckingCombination(steps);
                const defences = proof
                    ? [...steps[0].after.allDests()].flatMap(([from, dests]) =>
                          [...dests].map((to) => {
                              const pos = steps[0].after.clone();
                              pos.play({ from, to });
                              return { fen: makeFen(pos.toSetup()), move: "" };
                          }),
                      )
                    : [];
                const decisions = [
                    { fen: row.fen, move: "" },
                    { fen: row.fen, move: row.pvUci[0] },
                    ...(proof?.decisions ?? []),
                    ...defences,
                ];
                const probes = [
                    ...new Map(
                        decisions.map((decision) => [`${decision.fen}:${decision.move}`, decision]),
                    ).values(),
                ].map((decision, index) => ({
                    id: `${row.id}:${index}`,
                    fen: decision.fen,
                    ...(decision.move ? { searchMove: decision.move } : {}),
                }));
                return { ...row, proof, probes };
            });
        expect(rows.length).toBeGreaterThan(0);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_COUNTERCHECK_PROBES!),
            JSON.stringify(
                {
                    samplePath: "benchmarks/tactical-relevance/quiet-mate-development.json",
                    cases: rows,
                    probes: rows.flatMap((row) => row.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test("independent engine receipts cover the current retained constructed decisions", () => {
    const paths: string[] = process.env.TACTICAL_COUNTERCHECK_ENGINE_REPORTS
        ? JSON.parse(process.env.TACTICAL_COUNTERCHECK_ENGINE_REPORTS)
        : ["benchmarks/tactical-relevance/countercheck-capture-stockfish-18.json"];
    const searches = paths.flatMap((path) => {
        const receipt = JSON.parse(readFileSync(path, "utf8"));
        expect(receipt.completed ?? receipt.searches.length).toBe(
            receipt.requested ?? receipt.searches.length,
        );
        return receipt.searches;
    });
    const records = new Map(
        searches.map((row) => [`${row.fen}:${row.searchMove ?? row.move ?? ""}`, row]),
    );
    for (const row of inputs) {
        const proof = proveCheckingCombination(replayTacticalLine(row.fen, row.pvUci));
        for (const decision of [
            { fen: row.fen, move: "" },
            { fen: row.fen, move: row.pvUci[0] },
            ...(proof?.decisions ?? []),
        ]) {
            const key = `${decision.fen}:${decision.move}`;
            const evidence = records.get(key);
            expect({ case: row.id, key, present: Boolean(evidence) }).toMatchObject({
                present: true,
            });
            const best = evidence.lines?.[0] ?? evidence;
            expect(best.depth).toBe(16);
            expect(!row.proved || (best.cp ?? -Infinity) > 0 || (best.mate ?? -Infinity) > 0).toBe(
                true,
            );
            expect(
                !row.id.startsWith("capturable-battery-rook") ||
                    !decision.move ||
                    (best.cp ?? Infinity) < 0 ||
                    (best.mate ?? Infinity) < 0,
            ).toBe(true);
        }
    }
    if (process.env.TACTICAL_COUNTERCHECK_PUBLIC_REPORT)
        writeFileSync(
            process.env.TACTICAL_COUNTERCHECK_PUBLIC_REPORT,
            JSON.stringify(
                {
                    scope: "Constructed checking-attack controls; finite-depth full-position scores, not local bounds or representative accuracy.",
                    engine: "Stockfish 18",
                    searches: searches.map((evidence) => {
                        const best = evidence.lines?.[0] ?? evidence;
                        return {
                            id: evidence.id,
                            fen: evidence.fen,
                            move: evidence.searchMove ?? evidence.move ?? "",
                            depth: best.depth,
                            cp: best.cp,
                            mate: best.mate,
                            pvUci: best.pvUci,
                            pvSan: best.pvSan,
                        };
                    }),
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
});
