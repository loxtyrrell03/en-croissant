import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { makeSan } from "chessops/san";
import { provePerpetualCheck, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

test.skipIf(!process.env.TACTICAL_PERPETUAL_RECALL_INPUT || !process.env.TACTICAL_PERPETUAL_RECALL_REPORT)(
    "inspect missing saving checks without treating a zero engine score as a draw proof",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PERPETUAL_RECALL_REPORT!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_PERPETUAL_RECALL_INPUT!, "utf8"));
        const ids: string[] = JSON.parse(process.env.TACTICAL_PERPETUAL_RECALL_IDS ?? "[]");
        expect(ids.length).toBeGreaterThan(0);
        const rows = input.results.filter((row: any) => ids.includes(row.id));
        expect(rows).toHaveLength(ids.length);
        const results = rows.map((row: any) => {
            const steps = replayTacticalLine(row.fen, row.before[0].pvUci);
            expect(steps).toHaveLength(row.before[0].pvUci.length);
            expect(steps[0].after.isCheck()).toBe(true);
            const root = steps[0];
            const attempts = [4096, 8192, 32768].map(limit => {
                const budget = { nodes: limit };
                const start = performance.now();
                const proof = provePerpetualCheck(steps, limit, { budget, captureStrategy: true });
                return { limit, visits: limit - budget.nodes, ms: performance.now() - start, proof };
            });
            const defences = [...root.after.allDests()].flatMap(([from, tos]) => [...tos].flatMap(to =>
                (root.after.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                    ? ["queen", "rook", "bishop", "knight"] as const : [undefined])
                    .map(promotion => ({ from, to, promotion })))).map(move => {
                const pos = root.after.clone(); pos.play(move);
                return { move: makeUci(move), san: makeSan(root.after, move), fen: makeFen(pos.toSetup()) };
            });
            const rootOnlyBudget = { nodes: 4096 };
            const rootOnly = provePerpetualCheck(steps.slice(0, 1), 4096,
                { budget: rootOnlyBudget, captureStrategy: true });
            const reflected = reflectMixedForkFen(row.fen);
            const reflectedBudget = { nodes: 4096 };
            const reflectedProof = provePerpetualCheck(replayTacticalLine(reflected,
                row.before[0].pvUci.map(reflectMixedForkMove)), 4096,
                { budget: reflectedBudget, captureStrategy: true });
            return { id: row.id, fen: row.fen, root: root.uci, san: root.san,
                played: row.playedMoveUci, line: row.before[0], attempts, defences,
                rootOnly, rootOnlyVisits: 4096 - rootOnlyBudget.nodes,
                reflected: { fen: reflected, move: reflectMixedForkMove(root.uci),
                    visits: 4096 - reflectedBudget.nodes, proof: reflectedProof },
                scan: buildLiveTacticalScan({ fen: row.fen, ...row.before[0], variations: row.before,
                    tacticalHistory: row.tacticalHistory, engineName: "Stockfish 18" }),
            };
        });
        writeFileSync(output, JSON.stringify({ scope: "Selected development diagnostics; larger budgets are not a production change or an outcome certificate.", results }, null, 2), { flag: "wx" });
    }, 120000,
);
