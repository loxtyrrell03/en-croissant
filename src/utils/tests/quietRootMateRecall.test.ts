import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { makeFen, parseFen } from "chessops/fen";
import { Chess } from "chessops/chess";
import { makeUci, parseUci } from "chessops/util";
import type { NormalMove } from "chessops/types";
import {
    proveCheckingMate,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";
import { quietRootMateCases } from "./fixtures/quietRootMate";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

function checkStrategy(fen: string, pv: string[]) {
    const steps = replayTacticalLine(fen, pv);
    expect(steps).toHaveLength(pv.length);
    const proof = proveCheckingMate(steps, 65536, true);
    if (!proof) {
        assert.equal(proveCheckingMate(steps), null);
        return { proof, probes: [] };
    }
    const { strategy: _strategy, visits: _visits, ...productionProof } = proof;
    assert.deepEqual(proveCheckingMate(steps), productionProof);
    expect(proof.visits).toBeLessThanOrEqual(65536);
    const probes = new Map<
        string,
        { fen: string; searchMove: string; mateWithin: number }
    >();
    const inspect = (
        node: NonNullable<typeof proof.strategy>,
        remaining: number,
    ) => {
        const pos = Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
        if (!node.replies.length) {
            assert.equal(pos.isCheckmate(), true);
            return;
        }
        expect(remaining).toBeGreaterThan(0);
        expect(pos.isEnd()).toBe(false);
        expect(pos.halfmoves).toBeLessThan(100);
        const legal: NormalMove[] = [...pos.allDests()].flatMap(
            ([from, dests]) =>
                [...dests].flatMap((to) =>
                    pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                        ? (["queen", "rook", "bishop", "knight"] as const).map(
                              (promotion) => ({ from, to, promotion }),
                          )
                        : [{ from, to }],
                ),
        );
        expect(node.replies.map((reply) => reply.move).sort()).toEqual(
            legal.map(makeUci).sort(),
        );
        for (const branch of node.replies) {
            const after = pos.clone();
            after.play(parseUci(branch.move)!);
            const answer = parseUci(branch.answer)!;
            expect(after.isEnd()).toBe(false);
            expect(after.isLegal(answer)).toBe(true);
            const beforeAnswer = makeFen(after.toSetup());
            const key = `${beforeAnswer}:${branch.answer}`;
            probes.set(key, {
                fen: beforeAnswer,
                searchMove: branch.answer,
                mateWithin: Math.min(
                    remaining,
                    probes.get(key)?.mateWithin ?? remaining,
                ),
            });
            after.play(answer);
            expect(makeFen(after.toSetup())).toBe(branch.next.fen);
            inspect(branch.next, remaining - 1);
        }
    };
    expect(proof.strategy!.fen).toBe(makeFen(steps[0].after.toSetup()));
    inspect(proof.strategy!, proof.maxMoves - 1);
    return {
        proof,
        probes: [...probes.values()].map((probe, index) => ({
            ...probe,
            id: `answer:${index}`,
        })),
    };
}

const publicSample = JSON.parse(
    readFileSync(
        "benchmarks/tactical-relevance/quiet-mate-development.json",
        "utf8",
    ),
);
const queen = publicSample.cases.find((row: any) => row.id === "lichess:0rcU4");

test("fresh public engine receipts corroborate mates, queen-capture refutations and draw claims", () => {
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/quiet-root-mate-stockfish-18.json",
            "utf8",
        ),
    );
    expect(receipt.searches).toHaveLength(16);
    for (const reflected of [false, true]) {
        for (const row of quietRootMateCases) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const move = reflected
                ? reflectMixedForkMove(row.pvUci[0])
                : row.pvUci[0];
            const checked = receipt.searches.find(
                (item: any) => item.id === `${row.id}:${reflected}:root`,
            );
            expect(checked).toMatchObject({ fen, searchMove: move });
            expect(checked.lines[0].depth).toBe(16);
            expect(checked.lines[0].mate).toBe(row.positive ? 4 : null);
            const cp = checked.lines[0].cp;
            assert(row.positive ? cp === null : Number.isFinite(cp) && cp <= 0);
            assert(!row.id.startsWith("claimable") || cp === 0);
        }
    }
});

test.each([false, true])(
    "quiet root mates cover every legal defence, reflected=%s",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(queen.startFen)
            : queen.startFen;
        const pv = reflected
            ? queen.bestLine.map(reflectMixedForkMove)
            : queen.bestLine;
        const { proof } = checkStrategy(fen, pv);
        expect(proof).toMatchObject({ maxMoves: 4 });
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: pv }).motifs[0],
        ).toMatchObject({ id: "mateIn4", ply: 1 });
        expect(
            proveCheckingMate(replayTacticalLine(fen, pv.slice(0, 1))),
        ).toBeNull();
        for (const limit of [0, 1, -1, NaN, Infinity, 1.5])
            expect(
                proveCheckingMate(replayTacticalLine(fen, pv), limit),
            ).toBeNull();
        const defended =
            fen === queen.startFen
                ? fen.replace("4N3", "4NN2")
                : reflectMixedForkFen(queen.startFen.replace("4N3", "4NN2"));
        const cooperative = replayTacticalLine(defended, pv);
        expect(cooperative).toHaveLength(pv.length);
        expect(cooperative.at(-1)!.after.isCheckmate()).toBe(true);
        expect(proveCheckingMate(cooperative)).toBeNull();
        const claimFen = fen.replace(/ \d+ \d+$/, " 99 23");
        expect(proveCheckingMate(replayTacticalLine(claimFen, pv))).toBeNull();
    },
);

test.each([false, true])(
    "quiet and capturing roots preserve contrary defences and draw claims, reflected=%s",
    (reflected) => {
        for (const row of quietRootMateCases) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const pv = reflected
                ? row.pvUci.map(reflectMixedForkMove)
                : row.pvUci;
            const steps = replayTacticalLine(fen, pv);
            expect(steps).toHaveLength(pv.length);
            expect(steps.at(-1)!.after.isCheckmate()).toBe(true);
            const { proof } = checkStrategy(fen, pv);
            expect({ id: row.id, proved: Boolean(proof) }).toEqual({
                id: row.id,
                proved: row.positive,
            });
            const result = classifyPositionTacticalMotifs({ fen, pvUci: pv });
            expect(
                result.motifs.some((motif) => /^mateIn/.test(motif.id)),
            ).toBe(row.positive);
            expect(
                row.positive
                    ? { id: result.motifs[0]?.id, ply: result.motifs[0]?.ply }
                    : null,
            ).toEqual(row.positive ? { id: "mateIn4", ply: 1 } : null);
            const scan = buildLiveTacticalScan({
                fen,
                pvUci: pv,
                engineName: "Quiet-root test",
                depth: 16,
            });
            assert(
                !row.positive || scan.arrows.every((arrow) => arrow.ply === 1),
            );
        }
    },
);

test.skipIf(!process.env.TACTICAL_QUIET_ROOT_PUBLIC_REPORT)(
    "export quiet-root public certificates and controls",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const cases = [];
        for (const reflected of [false, true])
            for (const row of publicSample.cases.filter(
                (row: any) => row.stratum === "mateIn4",
            )) {
                const fen = reflected
                    ? reflectMixedForkFen(row.startFen)
                    : row.startFen;
                const pvUci = reflected
                    ? row.bestLine.map(reflectMixedForkMove)
                    : row.bestLine;
                const inspected = checkStrategy(fen, pvUci);
                cases.push({
                    id: `${row.id}:${reflected}`,
                    fen,
                    pvUci,
                    ...inspected,
                });
            }
        for (const reflected of [false, true])
            for (const row of quietRootMateCases) {
                const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                const pvUci = reflected
                    ? row.pvUci.map(reflectMixedForkMove)
                    : row.pvUci;
                cases.push({
                    id: `${row.id}:${reflected}`,
                    fen,
                    pvUci,
                    ...checkStrategy(fen, pvUci),
                });
            }
        const probes = cases.flatMap((row) => [
            { id: `${row.id}:root`, fen: row.fen, searchMove: row.pvUci[0] },
            ...row.probes.map((probe) => ({
                ...probe,
                id: `${row.id}:${probe.id}`,
            })),
        ]);
        expect(cases).toHaveLength(18);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_QUIET_ROOT_PUBLIC_REPORT!),
            JSON.stringify(
                {
                    samplePath:
                        "benchmarks/tactical-relevance/quiet-mate-development.json",
                    cases,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_MATE_STRATEGY_PYTHON)(
    "a second rules library verifies strategies and rejects tampering",
    () => {
        const row = quietRootMateCases[0];
        const report = {
            cases: [{ ...row, ...checkStrategy(row.fen, row.pvUci) }],
        };
        const run = (input: unknown) =>
            spawnSync(
                process.env.TACTICAL_MATE_STRATEGY_PYTHON!,
                ["scripts/benchmarks/verify-mating-strategy.py"],
                {
                    input: JSON.stringify(input),
                    encoding: "utf8",
                    windowsHide: true,
                },
            );
        expect(run(report).status).toBe(0);
        for (const corruption of [
            "missing-defence",
            "false-terminal",
            "illegal-answer",
            "false-distance",
        ]) {
            const invalid = structuredClone(report);
            const proof = invalid.cases[0].proof!;
            if (corruption === "missing-defence") proof.strategy!.replies.pop();
            if (corruption === "false-terminal") proof.strategy!.replies = [];
            if (corruption === "illegal-answer")
                proof.strategy!.replies[0].answer = "a1a8";
            if (corruption === "false-distance") proof.maxMoves = 1;
            expect({ corruption, accepted: run(invalid).status === 0 }).toEqual(
                { corruption, accepted: false },
            );
        }
    },
);

test.skipIf(
    !process.env.TACTICAL_QUIET_ROOT_PRIVATE_REPLAY ||
        !process.env.TACTICAL_QUIET_ROOT_PRIVATE_REPORT,
)(
    "verify the newly recovered private course root and its colour reflection",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const report = JSON.parse(
            readFileSync(
                process.env.TACTICAL_QUIET_ROOT_PRIVATE_REPLAY!,
                "utf8",
            ),
        );
        const row = report.results
            .flatMap((group: any) => group.cases)
            .find((row: any) => row.id === "private-easy:153");
        const cases = [false, true].map((reflected) => {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const pvUci = reflected
                ? row.engineLines[0].pvUci.map(reflectMixedForkMove)
                : row.engineLines[0].pvUci;
            const inspected = checkStrategy(fen, pvUci);
            expect(inspected.proof).toMatchObject({ maxMoves: 6 });
            return { id: `${row.id}:${reflected}`, fen, pvUci, ...inspected };
        });
        writeFileSync(
            privateReportPath(process.env.TACTICAL_QUIET_ROOT_PRIVATE_REPORT!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_QUIET_ROOT_PRIVATE_REPLAY,
                    cases,
                    probes: cases.flatMap((row) => [
                        {
                            id: `${row.id}:root`,
                            fen: row.fen,
                            searchMove: row.pvUci[0],
                        },
                        ...row.proof!.strategy!.replies.map((branch) => ({
                            id: `${row.id}:answer:${branch.move}`,
                            fen: makeFen(
                                replayTacticalLine(row.fen, [
                                    row.pvUci[0],
                                    branch.move,
                                ])[1].after.toSetup(),
                            ),
                            searchMove: branch.answer,
                            certificateMateWithin: row.proof!.maxMoves - 1,
                        })),
                    ]),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    120_000,
);

test.skipIf(!process.env.TACTICAL_QUIET_ROOT_CONTROL_REQUEST)(
    "nominate fresh public root and queen-capture controls",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const probes = [false, true].flatMap((reflected) =>
            quietRootMateCases.flatMap((row) => {
                const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                const move = reflected
                    ? reflectMixedForkMove(row.pvUci[0])
                    : row.pvUci[0];
                const list: any[] = [
                    {
                        id: `${row.id}:${reflected}:root`,
                        fen,
                        searchMove: move,
                    },
                ];
                if (row.id.startsWith("capturable")) {
                    const reply = reflected
                        ? reflectMixedForkMove("f5h4")
                        : "f5h4";
                    const steps = replayTacticalLine(fen, [move, reply]);
                    assert.equal(steps.length, 2);
                    list.push({
                        id: `${row.id}:${reflected}:acceptance`,
                        fen: makeFen(steps[1].after.toSetup()),
                    });
                }
                return list;
            }),
        );
        expect(probes).toHaveLength(16);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_QUIET_ROOT_CONTROL_REQUEST!),
            JSON.stringify(
                {
                    samplePath:
                        "benchmarks/tactical-relevance/quiet-mate-development.json",
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_QUIET_ROOT_REMAINING_REQUEST)(
    "retain contrary mate distance and nominate the remaining decisions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const source = process.env.TACTICAL_QUIET_ROOT_STRATEGIES!;
        const report = JSON.parse(readFileSync(source, "utf8"));
        const completed = JSON.parse(
            readFileSync(
                process.env.TACTICAL_QUIET_ROOT_PARTIAL_ENGINE!,
                "utf8",
            ),
        );
        const additional = process.env.TACTICAL_QUIET_ROOT_ADDITIONAL_ENGINE
            ? JSON.parse(
                  readFileSync(
                      process.env.TACTICAL_QUIET_ROOT_ADDITIONAL_ENGINE,
                      "utf8",
                  ),
              ).searches
            : [];
        // Older receipts can contain repeated IDs. Resume by the actual
        // position and held move, never a display identifier alone.
        const decisionKey = (row: any) => `${row.fen}:${row.searchMove ?? ""}`;
        const seen = new Set(
            [...completed.searches, ...additional].map(decisionKey),
        );
        const probes = report.probes
            .filter((probe: any) => !seen.has(decisionKey(probe)))
            .map(({ mateWithin, ...probe }: any) => ({
                ...probe,
                certificateMateWithin: mateWithin,
            }));
        expect(probes.length).toBeGreaterThan(0);
        writeFileSync(
            privateReportPath(
                process.env.TACTICAL_QUIET_ROOT_REMAINING_REQUEST!,
            ),
            JSON.stringify(
                {
                    samplePath: source,
                    scope: "Finite-depth engine corroboration; exact bound verified by independent complete legal strategies. Earlier contrary distances remain in the original receipts.",
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_QUIET_ROOT_OWNER_RESULT)(
    "owner mate lessons keep played, missed, existing-danger and faster-mate contexts distinct",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_QUIET_ROOT_OWNER_RESULT!, "utf8"),
        );
        const game = report.results[0].game;
        const row = (ply: number) =>
            report.results.find(
                (item: any) => item.game === game && item.ply === ply,
            );
        expect(row(34).scan.motifs[0]).toMatchObject({
            id: "mateIn6",
            moveUci: "c8h8",
            ply: 1,
        });
        expect(row(34).playedMoveUci).toBe("c8h8");
        expect(row(34).classification.missedMotifs).toEqual([]);
        expect(row(42).scan.motifs[0]).toMatchObject({
            id: "mateIn2",
            moveUci: "f6f7",
        });
        expect(row(47).explanation.primary).toMatchObject({
            id: "mateIn4",
            comparison: "persists",
        });
        expect(row(48).explanation.primary).toMatchObject({
            id: "mateIn4",
            moveUci: "e1d2",
            source: "missed",
            ply: 1,
        });
        expect(row(48).classification.missedTimeline).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "discoveredCheck",
                    ply: 3,
                    actor: "white",
                }),
            ]),
        );
        for (const ply of [34, 48]) {
            expect(row(ply).scan.arrows.length).toBeGreaterThan(0);
            expect(
                row(ply).scan.arrows.every((arrow: any) => arrow.ply === 1),
            ).toBe(true);
        }
    },
);

test.skipIf(
    !process.env.TACTICAL_QUIET_ROOT_REPLAY ||
        !process.env.TACTICAL_QUIET_ROOT_REPORT,
)(
    "audit nonchecking mating roots from frozen owner games",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_QUIET_ROOT_REPLAY!, "utf8"),
        );
        const cases = [];
        for (const row of report.results)
            for (const variation of row.before) {
                const steps = replayTacticalLine(row.fen, variation.pvUci);
                if (
                    !steps.length ||
                    steps[0].after.isCheck() ||
                    !steps.some((step) => step.after.isCheckmate())
                )
                    continue;
                expect(steps).toHaveLength(variation.pvUci.length);
                const start = performance.now();
                const inspected = checkStrategy(row.fen, variation.pvUci);
                const proof = inspected.proof;
                const elapsedMs = performance.now() - start;
                const result = classifyPositionTacticalMotifs({
                    fen: row.fen,
                    pvUci: variation.pvUci,
                });
                cases.push({
                    game: row.game,
                    ply: row.ply,
                    fen: row.fen,
                    pvUci: variation.pvUci,
                    pvSan: variation.pvSan,
                    proof,
                    probes: inspected.probes,
                    elapsedMs,
                    result,
                });
            }
        expect(cases.length).toBeGreaterThan(0);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_QUIET_ROOT_REPORT!),
            JSON.stringify(
                {
                    source: process.env.TACTICAL_QUIET_ROOT_REPLAY,
                    samplePath: process.env.TACTICAL_QUIET_ROOT_REPLAY,
                    cases,
                    probes: cases.flatMap((row) => [
                        {
                            id: `${row.game}:${row.ply}:${row.pvUci[0]}:root`,
                            fen: row.fen,
                            searchMove: row.pvUci[0],
                        },
                        ...row.probes.map((probe) => ({
                            ...probe,
                            id: `${row.game}:${row.ply}:${row.pvUci[0]}:${probe.id}`,
                        })),
                    ]),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    120_000,
);
