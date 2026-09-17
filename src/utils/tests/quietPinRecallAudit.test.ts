import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveCaptureDeflection,
    proveCaptureForkPreparation,
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

// Diagnostic only: a sound pin threat and a forced material win are different
// claims. Do not turn a null local bound into a refutation of the whole position.
// Owner boards are supplied privately, never copied into a public fixture.
test.skipIf(
    !process.env.TACTICAL_PIN_AUDIT_INPUT ||
        !process.env.TACTICAL_PIN_AUDIT_ID ||
        !process.env.TACTICAL_PIN_AUDIT_TARGET ||
        !process.env.TACTICAL_PIN_AUDIT_REPORT,
)(
    "audit every reply to an omitted quiet pin and its direct target captures",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PIN_AUDIT_REPORT!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_PIN_AUDIT_INPUT!, "utf8"));
        const rows = input.results.filter(
            (row: any) => row.id === process.env.TACTICAL_PIN_AUDIT_ID,
        );
        expect(rows).toHaveLength(1);
        const row = rows[0];
        const root = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
        const target = parseSquare(process.env.TACTICAL_PIN_AUDIT_TARGET! as any);
        expect(target).toBeDefined();
        expect(root.capture).toBe(0);
        expect(root.after.isCheck()).toBe(false);
        expect(root.after.board.get(target!)?.color).toBe(root.after.turn);
        const replies = [...root.after.allDests()].flatMap(([from, dests]) =>
            [...dests].map((to) => ({ from, to })),
        );
        // These private roots contain no promotion replies; fail instead of silently
        // treating the four promotions as one incomplete ordinary move.
        expect(
            replies.some(
                (m) => root.after.board.get(m.from)?.role === "pawn" && (m.to < 8 || m.to >= 56),
            ),
        ).toBe(false);
        const branches = replies.map((reply) => {
            const next = root.after.clone();
            next.play(reply);
            const fen = makeFen(next.toSetup());
            const actualTarget = reply.from === target ? reply.to : target!;
            const captures = [...next.allDests()].flatMap(([from, dests]) =>
                [...dests]
                    .filter((to) => to === actualTarget)
                    .map((to) => {
                        const move = { from, to };
                        const step = replayTacticalLine(fen, [makeUci(move)])[0];
                        expect(step).toBeDefined();
                        return {
                            move: step.uci,
                            san: step.san,
                            exchangeGain: tacticalExchangeGain(next, move),
                            retainedGain: tacticalCaptureGain(step),
                            motifs: classifyPositionTacticalMotifs({ fen, pvUci: [step.uci] })
                                .motifs,
                        };
                    }),
            );
            return { reply: makeUci(reply), san: makeSan(root.after, reply), fen, captures };
        });
        const unresolved = branches.filter(
            (b) => !b.captures.some((c) => (c.retainedGain ?? -Infinity) >= 90),
        );
        const continuations = unresolved.flatMap((branch) =>
            branch.captures.map((capture) => {
                const step = replayTacticalLine(branch.fen, [capture.move])[0];
                const forkFailures: string[] = [],
                    deflectionFailures: string[] = [];
                return {
                    reply: branch.reply,
                    capture: capture.move,
                    fork: proveCaptureForkPreparation(step, 8192, (reason) =>
                        forkFailures.push(reason),
                    ),
                    forkFailures,
                    deflection: proveCaptureDeflection(step, 16384, (reason) =>
                        deflectionFailures.push(reason),
                    ),
                    deflectionFailures,
                };
            }),
        );
        const report = {
            scope: "Private direct-capture audit, not an all-continuation pin proof or accuracy score.",
            samplePath: process.env.TACTICAL_PIN_AUDIT_INPUT,
            id: row.id,
            fen: row.fen,
            root: root.uci,
            target: process.env.TACTICAL_PIN_AUDIT_TARGET,
            rootResult: classifyPositionTacticalMotifs({
                fen: row.fen,
                pvUci: [root.uci],
                rootCp: row.before[0].cp,
            }),
            branches,
            unresolved: unresolved.map((b) => b.reply),
            continuations,
            probes: unresolved.flatMap((branch) => [
                { id: `${row.id}:reply:${branch.reply}:best`, fen: branch.fen },
                ...branch.captures.map((capture) => ({
                    id: `${row.id}:reply:${branch.reply}:held:${capture.move}`,
                    fen: branch.fen,
                    searchMove: capture.move,
                })),
            ]),
        };
        writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
        console.log(
            JSON.stringify({
                replies: branches.length,
                unresolved: unresolved.map((b) => ({ san: b.san, captures: b.captures })),
                continuations,
            }),
        );
    },
    60000,
);
