import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { proveMateWithinThree, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    captureMateFen as fen,
    captureMateLine as line,
    captureMateCases,
} from "./fixtures/captureMate";

function reflectGameFen(fen: string) {
    const fields = reflectMixedForkFen(fen).split(" ");
    const swapped = fields[2].replace(/[a-zA-Z]/g, (c) =>
        c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(),
    );
    fields[2] = ["K", "Q", "k", "q"].filter((c) => swapped.includes(c)).join("") || "-";
    fields[3] = reflectMixedForkMove(fields[3]);
    return fields.join(" ");
}

// Constructed from the public quiet-king-approach regression: the queen now
// captures a pawn on h2. The reached mating geometry is exactly the same.

test.each([false, true])(
    "a nonchecking mating capture does not need a terminal PV (%s)",
    (reflected) => {
        const start = reflected ? reflectMixedForkFen(fen) : fen;
        const moves = reflected ? line.map(reflectMixedForkMove) : line;
        const root = replayTacticalLine(start, moves.slice(0, 1));
        const proof = proveMateWithinThree(root);
        expect(proof).not.toBeNull();
        expect(proof!.visits).toBeLessThanOrEqual(16384);
        for (const length of [1, 2, 3, 4, 5]) {
            const pvUci = moves.slice(0, length);
            const result = classifyPositionTacticalMotifs({ fen: start, pvUci });
            expect(result.motifs[0]).toMatchObject({
                id: "mateIn3",
                label: "Forcing Mate",
                ply: 1,
            });
            expect(result.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
            const scan = buildLiveTacticalScan({
                fen: start,
                pvUci,
                depth: 16,
                engineName: "Constructed mate",
            });
            expect(scan.motifs[0]?.id).toBe("mateIn3");
            expect(scan.arrows).toEqual([
                expect.objectContaining({
                    from: moves[0].slice(0, 2),
                    to: moves[0].slice(2, 4),
                    ply: 1,
                }),
            ]);
        }
        const fasterMate = reflected ? reflectMixedForkMove("h5h6") : "h5h6";
        expect(
            classifyPositionTacticalMotifs({ fen: start, pvUci: [fasterMate] }).motifs[0]?.value,
        ).toBe(10000);
        expect(
            classifyMistakeReviewMotifs({
                fen: start,
                bestMoveUci: fasterMate,
                pvUci: [fasterMate],
                playedMoveUci: moves[0],
            }).missedMotifs,
        ).toEqual([]);
    },
);

test("a capture with mate on the next turn does not get an inflated three-move distance", () => {
    const start = "7k/7p/5K1p/7Q/8/8/8/8 w - - 0 1";
    expect(replayTacticalLine(start, ["h5h6"])).toHaveLength(1);
    expect(classifyPositionTacticalMotifs({ fen: start, pvUci: ["h5h6"] }).motifs[0]?.id).toBe(
        "mateIn2",
    );
});

test.each([false, true])(
    "a queen-winning reply refutes the apparent capture mate (%s)",
    (reflected) => {
        const counter = fen.replace("8/8/7p", "8/5n2/7p");
        const start = reflected ? reflectMixedForkFen(counter) : counter;
        const move = reflected ? reflectMixedForkMove(line[0]) : line[0];
        expect(proveMateWithinThree(replayTacticalLine(start, [move]))).toBeNull();
        expect(
            classifyPositionTacticalMotifs({ fen: start, pvUci: [move] }).motifs.some((m) =>
                m.id.startsWith("mate"),
            ),
        ).toBe(false);
    },
);

test("capture resets the fifty-move clock and failed budgets cannot contaminate its proof", () => {
    const steps = replayTacticalLine(fen.replace("0 1", "99 1"), [line[0]]);
    for (const limit of [0, 1, -1, NaN, Infinity, 1.5])
        expect(proveMateWithinThree(steps, limit)).toBeNull();
    expect(proveMateWithinThree(steps)).not.toBeNull();
});

test.skipIf(!process.env.TACTICAL_CAPTURE_MATE_INPUT)(
    "inspect the previously audited owner capture without a mate-ending hint",
    () => {
        const input = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_MATE_INPUT!, "utf8"));
        const roots = input.searches.filter(
            (row: { id: string; lines: { mate: number | null }[] }) =>
                row.id.endsWith(":root") && row.lines[0]?.mate === 3,
        );
        expect(roots).toHaveLength(1);
        const cases = roots.flatMap(
            (row: { id: string; fen: string; searchMove: string; lines: { pvUci: string[] }[] }) =>
                [false, true].map((reflected) => {
                    const start = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                    const pvUci = reflected
                        ? row.lines[0].pvUci.map(reflectMixedForkMove)
                        : row.lines[0].pvUci;
                    const proof = proveMateWithinThree(replayTacticalLine(start, [pvUci[0]]));
                    expect(proof).not.toBeNull();
                    const result = classifyPositionTacticalMotifs({
                        fen: start,
                        pvUci: [pvUci[0]],
                    });
                    expect(result.motifs[0]).toMatchObject({
                        id: "mateIn3",
                        label: "Forcing Mate",
                        ply: 1,
                    });
                    return { id: `${row.id}:${reflected}`, fen: start, pvUci, proof, result };
                }),
        );
        if (process.env.TACTICAL_CAPTURE_MATE_REPORT)
            writeFileSync(
                process.env.TACTICAL_CAPTURE_MATE_REPORT,
                JSON.stringify({ cases }, null, 2) + "\n",
                { flag: "wx" },
            );
    },
);

test.skipIf(!process.env.TACTICAL_CAPTURE_MATE_STRATEGY_REPORT)(
    "independently replay capture mating strategies and export every nominated answer",
    () => {
        const inputs: {
            id: string;
            fen: string;
            pvUci: string[];
            mate: number | null;
            tacticalHistory?: { fen: string; moves: string[] };
        }[] = [...captureMateCases];
        if (process.env.TACTICAL_CAPTURE_MATE_INPUT) {
            const input = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_MATE_INPUT, "utf8"));
            for (const row of input.searches.filter(
                (row: { id: string; lines: { mate: number | null }[] }) =>
                    row.id.endsWith(":root") && row.lines[0]?.mate === 3,
            ))
                inputs.push({ id: row.id, fen: row.fen, pvUci: row.lines[0].pvUci, mate: 3 });
        }
        if (process.env.TACTICAL_CAPTURE_MATE_OWNER_REPLAY) {
            const report = JSON.parse(
                readFileSync(process.env.TACTICAL_CAPTURE_MATE_OWNER_REPLAY, "utf8"),
            );
            const changed = new Set(report.changed.map((row: { id: string }) => row.id));
            const seen = new Set<string>();
            for (const row of report.results.filter((row: { id: string }) => changed.has(row.id))) {
                const lanes = [
                    { fen: row.fen, line: row.sourceUci, history: row.tacticalHistory },
                    ...row.before.map((pv: { pvUci: string[] }) => ({
                        fen: row.fen,
                        line: pv.pvUci,
                        history: row.tacticalHistory,
                    })),
                    ...row.after.map((pv: { pvUci: string[] }) => ({
                        fen: row.afterFen,
                        line: pv.pvUci,
                        history: {
                            fen: row.tacticalHistory.fen,
                            moves: [...row.tacticalHistory.moves, row.playedMoveUci],
                        },
                    })),
                ];
                for (const lane of lanes) {
                    const steps = replayTacticalLine(lane.fen, lane.line);
                    for (const [index, step] of steps.entries()) {
                        if (!step.capture || step.after.isCheck()) continue;
                        const short = proveMateWithinThree([step]);
                        if (!short) continue;
                        const fen = makeFen(step.before.toSetup()),
                            key = `${fen}:${step.uci}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        inputs.push({
                            id: `${row.id}:${step.uci}:${index}`,
                            fen,
                            pvUci: [step.uci],
                            mate: short.branches.some((b) => b.replies) ? 3 : 2,
                            tacticalHistory: {
                                fen: lane.history.fen,
                                moves: [
                                    ...lane.history.moves,
                                    ...steps.slice(0, index).map((s) => s.uci),
                                ],
                            },
                        });
                    }
                }
            }
            assert(seen.size > 1);
        }
        const cases = inputs.flatMap((row) =>
            [false, true].map((reflected) => {
                let start = reflected ? reflectGameFen(row.fen) : row.fen;
                const move = reflected ? reflectMixedForkMove(row.pvUci[0]) : row.pvUci[0];
                const tacticalHistory = row.tacticalHistory
                    ? {
                          fen: reflected
                              ? reflectGameFen(row.tacticalHistory.fen)
                              : row.tacticalHistory.fen,
                          moves: reflected
                              ? row.tacticalHistory.moves.map(reflectMixedForkMove)
                              : row.tacticalHistory.moves,
                      }
                    : undefined;
                if (tacticalHistory) {
                    const reached = makeFen(
                        replayTacticalLine(tacticalHistory.fen, tacticalHistory.moves)
                            .at(-1)!
                            .after.toSetup(),
                    );
                    // Swapping the initial side changes fullmove numbering, not the
                    // board, halfmove clock or repetition history being verified.
                    assert.deepEqual(reached.split(" ").slice(0, 5), start.split(" ").slice(0, 5));
                    start = reached;
                }
                const root = replayTacticalLine(start, [move])[0];
                expect(root).toBeDefined();
                const short = proveMateWithinThree([root]);
                expect(Boolean(short)).toBe(row.mate !== null);
                const advance = (start: string, ...moves: string[]) => {
                    const steps = replayTacticalLine(start, moves);
                    expect(steps).toHaveLength(moves.length);
                    return makeFen(steps.at(-1)!.after.toSetup());
                };
                const afterRoot = makeFen(root.after.toSetup());
                const proof = short
                    ? {
                          maxMoves: short.branches.some((b) => b.replies) ? 3 : 2,
                          visits: short.visits,
                          strategy: {
                              fen: afterRoot,
                              replies: short.branches.map((branch) => {
                                  const afterAttack = advance(
                                      afterRoot,
                                      branch.replyUci,
                                      branch.attackUci,
                                  );
                                  return {
                                      move: branch.replyUci,
                                      answer: branch.attackUci,
                                      next: {
                                          fen: afterAttack,
                                          replies: (branch.replies ?? []).map((reply) => ({
                                              move: reply.replyUci,
                                              answer: reply.mateUci,
                                              next: {
                                                  fen: advance(
                                                      afterAttack,
                                                      reply.replyUci,
                                                      reply.mateUci,
                                                  ),
                                                  replies: [],
                                              },
                                          })),
                                      },
                                  };
                              }),
                          },
                      }
                    : null;
                assert.equal(proof?.maxMoves ?? null, row.mate);
                return {
                    id: `${row.id}:${reflected}`,
                    fen: start,
                    pvUci: [move],
                    proof,
                    tacticalHistory,
                };
            }),
        );
        const probes: {
            id: string;
            fen: string;
            searchMove: string;
            expectedSign: number;
            mateWithin?: number;
        }[] = [];
        for (const row of cases) {
            probes.push({
                id: `${row.id}:root`,
                fen: row.fen,
                searchMove: row.pvUci[0],
                expectedSign: row.proof ? 1 : -1,
                ...(row.proof ? { mateWithin: row.proof.maxMoves } : {}),
            });
            for (const branch of row.proof?.strategy.replies ?? []) {
                const replyFen = makeFen(
                    replayTacticalLine(row.proof!.strategy.fen, [branch.move])[0].after.toSetup(),
                );
                probes.push({
                    id: `${row.id}:${branch.move}`,
                    fen: replyFen,
                    searchMove: branch.answer,
                    expectedSign: 1,
                    mateWithin: branch.next.replies.length ? 2 : 1,
                });
                for (const reply of branch.next.replies)
                    probes.push({
                        id: `${row.id}:${branch.move}:${reply.move}`,
                        fen: makeFen(
                            replayTacticalLine(branch.next.fen, [reply.move])[0].after.toSetup(),
                        ),
                        searchMove: reply.answer,
                        expectedSign: 1,
                        mateWithin: 1,
                    });
            }
        }
        const report = {
            samplePath: process.env.TACTICAL_CAPTURE_MATE_STRATEGY_REPORT!,
            cases,
            probes,
        };
        if (process.env.TACTICAL_CAPTURE_MATE_RESUME_AUDIT) {
            const earlier = JSON.parse(
                readFileSync(process.env.TACTICAL_CAPTURE_MATE_RESUME_AUDIT, "utf8"),
            );
            const lastId = earlier.searches.at(-1).id;
            const index = probes.findIndex((p) => p.id === lastId);
            assert(index >= 0);
            // Full independent defensive trees establish the upper bounds. A
            // finite-depth engine can miss a shorter quiet route; retain its
            // contrary receipt and test outcome signs, not invented agreement.
            const completed = new Set(
                earlier.searches.slice(0, -1).map((p: { id: string }) => p.id),
            );
            for (const path of JSON.parse(process.env.TACTICAL_CAPTURE_MATE_PRIOR_AUDITS ?? "[]")) {
                const prior = JSON.parse(readFileSync(path, "utf8"));
                assert.equal(prior.completed, prior.requested);
                for (const probe of prior.searches) completed.add(probe.id);
            }
            const remaining = probes
                .filter((p) => !completed.has(p.id))
                .map((p) => ({ ...p, mateWithin: p.mateWithin === 1 ? 1 : undefined }));
            const deeper = probes
                .filter((p) => p.id === lastId || p.id === lastId.replace(":false:", ":true:"))
                .map((p) => ({ ...p, id: `${p.id}:depth22`, depth: 22, mateWithin: undefined }));
            writeFileSync(
                `${process.env.TACTICAL_CAPTURE_MATE_STRATEGY_REPORT}.engine-followup.json`,
                JSON.stringify(
                    {
                        samplePath: process.env.TACTICAL_CAPTURE_MATE_STRATEGY_REPORT,
                        probes: [...remaining, ...deeper],
                    },
                    null,
                    2,
                ) + "\n",
                { flag: "wx" },
            );
        }
        const python = spawnSync(
            process.env.TACTICAL_MATE_STRATEGY_PYTHON ?? "python",
            ["scripts/benchmarks/verify-mating-strategy.py"],
            {
                input: JSON.stringify(report),
                encoding: "utf8",
                windowsHide: true,
            },
        );
        expect({ status: python.status, stderr: python.stderr }).toEqual({ status: 0, stderr: "" });
        console.log(python.stdout);
        writeFileSync(
            process.env.TACTICAL_CAPTURE_MATE_STRATEGY_REPORT!,
            JSON.stringify(report, null, 2) + "\n",
            { flag: "wx" },
        );
    },
);
