import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { makeFen } from "chessops/fen";
import { makeSquare, makeUci, parseSquare } from "chessops/util";
import { makeSan } from "chessops/san";
import { expect, test } from "vitest";
import {
    proveCaptureForkPreparation,
    proveCaptureDiscoveryPreparation,
    proveQuietTacticalPreparation,
    proveTrappedMaterial,
    proveDefenderCombination,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

test.skipIf(!process.env.TACTICAL_CAPTURE_TRAP_INPUT || !process.env.TACTICAL_CAPTURE_TRAP_REPORT)(
    "inspect capture attraction and connected trap alternatives without borrowing a cooperative line",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CAPTURE_TRAP_REPORT!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_TRAP_INPUT!, "utf8"));
        const ids: string[] = JSON.parse(process.env.TACTICAL_CAPTURE_TRAP_IDS ?? "[]");
        const named: Record<string, string[]> = JSON.parse(
            process.env.TACTICAL_CAPTURE_TRAP_TARGETS ?? "{}",
        );
        expect(ids.length).toBeGreaterThan(0);
        const rows = input.results.filter((row: any) => ids.includes(row.id));
        expect(rows).toHaveLength(ids.length);
        const results = rows.map((row: any) => {
            const line = row.before[0].pvUci;
            const steps = replayTacticalLine(row.fen, line);
            expect(steps).toHaveLength(line.length);
            const failures: string[] = [];
            const preparation = proveCaptureForkPreparation(steps[0], 8192, (why) =>
                failures.push(why),
            );
            const discovery = proveCaptureDiscoveryPreparation(steps[0], 8192, (why) =>
                failures.push(why),
            );
            const reached = steps
                .slice(0, 7)
                .filter((step) => step.before.turn === steps[0].before.turn)
                .map((step) => {
                    const targets = [...step.after.board[step.after.turn]].filter((square) =>
                        ["queen", "rook", "bishop", "knight"].includes(
                            step.after.board.get(square)!.role,
                        ),
                    );
                    const traps = !step.after.isCheck()
                        ? targets.map((target) => {
                              const why: string[] = [];
                              const proof = proveTrappedMaterial(step, target, 256, 8, (reason) =>
                                  why.push(reason),
                              );
                              return { target: makeSquare(target), proof, failures: why };
                          })
                        : [];
                    const position = makeFen(step.before.toSetup());
                    const suffix = line.slice(steps.indexOf(step));
                    const namedTargets = (named[step.uci] ?? []).map((square) => {
                        const target = parseSquare(square as any);
                        assert.notEqual(target, undefined, `Invalid target ${square}`);
                        expect(step.after.board.get(target!)?.color).toBe(step.after.turn);
                        return target!;
                    });
                    const combination = namedTargets.length
                        ? [4096, 8192].map((limit) => {
                              const budget = { nodes: limit };
                              const leaves: any[] = [],
                                  failures: any[] = [];
                              const gain = proveDefenderCombination(
                                  step,
                                  namedTargets,
                                  [...step.after.board[step.before.turn]],
                                  limit,
                                  budget,
                                  1,
                                  true,
                                  100,
                                  (leaf) => leaves.push(leaf),
                                  true,
                                  (failure) => failures.push(failure),
                                  true,
                              );
                              return {
                                  gain,
                                  visits: limit - budget.nodes,
                                  limit,
                                  leaves,
                                  failures,
                                  failureCaptures: failures.slice(-4).map((failure) => {
                                      const defence = replayTacticalLine(failure.fen, [
                                          failure.replyUci,
                                      ])[0];
                                      const afterFen = makeFen(defence.after.toSetup());
                                      return {
                                          ...failure,
                                          afterFen,
                                          captures: [...defence.after.allDests()].flatMap(
                                              ([from, tos]) =>
                                                  [...tos]
                                                      .filter(
                                                          (to) =>
                                                              defence.after.board.get(to)?.color ===
                                                              defence.before.turn,
                                                      )
                                                      .map((to) => {
                                                          // A promotion needs a distinct legal root for each choice.
                                                          const promotions =
                                                              defence.after.board.get(from)
                                                                  ?.role === "pawn" &&
                                                              (to < 8 || to >= 56)
                                                                  ? ([
                                                                        "queen",
                                                                        "rook",
                                                                        "bishop",
                                                                        "knight",
                                                                    ] as const)
                                                                  : [undefined];
                                                          return promotions.map((promotion) => {
                                                              const capture = replayTacticalLine(
                                                                  afterFen,
                                                                  [
                                                                      makeUci({
                                                                          from,
                                                                          to,
                                                                          promotion,
                                                                      }),
                                                                  ],
                                                              )[0];
                                                              assert.ok(capture);
                                                              return {
                                                                  move: capture.uci,
                                                                  gain: tacticalCaptureGain(
                                                                      capture,
                                                                  ),
                                                              };
                                                          });
                                                      })
                                                      .flat(),
                                          ),
                                      };
                                  }),
                              };
                          })
                        : [];
                    return {
                        fen: position,
                        move: step.uci,
                        san: step.san,
                        traps,
                        combination,
                        preparation: proveQuietTacticalPreparation(
                            replayTacticalLine(position, suffix),
                        ),
                        classified: classifyPositionTacticalMotifs({
                            fen: position,
                            pvUci: suffix,
                        }),
                        replies: [...step.after.allDests()]
                            .flatMap(([from, tos]) =>
                                [...tos].flatMap((to) =>
                                    (step.after.board.get(from)?.role === "pawn" &&
                                    (to < 8 || to >= 56)
                                        ? (["queen", "rook", "bishop", "knight"] as const)
                                        : [undefined]
                                    ).map((promotion) => ({ from, to, promotion })),
                                ),
                            )
                            .map((move) => {
                                const next = step.after.clone();
                                next.play(move);
                                return {
                                    move: makeUci(move),
                                    san: makeSan(step.after, move),
                                    fen: makeFen(next.toSetup()),
                                };
                            }),
                    };
                });
            return {
                id: row.id,
                fen: row.fen,
                played: row.playedMoveUci,
                line,
                preparation,
                discovery,
                failures,
                reached,
            };
        });
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Selected private development diagnostics, not an accuracy estimate or proof from the supplied line.",
                    results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    120000,
);
