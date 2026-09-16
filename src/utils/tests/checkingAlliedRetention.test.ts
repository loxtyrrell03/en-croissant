import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    proveCheckingPawnRetention,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    checkingAlliedRetentionCases,
    checkingAlliedRetentionLine,
} from "./fixtures/checkingAlliedRetention";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";

test.each([false, true])(
    "allied support retains the pawn with checked king safety: reflected=%s",
    (reflected) => {
        for (const row of checkingAlliedRetentionCases) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const pvUci = reflected
                ? checkingAlliedRetentionLine.map(reflectMixedForkMove)
                : checkingAlliedRetentionLine;
            const proof = proveCheckingPawnRetention(
                replayTacticalLine(fen, pvUci),
            );
            expect({ id: row.id, proved: !!proof }).toEqual({
                id: row.id,
                proved: row.positive,
            });
            const scan = buildLiveTacticalScan({
                fen,
                pvUci,
                depth: 16,
                engineName: "Constructed",
                variations: [{ pvUci, cp: 0, depth: 16 }],
            });
            expect(scan.motifs[0]?.label ?? null).toBe(
                row.positive ? "Hanging Pawn" : null,
            );
            if (!row.positive) continue;
            {
                expect(proof).not.toBeNull();
                expect(proof!.gain).toBe(100);
                expect(proof!.visits).toBeLessThan(8192);
                expect(
                    proof!.branches.some((branch) => branch.retainedBySupport),
                ).toBe(true);
                expect(proof!.defensiveDecisions?.length).toBeGreaterThan(0);
                expect(scan.motifs[0].evidence).toContain("allied support");
                expect(scan.arrows.every((arrow) => arrow.ply === 1)).toBe(
                    true,
                );
                // Checking the continuing line instead of playing the exchange in
                // the supplied PV cannot change the verified retention branches.
                const exchange = reflected ? "c3d2" : "c6d7";
                expect(
                    proveCheckingPawnRetention(
                        replayTacticalLine(fen, [
                            ...pvUci.slice(0, 2),
                            exchange,
                        ]),
                    )?.branches,
                ).toEqual(proof!.branches);
            }
        }
    },
);

test("missing nominations and exhausted budgets cannot reuse successful allied proofs", () => {
    const row = checkingAlliedRetentionCases[0];
    const steps = replayTacticalLine(row.fen, checkingAlliedRetentionLine);
    expect(proveCheckingPawnRetention(steps)).not.toBeNull();
    for (const budget of [0, 1, 20, -1, NaN, 0.5])
        expect(proveCheckingPawnRetention(steps, budget)).toBeNull();
    expect(proveCheckingPawnRetention(steps.slice(0, 1))).toBeNull();
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "the recovered owner pawn remains secondary to the allowed queen loss",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"),
        );
        const row = report.results.find(
            (r: any) => r.game === report.results[0].game && r.ply === 42,
        );
        const scan = buildLiveTacticalScan({
            ...row,
            ...row.before[0],
            variations: row.before,
            engineName: "Stockfish 18",
        });
        expect(scan.motifs[0]).toMatchObject({
            label: "Hanging Pawn",
            value: 100,
            ply: 1,
        });
        const explanation = buildMistakeReviewTacticalExplanation(
            classifyMistakeReviewMotifs({
                ...row,
                bestMoveUci: row.before[0].pvUci[0],
                pvUci: row.before[0].pvUci,
                refutationUci: row.after[0].pvUci,
                bestCandidates: row.before.map((line: any) => ({
                    fen: row.fen,
                    ...line,
                })),
                refutationCandidates: row.after.map((line: any) => ({
                    fen: row.afterFen,
                    ...line,
                })),
                cpBefore:
                    row.before[0].cp * (row.fen.split(" ")[1] === "w" ? 1 : -1),
                cpAfter:
                    -row.after[0].cp * (row.fen.split(" ")[1] === "w" ? 1 : -1),
                cpLoss: Math.max(0, row.before[0].cp + row.after[0].cp),
            }),
        );
        expect(explanation?.primary).toMatchObject({
            source: "allowed",
            label: "Hanging Piece",
            value: 900,
        });
        expect(explanation?.secondary).toMatchObject({
            source: "missed",
            label: "Hanging Pawn",
            value: 100,
        });
    },
);

test.skipIf(!process.env.TACTICAL_ALLIED_RETENTION_REPORT)(
    "inspect constructed allied retention and selected safety decisions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const cases = checkingAlliedRetentionCases.flatMap((row) =>
            [false, true].map((reflected) => {
                const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                const pvUci = reflected
                    ? checkingAlliedRetentionLine.map(reflectMixedForkMove)
                    : checkingAlliedRetentionLine;
                const steps = replayTacticalLine(fen, pvUci);
                expect(steps).toHaveLength(pvUci.length);
                const trace: string[] = [];
                const proof = proveCheckingPawnRetention(
                    steps,
                    8192,
                    (message) => trace.push(message),
                );
                return {
                    id: `${row.id}:${reflected ? "black" : "white"}`,
                    fen,
                    pvUci,
                    proof,
                    trace,
                };
            }),
        );
        const probes = cases.flatMap((row) => [
            { id: `${row.id}:root`, fen: row.fen, searchMove: row.pvUci[0] },
            ...(row.proof?.branches.map((branch, index) => ({
                id: `${row.id}:branch-${index}`,
                searchMove: branch.answerUci,
                fen: makeFen(
                    replayTacticalLine(row.fen, [row.pvUci[0], branch.replyUci])
                        .at(-1)!
                        .after.toSetup(),
                ),
            })) ?? []),
            ...(row.proof?.defensiveDecisions?.map((decision, index) => ({
                id: `${row.id}:safety-${index}`,
                fen: decision.fen,
                searchMove: decision.moveUci,
            })) ?? []),
        ]);
        if (
            process.env.TACTICAL_ALLIED_ENGINE_RECEIPT &&
            process.env.TACTICAL_ALLIED_PUBLIC_RECEIPT
        ) {
            const engine = JSON.parse(
                readFileSync(
                    process.env.TACTICAL_ALLIED_ENGINE_RECEIPT,
                    "utf8",
                ),
            );
            const searches = probes.map((probe) => {
                const row = engine.searches.find(
                    (row: any) =>
                        row.id === probe.id &&
                        row.fen === probe.fen &&
                        row.lines[0].pvUci[0] === probe.searchMove,
                );
                if (!row)
                    throw new Error(`Missing public decision ${probe.id}`);
                return {
                    id: row.id,
                    fen: row.fen,
                    move: probe.searchMove,
                    ...row.lines[0],
                };
            });
            // Only the explicitly constructed public controls are exported.
            // Keep the failed Qf2/Qf7 witnesses as contrary evidence, not part
            // of the final selected decision set.
            const rejectedWitnesses = engine.searches.filter((row: any) =>
                [
                    "no-f-pawn-shield:white:safety-3",
                    "no-f-pawn-shield:black:safety-7",
                ].includes(row.id),
            );
            writeFileSync(
                process.env.TACTICAL_ALLIED_PUBLIC_RECEIPT,
                JSON.stringify(
                    {
                        scope: "Constructed controls and finite-depth decision checks, not independent-game accuracy or winning-position certificates.",
                        cases: cases.map(({ trace: _trace, ...row }) => row),
                        searches,
                        rejectedWitnesses,
                    },
                    null,
                    2,
                ) + "\n",
                { flag: "wx" },
            );
        }
        writeFileSync(
            privateReportPath(process.env.TACTICAL_ALLIED_RETENTION_REPORT!),
            JSON.stringify(
                {
                    cases,
                    probes,
                    samplePath: process.env.TACTICAL_RECALL_REPLAY,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
    },
);

test("fresh public engine checks cover the actual selected king-safety witnesses", () => {
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/checking-allied-retention-stockfish-18.json",
            "utf8",
        ),
    );
    for (const row of receipt.cases) {
        const proof = proveCheckingPawnRetention(
            replayTacticalLine(row.fen, row.pvUci),
        );
        expect(proof?.branches ?? null).toEqual(row.proof?.branches ?? null);
        expect(proof?.defensiveDecisions ?? []).toEqual(
            row.proof?.defensiveDecisions ?? [],
        );
    }
    const selected = receipt.searches.filter((row: any) =>
        row.id.startsWith("pinned-interposer-support:"),
    );
    expect(selected).toHaveLength(114);
    for (const row of selected) {
        expect(row.pvUci[0]).toBe(row.move);
        expect(row.mate === null ? row.cp >= -50 : row.mate > 0).toBe(true);
    }
    expect(receipt.rejectedWitnesses).toHaveLength(2);
    expect(
        receipt.rejectedWitnesses.map((row: any) => row.lines[0].mate),
    ).toEqual([-4, -4]);
});
