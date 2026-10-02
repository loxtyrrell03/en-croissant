import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeUci, parseSquare } from "chessops/util";
import { makeSan } from "chessops/san";
import { makeFen } from "chessops/fen";
import { balance, captureValue, legalMoves, play } from "./ltbye-intermediate-audit.mjs";
import {
    proveDefenderCombination,
    proveTrappedMaterial,
    replayTacticalLine,
    tacticalExchangeGain,
} from "../../src/utils/tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork";

const baseline = "9fad2cd685d88d10e962bd80384eb9aaf117072e";
assert.equal(process.env.RARE_CAUSAL_COHORT_V2_REF, baseline);
const selection = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/quiet-trap-adversarial-selection.json", "utf8"),
);
const rows: unknown[] = [];
const sourceHash = () =>
    createHash("sha256")
        .update(
            execFileSync("git", [
                "-c",
                "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
                "show",
                `${baseline}:src/utils/tacticalMotifs/causalTactics.ts`,
            ]),
        )
        .digest("hex");
const initialHash = sourceHash();
for (const id of ["lichess:gMkbY", "lichess:9YfbQ"])
    for (const reflected of [false, true]) {
        test(`bounded independent nomination ${id} reflected=${reflected}`, () => {
            const selected = selection.cases.find((item: any) => item.id === id);
            const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
            const fen = reflected ? reflectMixedForkFen(selected.startFen) : selected.startFen;
            const line = selected.bestLine.map(m);
            const steps = replayTacticalLine(fen, line);
            expect(steps).toHaveLength(line.length);
            const root = steps[0],
                target = parseSquare(m(id.endsWith("gMkbY") ? "h5" : "c1"))!;
            const trace: string[] = [];
            const trap = proveTrappedMaterial(root, target, 256, 8, (reason) => trace.push(reason));
            const budget = { nodes: 16384 },
                leaves: any[] = [],
                failures: any[] = [];
            const gain = proveDefenderCombination(
                root,
                [target],
                [...root.after.board[root.before.turn]],
                16384,
                budget,
                1,
                true,
                90,
                (leaf) => leaves.push(leaf),
                true,
                (failure) => failures.push(failure),
                true,
                1,
            );
            const replies = legalMoves(root.after).map((reply) => {
                const next = play(root.after, reply);
                return {
                    uci: makeUci(reply),
                    san: makeSan(root.after, reply),
                    check: next.isCheck(),
                    capture: captureValue(root.after, reply),
                    candidates: legalMoves(next)
                        .filter(
                            (answer) =>
                                captureValue(next, answer) > 0 || play(next, answer).isCheck(),
                        )
                        .map((answer) => ({
                            uci: makeUci(answer),
                            san: makeSan(next, answer),
                            capture: captureValue(next, answer),
                            see: tacticalExchangeGain(next, answer),
                        })),
                };
            });
            const compositionBudget = { nodes: 16384 },
                composed: any[] = [];
            if (id.endsWith("gMkbY")) {
                for (const threshold of [90, 400])
                    for (const reply of legalMoves(root.after)) {
                        // Independent per-defence diagnostic only: this is not a
                        // proposed runtime budget or a single16k root certificate.
                        compositionBudget.nodes = 16384;
                        const next = play(root.after, reply),
                            victim = reply.from === target ? reply.to : target;
                        const debit =
                            balance(next, root.before.turn) -
                            balance(root.before, root.before.turn);
                        const candidates = legalMoves(next).filter(
                            (answer) =>
                                answer.to === victim ||
                                answer.to === reply.to ||
                                play(next, answer).isCheck(),
                        );
                        candidates.sort(
                            (a, b) =>
                                Number(b.to === victim) - Number(a.to === victim) ||
                                captureValue(next, b) - captureValue(next, a),
                        );
                        let proved: any = null;
                        for (const answer of candidates) {
                            if (compositionBudget.nodes < 0) break;
                            const answerStep = replayTacticalLine(makeFen(next.toSetup()), [
                                makeUci(answer),
                            ])[0];
                            const branchLeaves: any[] = [];
                            const branchGain = proveDefenderCombination(
                                answerStep,
                                answer.to === victim ? [] : [victim],
                                [...answerStep.after.board[root.before.turn]],
                                16384,
                                compositionBudget,
                                1,
                                true,
                                Math.max(1, threshold - debit),
                                (leaf) => branchLeaves.push(leaf),
                                true,
                                undefined,
                                true,
                                1,
                            );
                            if (branchGain !== null) {
                                assert.deepEqual(
                                    [
                                        ...new Set(branchLeaves.map((leaf) => leaf.lineUci[0])),
                                    ].sort(),
                                    legalMoves(answerStep.after).map(makeUci).sort(),
                                );
                                for (const leaf of branchLeaves) {
                                    let leafPosition = answerStep.after;
                                    for (const uci of leaf.lineUci.slice(0, -1))
                                        leafPosition = play(leafPosition, uci);
                                    assert.equal(makeFen(leafPosition.toSetup()), leaf.fen);
                                    assert.equal(
                                        balance(leafPosition, root.before.turn) -
                                            balance(next, root.before.turn),
                                        leaf.balance,
                                    );
                                    play(leafPosition, leaf.moveUci);
                                }
                                const compact = branchLeaves.map(
                                    ({ lineUci, moveUci, balance, gain }: any) => ({
                                        lineUci,
                                        moveUci,
                                        balance,
                                        gain,
                                    }),
                                );
                                proved = {
                                    answer: makeUci(answer),
                                    gain: debit + branchGain,
                                    followingLegalReplies: legalMoves(answerStep.after).map(
                                        makeUci,
                                    ),
                                    selectedLeaves: compact.length,
                                    selectedLeavesSha256: createHash("sha256")
                                        .update(JSON.stringify(compact))
                                        .digest("hex"),
                                    examples: compact.slice(0, 2),
                                };
                                break;
                            }
                        }
                        composed.push({
                            threshold,
                            reply: makeUci(reply),
                            debit,
                            proved,
                            visits: 16384 - compositionBudget.nodes,
                            exhausted: compositionBudget.nodes < 0,
                        });
                    }
                assert.equal(
                    composed.filter((branch) => branch.threshold === 90 && branch.proved).length,
                    30,
                );
                assert.equal(
                    composed.filter((branch) => branch.threshold === 400 && branch.proved).length,
                    29,
                );
            }
            expect(replies.length).toBeGreaterThan(0);
            rows.push({
                id,
                reflected,
                fen,
                line,
                rootChecks: root.after.isCheck(),
                root: classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] }),
                full: classifyPositionTacticalMotifs({ fen, pvUci: line }),
                displayedAccounting: steps.map((step) => ({
                    move: step.uci,
                    san: step.san,
                    fen: makeFen(step.after.toSetup()),
                    material:
                        balance(step.after, root.before.turn) -
                        balance(root.before, root.before.turn),
                })),
                trap,
                trapFailure: trace,
                bounded: { gain, visits: 16384 - budget.nodes, leaves, failures },
                replies,
                composition: {
                    scope: "Separate16k per-defence diagnostics, not one runtime root budget",
                    branches: composed,
                    totalVisits: composed.reduce((sum, branch) => sum + branch.visits, 0),
                },
            });
        });
    }
test("retain finite observations without upgrading unknown to negative", () => {
    expect(rows).toHaveLength(4);
    expect(sourceHash()).toBe(initialHash);
    if (process.env.QUIET_TRAP_FOLLOWUP_REPORT)
        writeFileSync(
            process.env.QUIET_TRAP_FOLLOWUP_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    baseline,
                    version: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
                    sourceHash: initialHash,
                    scope: "Finite nominated-target probe. Failed bounded proofs remain unknown, not positional classifications.",
                    rows,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});
