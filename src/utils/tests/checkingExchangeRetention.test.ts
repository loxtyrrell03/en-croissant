import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { proveCheckingPawnRetention, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    checkingExchangeFen as fen,
    checkingExchangeLine as line,
    checkingExchangeCases,
} from "./fixtures/checkingExchangeRetention";

test("the public engine receipt covers the actual selected exchange decisions", () => {
    const receipt = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/checking-exchange-stockfish-18.json", "utf8"),
    );
    const decisions: string[] = [];
    for (const row of receipt.cases) {
        const proof = proveCheckingPawnRetention(replayTacticalLine(row.fen, row.pvUci));
        expect(proof?.branches ?? null).toEqual(row.proof?.branches ?? null);
        decisions.push(`${row.id}:root:${row.fen}:${row.pvUci[0]}`);
        for (const [index, branch] of (proof?.branches ?? []).entries()) {
            const fen = makeFen(
                replayTacticalLine(row.fen, [row.pvUci[0], branch.replyUci])
                    .at(-1)!
                    .after.toSetup(),
            );
            decisions.push(`${row.id}:${index}:held:${fen}:${branch.answerUci}`);
        }
    }
    expect(new Set(receipt.searches.map((row: any) => `${row.id}:${row.fen}:${row.move}`))).toEqual(
        new Set(decisions),
    );
    for (const row of receipt.searches) {
        expect(row.pvUci[0]).toBe(row.move);
        const source = receipt.cases.find((source: any) => row.id.startsWith(`${source.id}:`));
        expect(!source.positive || (row.mate === null ? row.cp >= -50 : row.mate > 0)).toBe(true);
    }
});

test.each([false, true])(
    "the checking piece can exchange for its equal interposer: reflected=%s",
    (reflected) => {
        for (const row of checkingExchangeCases.filter((row) => row.positive)) {
            const input = {
                fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
                pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            };
            expect(replayTacticalLine(input.fen, input.pvUci)).toHaveLength(input.pvUci.length);
            const trace: string[] = [];
            const proof = proveCheckingPawnRetention(
                replayTacticalLine(input.fen, input.pvUci),
                8192,
                (message) => trace.push(message),
            );
            expect(proof?.gain).toBe(100);
            expect(
                proof?.branches.some((branch) => branch.retainedByExchange && branch.gain === 100),
            ).toBe(true);
            const scan = buildLiveTacticalScan({
                ...input,
                depth: 16,
                engineName: "Constructed",
                variations: [{ ...input, cp: 0, depth: 16 }],
            });
            expect(scan.motifs[0]).toMatchObject({
                id: "hangingPiece",
                label: "Hanging Pawn",
                value: 100,
                ply: 1,
            });
            expect(scan.motifs[0].evidence).toContain("equal interposing piece");
            expect(scan.arrows.every((arrow) => arrow.ply === 1)).toBe(true);
        }
    },
);

test.skipIf(!process.env.TACTICAL_EXCHANGE_CONTROL_PROBES)(
    "record constructed root and retention decisions for fresh engine checks",
    () => {
        const cases = checkingExchangeCases.flatMap((row) =>
            [false, true].map((reflected) => {
                const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
                const pvUci = reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci;
                const proof = proveCheckingPawnRetention(replayTacticalLine(fen, pvUci));
                return {
                    ...row,
                    id: `${row.id}:${reflected ? "black" : "white"}`,
                    fen,
                    pvUci,
                    proof,
                };
            }),
        );
        expect(cases).toHaveLength(checkingExchangeCases.length * 2);
        for (const row of cases) expect(Boolean(row.proof)).toBe(row.positive);
        writeFileSync(
            process.env.TACTICAL_EXCHANGE_CONTROL_PROBES!,
            JSON.stringify(
                {
                    cases,
                    samplePath: process.env.TACTICAL_RECALL_SAMPLE,
                    probes: cases.flatMap((row) => [
                        { id: `${row.id}:root`, fen: row.fen, searchMove: row.pvUci[0] },
                        ...(row.proof?.branches.map((branch, index) => ({
                            id: `${row.id}:${index}:held`,
                            fen: makeFen(
                                replayTacticalLine(row.fen, [row.pvUci[0], branch.replyUci])
                                    .at(-1)!
                                    .after.toSetup(),
                            ),
                            searchMove: branch.answerUci,
                        })) ?? []),
                    ]),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.each([false, true])(
    "unproved exchanges and terminal draws do not borrow retention: reflected=%s",
    (reflected) => {
        for (const row of checkingExchangeCases.filter((row) => !row.positive)) {
            const input = {
                fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
                pvUci: reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
            };
            const steps = replayTacticalLine(input.fen, input.pvUci);
            expect({ id: row.id, length: steps.length }).toEqual({
                id: row.id,
                length: input.pvUci.length,
            });
            expect(proveCheckingPawnRetention(steps)).toBeNull();
        }
    },
);

test("invalid and custom budgets cannot reuse a default exchange certificate", () => {
    const steps = replayTacticalLine(fen, line);
    expect(proveCheckingPawnRetention(steps)).not.toBeNull();
    for (const limit of [0, -1, 1, 1.5])
        expect(proveCheckingPawnRetention(steps, limit)).toBeNull();
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "the owner misses a retained pawn, not an extra queen, and larger causes stay primary",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const games = [...new Set(report.results.map((row: any) => row.game))];
        const row = (game: number, ply: number) =>
            report.results.find((r: any) => r.game === games[game] && r.ply === ply);
        const explain = (r: any) =>
            buildMistakeReviewTacticalExplanation(
                classifyMistakeReviewMotifs({
                    ...r,
                    bestMoveUci: r.before[0].pvUci[0],
                    pvUci: r.before[0].pvUci,
                    refutationUci: r.after[0].pvUci,
                    bestCandidates: r.before.map((line: any) => ({ fen: r.fen, ...line })),
                    refutationCandidates: r.after.map((line: any) => ({
                        fen: r.afterFen,
                        ...line,
                    })),
                    cpBefore: r.before[0].cp * (r.fen.split(" ")[1] === "w" ? 1 : -1),
                    cpAfter: -r.after[0].cp * (r.fen.split(" ")[1] === "w" ? 1 : -1),
                    cpLoss: Math.max(0, r.before[0].cp + r.after[0].cp),
                }),
            );
        expect(explain(row(0, 40))?.primary).toMatchObject({
            label: "Hanging Pawn",
            source: "missed",
            value: 100,
        });
        expect(explain(row(0, 39))?.primary.comparison).toBeUndefined();
        expect(explain(row(0, 39))?.primary.comparisonEvidence).toContain("also gains material");
        expect(explain(row(0, 42))?.primary).toMatchObject({
            label: "Hanging Piece",
            source: "allowed",
            value: 900,
        });
        expect(explain(row(1, 21))?.primary).toMatchObject({
            label: "Hanging Piece",
            source: "missed",
            value: 320,
        });
    },
);

test.skipIf(!process.env.TACTICAL_EXCHANGE_RETENTION_REPORT || !process.env.TACTICAL_RECALL_REPLAY)(
    "inspect the owner's retained-pawn exchange and every selected reply",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const games = [...new Set(report.results.map((row: any) => row.game))];
        const cases = [
            [0, 40],
            [0, 42],
            [0, 44],
            [1, 21],
        ].map(([game, ply]) => {
            const row = report.results.find(
                (row: any) => row.game === games[game] && row.ply === ply,
            );
            const steps = replayTacticalLine(row.fen, row.before[0].pvUci);
            const trace: string[] = [];
            const proof = proveCheckingPawnRetention(steps, 8192, (message) => trace.push(message));
            return {
                id: row.id,
                fen: row.fen,
                rootMove: row.before[0].pvUci[0],
                proof,
                trace,
                scan: buildLiveTacticalScan({
                    ...row,
                    ...row.before[0],
                    variations: row.before,
                    engineName: "Stockfish 18",
                }),
            };
        });
        writeFileSync(
            process.env.TACTICAL_EXCHANGE_RETENTION_REPORT!,
            JSON.stringify(
                {
                    cases,
                    samplePath: process.env.TACTICAL_RECALL_SAMPLE,
                    probes: cases.flatMap((row) => [
                        { id: `${row.id}-root-best`, fen: row.fen },
                        { id: `${row.id}-root-held`, fen: row.fen, searchMove: row.rootMove },
                        ...(row.proof?.branches.flatMap((branch, i) => {
                            const steps = replayTacticalLine(row.fen, [
                                row.rootMove,
                                branch.replyUci,
                            ]);
                            return [
                                {
                                    id: `${row.id}-${i}-best`,
                                    fen: makeFen(steps.at(-1)!.after.toSetup()),
                                },
                                {
                                    id: `${row.id}-${i}-held`,
                                    fen: makeFen(steps.at(-1)!.after.toSetup()),
                                    searchMove: branch.answerUci,
                                },
                            ];
                        }) ?? []),
                    ]),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        expect(cases[0].proof?.gain).toBe(100);
        expect(cases[2].scan.motifs[0]).toMatchObject({ label: "Hanging Piece", value: 900 });
    },
);
