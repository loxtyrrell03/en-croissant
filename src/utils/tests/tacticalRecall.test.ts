import { expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, makeSquare } from "chessops/util";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    proveMixedTargetFork,
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    quietPieceForkCases,
    quietPieceForkFen,
    quietPieceForkMove,
} from "./fixtures/quietPieceFork";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test.each(
    quietPieceForkCases.flatMap((row) => [
        { ...row, move: quietPieceForkMove },
        {
            ...row,
            id: `${row.id}:black`,
            fen: reflectMixedForkFen(row.fen),
            move: reflectMixedForkMove(quietPieceForkMove),
        },
    ]),
)("$id checks all target replies rather than rejecting any check", (row) => {
    const step = replayTacticalLine(row.fen, [row.move])[0];
    const proof = proveMixedTargetFork(step);
    expect(Boolean(proof)).toBe(row.positive);
    const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
    expect(result.motifs.some((m) => m.id === "fork")).toBe(row.positive);
    if (!row.positive) return;
    expect(proof?.captureBranches?.length).toBe(
        [...step.after.allDests()].reduce((n, [, tos]) => n + tos.size(), 0),
    );
    for (const branch of proof!.captureBranches!) {
        const steps = replayTacticalLine(makeFen(step.after.toSetup()), [
            branch.replyUci,
            branch.answerUci,
        ]);
        expect(steps).toHaveLength(2);
        expect(branch.gain).toBeGreaterThanOrEqual(100);
    }
    expect(result.motifs[0]).toMatchObject({ id: "fork", ply: 1, relevance: "primary" });
    const scan = buildLiveTacticalScan({
        fen: row.fen,
        pvUci: [row.move],
        depth: 16,
        engineName: "Control",
    });
    expect(scan.labels[0]).toMatchObject({ text: "Fork", square: row.move.slice(2, 4) });
    const targets = proof!.targets.map(makeSquare);
    for (const target of targets)
        expect(scan.arrows).toContainEqual(
            expect.objectContaining({ from: row.move.slice(2, 4), to: target, ply: 1 }),
        );
});

test("a queen countercheck is answered by the ally that can legally take it", () => {
    const proof = proveMixedTargetFork(
        replayTacticalLine(quietPieceForkFen, [quietPieceForkMove])[0],
    );
    expect(proof?.captureBranches).toContainEqual(
        expect.objectContaining({ replyUci: "c4b4", answerUci: "a3b4" }),
    );
    expect(proof?.captureBranches).toContainEqual(
        expect.objectContaining({ replyUci: "c4c3", answerUci: "b2c3" }),
    );
});

test.each([false, true])(
    "the same defensive-line cut remains Interference, not another Fork: reflected=%s",
    (reflected) => {
        const fen = "4r1k1/3pB1pp/5r2/8/8/4Q3/8/2K5 b - - 0 1";
        const input = {
            fen: reflected ? reflectMixedForkFen(fen) : fen,
            pvUci: [reflected ? reflectMixedForkMove("f6e6") : "f6e6"],
        };
        expect(proveMixedTargetFork(replayTacticalLine(input.fen, input.pvUci)[0])).not.toBeNull();
        const result = classifyPositionTacticalMotifs(input);
        expect(result.motifs.map((m) => m.id)).toEqual(["interference"]);
        expect(result.timeline?.some((m) => m.id === "fork")).toBe(false);
    },
);

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "quiet piece-fork budget %s cannot borrow a cached success",
    (limit) => {
        const step = replayTacticalLine(quietPieceForkFen, [quietPieceForkMove])[0];
        expect(proveMixedTargetFork(step)).not.toBeNull();
        expect(proveMixedTargetFork(step, limit)).toBeNull();
    },
);

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "judged owner-game captures and missed fork remain concrete lessons",
    () => {
        const baseline = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const games = [...new Set(baseline.results.map((r: any) => r.game))];
        expect(games).toHaveLength(3);
        const row = (game: number, ply: number) =>
            baseline.results.find((r: any) => r.game === games[game] && r.ply === ply);
        const scan = (r: any) =>
            buildLiveTacticalScan({
                ...r,
                ...r.before[0],
                variations: r.before,
                engineName: "Stockfish 18",
            });
        for (const [game, ply, label, value] of [
            [0, 17, "Hanging Piece", 500],
            [0, 54, "Material Gain", 220],
            [1, 23, "Hanging Piece", 320],
            [1, 33, "Hanging Piece", 500],
            [1, 40, "Hanging Piece", 900],
            [1, 46, "Hanging Piece", 320],
            [2, 19, "Hanging Piece", 330],
            [2, 29, "Hanging Piece", 320],
            [2, 45, "Winning Recapture", 230],
            [2, 55, "Material Gain", 180],
            [2, 84, "Perpetual Check", 0],
        ] as const)
            expect(scan(row(game, ply)).motifs[0]).toMatchObject({ label, value, ply: 1 });
        const fork = row(0, 10);
        expect(fork.scan.motifs).toEqual([]); // Frozen adapter-109 miss, not a new expectation.
        expect(scan(fork).motifs[0]).toMatchObject({ id: "fork", value: 230, ply: 1 });
        for (const [ply, source] of [
            [9, "allowed"],
            [10, "missed"],
        ] as const) {
            const r = row(0, ply),
                sign = r.fen.split(" ")[1] === "w" ? 1 : -1;
            const classification = classifyMistakeReviewMotifs({
                fen: r.fen,
                playedMoveUci: r.playedMoveUci,
                bestMoveUci: r.before[0].pvUci[0],
                pvUci: r.before[0].pvUci,
                refutationUci: r.after[0].pvUci,
                cpBefore: r.before[0].cp * sign,
                cpAfter: -r.after[0].cp * sign,
                cpLoss: r.before[0].cp + r.after[0].cp,
            });
            expect(buildMistakeReviewTacticalExplanation(classification)?.primary).toMatchObject({
                id: "fork",
                source,
                ply: 1,
            });
        }
        const falseFork = row(0, 42);
        expect(
            classifyPositionTacticalMotifs({
                fen: falseFork.fen,
                pvUci: ["c7c8", "h3c8"],
            }).motifs.some((m) => m.id === "fork"),
        ).toBe(false);
    },
);

test.skipIf(!process.env.TACTICAL_RECALL_DIAGNOSTIC)(
    "inspect recall candidates and their legal defences",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_SAMPLE!, "utf8"));
        const findings = [];
        const probes: { id: string; fen: string; searchMove?: string; minCp?: number }[] = [];
        for (const [ply, root] of [
            [8, "e2e4"],
            [10, "f3e5"],
            [42, "c7c8"],
        ] as const) {
            const row = sample.cases.find((r: any) => r.game === sample.games[0].id && r.ply === ply);
            const step = replayTacticalLine(row.fen, [root])[0];
            expect(step).toBeTruthy();
            const replies = [];
            for (const [from, tos] of step.after.allDests())
                for (const to of tos) {
                    const reply = { from, to };
                    const pos = step.after.clone();
                    pos.play(reply);
                    const captures = [];
                    for (const [a, bs] of pos.allDests())
                        for (const b of bs) {
                            if (pos.board.get(b)?.color === step.after.turn) {
                                const action = { from: a, to: b };
                                const leaf = replayTacticalLine(makeFen(pos.toSetup()), [
                                    makeUci(action),
                                ])[0];
                                captures.push({
                                    uci: makeUci(action),
                                    san: makeSan(pos, action),
                                    gain: tacticalCaptureGain(leaf),
                                    see: tacticalExchangeGain(pos, action),
                                });
                            }
                        }
                    replies.push({
                        uci: makeUci(reply),
                        san: makeSan(step.after, reply),
                        fen: makeFen(pos.toSetup()),
                        check: pos.isCheck(),
                        captures,
                    });
                }
            const attempts: unknown[] = [];
            const proof = proveMixedTargetFork(step, 8192, (targets, result) =>
                attempts.push({ targets, result }),
            );
            if (proof) {
                probes.push(
                    { id: `root:${ply}`, fen: row.fen },
                    { id: `held:${ply}`, fen: row.fen, searchMove: root, minCp: 100 },
                );
                for (const branch of proof.captureBranches ?? []) {
                    const reply = replayTacticalLine(makeFen(step.after.toSetup()), [
                        branch.replyUci,
                    ])[0];
                    probes.push({
                        id: `fork:${ply}:${branch.replyUci}`,
                        fen: makeFen(reply.after.toSetup()),
                        searchMove: branch.answerUci,
                        minCp: 0,
                    });
                }
            }
            findings.push({
                ply,
                fen: row.fen,
                root,
                proof,
                attempts,
                result: classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [root] }),
                replies,
            });
        }
        writeFileSync(
            privateReportPath(process.env.TACTICAL_RECALL_DIAGNOSTIC!),
            JSON.stringify(findings, null, 2),
            { flag: "wx" },
        );
        if (process.env.TACTICAL_RECALL_PROBES)
            writeFileSync(
                privateReportPath(process.env.TACTICAL_RECALL_PROBES),
                JSON.stringify({ samplePath: process.env.TACTICAL_RECALL_SAMPLE, probes }, null, 2),
                { flag: "wx" },
            );
    },
);

test.skipIf(!process.env.TACTICAL_RECALL_SUPPLEMENT)(
    "export constructed controls and the unresolved discovered queen attack",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: any) => r.game === sample.games[0].id && r.ply === 8);
        const steps = replayTacticalLine(row.fen, ["e2e4", "c4c6"]);
        expect(steps).toHaveLength(2);
        const probes: { id: string; fen: string; searchMove?: string; minCp?: number }[] =
            quietPieceForkCases.flatMap((control) => [
                { id: control.id, fen: control.fen, searchMove: quietPieceForkMove },
                {
                    id: `${control.id}:black`,
                    fen: reflectMixedForkFen(control.fen),
                    searchMove: reflectMixedForkMove(quietPieceForkMove),
                },
            ]);
        probes.push(
            {
                id: "unresolved-e4-queen-flight",
                fen: makeFen(steps[0].after.toSetup()),
                searchMove: "c4c6",
            },
            { id: "unresolved-e4-followup", fen: makeFen(steps[1].after.toSetup()) },
        );
        writeFileSync(
            privateReportPath(process.env.TACTICAL_RECALL_SUPPLEMENT!),
            JSON.stringify({ samplePath: process.env.TACTICAL_RECALL_SAMPLE, probes }, null, 2),
            { flag: "wx" },
        );
    },
);
