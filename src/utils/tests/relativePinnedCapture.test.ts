import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import {
    proveRelativePinnedCapture,
    compareImmediateTacticalDefence,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { relativePinnedCaptureCases } from "./fixtures/relativePinnedCapture";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";

const fen = "3r2k1/5ppp/6b1/8/4P3/3P4/8/3QK3 b - - 0 1";

test.each([false, true])(
    "relative pin controls preserve actual compensation: reflected=%s",
    (reflected) => {
        for (const row of relativePinnedCaptureCases) {
            const board = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const move = reflected ? reflectMixedForkMove(row.move) : row.move;
            const step = replayTacticalLine(board, [move])[0];
            expect({ id: row.id, legal: !!step }).toEqual({
                id: row.id,
                legal: true,
            });
            const trace: string[] = [];
            const proof = proveRelativePinnedCapture(step, 4096, (message) =>
                trace.push(message),
            );
            expect({ id: row.id, proved: !!proof }).toEqual({
                id: row.id,
                proved: row.positive,
            });
            if (!proof) continue;
            expect(proof.gain).toBeGreaterThanOrEqual(100);
            expect(proof.visits).toBeLessThan(4096);
            const scan = buildLiveTacticalScan({
                fen: board,
                pvUci: [move],
                depth: 16,
                engineName: "Constructed",
            });
            expect({ id: row.id, motif: scan.motifs[0] }).toMatchObject({
                id: row.id,
                motif: { id: "pin", ply: 1 },
            });
            expect(
                scan.motifs.filter((m) => m.id === "deflection"),
            ).toHaveLength(0);
            expect(scan.arrows.map((a) => a.from + a.to)).toContain(
                reflected
                    ? row.id.startsWith("rook")
                        ? "d1d8"
                        : "b7g2"
                    : row.id.startsWith("rook")
                      ? "d8d1"
                      : "b2g7",
            );
            expect(scan.arrows.every((a) => a.ply === 1)).toBe(true);
        }
    },
);

test("invalid and exhausted relative-pin budgets cannot reuse cached proofs", () => {
    const step = replayTacticalLine(fen, ["g6e4"])[0];
    expect(proveRelativePinnedCapture(step)).not.toBeNull();
    for (const nodes of [0, 1, -1, 0.5, NaN, Infinity])
        expect(proveRelativePinnedCapture(step, nodes)).toBeNull();
    expect(proveRelativePinnedCapture(step)).not.toBeNull();
});

test("missing the capture explains the relative pin, not a later queen gain", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "g6e4",
        playedMoveUci: "g6h5",
        pvUci: ["g6e4"],
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({
        id: "pin",
        value: 100,
        ply: 1,
    });
    expect(
        buildMistakeReviewTacticalExplanation(review)?.primary,
    ).toMatchObject({ id: "pin", source: "missed" });
});

test("a pin-based pawn recapture does not erase credit for the player's pawn capture", () => {
    const before = "3r2k1/5ppp/6b1/8/4p3/3P1P2/8/3QK3 w - - 0 1";
    const review = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "d3d4",
        playedMoveUci: "f3e4",
        pvUci: ["d3d4"],
        refutationUci: ["g6e4"],
    });
    expect(
        review.allowedMotifs.some(
            (m) => m.comparison === "prevented" || m.comparison === "reduced",
        ),
    ).toBe(false);
    expect(buildMistakeReviewTacticalExplanation(review)).toBeNull();
});

test("the same relative-pin opportunity after either quiet move is existing danger", () => {
    const before = "3r2k1/5ppp/6b1/8/4P3/3P4/P7/3QK3 w - - 0 1";
    const actual = replayTacticalLine(before, ["a2a3", "g6e4"]);
    const motifs = classifyPositionTacticalMotifs({
        fen: makeFen(actual[0].after.toSetup()),
        pvUci: ["g6e4"],
    }).motifs;
    expect(motifs[0]).toMatchObject({ id: "pin" });
    const compared = compareImmediateTacticalDefence(
        before,
        "a2a4",
        "a2a3",
        "g6e4",
        motifs,
    );
    expect(compared[0]).toMatchObject({ id: "pin", comparison: "persists" });
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "the owner missed pin is recovered without inventing a pawn-trade cause",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"),
        );
        const games = [...new Set(report.results.map((r: any) => r.game))];
        const rows = report.results.filter(
            (r: any) => r.game === games[1] && [26, 27].includes(r.ply),
        );
        const reviews = rows.map((row: any) =>
            classifyMistakeReviewMotifs({
                ...row,
                bestMoveUci: row.before[0].pvUci[0],
                pvUci: row.before[0].pvUci,
                refutationUci: row.after[0].pvUci,
            }),
        );
        expect(reviews).toHaveLength(2);
        expect(reviews[0].allowedMotifs[0]).toMatchObject({
            id: "pin",
            value: 100,
        });
        expect(reviews[0].allowedMotifs[0].comparison).toBeUndefined();
        expect(reviews[1].missedMotifs[0]).toMatchObject({
            id: "pin",
            value: 100,
        });
        expect(
            reviews[1].missedTimeline?.some(
                (m: any) => m.id === "intermezzo" && m.ply === 3,
            ),
        ).toBe(true);
    },
);

test.skipIf(!process.env.TACTICAL_RELATIVE_PIN_CONTROLS)(
    "record constructed relative-pin branches for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const cases = [],
            probes: any[] = [];
        for (const row of relativePinnedCaptureCases)
            for (const reflected of [false, true]) {
                const id = `${row.id}:${reflected ? "reflected" : "original"}`;
                const board = reflected
                    ? reflectMixedForkFen(row.fen)
                    : row.fen;
                const move = reflected
                    ? reflectMixedForkMove(row.move)
                    : row.move;
                const step = replayTacticalLine(board, [move])[0];
                const trace: string[] = [];
                const proof = proveRelativePinnedCapture(step, 4096, (reason) =>
                    trace.push(reason),
                );
                cases.push({
                    id,
                    fen: board,
                    move,
                    positive: row.positive,
                    proof,
                    trace,
                });
                probes.push(
                    { id: `${id}:best`, fen: board },
                    { id: `${id}:held`, fen: board, searchMove: move },
                );
                for (const branch of proof?.branches ?? []) {
                    const next = replayTacticalLine(board, [
                        move,
                        branch.replyUci,
                    ]).at(-1)!.after;
                    probes.push({
                        id: `${id}:reply-${branch.replyUci}`,
                        fen: makeFen(next.toSetup()),
                        searchMove: branch.answerUci,
                    });
                }
                for (const [i, decision] of (
                    proof?.defensiveDecisions ?? []
                ).entries())
                    probes.push({
                        id: `${id}:safety-${i}`,
                        fen: decision.fen,
                        searchMove: decision.moveUci,
                    });
            }
        expect(cases).toHaveLength(relativePinnedCaptureCases.length * 2);
        expect(probes.length).toBeGreaterThan(cases.length * 2);
        if (
            process.env.TACTICAL_RELATIVE_PIN_ENGINE &&
            process.env.TACTICAL_RELATIVE_PIN_PUBLIC
        ) {
            const engine = JSON.parse(
                readFileSync(process.env.TACTICAL_RELATIVE_PIN_ENGINE, "utf8"),
            );
            const searches = probes.map((probe) => {
                const found = engine.searches.find(
                    (row: any) =>
                        row.id === probe.id &&
                        row.fen === probe.fen &&
                        row.searchMove === probe.searchMove,
                );
                if (!found)
                    throw new Error(
                        `Missing matching engine request: ${probe.id}`,
                    );
                return {
                    id: found.id,
                    fen: found.fen,
                    searchMove: found.searchMove,
                    lines: found.lines,
                };
            });
            writeFileSync(
                process.env.TACTICAL_RELATIVE_PIN_PUBLIC,
                JSON.stringify(
                    {
                        scope: "Constructed relative-pin controls and selected defensive branches. Finite-depth estimates are not general accuracy or whole-game outcome proofs. No owner games or paid course positions.",
                        cases,
                        searches,
                    },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
        writeFileSync(
            privateReportPath(process.env.TACTICAL_RELATIVE_PIN_CONTROLS!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_RECALL_REPLAY,
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

test("a relative pin protects a capture without making the recapture illegal", () => {
    const step = replayTacticalLine(fen, ["g6e4"])[0];
    const trace: string[] = [];
    const proof = proveRelativePinnedCapture(step, 4096, (message) =>
        trace.push(message),
    );
    expect({ proof, trace }).toMatchObject({ proof: { gain: 100 }, trace: [] });
    expect(proof!.relative).toEqual({
        recapture: "dxe4",
        punishment: "Rxd1+",
        rear: "queen",
    });
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: ["g6e4"] }).motifs[0],
    ).toMatchObject({ id: "pin" });
});

test.skipIf(
    !process.env.TACTICAL_RECALL_REPLAY ||
        !process.env.TACTICAL_RELATIVE_PIN_REPORT,
)("inspect the owner relative-pin capture and its legal defences", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const report = JSON.parse(
        readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"),
    );
    const games = [...new Set(report.results.map((r: any) => r.game))];
    const row = report.results.find(
        (r: any) => r.game === games[1] && r.ply === 27,
    );
    const step = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
    const trace: string[] = [];
    const proof = proveRelativePinnedCapture(step, 4096, (message) =>
        trace.push(message),
    );
    expect(proof?.branches).toHaveLength(26);
    const probes: any[] = [
        { id: "owner-relative-pin-root-best", fen: row.fen },
        {
            id: "owner-relative-pin-root-held",
            fen: row.fen,
            searchMove: step.uci,
        },
    ];
    for (const branch of proof?.branches ?? []) {
        const next = replayTacticalLine(row.fen, [
            step.uci,
            branch.replyUci,
        ]).at(-1)!.after;
        probes.push({
            id: `owner-relative-pin-${branch.replyUci}`,
            fen: makeFen(next.toSetup()),
            searchMove: branch.answerUci,
        });
    }
    for (const [i, decision] of (proof?.defensiveDecisions ?? []).entries())
        probes.push({
            id: `owner-relative-pin-safety-${i}`,
            fen: decision.fen,
            searchMove: decision.moveUci,
        });
    writeFileSync(
        privateReportPath(process.env.TACTICAL_RELATIVE_PIN_REPORT!),
        JSON.stringify(
            {
                samplePath: process.env.TACTICAL_RECALL_REPLAY,
                fen: row.fen,
                proof,
                trace,
                probes,
                result: classifyPositionTacticalMotifs({
                    fen: row.fen,
                    ...row.before[0],
                }),
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
});
