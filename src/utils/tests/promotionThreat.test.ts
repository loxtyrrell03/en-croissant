import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { provePromotionThreat, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { promotionThreatCases, missedPromotionThreatFen, promotionForkCollectionFen } from "./fixtures/promotionThreat";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const cases = promotionThreatCases.flatMap((row) => [
    row,
    {
        ...row,
        id: `${row.id}:black`,
        fen: reflectMixedForkFen(row.fen),
        move: reflectMixedForkMove(row.move),
    },
]);

test.each(cases)("$id: immediate promotion threats need every legal defence", (row) => {
    const step = replayTacticalLine(row.fen, [row.move])[0];
    expect(step).toBeDefined();
    const proof = provePromotionThreat(step);
    expect(proof?.gain ?? null).toBe(row.gain);
    const source = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
    expect(source.motifs.some((m) => m.id === "promotionThreat")).toBe(row.gain !== null);
    if (!proof) return;
    const replies = [...step.after.allDests()].flatMap(([from, dests]) =>
        [...dests].flatMap((to) =>
            step.after.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) =>
                      makeUci({ from, to, promotion }),
                  )
                : [makeUci({ from, to })],
        ),
    );
    expect(proof.branches.map((b) => b.replyUci).sort()).toEqual(replies.sort());
    expect(proof.visits).toBeLessThanOrEqual(32768);
    for (const branch of proof.branches) {
        const replay = replayTacticalLine(row.fen, [
            row.move,
            branch.replyUci,
            branch.promotionUci!,
        ]);
        expect(replay).toHaveLength(3);
        expect(makeFen(replay[2].before.toSetup())).toBe(branch.fen);
        expect(replay[2].move.from).toBe(step.move.to);
        expect(branch.gain).toBeGreaterThanOrEqual(proof.gain);
    }
    const scan = buildLiveTacticalScan({
        fen: row.fen,
        pvUci: [row.move],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.motifs[0]).toMatchObject({ id: "promotionThreat", value: row.gain, ply: 1 });
    expect(scan.labels[0]).toMatchObject({
        square: row.move.slice(2, 4),
        text: "Promotion Threat",
    });
    expect(scan.arrows).toContainEqual(
        expect.objectContaining({ from: row.move.slice(0, 2), to: row.move.slice(2, 4), ply: 1 }),
    );
});

test("a threat's promotion stays at its actual ply without double-counting its gain", () => {
    const result = classifyPositionTacticalMotifs({
        fen: promotionThreatCases[0].fen,
        pvUci: ["f6f7", "a8b7", "f7f8q", "b7c6", "f8c8"],
    });
    expect(result.motifs[0]).toMatchObject({ id: "promotionThreat", ply: 1, value: 800 });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({
            id: "promotion",
            label: "Promotion Payoff",
            ply: 3,
            value: undefined,
        }),
    );
    expect(result.timeline?.every((m) => (m.ply ?? 0) <= 3)).toBe(true);
});

test.each([false, true])("promotion collecting a pawn fork does not replace the initiating fork (%s)", reflected => {
    // Only Kf8 answers the check; promotion then collects the fork's knight.
    const base = promotionForkCollectionFen;
    const fen = reflected ? reflectMixedForkFen(base) : base;
    const move = reflected ? reflectMixedForkMove("f6f7") : "f6f7";
    const root = replayTacticalLine(fen, [move])[0];
    expect(provePromotionThreat(root)).not.toBeNull();
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [move] });
    expect(result.motifs[0]?.id).toBe("fork");
    expect(result.motifs.some(m => m.id === "promotionThreat")).toBe(false);
});

test("a threat cannot reuse a cached success under an exhausted or invalid budget", () => {
    const root = replayTacticalLine(promotionThreatCases[0].fen, ["f6f7"])[0];
    expect(provePromotionThreat(root)).not.toBeNull();
    for (const budget of [0, 1, -1, NaN, Infinity, 0.5])
        expect(provePromotionThreat(root, budget)).toBeNull();
});

test("delaying a still available pawn push is not missing its promotion material", () => {
    const result = classifyMistakeReviewMotifs({
        fen: promotionThreatCases[0].fen,
        bestMoveUci: "f6f7",
        playedMoveUci: "c3d3",
        pvUci: ["f6f7"],
        refutationUci: ["a8b8"],
    });
    expect(result.missedMotifs.some((m) => m.id === "promotionThreat")).toBe(false);
});

test("a different equally retained pawn push is not a missed generic promotion threat", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "k7/8/5PP1/8/8/2K5/8/8 w - - 0 1",
        bestMoveUci: "f6f7",
        playedMoveUci: "g6g7",
        pvUci: ["f6f7"],
        refutationUci: ["a8b8"],
    });
    expect(result.missedMotifs.some((m) => m.id === "promotionThreat")).toBe(false);
});

test.each([false, true])(
    "a missed promotion threat has a root lesson in either colour (%s)",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(missedPromotionThreatFen)
            : missedPromotionThreatFen;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const input = {
            fen,
            bestMoveUci: move("f6f7"),
            playedMoveUci: move("b1b2"),
            pvUci: [move("f6f7")],
            refutationUci: [move("g4f6")],
        };
        const result = classifyMistakeReviewMotifs(input);
        expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
            id: "promotionThreat",
            source: "missed",
            value: 800,
            ply: 1,
        });
        expect(
            classifyMistakeReviewMotifs({ ...input, playedMoveUci: input.bestMoveUci })
                .missedMotifs,
        ).toEqual([]);
    },
);

test("capturing the pawn prevents its promotion threat, but merely checking does not establish prevention", () => {
    const fen = missedPromotionThreatFen.replace(" w ", " b ");
    const captured = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "g4f6",
        playedMoveUci: "g4h2",
        pvUci: ["g4f6"],
        refutationUci: ["f6f7"],
    });
    expect(captured.allowedMotifs).toContainEqual(
        expect.objectContaining({ id: "promotionThreat", comparison: "prevented" }),
    );
    const checking = classifyMistakeReviewMotifs({
        fen: fen.replace("1K6", "7K"),
        bestMoveUci: "g4f2",
        playedMoveUci: "g4h2",
        pvUci: ["g4f2"],
        refutationUci: ["f6f7"],
    });
    expect(checking.allowedMotifs).toContainEqual(
        expect.objectContaining({ id: "promotionThreat" }),
    );
    expect(
        checking.allowedMotifs.find((m) => m.id === "promotionThreat")?.comparison,
    ).toBeUndefined();
});

test.skipIf(!process.env.TACTICAL_PAWN_PUSH_PROBES)(
    "export public threat decisions for independent engine review",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PAWN_PUSH_PROBES!);
        expect(existsSync(output)).toBe(false);
        const probes = cases.flatMap((row) => {
            const proof = provePromotionThreat(replayTacticalLine(row.fen, [row.move])[0]);
            return [
                { id: `${row.id}:best`, fen: row.fen },
                { id: `${row.id}:held`, fen: row.fen, searchMove: row.move },
                ...(proof?.branches.flatMap((branch) => [
                    { id: `${row.id}:${branch.replyUci}:best`, fen: branch.fen },
                    {
                        id: `${row.id}:${branch.replyUci}:held`,
                        fen: branch.fen,
                        searchMove: branch.promotionUci,
                    },
                ]) ?? []),
            ];
        });
        for (const reflected of [false, true]) {
            const forkFen = reflected ? reflectMixedForkFen(promotionForkCollectionFen) : promotionForkCollectionFen;
            const forkMove = reflected ? reflectMixedForkMove("f6f7") : "f6f7";
            probes.push({id:`fork-priority:${reflected}:best`,fen:forkFen},
                {id:`fork-priority:${reflected}:held`,fen:forkFen,searchMove:forkMove});
            const proof = provePromotionThreat(replayTacticalLine(forkFen,[forkMove])[0])!;
            for(const branch of proof.branches) probes.push({id:`fork-priority:${reflected}:${branch.replyUci}:held`,
                fen:branch.fen,searchMove:branch.promotionUci});
            const fen = reflected
                ? reflectMixedForkFen(missedPromotionThreatFen)
                : missedPromotionThreatFen;
            const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
            probes.push(
                { id: `missed:${reflected}:best`, fen },
                { id: `missed:${reflected}:held`, fen, searchMove: move("f6f7") },
            );
            const after = makeFen(replayTacticalLine(fen, [move("b1b2")])[0].after.toSetup());
            probes.push(
                { id: `missed:${reflected}:reply-best`, fen: after },
                { id: `missed:${reflected}:reply-held`, fen: after, searchMove: move("g4f6") },
            );
        }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Constructed controls and every selected positive branch; not an accuracy sample.",
                    certificates: cases.flatMap(row => {
                        const threat = provePromotionThreat(replayTacticalLine(row.fen, [row.move])[0]);
                        return threat ? [{ id: row.id, fen: row.fen, move: row.move, threat }] : [];
                    }),
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.skipIf(!process.env.TACTICAL_PAWN_PUSH_REPLAY)(
    "owner promotion threats include checked preparations without claiming next-move promotion",
    () => {
        const replay = JSON.parse(readFileSync(process.env.TACTICAL_PAWN_PUSH_REPLAY!, "utf8"));
        const row = replay.results.find((r: any) => r.id === "recall:169988038936:ply91");
        const root = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
        expect(provePromotionThreat(root)).toMatchObject({ gain: 800 });
        expect(provePromotionThreat(root)?.branches).toHaveLength(7);
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci: row.before[0].pvUci,
            depth: 16,
            engineName: "Stockfish 18",
        });
        expect(scan.motifs[0]).toMatchObject({ id: "promotionThreat", ply: 1 });
        const delayed = replay.results.find((r: any) => r.id === "recall:169988038936:ply71");
        expect(
            provePromotionThreat(replayTacticalLine(delayed.fen, delayed.before[0].pvUci)[0]),
        ).toMatchObject({gain: 380});
        const fork = replay.results.find((r: any) => r.id === "recall:172652599758:ply22");
        const forkResult = classifyPositionTacticalMotifs({fen:fork.fen,pvUci:fork.before[0].pvUci});
        expect(forkResult.motifs[0]?.id).toBe("fork");
        expect(forkResult.motifs.some(m=>m.id==="promotionThreat")).toBe(false);
    },
);
