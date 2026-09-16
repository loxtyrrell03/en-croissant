import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    proveCheckingCombination,
    proveCheckingMaterialAttack,
    proveMixedCheckingAttack,
    proveQuietMatingAttack,
    replayTacticalLine,
    proveCheckingDiscovery,
} from "../tacticalMotifs/causalTactics";

test.skipIf(
    !process.env.TACTICAL_ATTACK_RECALL_INPUT || !process.env.TACTICAL_ATTACK_RECALL_REPORT,
)(
    "audit unexplained owner checking attacks without changing their engine inputs",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const input = JSON.parse(readFileSync(process.env.TACTICAL_ATTACK_RECALL_INPUT!, "utf8"));
        const selected: string[] = JSON.parse(process.env.TACTICAL_ATTACK_RECALL_IDS ?? "[]");
        expect(selected.length).toBeGreaterThan(0);
        const rows: any[] = input.results.filter((row: any) => selected.includes(row.id));
        expect(rows).toHaveLength(selected.length);
        const results = rows.map((row: any) => {
            const steps = replayTacticalLine(row.fen, row.main[0].pvUci),
                trace: string[] = [];
            expect(steps).toHaveLength(row.main[0].pvUci.length);
            const start = performance.now();
            const combination = proveCheckingCombination(steps, 32768, (reason) =>
                trace.push(reason),
            );
            const material = proveCheckingMaterialAttack(steps);
            const mixed = proveMixedCheckingAttack(steps[0]);
            const quiet = proveQuietMatingAttack(steps[0]);
            const result = buildLiveTacticalScan(row.scanInput);
            const candidateProofs = result.variations
                .map((variation) => {
                    const candidateSteps = replayTacticalLine(row.fen, variation.lineUci);
                    const proof = proveCheckingCombination(candidateSteps);
                    return { move: variation.lineUci[0], proof };
                })
                .filter((candidate) => candidate.proof);
            const probes = candidateProofs.flatMap((candidate) => {
                const after = replayTacticalLine(row.fen, [candidate.move])[0].after;
                const defences = [...after.allDests()].flatMap(([from, dests]) =>
                    [...dests].map((to) => {
                        const reply = after.clone();
                        reply.play({ from, to });
                        return { fen: makeFen(reply.toSetup()), move: "" };
                    }),
                );
                const decisions = [
                    { fen: row.fen, move: "" },
                    { fen: row.fen, move: candidate.move },
                    ...candidate.proof!.decisions,
                    ...defences,
                ];
                return decisions.map((decision, index) => ({
                    id: `${row.id}:${candidate.move}:${index}`,
                    fen: decision.fen,
                    ...(decision.move ? { searchMove: decision.move } : {}),
                }));
            });
            const elapsedMs = performance.now() - start;
            return {
                id: row.id,
                fen: row.fen,
                input: row.scanInput,
                main: row.main,
                result,
                combination,
                material,
                mixed,
                quiet,
                candidateProofs,
                probes,
                trace,
                elapsedMs,
            };
        });
        writeFileSync(
            privateReportPath(process.env.TACTICAL_ATTACK_RECALL_REPORT!),
            JSON.stringify(
                {
                    scope: "Frozen owner inputs; diagnostic results are not accuracy judgements.",
                    results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        if (process.env.TACTICAL_ATTACK_RECALL_PROBES) {
            const probes = [
                ...new Map(
                    results
                        .flatMap((row) => row.probes)
                        .map((probe) => [`${probe.fen}:${probe.searchMove ?? ""}`, probe]),
                ).values(),
            ];
            writeFileSync(
                privateReportPath(process.env.TACTICAL_ATTACK_RECALL_PROBES),
                JSON.stringify(
                    { samplePath: process.env.TACTICAL_ATTACK_RECALL_REPORT, probes },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
        console.log(
            results.map((row) => ({
                id: row.id,
                combination: row.combination?.gain,
                material: row.material?.gain,
                mixed: row.mixed?.gain,
                quiet: row.quiet?.gain,
                trace: row.trace,
                elapsedMs: Math.round(row.elapsedMs),
            })),
        );
    },
    60000,
);

test.skipIf(
    !process.env.TACTICAL_ATTACK_CHANGED_INPUT || !process.env.TACTICAL_ATTACK_CHANGED_PROBES,
)(
    "export changed owner proof decisions without treating stable headlines as sufficient",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const input = JSON.parse(readFileSync(process.env.TACTICAL_ATTACK_CHANGED_INPUT!, "utf8"));
        const selections: { id: string; candidate: number; ply: number }[] = JSON.parse(
            process.env.TACTICAL_ATTACK_PROOF_SELECTIONS ?? "[]",
        );
        expect(selections.length).toBeGreaterThan(0);
        const cases = selections.map((selection) => {
            const row = input.results.find((row: any) => row.id === selection.id);
            expect(row).toBeDefined();
            const steps = replayTacticalLine(row.fen, row.before[selection.candidate].pvUci).slice(
                selection.ply - 1,
            );
            const root = steps[0];
            const proof = proveCheckingCombination(steps) ?? proveCheckingDiscovery(root);
            expect(proof).not.toBeNull();
            const defences = [...root.after.allDests()].flatMap(([from, dests]) =>
                [...dests].map((to) => {
                    const reply = root.after.clone();
                    reply.play({ from, to });
                    return { fen: makeFen(reply.toSetup()), move: "" };
                }),
            );
            const fen = makeFen(root.before.toSetup());
            const decisions = [
                { fen, move: "" },
                { fen, move: root.uci },
                ...proof!.decisions,
                ...defences,
            ];
            const probes = [
                ...new Map(
                    decisions.map((decision) => [`${decision.fen}:${decision.move}`, decision]),
                ).values(),
            ].map((decision, index) => ({
                id: `${selection.id}:${selection.candidate}:${selection.ply}:${index}`,
                fen: decision.fen,
                ...(decision.move ? { searchMove: decision.move } : {}),
            }));
            return { ...selection, fen, proof, probes };
        });
        writeFileSync(
            privateReportPath(process.env.TACTICAL_ATTACK_CHANGED_PROBES!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_ATTACK_CHANGED_INPUT,
                    cases,
                    probes: cases.flatMap((row) => row.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
