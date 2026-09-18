import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { attacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import { makeSquare, makeUci, opposite } from "chessops/util";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { expect, test } from "vitest";
import { proveMixedTargetFork, replayTacticalLine, tacticalExchangeGain } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

test.skipIf(!process.env.TACTICAL_PAWN_FORK_INPUT || !process.env.TACTICAL_PAWN_FORK_REPORT)(
    "inspect pawn-only double attacks across frozen game roots and reached continuations",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PAWN_FORK_REPORT!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_PAWN_FORK_INPUT!, "utf8"));
        expect(input.completed).toBe(input.requested);
        const seen = new Set<string>();
        const results = [];
        const allRoots = process.env.TACTICAL_PAWN_FORK_ALL_ROOTS === "1";
        for (const row of input.results) {
            for (const phase of ["before", "after"] as const) {
                if (allRoots && phase === "after") continue;
                const fen = phase === "before" ? row.fen : row.afterFen;
                const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
                const candidates = allRoots ? [...position.allDests()].flatMap(([from, tos]) =>
                    [...tos].filter(to => position.board.get(from)?.role !== "pawn" || (to >= 8 && to < 56))
                        .map(to => ({ multipv: null, pvUci: [makeUci({ from, to })] }))) : row[phase];
                for (const line of candidates) {
                    const steps = replayTacticalLine(fen, line.pvUci.slice(0, 9));
                    expect(steps).toHaveLength(Math.min(9, line.pvUci.length));
                    for (const [index, step] of steps.entries()) {
                        if (step.after.isCheck() || step.after.isEnd() || step.move.promotion) continue;
                        const reached = makeFen(step.before.toSetup());
                        const key = `${reached}:${step.uci}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        const piece = step.after.board.get(step.move.to)!;
                        const targets = [...attacks(piece, step.move.to, step.after.board.occupied)
                            .intersect(step.after.board[opposite(step.before.turn)])];
                        if (targets.length < 2 || targets.some(square => step.after.board.get(square)?.role !== "pawn")) continue;
                        const probe = step.after.clone();
                        probe.turn = step.before.turn;
                        const values = targets.map(square => ({ square: makeSquare(square),
                            gain: tacticalExchangeGain(probe, { from: step.move.to, to: square }) }));
                        if (values.filter(target => target.gain >= 100).length < 2) continue;
                        if (allRoots && targets.every(square => attacks(step.before.board.get(step.move.from)!,
                            step.move.from, step.before.board.occupied).has(square))) continue;
                        const attempts: unknown[] = [];
                        const proof = proveMixedTargetFork(step, 8192, (pair, result) =>
                            attempts.push({ pair: pair.map(makeSquare), result }));
                        const remaining = line.pvUci.slice(index);
                        results.push({ id: row.id, phase, multipv: line.multipv, ply: index + 1,
                            fen: reached, root: step.uci, san: step.san, capture: step.capture,
                            line: remaining, targets: values, proof, attempts,
                            classification: classifyPositionTacticalMotifs({ fen: reached, pvUci: remaining }),
                        });
                    }
                }
            }
        }
        writeFileSync(output, JSON.stringify({ scope: "Development nominations only. Later plies are not root lessons; local gains are not full-position evaluations.",
            positions: input.completed, allRoots, results }, null, 2), { flag: "wx" });
        console.log({ positions: input.completed, nominated: results.length,
            proven: results.filter(row => row.proof).map(row => ({ id: row.id, phase: row.phase,
                ply: row.ply, san: row.san, gain: row.proof?.gain })) });
    }, 120000,
);
