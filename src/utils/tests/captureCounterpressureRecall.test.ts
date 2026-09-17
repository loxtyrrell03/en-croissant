import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { attacks } from "chessops/attacks";
import { makeSquare, opposite } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveCaptureCounterattack,
    proveDefenderCombination,
    proveDiscoveredMaterial,
    proveExchangeDiscovery,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";

test.skipIf(!process.env.TACTICAL_COUNTERPRESSURE_REPLAY || !process.env.TACTICAL_COUNTERPRESSURE_REPORT)(
    "inspect defended counterattack targets without treating nomination as proof",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const path = privateReportPath(process.env.TACTICAL_COUNTERPRESSURE_REPORT!);
        expect(existsSync(path)).toBe(false);
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_COUNTERPRESSURE_REPLAY!, "utf8"));
        const ids: string[] = JSON.parse(process.env.TACTICAL_COUNTERPRESSURE_IDS ?? "[]");
        expect(ids.length).toBeGreaterThan(0);
        const rows = sample.results.filter((r: any) => ids.includes(r.id));
        expect(rows).toHaveLength(ids.length);
        const cases = rows.flatMap((row: any) => row.before.filter((line: any) =>
            replayTacticalLine(row.fen, line.pvUci)[0]?.capture,
        ).map((line: any) => {
            const root = replayTacticalLine(row.fen, line.pvUci)[0];
            const piece = root.after.board.get(root.move.to)!;
            const oldAttacks = attacks(piece, root.move.from, root.before.board.occupied);
            const targets = [...attacks(piece, root.move.to, root.after.board.occupied)
                .intersect(root.after.board[opposite(root.before.turn)])]
                .filter(sq => !["pawn", "king"].includes(root.after.board.get(sq)!.role) && !oldAttacks.has(sq));
            const discoveryFailures: string[] = [];
            const discovery = proveDiscoveredMaterial(root,4096,100,undefined,reason=>discoveryFailures.push(reason));
            return { id: row.id, fen: row.fen, root: root.uci, san: root.san, targets: targets.map(makeSquare),
                discovery,discoveryFailures,exchangeDiscovery:proveExchangeDiscovery(root),
                currentGain: tacticalCaptureGain(root), currentCounterattack: proveCaptureCounterattack(root),
                trials: ["connected", "liability-recovery", "all-targets"].flatMap(mode => [4096, 16384].map(limit => {
                    const broadDiagnosis = mode === "all-targets";
                    const budget = { nodes: limit };
                    const leaves: any[] = [];
                    const failures: any[] = [];
                    // The broad trial deliberately permits unrelated material.
                    // It is only a coverage diagnostic, never an admission rule.
                    const nominees = broadDiagnosis ? [...root.after.board[opposite(root.before.turn)]] : targets;
                    const collectors = broadDiagnosis ? [...root.after.board[root.before.turn]] : [root.move.to];
                    const gain = nominees.length ? proveDefenderCombination(root, nominees, collectors,
                        limit, budget, 1, true, 90, leaf => leaves.push(leaf), true, failure => failures.push(failure),
                        mode === "liability-recovery") : null;
                    return {mode,broadDiagnosis,limit,gain,visits:limit-budget.nodes,leaves,failures};
                })) };
        }));
        writeFileSync(path, JSON.stringify({scope:"Selected nomination diagnosis, not production admission or accuracy evidence.", cases},null,2), {flag:"wx"});
        if (process.env.TACTICAL_COUNTERPRESSURE_PROBES) {
            const destination = privateReportPath(process.env.TACTICAL_COUNTERPRESSURE_PROBES);
            if (existsSync(destination)) throw new Error("Existing private probe receipt");
            const probes = cases.filter((row: any) => row.currentCounterattack).flatMap((row: any) => [
                {id:`${row.id}:${row.root}:root`,fen:row.fen,searchMove:row.root,expectedSign:1},
                ...row.currentCounterattack.leaves.flatMap((leaf: any,i: number) => [
                    {id:`${row.id}:${row.root}:leaf-${i}`,fen:leaf.fen,searchMove:leaf.moveUci,expectedSign:1},
                    ...(leaf.counterchecks ?? []).map((reply: any,j: number) => ({
                        id:`${row.id}:${row.root}:check-${i}-${j}`,fen:reply.fen,searchMove:reply.moveUci,expectedSign:1,
                    })),
                ]),
            ]);
            writeFileSync(destination,JSON.stringify({samplePath:process.env.TACTICAL_COUNTERPRESSURE_REPLAY,
                scope:"Selected current certificates for fresh engine review; diagnostic broad trials are excluded.",probes},null,2),{flag:"wx"});
        }
        console.log(cases.map((row: any) => ({id:row.id,root:row.san,targets:row.targets,currentGain:row.currentGain,
            trials:row.trials.map(({leaves,...trial}:any)=>({...trial,leaves:leaves.length}))})));
    },120000,
);
