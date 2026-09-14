import { expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { parseUci, makeUci } from "chessops/util";
import { makeFen } from "chessops/fen";
import {
    proveMixedTargetFork,
    replayTacticalLine,
    compareImmediateTacticalDefence,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    mixedForkFen as fen,
    mixedForkPreviousFen,
    mixedForkLine,
    mixedForkControls,
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";

test("a quiet three-target fork explains the root while its pin stays on the actual capture ply", () => {
    const step = replayTacticalLine(fen, ["d2f3"])[0];
    const attempts: unknown[] = [];
    const proof = proveMixedTargetFork(step, 8192, (targets, result) =>
        attempts.push({ targets, result }),
    );
    const result = classifyPositionTacticalMotifs({ fen, pvUci: mixedForkLine });
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: mixedForkLine,
        depth: 16,
        engineName: "Regression",
    });
    if (process.env.TACTICAL_MIXED_FORK_REPORT)
        writeFileSync(
            process.env.TACTICAL_MIXED_FORK_REPORT,
            JSON.stringify({ fen, proof, attempts, result, scan }, null, 2),
            { flag: "wx" },
        );
    expect(proof).toMatchObject({ gain: 100, targets: [4, 27, 31] });
    expect(result.motifs[0]).toMatchObject({ id: "fork", ply: 1, value: 100 });
    expect(scan.labels[0]).toMatchObject({ id: "fork", square: "f3" });
    expect(scan.labels).toHaveLength(1);
    expect(scan.arrows.map((a) => `${a.from}:${a.to}`).sort()).toEqual(
        ["d2:f3", "f3:e1", "f3:d4", "f3:h4", "c6:c2"].sort(),
    );
    expect(result.motifs.map((m) => [m.id, m.ply])).toEqual([
        ["fork", 1],
        ["pin", 3],
    ]);
    expect(result.motifs[0].evidence).toContain("pawn on c3 cannot recapture on d4");
    expect(proof?.captureBranches).toHaveLength(27);
    const legal = [...step.after.allDests()].flatMap(([from, tos]) =>
        [...tos].map((to) => makeUci({ from, to })),
    );
    expect(proof?.captureBranches?.map((b) => b.replyUci).sort()).toEqual(legal.sort());
    for (const branch of proof!.captureBranches!) {
        const position = step.after.clone();
        const reply = parseUci(branch.replyUci)!;
        expect(position.isLegal(reply)).toBe(true);
        position.play(reply);
        const answer = parseUci(branch.answerUci)!;
        expect(position.isLegal(answer)).toBe(true);
        expect(branch.gain).toBeGreaterThanOrEqual(100);
    }
});

test.each(mixedForkControls)(
    "$id does not acquire an unsupported immediate-capture certificate",
    (row) => {
        const steps = replayTacticalLine(row.fen, ["d2f3"]);
        expect(steps).toHaveLength(1);
        expect(proveMixedTargetFork(steps[0])).toBeNull();
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: ["d2f3"] }).motifs.some(
                (m) => m.id === "fork",
            ),
        ).toBe(false);
    },
);

test("neither two-target subset suffices, and apparent simultaneous defences have concrete answers", () => {
    const attempts: { targets: number[]; result: { kind: string; defence?: string } }[] = [];
    const proof = proveMixedTargetFork(
        replayTacticalLine(fen, ["d2f3"])[0],
        8192,
        (targets, result) => attempts.push({ targets, result }),
    );
    expect(attempts).toMatchObject([
        { targets: [4, 27], result: { kind: "refuted", defence: "Rd1" } },
        { targets: [4, 31], result: { kind: "refuted", defence: "Rh1" } },
        { targets: [4, 27, 31], result: { kind: "proven" } },
    ]);
    for (const [replyUci, answerUci] of [
        ["e1d1", "f3h4"],
        ["e1h1", "f3d4"],
        ["e1e4", "d5e4"],
        ["e1e6", "c6e6"],
    ])
        expect(proof?.captureBranches).toContainEqual(
            expect.objectContaining({ replyUci, answerUci }),
        );
    const pinned = replayTacticalLine(fen, ["d2f3", "e1h1", "f3d4"])[2].after;
    expect(pinned.isLegal(parseUci("c3d4")!)).toBe(false);
    const unpinned = replayTacticalLine(mixedForkControls[0].fen, ["d2f3", "e1h1", "f3d4"])[2]
        .after;
    expect(unpinned.isLegal(parseUci("c3d4")!)).toBe(true);
});

test.each([1, 2, 3, 5])(
    "root proof does not borrow the supplied continuation at %i plies",
    (length) => {
        const result = classifyPositionTacticalMotifs({
            fen,
            pvUci: mixedForkLine.slice(0, length),
        });
        expect(result.motifs[0]).toMatchObject({ id: "fork", ply: 1, value: 100 });
        expect(result.motifs.some((m) => m.id === "pin")).toBe(length >= 3);
    },
);

test("colour reflection retains the same fork, gain, pin support and causal comparison", () => {
    const mirrored = reflectMixedForkFen(fen);
    const pvUci = mixedForkLine.map(reflectMixedForkMove);
    expect(replayTacticalLine(mirrored, pvUci)).toHaveLength(pvUci.length);
    const result = classifyPositionTacticalMotifs({ fen: mirrored, pvUci });
    expect(result.motifs.map((m) => [m.id, m.ply, m.value])).toEqual([
        ["fork", 1, 100],
        ["pin", 3, 100],
    ]);
    expect(
        compareImmediateTacticalDefence(
            reflectMixedForkFen(mixedForkPreviousFen),
            "b8b7",
            "b8c7",
            "d7f6",
            result.motifs,
        )[0],
    ).toMatchObject({ comparison: "prevented" });
    for (const control of mixedForkControls)
        expect(
            proveMixedTargetFork(replayTacticalLine(reflectMixedForkFen(control.fen), ["d7f6"])[0]),
        ).toBeNull();
});

test("exhausted, invalid and claimable-draw entries cannot reuse a cached certificate", () => {
    const step = replayTacticalLine(fen, ["d2f3"])[0];
    expect(proveMixedTargetFork(step)?.gain).toBe(100);
    for (const budget of [0, -1, 0.5, Infinity, NaN, 1, 2, 3])
        expect(proveMixedTargetFork(step, budget)).toBeNull();
    const claimable = replayTacticalLine(fen.replace("2 36", "99 36"), ["d2f3"])[0];
    expect(proveMixedTargetFork(claimable)).toBeNull();
    expect(proveMixedTargetFork(step)?.gain).toBe(100);
});

test("a genuinely quiet fork cannot ignore an off-square queen that its victim can take", () => {
    const exposed = fen.replace("4R3", "q3R3");
    const step = replayTacticalLine(exposed, ["d2f3"])[0];
    expect(step.after.isCheck()).toBe(false);
    expect(tacticalExchangeGain(step.after, { from: 4, to: 0 })).toBe(900);
    expect(proveMixedTargetFork(step)).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: exposed, pvUci: ["d2f3"] }).motifs.some(
            (m) => m.id === "fork",
        ),
    ).toBe(false);
});

test("the king move is blamed only when it enables the same target-capture fork", () => {
    const motifs = classifyPositionTacticalMotifs({ fen, pvUci: ["d2f3"] }).motifs;
    expect(
        compareImmediateTacticalDefence(mixedForkPreviousFen, "b1b2", "b1c2", "d2f3", motifs)[0],
    ).toMatchObject({ id: "fork", comparison: "prevented" });
    expect(
        compareImmediateTacticalDefence(mixedForkPreviousFen, "b1c1", "b1c2", "d2f3", motifs)[0],
    ).toMatchObject({ id: "fork", comparison: "persists" });
    const review = classifyMistakeReviewMotifs({
        fen: mixedForkPreviousFen,
        playedMoveUci: "b1c2",
        bestMoveUci: "b1b2",
        pvUci: ["b1b2", "d2f3", "e1h1"],
        refutationUci: mixedForkLine,
        cpBefore: -117,
        cpAfter: -189,
        cpLoss: 72,
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "fork",
        source: "allowed",
        ply: 1,
    });
});

test("hanging a knight outranks the smaller missed pawn-winning fork without hiding it", () => {
    const evidence = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/broader-game-stockfish-18.json", "utf8"),
    );
    const best = evidence.witnesses.find((r: any) => r.id === "mixed-fork:root-choice").lines[0];
    const played = evidence.witnesses.find((r: any) => r.id === "mixed-fork:missed").lines[0];
    const refutation = evidence.supplements.find(
        (r: any) => r.id === "mixed-fork:missed-refutation",
    ).lines[0];
    const review = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "c6c7",
        bestMoveUci: "d2f3",
        pvUci: best.pvUci,
        refutationUci: refutation.pvUci,
        cpBefore: best.cp,
        cpAfter: played.cp,
        cpLoss: best.cp - played.cp,
    });
    const lesson = buildMistakeReviewTacticalExplanation(review);
    expect(lesson?.primary).toMatchObject({
        id: "hangingPiece",
        source: "allowed",
        comparison: "prevented",
    });
    expect(lesson?.secondary).toMatchObject({ id: "fork", source: "missed", ply: 1, value: 100 });
});

test.skipIf(
    !process.env.TACTICAL_MIXED_FORK_PRIVATE_INPUT ||
        !process.env.TACTICAL_MIXED_FORK_PRIVATE_REPORT,
)("audit a changed private continuation without publishing its position", () => {
    const input = JSON.parse(readFileSync(process.env.TACTICAL_MIXED_FORK_PRIVATE_INPUT!, "utf8"));
    const step = replayTacticalLine(input.fen, input.pvUci)[input.index];
    const proof = proveMixedTargetFork(step);
    expect(proof).toMatchObject({ complete: true, gain: 100 });
    const fen = makeFen(step.before.toSetup());
    const probes = [
        { id: "private-mixed:root", fen, searchMove: step.uci },
        ...proof!.captureBranches!.map((branch) => {
            const after = step.after.clone();
            after.play(parseUci(branch.replyUci)!);
            return {
                id: "private-mixed:reply:" + branch.replyUci,
                fen: makeFen(after.toSetup()),
                searchMove: branch.answerUci,
            };
        }),
    ];
    writeFileSync(
        process.env.TACTICAL_MIXED_FORK_PRIVATE_REPORT!,
        JSON.stringify(
            {
                samplePath: "benchmarks/tactical-relevance/broader-game-context.json",
                fen,
                proof,
                probes,
                result: classifyPositionTacticalMotifs({ fen: input.fen, pvUci: input.pvUci }),
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
});
