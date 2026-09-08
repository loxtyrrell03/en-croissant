import { expect, test } from "vitest";
import {
    provePromotionCombination,
    compareImmediateTacticalDefence,
    replayTacticalLine,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

const fen = "3R4/5k2/6p1/p7/3pNr2/2p2P1P/P5PK/8 b - - 3 41";
const line = ["f4e4", "f3e4", "c3c2", "d8d4", "c2c1q"];

test("the real rook sacrifice removes the knight's control of the connected passers", () => {
    const root = replayTacticalLine(fen, ["f4e4"])[0];
    const proof = provePromotionCombination(root);
    expect(proof).toMatchObject({ gain: 220, replyCount: 21, controlled: [11] });
    expect(proof!.examinedMoves).toBeLessThanOrEqual(131072);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0]).toMatchObject({ id: "promotionCombination", ply: 1 });
    expect(result.timeline?.find((m) => m.id === "promotion")?.ply).toBe(5);
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Regression" });
    expect(scan.labels[0]).toMatchObject({ id: "promotionCombination", square: "e4" });
    expect(scan.arrows).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ from: "c3", to: "c2" }),
            expect.objectContaining({ from: "d4", to: "d3" }),
            expect.objectContaining({ from: "e4", to: "d2" }),
        ]),
    );
});

test("pushing too early misses the defender-removing promotion combination", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "f4e4",
        playedMoveUci: "c3c2",
        pvUci: line,
        cpLoss: 440,
    });
    expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
        source: "missed",
        primary: { id: "promotionCombination", ply: 1 },
    });
});

test.each([
    [fen.replace("2p2P1P", "5P1P"), "one missing passer"],
    [fen.replace("3pNr2", "4Nr2"), "the missing partner pawn"],
    [fen.replace("5k2", "P4k2").replace("P5PK", "6PK"), "a counterpromotion"],
])("a cooperative promotion line is not sufficient with %s (%s)", (position) => {
    expect(provePromotionCombination(replayTacticalLine(position, ["f4e4"])[0])).toBeNull();
});

test("the proof cache cannot bypass a caller's smaller budget", () => {
    const root = replayTacticalLine(fen, ["f4e4"])[0];
    expect(provePromotionCombination(root)).not.toBeNull();
    expect(provePromotionCombination(root, 0)).toBeNull();
    expect(provePromotionCombination(root, 1)).toBeNull();
});

test("the colour-reflected sacrifice has the same pawn-race proof", () => {
    const reflected = "8/p5pk/2P2p1p/3PnR2/P7/6P1/5K2/3r4 w - - 3 41";
    const root = replayTacticalLine(reflected, ["f5e5"])[0];
    expect(provePromotionCombination(root)).toMatchObject({
        gain: 220,
        replyCount: 21,
        controlled: [51],
    });
});

const before = "1R6/5k2/6p1/p7/3pNr2/2p2P1P/P5PK/8 w - - 2 41";

test("moving the knight prevents this defender-removing sacrifice", () => {
    const motifs = classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs;
    expect(
        compareImmediateTacticalDefence(before, "e4c5", "b8d8", "f4e4", motifs)[0],
    ).toMatchObject({
        id: "promotionCombination",
        comparison: "prevented",
    });
});

test("a different rook move is not blamed when the same pawn combination persists", () => {
    const motifs = classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs;
    expect(
        compareImmediateTacticalDefence(before, "b8h8", "b8d8", "f4e4", motifs)[0],
    ).toMatchObject({
        id: "promotionCombination",
        comparison: "persists",
    });
});

test("an unproved alternative is not treated as a causal comparison", () => {
    const motifs = classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs;
    expect(
        compareImmediateTacticalDefence(before, "b8c8", "b8d8", "f4e4", motifs)[0].comparison,
    ).toBeUndefined();
});

test("the promotion payoff ends the episode before later queen captures", () => {
    const extended = [...line, "d4d1", "c1d1"];
    expect(replayTacticalLine(fen, extended)).toHaveLength(extended.length);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: extended }).timeline).toEqual(
        classifyPositionTacticalMotifs({ fen, pvUci: line }).timeline,
    );
});

test("a pinned knight is not credited with controlling a promotion path", () => {
    const position = "R3r2k/8/2b5/8/3pN3/2p2P2/8/4K3 b - - 0 1";
    const steps = replayTacticalLine(position, ["c6e4"]);
    expect(steps).toHaveLength(1);
    expect(provePromotionCombination(steps[0])).toBeNull();
});
