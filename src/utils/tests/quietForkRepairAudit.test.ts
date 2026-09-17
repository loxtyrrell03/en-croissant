import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { attacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, opposite } from "chessops/util";
import {
    proveDefenderCombination,
    proveImmediateFork,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";

// Diagnostic only: independently try actual quiet repairs of an endangered
// ally while retaining the original fork victims. Per-candidate diagnostic
// budgets are not a production admission rule or a runtime budget proposal.
test.skipIf(!process.env.TACTICAL_QUIET_FORK_INPUT || !process.env.TACTICAL_QUIET_FORK_REPORT)(
    "inspect quiet fork collection and independently verified ally repairs",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_QUIET_FORK_REPORT!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_QUIET_FORK_INPUT!, "utf8"));
        const row = input.results.find((r: any) => r.id === process.env.TACTICAL_QUIET_FORK_ID);
        expect(row).toBeDefined();
        const root = replayTacticalLine(row.fen, [row.before[0].pvUci[0]])[0];
        const side = root.before.turn,
            forker = root.move.to;
        const targets = [
            ...attacks(root.after.board.get(forker)!, forker, root.after.board.occupied).intersect(
                root.after.board[opposite(side)],
            ),
        ].filter((square) => !["king", "pawn"].includes(root.after.board.get(square)!.role));
        expect(targets.length).toBeGreaterThanOrEqual(2);
        const branches = [];
        for (const [from, tos] of root.after.allDests())
            for (const to of tos) {
                const replyUci = makeUci({ from, to });
                const reply = replayTacticalLine(makeFen(root.after.toSetup()), [replyUci])[0];
                const pos = reply.after;
                const victims = targets.map((square) => (square === from ? to : square));
                const direct = [];
                for (const [a, bs] of pos.allDests())
                    for (const b of bs) {
                        if (a !== forker || !victims.includes(b) || !pos.board.get(b)) continue;
                        const step = replayTacticalLine(makeFen(pos.toSetup()), [
                            makeUci({ from: a, to: b }),
                        ])[0];
                        const gain = tacticalCaptureGain(step);
                        const nextTargets = [
                            ...attacks(
                                step.after.board.get(b)!,
                                b,
                                step.after.board.occupied,
                            ).intersect(step.after.board[opposite(side)]),
                        ].filter(
                            (square) =>
                                !["king", "pawn"].includes(step.after.board.get(square)!.role),
                        );
                        const collectionLeaves: any[] = [];
                        const collectionBudget = { nodes: 8192 };
                        const collection =
                            gain !== null && gain >= 90
                                ? null
                                : proveDefenderCombination(
                                      step,
                                      nextTargets,
                                      [b],
                                      8192,
                                      collectionBudget,
                                      1,
                                      true,
                                      90,
                                      (leaf) => collectionLeaves.push(leaf),
                                  );
                        direct.push({
                            move: step.san,
                            gain,
                            nextTargets,
                            collection,
                            collectionVisits: 8192 - collectionBudget.nodes,
                            collectionLeaves,
                        });
                    }
                const directWorks = direct.some(
                    (item) => item.gain !== null && item.gain - reply.capture >= 90,
                );
                const repairs = [];
                if (!directWorks) {
                    for (const [a, bs] of pos.allDests())
                        for (const b of bs) {
                            if (
                                a === forker ||
                                pos.board.get(a)?.role === "king" ||
                                pos.board.get(b)
                            )
                                continue;
                            const step = replayTacticalLine(makeFen(pos.toSetup()), [
                                makeUci({ from: a, to: b }),
                            ])[0];
                            if (step.after.isCheck()) continue;
                            const leaves: any[] = [];
                            const budget = { nodes: 8192 };
                            const gain = proveDefenderCombination(
                                step,
                                victims,
                                [forker],
                                8192,
                                budget,
                                1,
                                true,
                                90 + reply.capture,
                                (leaf) => leaves.push(leaf),
                            );
                            if (gain !== null)
                                repairs.push({
                                    move: step.san,
                                    uci: step.uci,
                                    gain,
                                    visits: 8192 - budget.nodes,
                                    leaves,
                                });
                        }
                }
                branches.push({
                    replyUci,
                    replySan: makeSan(root.after, { from, to }),
                    direct,
                    directWorks,
                    repairs,
                });
            }
        const diagnostics: unknown[] = [];
        const immediate = proveImmediateFork(root, (...info) => diagnostics.push(info));
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Exploratory all-reply fork audit; each repair has a separate diagnostic budget, not production proof.",
                    id: row.id,
                    root: root.uci,
                    targets,
                    immediate,
                    diagnostics,
                    branches,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        if (process.env.TACTICAL_FORK_COLLECTION_PROBES) {
            const probes: any[] = [{ id: "root", fen: row.fen, searchMove: root.uci }];
            const seen = new Set<string>();
            const add = (id: string, fen: string, searchMove: string) => {
                const key = `${fen}:${searchMove}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    probes.push({ id, fen, searchMove, minCp: 0 });
                }
            };
            if (!immediate) throw new Error("A complete fork certificate is required for engine probes");
            for (const [i, branch] of immediate!.branches.entries()) {
                const reply = replayTacticalLine(makeFen(root.after.toSetup()), [
                    branch.replyUci,
                ])[0];
                if (branch.captureUci)
                    add(`root-answer-${i}`, makeFen(reply.after.toSetup()), branch.captureUci);
                for (const [j, leaf] of (branch.collection ?? []).entries()) {
                    add(`collection-${i}-${j}`, leaf.fen, leaf.moveUci);
                    for (const [k, answer] of (leaf.counterchecks ?? []).entries())
                        add(`countercheck-${i}-${j}-${k}`, answer.fen, answer.moveUci);
                }
            }
            writeFileSync(
                privateReportPath(process.env.TACTICAL_FORK_COLLECTION_PROBES),
                JSON.stringify(
                    {
                        samplePath: process.env.TACTICAL_QUIET_FORK_INPUT,
                        probes,
                    },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
        expect(branches.length).toBeGreaterThan(0);
    },
    120000,
);
