import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, expect } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import {
    provePromotionCheckRetention,
    proveImmediatePromotion,
    proveCheckingMate,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { immediatePromotionCases } from "./fixtures/immediatePromotion";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { promotionCheckFen as ownerFen } from "./fixtures/promotionCheckRetention";

const raceFen = "Q7/4K3/2p5/2P1k3/8/8/3p4/8 b - - 0 53";

test.each([false, true])(
    "recover promotion through complete checking branches: reflected=%s",
    (reflected) => {
        const fen = reflected ? reflectMixedForkFen(ownerFen) : ownerFen;
        const move = reflected ? reflectMixedForkMove("d2d1q") : "d2d1q";
        const step = replayTacticalLine(fen, [move])[0];
        const proof = proveImmediatePromotion(step);
        expect(proof).toMatchObject({ gain: 300 });
        expect(proof!.visits).toBeLessThanOrEqual(16384);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [move] }).motifs[0]).toMatchObject({
            id: "promotion",
            value: 300,
            ply: 1,
            confidence: "high",
        });
        for (const decision of proof!.counterchecks) {
            const answered = replayTacticalLine(decision.fen, [decision.moveUci])[0].after;
            const queens = [...answered.board[step.before.turn]].filter(
                (square) => answered.board.get(square)?.role === "queen",
            );
            expect(queens).toHaveLength(1);
            for (const dests of answered.allDests().values())
                expect(dests.has(queens[0])).toBe(false);
        }
    },
);

test("bounded checking retention cannot reuse a larger cached proof", () => {
    const step = replayTacticalLine(ownerFen, ["d2d1q"])[0];
    expect(proveImmediatePromotion(step)?.gain).toBe(300);
    for (const budget of [0, 1, 4096, -1, NaN, Infinity]) {
        expect(provePromotionCheckRetention(step, budget)).toBeNull();
        expect(proveImmediatePromotion(step, budget)).toBeNull();
    }
    expect(proveImmediatePromotion(step)?.gain).toBe(300);
});

test.skipIf(!process.env.TACTICAL_RETENTION_PYTHON)(
    "independent promotion strategy checker rejects incomplete and inflated certificates",
    () => {
        const record = {
            id: "owner-position-checking-strategy",
            fen: ownerFen,
            move: "d2d1q",
            proof: proveImmediatePromotion(replayTacticalLine(ownerFen, ["d2d1q"])[0])!,
        };
        const inspect = (row: typeof record) =>
            spawnSync(
                process.env.TACTICAL_RETENTION_PYTHON!,
                ["scripts/benchmarks/verify-promotion-retention.py"],
                { input: JSON.stringify({ records: [row] }), encoding: "utf8" },
            );
        const good = inspect(record);
        expect({ status: good.status, error: good.stderr }).toEqual({ status: 0, error: "" });
        expect(JSON.parse(good.stdout).verified).toBe(1);
        expect(
            inspect({ ...record, proof: { ...record.proof, counterchecks: [] } }).status,
        ).not.toBe(0);
        expect(inspect({ ...record, proof: { ...record.proof, gain: 801 } }).status).not.toBe(0);
    },
);

test("a constructed missed choice retains the recovered promotion lesson", () => {
    const result = classifyMistakeReviewMotifs({
        fen: ownerFen,
        bestMoveUci: "d2d1q",
        playedMoveUci: "f6h6",
        pvUci: ["d2d1q"],
        refutationUci: ["g3d3"],
    });
    expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
        id: "promotion",
        source: "missed",
        value: 300,
        ply: 1,
    });
});

test.fails("known coverage gap: the stronger mating punishment should precede the missed promotion", () => {
    const result = classifyMistakeReviewMotifs({
        fen: ownerFen,
        bestMoveUci: "d2d1q",
        playedMoveUci: "f6h6",
        pvUci: ["d2d1q"],
        refutationUci: ["e5e7", "h7h8", "g3b3", "d2d1n", "b2a1", "h6g6", "f5g6", "d1e3", "b3b8"],
    });
    if (process.env.TACTICAL_PROMOTION_MATE_TRACE) {
        const after = replayTacticalLine(ownerFen, ["f6h6"])[0].after;
        const line = ["e5e7", "h7h8", "g3b3", "d2d1n", "b2a1", "h6g6", "f5g6", "d1e3", "b3b8"];
        const reasons: string[] = [];
        const proof = proveCheckingMate(
            replayTacticalLine(makeFen(after.toSetup()), line),
            undefined,
            true,
            (reason) => reasons.push(reason),
        );
        process.stdout.write(JSON.stringify({ mate: proof?.maxMoves ?? null, reasons }) + "\n");
    }
    // Fresh Stockfish finds mate in five after the constructed Rh6 mistake.
    // The current bounded mating/causal verifier misses it; Promotion is a
    // real missed resource, but not the complete or best primary explanation.
    expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
        label: "Forcing Mate",
        source: "allowed",
    });
});

test.each(immediatePromotionCases)("retain existing promotion counterplay control: $id", (row) => {
    const proof = provePromotionCheckRetention(replayTacticalLine(row.fen, [row.move])[0]);
    expect(proof?.gain ?? null).toBe(row.gain);
});

test("unsafe mate continuation cannot fund promotion recovery", () => {
    const fen = "1K6/P2k4/8/8/4q3/8/7P/8 w - - 7 52";
    expect(proveImmediatePromotion(replayTacticalLine(fen, ["a7a8q"])[0])).toBeNull();
});

test.fails("known coverage gap: retain promotion through a queen-ending checking race", () => {
    expect(proveImmediatePromotion(replayTacticalLine(raceFen, ["d2d1q"])[0])).toMatchObject({
        gain: expect.any(Number),
    });
});

test.skipIf(!process.env.TACTICAL_PROMOTION_CHECK_PROBES)(
    "export promotion checking witnesses for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PROMOTION_CHECK_PROBES!);
        expect(existsSync(output)).toBe(false);
        const records: any[] = [],
            probes: any[] = [];
        for (const reflected of [false, true]) {
            const fen = reflected ? reflectMixedForkFen(ownerFen) : ownerFen;
            const move = reflected ? reflectMixedForkMove("d2d1q") : "d2d1q";
            const root = replayTacticalLine(fen, [move])[0];
            const proof = proveImmediatePromotion(root)!;
            expect(proof).not.toBeNull();
            const id = `owner-promotion:${reflected}`;
            probes.push({ id: `${id}:root`, fen, searchMove: move, depth: 20 });
            const replies: string[] = [];
            for (const [from, tos] of root.after.allDests())
                for (const to of tos) {
                    expect(
                        root.after.board.get(from)?.role !== "pawn" || (to >= 8 && to < 56),
                    ).toBe(true);
                    const reply = { from, to };
                    const next = root.after.clone();
                    next.play(reply);
                    replies.push(makeUci(reply));
                    probes.push({
                        id: `${id}:reply:${makeUci(reply)}`,
                        fen: makeFen(next.toSetup()),
                    });
                }
            const unique = [
                ...new Map(proof.counterchecks.map((x) => [`${x.fen}:${x.moveUci}`, x])).values(),
            ];
            for (const [i, decision] of unique.entries()) {
                probes.push({ id: `${id}:decision:${i}:best`, fen: decision.fen });
                probes.push({
                    id: `${id}:decision:${i}:held`,
                    fen: decision.fen,
                    searchMove: decision.moveUci,
                });
            }
            records.push({ id, fen, move, proof, replies, unique });
        }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    samplePath:
                        "C:/Users/Lox/Documents/OnCrescent Tactical Benchmarks/immediate-promotion-owner145-final-20260917.json",
                    records,
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
