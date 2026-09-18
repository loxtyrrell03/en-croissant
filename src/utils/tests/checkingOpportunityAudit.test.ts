import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveCheckingCombination,
    proveImmediateFork,
    provePerpetualCheck,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

test.skipIf(!process.env.TACTICAL_CHECK_OPPORTUNITY_INPUT ||
    !process.env.TACTICAL_CHECK_OPPORTUNITY_ENGINE || !process.env.TACTICAL_CHECK_OPPORTUNITY_REPORT)(
    "reconcile selected checking opportunities with fresh legal defence searches",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const destination = privateReportPath(process.env.TACTICAL_CHECK_OPPORTUNITY_REPORT!);
        expect(existsSync(destination)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_CHECK_OPPORTUNITY_INPUT!, "utf8"));
        const engine = JSON.parse(readFileSync(process.env.TACTICAL_CHECK_OPPORTUNITY_ENGINE!, "utf8"));
        expect(engine.completed).toBe(input.probes.length);
        expect(engine.searches).toHaveLength(input.probes.length);
        let lineCount = 0, moveCount = 0;
        for (const request of input.probes) {
            const records = engine.searches.filter((record: any) => record.id === request.id);
            expect(records).toHaveLength(1);
            const record = records[0];
            expect(record.fen).toBe(request.fen);
            expect(record.searchMove).toBe(request.searchMove);
            expect(record.depth).toBe(request.depth);
            for (const line of record.lines) {
                expect(line.depth).toBe(request.depth);
                expect(replayTacticalLine(record.fen, line.pvUci)).toHaveLength(line.pvUci.length);
                expect(!request.searchMove || line.pvUci[0] === request.searchMove).toBe(true);
                lineCount++; moveCount += line.pvUci.length;
            }
        }
        const inspect = (fen: string, line: { pvUci: string[]; cp: number | null }) => {
            const steps = replayTacticalLine(fen, line.pvUci);
            expect(steps).toHaveLength(line.pvUci.length);
            const trace: string[] = [];
            const combination = proveCheckingCombination(steps, 32768, reason => trace.push(reason));
            const forkTrace: unknown[] = [];
            const fork = proveImmediateFork(steps[0], (reason, reply, remaining) =>
                forkTrace.push({ reason, reply, remaining }));
            return { combination, trace, fork, forkTrace, perpetual: provePerpetualCheck(steps),
                result: classifyPositionTacticalMotifs({ fen, pvUci: line.pvUci, rootCp: line.cp }),
                plies: steps.slice(0, 7).map(step => ({ fen: makeFen(step.before.toSetup()), move: step.uci,
                    san: step.san, capture: step.capture,
                    captureGain: step.capture ? tacticalCaptureGain(step) : null,
                    fork: step.after.isCheck() ? proveImmediateFork(step) : null })) };
        };
        for (const row of input.cases) {
            const root = replayTacticalLine(row.fen, [row.root])[0];
            expect(root.after.isCheck()).toBe(true);
            const legal = [...root.after.allDests()].flatMap(([from, dests]) => [...dests].flatMap(to =>
                (root.after.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                    ? ["queen", "rook", "bishop", "knight"] as const : [undefined])
                    .map(promotion => makeUci({ from, to, promotion }))));
            expect(row.defences.map((reply: any) => reply.move).sort()).toEqual(legal.sort());
            const history = replayTacticalLine(row.tacticalHistory.fen, row.tacticalHistory.moves);
            expect(history).toHaveLength(row.tacticalHistory.moves.length);
            expect(history.length ? makeFen(history.at(-1)!.after.toSetup()) : row.tacticalHistory.fen).toBe(row.fen);
        }
        const results = input.cases.map((row: any) => ({ id: row.id, judgement: row.judgement,
            original: inspect(row.fen, row.before[0]),
            fresh: inspect(row.fen, engine.searches.find((r: any) => r.id === `${row.id}:held`).lines[0]),
            defences: row.defences.map((reply: any) => {
                const record = engine.searches.find((r: any) => r.id === `${row.id}:reply:${reply.move}`);
                expect(record.fen).toBe(reply.fen);
                return { ...reply, line: record.lines[0], audit: inspect(reply.fen, record.lines[0]) };
            }),
        }));
        writeFileSync(destination, JSON.stringify({ scope: "Selected development diagnostics, not accuracy or outcome certificates.",
            searches: engine.completed, lineCount, moveCount, results }, null, 2), { flag: "wx" });
        console.log(results.map((row: any) => ({ id: row.id,
            original: { trace: row.original.trace, fork: row.original.forkTrace, perpetual: !!row.original.perpetual },
            fresh: { trace: row.fresh.trace, fork: row.fresh.forkTrace, perpetual: !!row.fresh.perpetual } })));
    },
    120000,
);
