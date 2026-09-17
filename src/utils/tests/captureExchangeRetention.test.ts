import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    replayTacticalLine,
    tacticalCaptureGain,
    provePersistentPawnCapture,
    filterCompensatedRootCaptures,
} from "../tacticalMotifs/causalTactics";
import {
    persistentPawnExchangeContext,
    rootCaptureExchangeContext,
    settledRootCaptureExchange,
} from "../tacticalMotifs/gameHistory";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { captureExchangeRetentionInput } from "./fixtures/captureExchangeRetention";
import { settledRootExchangeCases } from "./fixtures/settledRootExchange";
import { reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test.each([false, true])(
    "a final recapture retains the pawn earned in the same exchange (%s)",
    (reflected) => {
        const input = captureExchangeRetentionInput(reflected);
        const root = replayTacticalLine(input.fen, input.pvUci)[0];
        expect(tacticalCaptureGain(root)).toBe(320);
        const result = classifyPositionTacticalMotifs({ ...input, rootCp: 100 });
        expect(result.motifs[0]).toMatchObject({
            id: "hangingPiece",
            label: "Winning Recapture",
            value: 100,
            ply: 1,
        });
        expect(result.motifs[0].evidence).toContain("completes the exchange");
        expect(result.motifs[0].evidence).not.toContain("wins the loose knight");
        const scan = buildLiveTacticalScan({
            ...input,
            depth: 18,
            variations: [{ pvUci: input.pvUci, cp: 100, depth: 18 }],
            engineName: "Constructed retained pawn",
        });
        expect(scan.motifs[0]).toMatchObject({ label: "Winning Recapture", value: 100, ply: 1 });
        expect(scan.arrows.every((arrow) => arrow.ply === 1)).toBe(true);
        const context = rootCaptureExchangeContext(
            input.tacticalHistory,
            input.fen,
            root.move,
            input.previousFen,
            input.previousMoveUci,
        );
        expect(context).toEqual({ debit: 220, moves: input.tacticalHistory.moves.slice(-4) });
        expect(
            settledRootCaptureExchange(
                input.tacticalHistory,
                input.fen,
                root.move,
                input.previousFen,
                input.previousMoveUci,
            ),
        ).toBeNull();
        const exchange = replayTacticalLine(input.tacticalHistory.fen, [
            ...input.tacticalHistory.moves,
            ...input.pvUci,
        ]).slice(-5);
        expect(
            exchange.reduce(
                (sum, step) =>
                    sum + (step.before.turn === root.before.turn ? 1 : -1) * step.capture,
                0,
            ),
        ).toBe(100);
    },
);

test.each([false, true])(
    "exchange context cannot fund a losing queen capture (%s)",
    (reflected) => {
        const input = captureExchangeRetentionInput(reflected, false);
        const root = replayTacticalLine(input.fen, input.pvUci)[0];
        expect(tacticalCaptureGain(root)).toBeLessThan(0);
        expect(classifyPositionTacticalMotifs({ ...input, rootCp: 100 }).motifs).toEqual([]);
    },
);

test("fresh engine lines preserve the useful recapture even in a slightly worse position", () => {
    const report = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/capture-exchange-stockfish-18.json", "utf8"),
    );
    for (const reflected of [false, true])
        for (const safe of [true, false]) {
            const input = captureExchangeRetentionInput(reflected, safe);
            const entry = report.searches.find(
                (row: any) => row.id === `constructed:${reflected}:${safe}:held`,
            );
            expect(entry.fen).toBe(input.fen);
            expect(entry.searchMove).toBe(input.pvUci[0]);
            const line = entry.lines[0];
            expect(line.depth).toBe(16);
            expect(replayTacticalLine(input.fen, line.pvUci)).toHaveLength(line.pvUci.length);
            expect(line.cp).toBeLessThan(0);
            const scan = buildLiveTacticalScan({
                ...input,
                pvUci: line.pvUci,
                variations: [line],
                depth: 16,
                engineName: "Stockfish 18",
            });
            expect(
                scan.motifs
                    .filter((m) => m.id === "hangingPiece")
                    .map(({ label, value }) => ({ label, value })),
            ).toEqual(safe ? [{ label: "Winning Recapture", value: 100 }] : []);
        }
});

test.each([false, true])(
    "missing or mismatched history cannot invent exchange credit (%s)",
    (reflected) => {
        const input = captureExchangeRetentionInput(reflected),
            root = replayTacticalLine(input.fen, input.pvUci)[0];
        const steps = replayTacticalLine(input.tacticalHistory.fen, input.tacticalHistory.moves);
        for (const history of [
            undefined,
            {
                fen: makeFen(steps.at(-3)!.before.toSetup()),
                moves: input.tacticalHistory.moves.slice(-3),
            },
            { ...input.tacticalHistory, moves: input.tacticalHistory.moves.slice(0, -1) },
        ]) {
            expect(
                rootCaptureExchangeContext(
                    history,
                    input.fen,
                    root.move,
                    input.previousFen,
                    input.previousMoveUci,
                ),
            ).toBeNull();
            expect(
                classifyPositionTacticalMotifs({ ...input, tacticalHistory: history, rootCp: 100 })
                    .motifs,
            ).toEqual([]);
        }
        expect(
            rootCaptureExchangeContext(
                input.tacticalHistory,
                input.fen,
                root.move,
                input.fen,
                input.previousMoveUci,
            ),
        ).toBeNull();
    },
);

test("quiet gaps and a prior material surplus cannot fund a new gain", () => {
    const input = captureExchangeRetentionInput();
    const moves = [...input.tacticalHistory.moves, "a7a6", "a2a3"];
    const history = replayTacticalLine(input.tacticalHistory.fen, moves);
    expect(history).toHaveLength(moves.length);
    const fen = makeFen(history.at(-1)!.after.toSetup());
    expect(
        rootCaptureExchangeContext(
            { fen: input.tacticalHistory.fen, moves },
            fen,
            replayTacticalLine(fen, input.pvUci)[0].move,
            makeFen(history.at(-1)!.before.toSetup()),
            moves.at(-1)!,
        ),
    ).toBeNull();
    const row = settledRootExchangeCases.find(
        (row) => row.id === "settled-bishops-then-queen:false",
    )!;
    const origin = row.tacticalHistory.fen.replace("3B1P2", "3R1P2").replace("RNBQ2KR", "BNBQ2KR");
    const surplus = replayTacticalLine(origin, row.tacticalHistory.moves);
    expect(surplus).toHaveLength(2);
    const final = makeFen(surplus.at(-1)!.after.toSetup());
    expect(
        rootCaptureExchangeContext(
            { fen: origin, moves: row.tacticalHistory.moves },
            final,
            replayTacticalLine(final, row.pvUci)[0].move,
            makeFen(surplus.at(-1)!.before.toSetup()),
            row.previousMoveUci,
        ),
    ).toBeNull();
});

test.each([false, true])(
    "missed exchange payoffs keep their net value and never accuse the played capture (%s)",
    (reflected) => {
        const input = captureExchangeRetentionInput(reflected);
        const played = reflected ? reflectMixedForkMove("a7a6") : "a7a6";
        const missed = classifyMistakeReviewMotifs({
            ...input,
            bestMoveUci: input.pvUci[0],
            playedMoveUci: played,
        });
        expect(missed.missedMotifs[0]).toMatchObject({
            label: "Winning Recapture",
            value: 100,
            ply: 1,
        });
        expect(
            classifyMistakeReviewMotifs({
                ...input,
                bestMoveUci: input.pvUci[0],
                playedMoveUci: input.pvUci[0],
            }).missedMotifs,
        ).toEqual([]);
    },
);

test.each([false, true])(
    "avoiding the final recapture does not prove prevention of the earlier loss (%s)",
    (reflected) => {
        const input = captureExchangeRetentionInput(reflected);
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const history = replayTacticalLine(input.tacticalHistory.fen, input.tacticalHistory.moves);
        const result = classifyMistakeReviewMotifs({
            fen: input.previousFen,
            tacticalHistory: {
                ...input.tacticalHistory,
                moves: input.tacticalHistory.moves.slice(0, -1),
            },
            previousFen: makeFen(history.at(-2)!.before.toSetup()),
            previousMoveUci: move("c6d4"),
            playedMoveUci: move("f3d4"),
            bestMoveUci: move("e2d3"),
            pvUci: [move("e2d3")],
            refutationUci: input.pvUci,
        });
        expect(result.allowedMotifs[0]).toMatchObject({ label: "Winning Recapture", value: 100 });
        expect(result.allowedMotifs[0].comparison).toBeUndefined();
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("existing exchange");
    },
);

test.skipIf(
    !process.env.TACTICAL_EXCHANGE_RETENTION_REPLAY ||
        !process.env.TACTICAL_EXCHANGE_RETENTION_PROBES,
)(
    "export real and constructed exchange decisions for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_EXCHANGE_RETENTION_PROBES!);
        expect(existsSync(output)).toBe(false);
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_EXCHANGE_RETENTION_REPLAY!, "utf8"),
        );
        const ids: string[] = JSON.parse(process.env.TACTICAL_EXCHANGE_RETENTION_IDS ?? "[]");
        const rows = sample.results.filter((row: any) => ids.includes(row.id));
        expect(rows).toHaveLength(ids.length);
        const cases = [
            ...rows.map((row: any) => ({ id: row.id, fen: row.fen, pvUci: row.before[0].pvUci })),
            ...[false, true].flatMap((reflected) =>
                [true, false].map((safe) => ({
                    id: `constructed:${reflected}:${safe}`,
                    ...captureExchangeRetentionInput(reflected, safe),
                })),
            ),
        ];
        const probes = cases.flatMap((row) => [
            { id: `${row.id}:best`, fen: row.fen },
            { id: `${row.id}:held`, fen: row.fen, searchMove: row.pvUci[0] },
        ]);
        for (const row of rows) {
            probes.push({ id: `${row.id}:played`, fen: row.fen, searchMove: row.playedMoveUci });
            if (row.after?.length)
                probes.push({
                    id: `${row.id}:after`,
                    fen: row.afterFen,
                    searchMove: row.after[0].pvUci[0],
                });
        }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_EXCHANGE_RETENTION_REPLAY,
                    scope: "Development roots and losing recapture controls; not an independent accuracy set.",
                    cases,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    120000,
);

test.skipIf(!process.env.TACTICAL_EXCHANGE_RETENTION_OWNER)(
    "reviewed owner exchange payoffs stay visible without false missed or allowed causes",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_EXCHANGE_RETENTION_OWNER!, "utf8"),
        );
        const row = (id: string) => {
            const item = report.results.find((item: any) => item.id === id);
            expect(item).toBeDefined();
            return item;
        };
        for (const id of [
            "recall:174477406194:ply27",
            "recall:171520531886:ply10",
            "recall:170709695630:ply11",
            "recall:168354151966:ply37",
        ])
            expect(row(id).scan.motifs[0]).toMatchObject({
                label: "Winning Recapture",
                value: 100,
                ply: 1,
            });
        for (const id of [
            "recall:171520531886:ply10",
            "recall:170709695630:ply11",
            "recall:168354151966:ply37",
        ])
            expect(row(id).classification.missedMotifs).toEqual([]);
        for (const id of ["recall:174477406194:ply26", "recall:168354151966:ply36"]) {
            expect(row(id).classification.allowedMotifs[0].comparison).toBeUndefined();
            expect(row(id).explanation.title).toBe("Tactic after the move");
        }
        expect(row("recall:174477406194:ply27").classification.missedMotifs[0]).toMatchObject({
            value: 100,
            alternativeCapture: true,
        });
        for (const id of [
            "recall:172294705390:ply11",
            "recall:170709695630:ply23",
            "recall:168354151966:ply12",
            "recall:169804579660:ply27",
        ])
            expect(row(id).classification.missedMotifs).toEqual([]);
    },
);

test.skipIf(
    !process.env.TACTICAL_INDEPENDENT_EXCHANGE_REPLAY ||
        !process.env.TACTICAL_INDEPENDENT_EXCHANGE_REPORT,
)(
    "inspect owner captures after exchanges without assuming an empty result is wrong",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_INDEPENDENT_EXCHANGE_REPORT!);
        expect(existsSync(output)).toBe(false);
        const source = JSON.parse(
            readFileSync(process.env.TACTICAL_INDEPENDENT_EXCHANGE_REPLAY!, "utf8"),
        );
        const ids: string[] = JSON.parse(process.env.TACTICAL_INDEPENDENT_EXCHANGE_IDS ?? "[]");
        const rows = source.results.filter((row: any) => ids.includes(row.id));
        expect(rows).toHaveLength(ids.length);
        const results = rows.map((row: any) => {
            const root = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
            const history = replayTacticalLine(row.tacticalHistory.fen, row.tacticalHistory.moves);
            const previous = history.at(-1)!;
            const context = {
                previousFen: makeFen(previous.before.toSetup()),
                previousMoveUci: previous.uci,
                tacticalHistory: row.tacticalHistory,
            };
            const isolated = classifyPositionTacticalMotifs({
                fen: row.fen,
                pvUci: row.before[0].pvUci,
                rootCp: row.before[0].cp,
            });
            return {
                id: row.id,
                fen: row.fen,
                move: root.uci,
                san: root.san,
                captureGain: tacticalCaptureGain(root),
                persistent: provePersistentPawnCapture(root, row.tacticalHistory),
                exchange: persistentPawnExchangeContext(row.tacticalHistory, row.fen, root.move),
                previous: history
                    .slice(-6)
                    .map((s) => ({ uci: s.uci, san: s.san, capture: s.capture })),
                isolated,
                current: classifyPositionTacticalMotifs({
                    fen: row.fen,
                    pvUci: row.before[0].pvUci,
                    rootCp: row.before[0].cp,
                    ...context,
                }),
                filtered: filterCompensatedRootCaptures(
                    row.fen,
                    row.before[0].pvUci,
                    [
                        {
                            id: "hangingPiece",
                            label: "Diagnostic capture",
                            source: "available",
                            confidence: "high",
                            ply: 1,
                            moveUci: root.uci,
                            value: tacticalCaptureGain(root) ?? 0,
                            evidence: "Diagnostic only",
                        },
                    ],
                    context.previousFen,
                    context.previousMoveUci,
                    context.tacticalHistory,
                ),
            };
        });
        writeFileSync(
            output,
            JSON.stringify(
                { scope: "Output-selected diagnostics, not accuracy labels.", results },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            results.map(({ id, captureGain, persistent, exchange, filtered }: any) => ({
                id,
                captureGain,
                persistent,
                exchange,
                filtered,
            })),
        );
    },
    120000,
);
