import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import {
    proveCostlyPawnRecapture,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";
import {
    costlyPawnRecaptureCases,
    costlyPawnRecaptureInput,
} from "./fixtures/costlyPawnRecapture";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "6k1/8/8/3nq3/4P3/2PP4/2R5/4K3 b - - 0 1";
const move = "d5c3";

function inputFor(board: string, reflected: boolean) {
    const input = costlyPawnRecaptureInput({ fen: board });
    if (!reflected) return input;
    const previousFen = reflectMixedForkFen(input.previousFen);
    const previousMoveUci = reflectMixedForkMove(input.previousMoveUci);
    const fen = makeFen(
        replayTacticalLine(previousFen, [previousMoveUci])[0].after.toSetup(),
    );
    return {
        fen,
        previousFen,
        previousMoveUci,
        pvUci: [reflectMixedForkMove(move)],
    };
}

test.each([false, true])(
    "a costly rook defence does not hide an older pawn opportunity: reflected=%s",
    (reflected) => {
        const board = reflected ? reflectMixedForkFen(fen) : fen;
        const root = reflected ? reflectMixedForkMove(move) : move;
        const step = replayTacticalLine(board, [root])[0];
        expect(step).toBeTruthy();
        const proof = proveCostlyPawnRecapture(step);
        expect(proof).toMatchObject({ gain: 100, branches: [{ gain: 280 }] });
        const scan = buildLiveTacticalScan({
            ...inputFor(fen, reflected),
            depth: 16,
            engineName: "Constructed",
        });
        expect(scan.motifs[0]).toMatchObject({
            id: "hangingPiece",
            label: "Hanging Pawn",
            value: 100,
            ply: 1,
        });
        expect(scan.motifs[0].evidence).toContain(
            "giving up the rook for the knight",
        );
        expect(scan.arrows.every((arrow) => arrow.ply === 1)).toBe(true);
    },
);

test("missing protection, equal recapturers and no recapturers cannot borrow the costly-defence explanation", () => {
    for (const board of [
        "6k1/8/8/3n4/4P3/2PP4/2R5/4K3 b - - 0 1",
        "6k1/8/8/3nq3/4P3/2PP4/4N3/4K3 b - - 0 1",
        "6k1/8/8/3nq3/4P3/2PP4/8/4K3 b - - 0 1",
    ])
        expect(
            proveCostlyPawnRecapture(replayTacticalLine(board, [move])[0]),
        ).toBeNull();
});

test("invalid or exhausted budgets cannot reuse a costly-recapture proof", () => {
    const step = replayTacticalLine(fen, [move])[0];
    expect(proveCostlyPawnRecapture(step)).not.toBeNull();
    for (const budget of [0, 1, -1, 0.5, NaN, Infinity])
        expect(proveCostlyPawnRecapture(step, budget)).toBeNull();
});

test.each([false, true])(
    "all apparent defenders and off-square liabilities are checked: reflected=%s",
    (reflected) => {
        for (const row of costlyPawnRecaptureCases) {
            const board = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const root = reflected ? reflectMixedForkMove(move) : move;
            const step = replayTacticalLine(board, [root])[0];
            expect({ id: row.id, legal: !!step }).toEqual({
                id: row.id,
                legal: true,
            });
            const proof = proveCostlyPawnRecapture(step);
            expect({ id: row.id, proved: !!proof }).toEqual({
                id: row.id,
                proved: row.positive,
            });
            expect(proof?.branches.length ?? 0).toBe(
                row.positive
                    ? row.id === "rook-and-queen-defenders"
                        ? 2
                        : 1
                    : 0,
            );
        }
    },
);

test("ordinary Petroff and Catalan pawn recovery do not gain the new explanation", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    for (const line of [
        ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "f6e4"],
        [
            "d2d4",
            "d7d5",
            "c2c4",
            "e7e6",
            "g1f3",
            "g8f6",
            "g2g3",
            "d5c4",
            "d1a4",
            "b8c6",
            "a4c4",
        ],
    ]) {
        const steps = replayTacticalLine(start, line);
        expect(steps).toHaveLength(line.length);
        const step = steps.at(-1)!;
        expect(proveCostlyPawnRecapture(step)).toBeNull();
        const scan = buildLiveTacticalScan({
            fen: makeFen(step.before.toSetup()),
            pvUci: [step.uci],
            depth: 16,
            engineName: "Opening control",
            variations: [{ pvUci: [step.uci], depth: 16, cp: 20 }],
        });
        expect(scan.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
    }
});

test("missing or mismatched history cannot turn a static pawn exchange into a fresh lesson", () => {
    const input = costlyPawnRecaptureInput({ fen });
    for (const context of [
        {},
        { previousFen: input.previousFen, previousMoveUci: "d2d4" },
    ]) {
        const scan = buildLiveTacticalScan({
            fen,
            pvUci: [move],
            ...context,
            depth: 16,
            engineName: "Context control",
        });
        expect(scan.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
    }
});

test("a pawn that just captured a bishop remains exchange compensation", () => {
    const previousFen = "6k1/8/8/3nq3/4P3/2bP4/1PR5/4K3 w - - 0 1";
    const previousMoveUci = "b2c3";
    const step = replayTacticalLine(previousFen, [previousMoveUci, move]);
    expect(step).toHaveLength(2);
    expect(proveCostlyPawnRecapture(step[1])).not.toBeNull();
    const scan = buildLiveTacticalScan({
        fen: makeFen(step[1].before.toSetup()),
        pvUci: [move],
        previousFen,
        previousMoveUci,
        depth: 16,
        engineName: "Exchange control",
    });
    expect(scan.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test.skipIf(!process.env.TACTICAL_COSTLY_PAWN_CONTROLS)(
    "record public costly-recapture decisions for independent engine checks",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const cases = [],
            probes: any[] = [];
        for (const row of costlyPawnRecaptureCases)
            for (const reflected of [false, true]) {
                const id = `${row.id}:${reflected ? "reflected" : "original"}`;
                const board = reflected
                    ? reflectMixedForkFen(row.fen)
                    : row.fen;
                const root = reflected ? reflectMixedForkMove(move) : move;
                const proof = proveCostlyPawnRecapture(
                    replayTacticalLine(board, [root])[0],
                );
                expect({ id, proved: !!proof }).toEqual({
                    id,
                    proved: row.positive,
                });
                cases.push({
                    id,
                    fen: board,
                    move: root,
                    positive: row.positive,
                    proof,
                });
                probes.push({ id: `${id}:root`, fen: board, searchMove: root });
                for (const [i, branch] of (proof?.branches ?? []).entries())
                    probes.push({
                        id: `${id}:punishment:${i}`,
                        fen: makeFen(
                            replayTacticalLine(board, [root, branch.replyUci])
                                .at(-1)!
                                .after.toSetup(),
                        ),
                        searchMove: branch.answerUci,
                    });
                for (const [i, decision] of (
                    proof?.defensiveDecisions ?? []
                ).entries())
                    probes.push({
                        id: `${id}:safety:${i}`,
                        fen: decision.fen,
                        searchMove: decision.moveUci,
                    });
            }
        if (
            process.env.TACTICAL_COSTLY_PAWN_ENGINE &&
            process.env.TACTICAL_COSTLY_PAWN_PUBLIC
        ) {
            const engine = JSON.parse(
                readFileSync(process.env.TACTICAL_COSTLY_PAWN_ENGINE, "utf8"),
            );
            const searches = probes.map((probe) => {
                const found = engine.searches.find(
                    (search: any) =>
                        search.id === probe.id &&
                        search.fen === probe.fen &&
                        search.searchMove === probe.searchMove,
                );
                if (!found || found.lines[0].pvUci[0] !== probe.searchMove)
                    throw new Error(
                        `Missing exact engine decision: ${probe.id}`,
                    );
                return {
                    id: probe.id,
                    fen: probe.fen,
                    move: probe.searchMove,
                    cp: found.lines[0].cp,
                    mate: found.lines[0].mate,
                    pvUci: found.lines[0].pvUci,
                };
            });
            if (engine.completed !== probes.length)
                throw new Error("Incomplete engine receipt");
            writeFileSync(
                process.env.TACTICAL_COSTLY_PAWN_PUBLIC,
                JSON.stringify(
                    {
                        scope: "Constructed legal exchange controls and colour reflections. Local material bounds are not full-position outcomes; this is not a puzzle accuracy sample.",
                        cases,
                        searches,
                    },
                    null,
                    2,
                ) + "\n",
                { flag: "wx" },
            );
        }
        writeFileSync(
            privateReportPath(process.env.TACTICAL_COSTLY_PAWN_CONTROLS!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_COSTLY_PAWN_CONTROLS,
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

test.skipIf(
    !process.env.TACTICAL_COSTLY_PAWN_REPORT ||
        !process.env.TACTICAL_RECALL_REPLAY,
)(
    "inspect the remaining owner pawn opportunity and its costly recaptures",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"),
        );
        const games = [...new Set(report.results.map((row: any) => row.game))];
        const row = report.results.find(
            (row: any) => row.game === games[1] && row.ply === 29,
        );
        const step = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
        const proof = proveCostlyPawnRecapture(step);
        const scan = buildLiveTacticalScan({
            ...row,
            ...row.before[0],
            variations: row.before,
            engineName: "Stockfish 18",
        });
        const review = classifyMistakeReviewMotifs({
            ...row,
            bestMoveUci: step.uci,
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
        });
        const probes: any[] = [
            { id: "owner:best", fen: row.fen },
            { id: "owner:held", fen: row.fen, searchMove: step.uci },
        ];
        for (const [i, branch] of (proof?.branches ?? []).entries()) {
            const position = replayTacticalLine(row.fen, [
                step.uci,
                branch.replyUci,
            ]).at(-1)!.after;
            probes.push({
                id: `owner:punishment:${i}`,
                fen: makeFen(position.toSetup()),
                searchMove: branch.answerUci,
            });
        }
        for (const [i, decision] of (proof?.defensiveDecisions ?? []).entries())
            probes.push({
                id: `owner:safety:${i}`,
                fen: decision.fen,
                searchMove: decision.moveUci,
            });
        writeFileSync(
            privateReportPath(process.env.TACTICAL_COSTLY_PAWN_REPORT!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_RECALL_REPLAY,
                    proof,
                    scan,
                    review,
                    explanation: buildMistakeReviewTacticalExplanation(review),
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        expect(proof).not.toBeNull();
        expect(scan.motifs[0]).toMatchObject({
            id: "hangingPiece",
            value: 100,
            ply: 1,
        });
        expect(buildMistakeReviewTacticalExplanation(review)).toBeNull();
    },
);

test("the public receipt covers the actual costly-recapture and safety decisions", () => {
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/costly-pawn-stockfish-18.json",
            "utf8",
        ),
    );
    const expected = [];
    for (const row of receipt.cases) {
        const proof = proveCostlyPawnRecapture(
            replayTacticalLine(row.fen, [row.move])[0],
        );
        expect(proof).toEqual(row.proof);
        expected.push(`${row.id}:root`);
        for (const [i] of (proof?.branches ?? []).entries())
            expected.push(`${row.id}:punishment:${i}`);
        for (const [i] of (proof?.defensiveDecisions ?? []).entries())
            expected.push(`${row.id}:safety:${i}`);
    }
    expect(new Set(receipt.searches.map((row: any) => row.id))).toEqual(
        new Set(expected),
    );
});
