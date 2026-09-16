import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    isNewlyExposedPawnCapture,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    capturingPawnGuardCases,
    capturingPawnGuardInput,
} from "./fixtures/capturingPawnGuard";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";

test.each(
    capturingPawnGuardCases.flatMap((row) =>
        [false, true].map((reflected) => ({ ...row, reflected })),
    ),
)("capture by a former pawn guard: $id reflected=$reflected", (row) => {
    const input = capturingPawnGuardInput(row);
    if (row.reflected) {
        input.previousFen = reflectMixedForkFen(input.previousFen);
        input.previousMoveUci = reflectMixedForkMove(input.previousMoveUci);
        input.fen = makeFen(
            replayTacticalLine(input.previousFen, [
                input.previousMoveUci,
            ])[0].after.toSetup(),
        );
        input.pvUci = input.pvUci.map(reflectMixedForkMove);
    }
    const replay = replayTacticalLine(input.previousFen, [
        input.previousMoveUci,
        input.pvUci[0],
    ]);
    expect(replay).toHaveLength(2);
    expect(makeFen(replay[0].after.toSetup())).toBe(input.fen);
    expect(replay[0].capture).toBe(100);
    expect(
        isNewlyExposedPawnCapture(
            replay[1],
            input.previousFen,
            input.previousMoveUci,
        ),
    ).toBe(row.exposed);
    const result = classifyPositionTacticalMotifs(input);
    expect(result.motifs.map((m) => m.label)).toEqual(
        row.visible ? ["Hanging Pawn"] : [],
    );
    expect(
        result.motifs.map((m) => ({
            value: m.value,
            ply: m.ply,
            moveUci: m.moveUci,
            namesDefender: m.evidence.includes("defender"),
        })),
    ).toEqual(
        row.visible
            ? [
                  {
                      value: 100,
                      ply: 1,
                      moveUci: input.pvUci[0],
                      namesDefender: true,
                  },
              ]
            : [],
    );
});

test("capture history must match and an exhausted exposure check cannot certify a pawn", () => {
    const input = capturingPawnGuardInput();
    const step = replayTacticalLine(input.fen, input.pvUci)[0];
    expect(
        isNewlyExposedPawnCapture(
            step,
            input.previousFen,
            input.previousMoveUci,
            0,
        ),
    ).toBe(false);
    expect(
        isNewlyExposedPawnCapture(
            step,
            input.previousFen,
            input.previousMoveUci,
            1,
        ),
    ).toBe(false);
    expect(
        classifyPositionTacticalMotifs({ fen: input.fen, pvUci: input.pvUci })
            .motifs,
    ).toEqual([]);
    expect(
        classifyPositionTacticalMotifs({ ...input, previousMoveUci: "a7a6" })
            .motifs,
    ).toEqual([]);
    expect(
        classifyPositionTacticalMotifs({
            ...input,
            previousFen: input.previousFen.replace("0 1", "0 2"),
        }).motifs,
    ).toEqual([]);
});

test.skipIf(!process.env.TACTICAL_GUARD_OWNER_REPLAY)(
    "the actual owner capture is visible without blaming the compensating predecessor",
    async () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_GUARD_OWNER_REPLAY!, "utf8"),
        );
        const row = report.results.find(
            (r: any) => r.game === report.results[0].game && r.ply === 12,
        );
        expect(row.before[0].pvUci[0]).toBe("f3e5");
        const scan = buildLiveTacticalScan({
            ...row,
            ...row.before[0],
            variations: row.before,
            engineName: "Stockfish 18",
        });
        expect(scan.motifs[0]).toMatchObject({
            label: "Hanging Pawn",
            value: 100,
            moveUci: "f3e5",
        });
        const previous = report.results.find(
            (r: any) => r.game === row.game && r.ply === 11,
        );
        const review = (entry: any) =>
            classifyMistakeReviewMotifs({
                ...entry,
                bestMoveUci: entry.before[0].pvUci[0],
                pvUci: entry.before[0].pvUci,
                refutationUci: entry.after[0].pvUci,
                cpLoss: Math.max(0, entry.before[0].cp + entry.after[0].cp),
            });
        const result = review(row),
            preceding = review(previous);
        expect(result.missedMotifs[0]?.label).toBe("Hanging Pawn");
        expect(buildMistakeReviewTacticalExplanation(result)?.source).toBe(
            "missed",
        );
        expect(buildMistakeReviewTacticalExplanation(preceding)?.title).toBe(
            "Tactic after the move",
        );
        expect(preceding.allowedMotifs[0].comparison).toBeUndefined();
        expect(preceding.allowedMotifs[0].comparisonEvidence).toContain(
            "dxc5 also gains material",
        );
        if (process.env.TACTICAL_GUARD_OWNER_REPORT) {
            const { privateReportPath } =
                await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
            writeFileSync(
                privateReportPath(process.env.TACTICAL_GUARD_OWNER_REPORT),
                JSON.stringify(
                    {
                        samplePath: process.env.TACTICAL_GUARD_OWNER_REPLAY,
                        scan,
                        review: result,
                        preceding,
                        probes: [
                            { id: "owner:root", fen: row.fen },
                            {
                                id: "owner:held",
                                fen: row.fen,
                                searchMove: "f3e5",
                            },
                            { id: "owner:before", fen: row.previousFen },
                            {
                                id: "owner:before-held",
                                fen: row.previousFen,
                                searchMove: row.previousMoveUci,
                            },
                            {
                                id: "owner:played",
                                fen: row.fen,
                                searchMove: row.playedMoveUci,
                            },
                            { id: "owner:after-played", fen: row.afterFen },
                        ],
                    },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
    },
);

test.skipIf(!process.env.TACTICAL_GUARD_PUBLIC_PROBES)(
    "export constructed guard-capture controls for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const cases = capturingPawnGuardCases.map((row) => ({
            ...row,
            gain: tacticalCaptureGain(
                replayTacticalLine(row.fen, [row.move])[0],
            ),
            result: classifyPositionTacticalMotifs(
                capturingPawnGuardInput(row),
            ),
        }));
        expect(cases).toHaveLength(8);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_GUARD_PUBLIC_PROBES!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_GUARD_PUBLIC_PROBES,
                    cases,
                    probes: cases.flatMap((row) => [
                        { id: `${row.id}:root`, fen: row.fen },
                        {
                            id: `${row.id}:held`,
                            fen: row.fen,
                            searchMove: row.move,
                        },
                    ]),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_GUARD_DISJOINT_REPLAY)(
    "another owner opportunity is retained but a losing delaying check is not a pawn win",
    async () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_GUARD_DISJOINT_REPLAY!, "utf8"),
        );
        const delaying = report.results.find(
            (r: any) => r.ply === 54 && r.before[0].pvUci[0] === "g6h6",
        );
        const alternative = report.results.find(
            (r: any) => r.ply === 29 && r.playedMoveUci === "f6g7",
        );
        expect(delaying.before[0].mate).toBeLessThan(0);
        const scan = buildLiveTacticalScan({
            ...delaying,
            ...delaying.before[0],
            variations: delaying.before,
            engineName: "Stockfish 18",
        });
        expect(scan.motifs.some((m) => m.label === "Hanging Pawn")).toBe(false);
        const result = classifyMistakeReviewMotifs({
            ...alternative,
            bestMoveUci: alternative.before[0].pvUci[0],
            pvUci: alternative.before[0].pvUci,
            bestCandidates: alternative.before.map((line: any) => ({
                ...line,
                fen: alternative.fen,
            })),
            refutationUci: alternative.after[0].pvUci,
            cpLoss: Math.max(
                0,
                alternative.before[0].cp + alternative.after[0].cp,
            ),
        });
        expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
            title: "Missed alternative: Hanging Pawn",
            source: "missed",
            primary: { moveUci: "f6f2", value: 100 },
        });
        if (process.env.TACTICAL_GUARD_DISJOINT_REPORT) {
            const { privateReportPath } =
                await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
            writeFileSync(
                privateReportPath(process.env.TACTICAL_GUARD_DISJOINT_REPORT),
                JSON.stringify(
                    {
                        samplePath: process.env.TACTICAL_GUARD_DISJOINT_REPLAY,
                        scan,
                        review: result,
                        probes: [
                            {
                                id: "owner-alternative:root",
                                fen: alternative.fen,
                            },
                            {
                                id: "owner-alternative:held",
                                fen: alternative.fen,
                                searchMove: "f6f2",
                            },
                            {
                                id: "owner-alternative:played",
                                fen: alternative.fen,
                                searchMove: alternative.playedMoveUci,
                            },
                            {
                                id: "owner-alternative:defence",
                                fen: alternative.fen,
                                moves: ["f6f2", "d1f1"],
                                searchMove: "f2h2",
                            },
                            { id: "owner-delaying:root", fen: delaying.fen },
                            {
                                id: "owner-delaying:held",
                                fen: delaying.fen,
                                searchMove: "g6h6",
                            },
                        ],
                    },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
    },
);

test.skipIf(
    !process.env.TACTICAL_GUARD_ENGINE_RECEIPT ||
        !process.env.TACTICAL_GUARD_PUBLIC_RECEIPT,
)("export only the constructed guard audit's verified engine inputs", () => {
    const report = JSON.parse(
        readFileSync(process.env.TACTICAL_GUARD_ENGINE_RECEIPT!, "utf8"),
    );
    const searches = capturingPawnGuardCases.flatMap((row) =>
        ["root", "held"].map((kind) => {
            const result = report.searches.find(
                (entry: any) => entry.id === `${row.id}:${kind}`,
            );
            expect(result.fen).toBe(row.fen);
            expect(result.searchMove).toBe(
                kind === "held" ? row.move : undefined,
            );
            expect(result.lines[0].depth).toBe(16);
            expect(
                replayTacticalLine(row.fen, result.lines[0].pvUci),
            ).toHaveLength(result.lines[0].pvUci.length);
            return {
                id: result.id,
                fen: result.fen,
                searchMove: result.searchMove,
                lines: [result.lines[0]],
            };
        }),
    );
    expect(searches).toHaveLength(16);
    writeFileSync(
        process.env.TACTICAL_GUARD_PUBLIC_RECEIPT!,
        JSON.stringify(
            {
                scope: "Constructed guard-capture controls only: sixteen fresh Stockfish 18 depth-16 root/held searches. First PV retained here; full private reports retain MultiPV. Scores describe the whole position, not the local pawn bound or classifier accuracy. The already-loose and checking controls remain coverage exclusions, not incorrect chess moves.",
                cases: capturingPawnGuardCases,
                searches,
            },
            null,
            2,
        ) + "\n",
        { flag: "wx" },
    );
});

test("the public receipt matches the constructed boards and both root choices", () => {
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/capturing-guard-stockfish-18.json",
            "utf8",
        ),
    );
    expect(receipt.cases).toEqual(capturingPawnGuardCases);
    expect(receipt.searches.map((row: any) => row.id)).toEqual(
        capturingPawnGuardCases.flatMap((row) => [
            `${row.id}:root`,
            `${row.id}:held`,
        ]),
    );
    for (const row of capturingPawnGuardCases) {
        const held = receipt.searches.find(
            (entry: any) => entry.id === `${row.id}:held`,
        );
        expect(held.fen).toBe(row.fen);
        expect(held.searchMove).toBe(row.move);
        expect(held.lines[0].pvUci[0]).toBe(row.move);
    }
});
