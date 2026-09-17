import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import { proveCaptureForkPreparation, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { forkRayClearanceCases, forkRayClearanceControls } from "./fixtures/forkRayClearance";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

test.each(forkRayClearanceCases)("prove every defence to the $id offer", (row) => {
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const move = reflected ? reflectMixedForkMove(row.move) : row.move;
        const root = replayTacticalLine(fen, [move])[0];
        const failures: string[] = [];
        const proof = proveCaptureForkPreparation(root, 8192, (reason) => failures.push(reason));
        assert.ok(proof, failures.join("; "));
        expect(proof!.branches.some((b) => b.clearedForkRay)).toBe(true);
        expect(proof!.gain).toBeGreaterThanOrEqual(100);
    }
});

test.skipIf(!process.env.TACTICAL_FORK_RAY_AUDIT_REPORT)(
    "record legal root replies and selected preparation decisions for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_FORK_RAY_AUDIT_REPORT!);
        expect(existsSync(output)).toBe(false);
        const inputs = [...forkRayClearanceCases, ...forkRayClearanceControls].flatMap((row) =>
            [false, true].map((reflected) => ({
                id: `${row.id}:${reflected ? "reflected" : "original"}`,
                fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
                move: reflected ? reflectMixedForkMove(row.move) : row.move,
            })),
        );
        if (process.env.TACTICAL_FORK_RAY_OWNER_INPUT) {
            const owner = JSON.parse(
                readFileSync(process.env.TACTICAL_FORK_RAY_OWNER_INPUT, "utf8"),
            );
            const branch = owner.branches.find((b: any) => b.san === "Bd2");
            expect(branch).toBeDefined();
            const capture = branch.captures.find((c: any) => c.san === "Bxc3");
            expect(capture).toBeDefined();
            inputs.push({ id: "owner-reached-Bd2", fen: branch.fen, move: capture.move });
        }
        const probes: { id: string; fen: string; searchMove?: string }[] = [];
        const cases = inputs.map((row) => {
            const root = replayTacticalLine(row.fen, [row.move])[0];
            expect(root).toBeDefined();
            const proof = proveCaptureForkPreparation(root);
            probes.push(
                { id: `${row.id}:best`, fen: row.fen },
                { id: `${row.id}:held`, fen: row.fen, searchMove: row.move },
            );
            if (proof) {
                const branches = [
                    ...proof.branches,
                    ...proof.declined,
                    ...(proof.otherCaptures ?? []),
                ];
                const legal = [...root.after.allDests()].flatMap(([from, dests]) =>
                    [...dests].map((to) => ({ from, to })),
                );
                expect(
                    legal.some(
                        (m) =>
                            root.after.board.get(m.from)?.role === "pawn" &&
                            (m.to < 8 || m.to >= 56),
                    ),
                ).toBe(false);
                const replies = branches.map((branch) => {
                    const reply = parseSan(root.after, branch.reply);
                    expect(reply).toBeDefined();
                    const next = root.after.clone();
                    next.play(reply!);
                    const answer = parseSan(next, branch.answer);
                    expect(answer).toBeDefined();
                    const fen = makeFen(next.toSetup());
                    probes.push({
                        id: `${row.id}:${branch.reply}:held`,
                        fen,
                        searchMove: makeUci(answer!),
                    });
                    return makeUci(reply!);
                });
                expect([...new Set(replies)].sort()).toEqual(legal.map(makeUci).sort());
                for (const branch of proof.branches) {
                    const next = root.after.clone();
                    next.play(parseSan(next, branch.reply)!);
                    const fork = parseSan(next, branch.answer)!;
                    next.play(fork);
                    for (const [from, dests] of next.allDests())
                        for (const to of dests) {
                            expect(
                                next.board.get(from)?.role === "pawn" && (to < 8 || to >= 56),
                            ).toBe(false);
                            const after = next.clone();
                            after.play({ from, to });
                            if (!after.isEnd())
                                probes.push({
                                    id: `${row.id}:${branch.reply}:${makeUci({ from, to })}:best`,
                                    fen: makeFen(after.toSetup()),
                                });
                        }
                }
                for (const branch of proof.declined)
                    for (const [index, leaf] of (branch.checkingExchange ?? []).entries()) {
                        probes.push({
                            id: `${row.id}:${branch.reply}:leaf:${index}`,
                            fen: leaf.fen,
                            searchMove: leaf.moveUci,
                        });
                        for (const [checkIndex, check] of (leaf.counterchecks ?? []).entries())
                            probes.push({
                                id: `${row.id}:${branch.reply}:leaf:${index}:countercheck:${checkIndex}`,
                                fen: check.fen,
                                searchMove: check.moveUci,
                            });
                    }
            }
            return {
                ...row,
                proof,
                source: classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] }),
                scan: buildLiveTacticalScan({
                    fen: row.fen,
                    pvUci: [row.move],
                    depth: 16,
                    engineName: "Constructed input",
                }),
            };
        });
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Constructed and reached owner preparation decisions; not general accuracy or original quiet-pin proof.",
                    samplePath: process.env.TACTICAL_FORK_RAY_OWNER_INPUT ?? output,
                    cases,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            JSON.stringify({
                cases: cases.length,
                probes: probes.length,
                lessons: cases.map((c) => ({
                    id: c.id,
                    gain: c.proof?.gain,
                    motifs: c.source.motifs.map((m) => m.id),
                })),
            }),
        );
    },
    60000,
);

test.each(forkRayClearanceControls)("does not claim ray preparation for $id", (row) => {
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const move = reflected ? reflectMixedForkMove(row.move) : row.move;
        const root = replayTacticalLine(fen, [move])[0];
        expect(root).toBeDefined();
        expect(proveCaptureForkPreparation(root)).toBeNull();
    }
});

test("keeps preparation at the root and the fork on its actual continuation ply", () => {
    const row = forkRayClearanceCases[0];
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const line = [row.move, "d3c4", "e2c2", "b3b4", "c2g6"].map((move) =>
            reflected ? reflectMixedForkMove(move) : move,
        );
        expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
        expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 310 });
        expect(result.timeline).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "fork", ply: 3, moveUci: line[2] }),
            ]),
        );
        const scan = buildLiveTacticalScan({
            fen,
            pvUci: line,
            depth: 16,
            engineName: "Constructed input",
        });
        expect(scan.arrows).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    from: reflected ? "c7" : "c2",
                    to: reflected ? "g3" : "g6",
                }),
            ]),
        );
        expect(scan.labels.map((label) => label.text)).toEqual(["Fork Preparation"]);
    }
});

test("a larger queen loss keeps priority over the missed ray preparation", () => {
    const row = forkRayClearanceCases[0];
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const flip = (move: string) => (reflected ? reflectMixedForkMove(move) : move);
        expect(replayTacticalLine(fen, ["e2e5", "g6e5"].map(flip))).toHaveLength(2);
        const result = classifyMistakeReviewMotifs({
            fen,
            playedMoveUci: flip("e2e5"),
            bestMoveUci: flip(row.move),
            pvUci: [row.move, "d3c4", "e2c2", "b3b4", "c2g6"].map(flip),
            refutationUci: ["g6e5"].map(flip),
            cpBefore: reflected ? 450 : -466,
            cpAfter: reflected ? -315 : 301,
            cpLoss: reflected ? 765 : 767,
        });
        expect(result.missedMotifs).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: "forkPreparation", ply: 1 })]),
        );
        const explanation = buildMistakeReviewTacticalExplanation(result);
        expect(explanation).toBeDefined();
        expect(explanation?.primary.id).toBe("hangingPiece");
        expect(explanation?.secondary?.id).toBe("forkPreparation");
    }
});
