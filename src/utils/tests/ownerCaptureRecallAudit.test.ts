import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    isNewlyExposedPawnCapture,
    proveCheckingPawnRetention,
    proveImmediateFork,
    provePersistentPawnCapture,
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import { persistentPawnExchangeContext } from "../tacticalMotifs/gameHistory";

test.skipIf(!process.env.TACTICAL_OWNER_CAPTURE_INPUT || !process.env.TACTICAL_OWNER_CAPTURE_REPORT)(
    "inspect complete owner-game capture and fork omissions without treating abstention as a negative",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const destination = privateReportPath(process.env.TACTICAL_OWNER_CAPTURE_REPORT!);
        expect(existsSync(destination)).toBe(false);
        const input = JSON.parse(readFileSync(privateReportPath(process.env.TACTICAL_OWNER_CAPTURE_INPUT!), "utf8"));
        expect(input.completed).toBe(input.requested);
        expect(input.results).toHaveLength(input.completed);
        const results = input.results.flatMap((row: any) => row.before.flatMap((line: any) => {
            const steps = replayTacticalLine(row.fen, line.pvUci);
            expect(steps).toHaveLength(line.pvUci.length);
            const root = steps[0];
            if (!root.capture) return [];
            const variant = row.scan.variations.find((v: any) => v.lineUci[0] === root.uci);
            if (!variant || variant.motifs.some((m: any) => m.ply === 1)) return [];
            const history = replayTacticalLine(row.tacticalHistory.fen, row.tacticalHistory.moves);
            expect(history).toHaveLength(row.tacticalHistory.moves.length);
            expect(history.length ? makeFen(history.at(-1)!.after.toSetup()) : row.tacticalHistory.fen).toBe(row.fen);
            const trace: string[] = [];
            const forkTrace: unknown[] = [];
            const fork = proveImmediateFork(root, (reason, reply, remaining) => forkTrace.push({ reason, reply, remaining }));
            const replies = [...root.after.allDests()].flatMap(([from, dests]) => [...dests].flatMap(to =>
                (root.after.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                    ? ["queen", "rook", "bishop", "knight"] as const : [undefined]).map(promotion => {
                    const move = { from, to, promotion };
                    const after = root.after.clone(); after.play(move);
                    return { moveUci: makeUci(move), san: makeSan(root.after, move), fen: makeFen(after.toSetup()) };
                })));
            return [{ id: `${row.id}:${root.uci}`, fen: row.fen, moveUci: root.uci, san: root.san,
                cp: line.cp, mate: line.mate, line: line.pvSan, capture: root.capture,
                gain: tacticalCaptureGain(root), exchangeGain: tacticalExchangeGain(root.before, root.move),
                exposed: isNewlyExposedPawnCapture(root, row.previousFen, row.previousMoveUci),
                pawnContext: root.capture === 100 ? persistentPawnExchangeContext(row.tacticalHistory, row.fen, root.move) : null,
                persistent: provePersistentPawnCapture(root, row.tacticalHistory),
                checkingRetention: proveCheckingPawnRetention(steps, 8192, reason => trace.push(reason)),
                trace, fork, forkTrace, replies }];
        }));
        writeFileSync(destination, JSON.stringify({ scope: "Complete-game capture omissions, not certified missing tactics. Scores and exchange bounds are separate; all legal replies retained for follow-up.",
            contexts: input.completed, results }, null, 2), { flag: "wx" });
        console.log(results.map((r: any) => ({ id: r.id, move: r.san, capture: r.capture, gain: r.gain,
            exchange: r.exchangeGain, context: r.pawnContext, persistent: r.persistent, trace: r.trace })));
    },
    120000,
);
