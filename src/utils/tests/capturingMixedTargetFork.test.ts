import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import { proveMixedTargetFork, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    capturingMixedForkCases,
    capturingMixedForkFen,
    capturingMixedForkLine,
} from "./fixtures/capturingMixedTargetFork";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

test.skipIf(
    !process.env.TACTICAL_CAPTURE_FORK_CHANGED_REPLAY ||
        !process.env.TACTICAL_CAPTURE_FORK_CHANGED_REPORT,
)(
    "audit newly admitted owner fork roots and continuation branches",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CAPTURE_FORK_CHANGED_REPORT!);
        expect(existsSync(output)).toBe(false);
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_CAPTURE_FORK_CHANGED_REPLAY!, "utf8"),
        );
        const baseline = JSON.parse(readFileSync(report.replayFrom[0], "utf8"));
        const found = new Map<string, any>();
        const key = (m: any) => JSON.stringify([m.id, m.ply, m.moveUci, m.value]);
        for (const changed of report.changed) {
            const row = report.results.find((r: any) => r.id === changed.id);
            const old = baseline.results.find((r: any) => r.id === row.id);
            const inspect = (motifs: any[], prior: any[], fen: string, lines: string[][]) => {
                for (const motif of motifs.filter(
                    (m) => m.id === "fork" && !prior.some((p) => key(p) === key(m)),
                )) {
                    for (const line of lines) {
                        const step = replayTacticalLine(fen, line)[motif.ply - 1];
                        if (!step || step.uci !== motif.moveUci) continue;
                        const proof = proveMixedTargetFork(step);
                        if (!proof || proof.gain !== motif.value) continue;
                        const rootFen = makeFen(step.before.toSetup());
                        const id = `${rootFen}:${step.uci}`;
                        if (found.has(id)) continue;
                        const name = `new-fork-${found.size + 1}`;
                        found.set(id, {
                            id: name,
                            context: row.id,
                            fen: rootFen,
                            move: step.uci,
                            proof,
                            probes: [
                                { id: `${name}:best`, fen: rootFen },
                                { id: `${name}:held`, fen: rootFen, searchMove: step.uci },
                                ...proof.captureBranches!.flatMap((branch) => {
                                    const reply = replayTacticalLine(
                                        makeFen(step.after.toSetup()),
                                        [branch.replyUci],
                                    )[0];
                                    const fen = makeFen(reply.after.toSetup());
                                    return [
                                        { id: `${name}:${branch.replyUci}:best`, fen },
                                        {
                                            id: `${name}:${branch.replyUci}:held`,
                                            fen,
                                            searchMove: branch.answerUci,
                                        },
                                    ];
                                }),
                            ],
                        });
                    }
                }
            };
            inspect(
                row.source.timeline ?? row.source.motifs,
                old.source.timeline ?? old.source.motifs,
                row.fen,
                [row.sourceUci],
            );
            for (const variation of row.scan.variations) {
                const prior = old.scan.variations.find((v: any) => v.multipv === variation.multipv);
                inspect(
                    variation.timeline ?? variation.motifs,
                    prior?.timeline ?? prior?.motifs ?? [],
                    row.fen,
                    [variation.lineUci],
                );
            }
            inspect(
                row.classification.allowedTimeline ?? [],
                old.classification.allowedTimeline ?? [],
                row.afterFen,
                row.after.map((l: any) => l.pvUci),
            );
            inspect(
                row.classification.missedTimeline ?? [],
                old.classification.missedTimeline ?? [],
                row.fen,
                row.before.map((l: any) => l.pvUci),
            );
        }
        const cases = [...found.values()];
        expect(cases.length).toBeGreaterThan(0);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_CAPTURE_FORK_CHANGED_REPLAY,
                    cases,
                    probes: cases.flatMap((c) => c.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    60000,
);

test.skipIf(!process.env.TACTICAL_CAPTURE_FORK_REPLAY || !process.env.TACTICAL_CAPTURE_FORK_REPORT)(
    "inspect capturing mixed-target forks in selected owner positions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CAPTURE_FORK_REPORT!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_FORK_REPLAY!, "utf8"));
        const ids: string[] = JSON.parse(process.env.TACTICAL_CAPTURE_FORK_IDS ?? "[]");
        expect(ids.length).toBeGreaterThan(0);
        const rows = input.results.filter((row: any) => ids.includes(row.id));
        expect(rows).toHaveLength(ids.length);
        const cases = rows.map((row: any) => {
            const line = row.before[0].pvUci;
            const step = replayTacticalLine(row.fen, line)[0];
            const attempts: unknown[] = [];
            const proof = proveMixedTargetFork(step, 8192, (targets, result) =>
                attempts.push({ targets: targets.map(makeSquare), result }),
            );
            return {
                id: row.id,
                fen: row.fen,
                line,
                proof,
                attempts,
                result: classifyPositionTacticalMotifs({ fen: row.fen, pvUci: line }),
                probes: [
                    { id: `${row.id}:root`, fen: row.fen },
                    { id: `${row.id}:held`, fen: row.fen, searchMove: step.uci },
                    ...(proof?.captureBranches ?? []).flatMap((branch) => {
                        const reply = replayTacticalLine(makeFen(step.after.toSetup()), [
                            branch.replyUci,
                        ])[0];
                        const fen = makeFen(reply.after.toSetup());
                        return [
                            { id: `${row.id}:${branch.replyUci}:best`, fen },
                            {
                                id: `${row.id}:${branch.replyUci}:held`,
                                fen,
                                searchMove: branch.answerUci,
                            },
                        ];
                    }),
                ],
            };
        });
        writeFileSync(
            output,
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_CAPTURE_FORK_REPLAY,
                    cases,
                    probes: cases.flatMap((row: any) => row.probes),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.each(capturingMixedForkCases)("$id requires a safe payoff beyond the entry capture", (row) => {
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const move = reflected ? reflectMixedForkMove("g5g2") : "g5g2";
        const step = replayTacticalLine(fen, [move])[0];
        const proof = proveMixedTargetFork(step);
        expect({ gain: proof?.gain ?? null, reflected }).toEqual({ gain: row.gain, reflected });
        const result = classifyPositionTacticalMotifs({ fen, pvUci: [move] });
        expect(result.motifs.some((m) => m.id === "fork")).toBe(row.gain !== null);
    }
});

test.each(capturingMixedForkCases.filter((row) => row.gain !== null))(
    "$id covers every legal defence in both colours",
    (row) => {
        for (const reflected of [false, true]) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const step = replayTacticalLine(fen, [
                reflected ? reflectMixedForkMove("g5g2") : "g5g2",
            ])[0];
            const proof = proveMixedTargetFork(step)!;
            expect(proof).not.toBeNull();
            expect(proof.captureBranches?.length).toBe(
                [...step.after.allDests()].reduce((sum, [, tos]) => sum + tos.size(), 0),
            );
            for (const branch of proof.captureBranches!) {
                expect(
                    replayTacticalLine(makeFen(step.after.toSetup()), [
                        branch.replyUci,
                        branch.answerUci,
                    ]),
                ).toHaveLength(2);
                expect(branch.gain).toBeGreaterThanOrEqual(step.capture + 100);
            }
        }
    },
);

test("fresh engine lines preserve the constructed positives and contrary controls", () => {
    const report = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/capturing-mixed-fork-stockfish-18.json",
            "utf8",
        ),
    );
    expect(report.completed).toBe(28);
    for (const row of capturingMixedForkCases)
        for (const reflected of [false, true]) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const entry = report.searches.find((r: any) => r.id === `${row.id}:${reflected}:held`);
            expect(entry.fen).toBe(fen);
            expect(entry.lines[0].depth).toBe(16);
            const line = entry.lines[0];
            expect(replayTacticalLine(fen, line.pvUci)).toHaveLength(line.pvUci.length);
            const scan = buildLiveTacticalScan({
                fen,
                pvUci: line.pvUci,
                variations: [line],
                depth: 16,
                engineName: "Stockfish 18",
            });
            // A later checking fork may be valid in the engine continuation;
            // it must not certify the rejected capturing root.
            expect(
                scan.motifs.filter((m) => m.id === "fork" && m.ply === 1).map((m) => m.value),
            ).toEqual(row.gain === null ? [] : [row.gain]);
        }
});

test.each([1, 2, 3, 4])(
    "the capture fork is independent of a %i-ply supplied continuation",
    (length) => {
        const scan = buildLiveTacticalScan({
            fen: capturingMixedForkFen,
            pvUci: capturingMixedForkLine.slice(0, length),
            depth: 16,
            engineName: "Constructed",
        });
        expect(scan.motifs[0]).toMatchObject({ id: "fork", ply: 1, value: 200 });
        expect(scan.motifs[0].evidence).toContain("including the initial capture");
        expect(scan.arrows.map((a) => `${a.from}:${a.to}`).sort()).toEqual(
            ["g5:g2", "g2:h1", "g2:e4"].sort(),
        );
    },
);

test("limited proof work never reuses a full-budget certificate", () => {
    const step = replayTacticalLine(capturingMixedForkFen, ["g5g2"])[0];
    expect(proveMixedTargetFork(step)?.gain).toBe(200);
    for (const budget of [0, 1, 2, -1, 0.5, NaN, Infinity])
        expect(proveMixedTargetFork(step, budget)).toBeNull();
    expect(proveMixedTargetFork(step)?.gain).toBe(200);
});

test("the missed capture fork is a root lesson without inventing opponent causality", () => {
    const missed = classifyMistakeReviewMotifs({
        fen: capturingMixedForkFen,
        pvUci: capturingMixedForkLine,
        playedMoveUci: "g5h5",
        bestMoveUci: "g5g2",
        refutationUci: ["g2g3"],
        cpBefore: -800,
        cpAfter: -500,
        cpLoss: 300,
    });
    expect(buildMistakeReviewTacticalExplanation(missed)?.primary).toMatchObject({
        id: "fork",
        source: "missed",
        value: 200,
        ply: 1,
    });
});

test.skipIf(!process.env.TACTICAL_CAPTURE_FORK_PUBLIC_PROBES)(
    "emit constructed fork and counterplay decision probes",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CAPTURE_FORK_PUBLIC_PROBES!);
        expect(existsSync(output)).toBe(false);
        const probes = capturingMixedForkCases.flatMap((row) =>
            [false, true].flatMap((reflected) => {
                const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                const move = reflected ? reflectMixedForkMove("g5g2") : "g5g2";
                return [
                    { id: `${row.id}:${reflected}:best`, fen },
                    { id: `${row.id}:${reflected}:held`, fen, searchMove: move },
                ];
            }),
        );
        writeFileSync(
            output,
            JSON.stringify(
                { samplePath: "benchmarks/tactical-relevance/broader-game-context.json", probes },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
