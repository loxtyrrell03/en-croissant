import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { expect, test } from "vitest";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { proveImmediatePromotion, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    immediatePromotionCases as cases,
    missedPromotionFen,
} from "./fixtures/immediatePromotion";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";

test.each(
    cases.flatMap((row) => [
        row,
        {
            ...row,
            id: `${row.id}:black`,
            fen: reflectMixedForkFen(row.fen),
            move: reflectMixedForkMove(row.move),
        },
    ]),
)(
    "$id promotes only with position-local retained material, independent of a supplied payoff",
    (row) => {
        const step = replayTacticalLine(row.fen, [row.move])[0];
        expect({ id: row.id, legal: Boolean(step) }).toEqual({ id: row.id, legal: true });
        const proof = proveImmediatePromotion(step);
        expect(proof?.gain ?? null).toBe(row.gain);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
        const promotion = result.motifs.find((m) => ["promotion", "underPromotion"].includes(m.id));
        expect(Boolean(promotion)).toBe(row.gain !== null);
        if (row.gain === null) return;
        expect(promotion).toMatchObject({
            ply: 1,
            moveUci: row.move,
            value: row.gain,
            confidence: "high",
        });
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci: [row.move],
            depth: 16,
            engineName: "Constructed",
        });
        expect(scan.motifs[0]).toMatchObject({
            id: row.move.endsWith("q") ? "promotion" : "underPromotion",
            ply: 1,
        });
        expect(scan.labels[0].square).toBe(row.move.slice(2, 4));
        expect(scan.arrows).toContainEqual(
            expect.objectContaining({
                from: row.move.slice(0, 2),
                to: row.move.slice(2, 4),
                ply: 1,
            }),
        );
    },
);

test("exhausted and invalid promotion budgets cannot borrow a cached certificate", () => {
    const step = replayTacticalLine(cases[0].fen, [cases[0].move])[0];
    expect(proveImmediatePromotion(step)?.gain).toBe(800);
    for (const budget of [0, 1, -1, 0.5, NaN, Infinity])
        expect(proveImmediatePromotion(step, budget)).toBeNull();
    expect(proveImmediatePromotion(step)?.gain).toBe(800);
});

test("a missed immediate promotion is a root lesson, not a later engine payoff", () => {
    const input = {
        fen: missedPromotionFen,
        bestMoveUci: "a7a8q",
        playedMoveUci: "h1g1",
        pvUci: ["a7a8q"],
        refutationUci: ["b5a7"],
    };
    const result = classifyMistakeReviewMotifs(input);
    expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
        id: "promotion",
        value: 800,
        ply: 1,
        source: "missed",
    });
    expect(classifyMistakeReviewMotifs({ ...input, playedMoveUci: "a7a8q" }).missedMotifs).toEqual(
        [],
    );
});

test("a delayed but still available promotion is not a missed material opportunity", () => {
    const result = classifyMistakeReviewMotifs({
        fen: cases[0].fen,
        bestMoveUci: "a7a8q",
        playedMoveUci: "h1g1",
        pvUci: ["a7a8q"],
        refutationUci: ["h6g6"],
    });
    expect(result.missedMotifs.some((m) => m.id === "promotion")).toBe(false);
});

test("equally retained promotion choices do not invent a missed promotion", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "8/PP6/7k/7p/8/8/8/7K w - - 0 1",
        bestMoveUci: "a7a8q",
        playedMoveUci: "b7b8q",
        pvUci: ["a7a8q"],
        refutationUci: [],
    });
    expect(result.missedMotifs.some((m) => m.id === "promotion")).toBe(false);
});

test("a checking alternative cannot claim it prevents a later promotion just because it delays it", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "8/P7/7k/7p/6n1/8/8/7K b - - 0 1",
        bestMoveUci: "g4f2",
        playedMoveUci: "g4e5",
        pvUci: ["g4f2", "h1h2"],
        refutationUci: ["a7a8q"],
    });
    expect(result.allowedMotifs).toContainEqual(
        expect.objectContaining({ id: "promotion", ply: 1 }),
    );
    expect(result.allowedMotifs.find((m) => m.id === "promotion")?.comparison).toBeUndefined();
});

test("capturing the promoting pawn establishes an allowed promotion cause", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "8/8/7k/7p/8/2N5/p7/7K w - - 0 1",
        bestMoveUci: "c3a2",
        playedMoveUci: "c3b5",
        pvUci: ["c3a2"],
        refutationUci: ["a2a1q"],
    });
    expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
        id: "promotion",
        source: "allowed",
        comparison: "prevented",
        value: 800,
    });
});

test.fails("known coverage gap: retain a real promotion through continuing rook checks", () => {
    const fen = "8/7k/5r2/4RP2/8/6R1/PK1p3P/8 b - - 0 37";
    // Fresh depth-20 analysis finds d1=Q approximately equal, not refuted.
    // This is a known missing certificate, NOT a correct negative position.
    expect(proveImmediatePromotion(replayTacticalLine(fen, ["d2d1q"])[0])).toMatchObject({
        gain: expect.any(Number),
    });
});

test.skipIf(!process.env.TACTICAL_PROMOTION_REPLAY || !process.env.TACTICAL_PROMOTION_REPORT)(
    "inspect actual owner promotions with root-only and complete continuations",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PROMOTION_REPORT!);
        expect(existsSync(output)).toBe(false);
        const replay = JSON.parse(readFileSync(process.env.TACTICAL_PROMOTION_REPLAY!, "utf8"));
        const rows = replay.results.filter((r: any) => r.before[0].pvUci[0].length === 5);
        const results = rows.map((r: any) => ({
            id: r.id,
            fen: r.fen,
            root: r.before[0].pvUci[0],
            old: r.scan,
            rootOnly: classifyPositionTacticalMotifs({ fen: r.fen, pvUci: [r.before[0].pvUci[0]] }),
            full: classifyPositionTacticalMotifs({ fen: r.fen, pvUci: r.before[0].pvUci }),
        }));
        writeFileSync(
            output,
            JSON.stringify(
                { scope: "Same owner inputs; diagnostics, not an accuracy score.", results },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            results.map((r: any) => ({
                id: r.id,
                rootOnly: r.rootOnly.motifs.map((m: any) => [m.id, m.value, m.ply]),
                full: r.full.motifs.map((m: any) => [m.id, m.value, m.ply]),
            })),
        );
    },
);

test.skipIf(!process.env.TACTICAL_PROMOTION_PROBES)(
    "export promotion decisions and countercheck answers for fresh engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PROMOTION_PROBES!);
        expect(existsSync(output)).toBe(false);
        const inputs = cases.map((row) => ({
            ...row,
            expectedSign: row.gain === null ? undefined : 1,
        }));
        const publicCase = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/secondary-theme-development.json", "utf8"),
        ).cases.find((r: any) => r.id === "lichess:oSj8l");
        inputs.push({
            id: publicCase.id,
            fen: publicCase.startFen,
            move: publicCase.bestLine[0],
            gain: 220,
            expectedSign: 1,
        });
        const owner = JSON.parse(readFileSync(process.env.TACTICAL_PROMOTION_REPLAY!, "utf8"));
        for (const row of owner.results.filter((r: any) => r.before[0].pvUci[0].length === 5))
            inputs.push({
                id: row.id,
                fen: row.fen,
                move: row.before[0].pvUci[0],
                gain: 800,
                expectedSign: 1,
            });
        const records: any[] = [],
            probes: any[] = [];
        for (const input of inputs)
            for (const reflected of [false, true]) {
                const fen = reflected ? reflectMixedForkFen(input.fen) : input.fen;
                const move = reflected ? reflectMixedForkMove(input.move) : input.move;
                const id = `${input.id}:${reflected}`;
                const root = replayTacticalLine(fen, [move])[0];
                expect(root).toBeDefined();
                const proof = proveImmediatePromotion(root);
                expect(proof?.gain ?? null).toBe(input.gain);
                probes.push({
                    id: `${id}:root`,
                    fen,
                    searchMove: move,
                    expectedSign: input.expectedSign,
                });
                const replies: string[] = [];
                if (proof) {
                    for (const [from, dests] of root.after.allDests())
                        for (const to of dests) {
                            // The current admitted examples have no opposing promotion reply.
                            assert(
                                root.after.board.get(from)?.role !== "pawn" || (to >= 8 && to < 56),
                            );
                            const reply = { from, to };
                            assert(root.after.isLegal(reply));
                            const next = root.after.clone();
                            next.play(reply);
                            const uci = makeUci(reply);
                            replies.push(uci);
                            probes.push({
                                id: `${id}:after-${uci}`,
                                fen: makeFen(next.toSetup()),
                                expectedSign: input.expectedSign,
                            });
                        }
                    for (const [i, decision] of proof.counterchecks.entries())
                        probes.push({
                            id: `${id}:countercheck-${i}`,
                            fen: decision.fen,
                            searchMove: decision.moveUci,
                            expectedSign: input.expectedSign,
                        });
                }
                records.push({ id, fen, move, proof, replies });
            }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_PROMOTION_REPLAY,
                    scope: "Constructed controls, one existing public puzzle and two owner promotions with reflections. Full-position engine decisions do not establish the local numerical gain.",
                    records,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
