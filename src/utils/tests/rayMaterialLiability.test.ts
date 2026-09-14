import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { replayTacticalLine, tacticalExchangeGain } from "../tacticalMotifs/causalTactics";

// Constructed relative pin: Qd5+ attacks b7 in front of Ra8. Capturing b7
// permits Qxh3+, so the two separate pawn captures do not prove a pawn gain.
const fen = "r5k1/1p6/8/8/7q/7P/8/3Q3K w - - 0 1";
const line = ["d1d5", "g8h8", "d5b7", "h4h3"];

test("a geometric relative pin cannot count its pawn and ignore the countercaptured pawn", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(4);
    expect(tacticalExchangeGain(steps[2].before, steps[2].move)).toBe(100);
    expect(tacticalExchangeGain(steps[3].before, steps[3].move)).toBe(100);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] });
    expect(result.motifs.some((m) => m.id === "pin")).toBe(false);
    expect(
        buildLiveTacticalScan({
            fen,
            pvUci: [line[0]],
            depth: 16,
            engineName: "Constructed",
        }).motifs.some((m) => m.id === "pin"),
    ).toBe(false);
});

test("without the off-square pawn liability the actual relative pin remains identifiable", () => {
    const safe = fen.replace("7P", "8").replace("3Q3K", "3Q2K1");
    expect(replayTacticalLine(safe, [line[0]])).toHaveLength(1);
    expect(classifyPositionTacticalMotifs({ fen: safe, pvUci: [line[0]] }).motifs[0]).toMatchObject(
        { id: "pin", value: 100 },
    );
});

test("winning a pinned pawn cannot ignore immediate back-rank mate", () => {
    const mate = "r3r1k1/1p6/8/8/8/8/5PPP/3Q2K1 w - - 0 1";
    const steps = replayTacticalLine(mate, ["d1d5", "g8h8", "d5b7", "e8e1"]);
    expect(steps).toHaveLength(4);
    expect(steps[3].after.isCheckmate()).toBe(true);
    expect(
        classifyPositionTacticalMotifs({ fen: mate, pvUci: ["d1d5"] }).motifs.some(
            (m) => m.id === "pin",
        ),
    ).toBe(false);
    const safe = mate.replace("r3r1k1", "r5k1");
    expect(classifyPositionTacticalMotifs({ fen: safe, pvUci: ["d1d5"] }).motifs[0]).toMatchObject({
        id: "pin",
        value: 100,
    });
});

test("a queen-front skewer cannot win a rook by abandoning a queen elsewhere", () => {
    const skewer = "r7/6k1/8/q7/8/1R6/1P5Q/5nK1 w - - 0 1";
    const moves = ["b3a3", "a5b5", "a3a8", "f1h2"];
    const steps = replayTacticalLine(skewer, moves);
    expect(steps).toHaveLength(4);
    expect(tacticalExchangeGain(steps[2].before, steps[2].move)).toBe(500);
    expect(tacticalExchangeGain(steps[3].before, steps[3].move)).toBe(580);
    expect(
        classifyPositionTacticalMotifs({ fen: skewer, pvUci: [moves[0]] }).motifs.some(
            (m) => m.id === "skewer",
        ),
    ).toBe(false);
});

test("colour reflection preserves the countercapture refutation", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: ["d8d4"] }).motifs.some(
            (m) => m.id === "pin",
        ),
    ).toBe(false);
});

test("a checking continuation can genuinely recover the rear target without abandoning the queen", () => {
    const result = classifyPositionTacticalMotifs({
        fen: "r7/8/8/k7/8/1R6/1P5Q/5nK1 w - - 0 1",
        pvUci: ["b3a3"],
    });
    const skewer = result.motifs.find((m) => m.id === "skewer");
    expect(skewer).toMatchObject({ value: 500, ply: 1 });
    expect(skewer?.evidence).toContain("Qd6+");
    expect(skewer?.evidence).toContain("Qxa8+");
});

test("the real discovered check does not need a smaller skewer of the same attacked pawn", () => {
    const row = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
    ).cases.find((r: { id: string }) => r.id === "lichess:ZVq1J");
    const result = classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine });
    expect(result.motifs[0]).toMatchObject({ id: "discoveredCheck", value: 680, ply: 5 });
    expect(result.timeline?.some((m) => m.id === "skewer")).toBe(false);
    const steps = replayTacticalLine(row.startFen, row.bestLine);
    const reached = classifyPositionTacticalMotifs({
        fen: makeFen(steps[4].before.toSetup()),
        pvUci: [row.bestLine[4]],
    });
    expect(steps).toHaveLength(5);
    expect(reached.timeline?.some((m) => m.id === "skewer")).toBe(false);
});

test("a separate rear victim is not swallowed by the discovery's material explanation", () => {
    const separate = "8/p2R1pk1/1p2r3/1p2n2b/2P1K3/6PP/3QP3/8 b - - 0 1";
    const result = classifyPositionTacticalMotifs({ fen: separate, pvUci: ["e5c4"] });
    expect(result.motifs[0]?.id).toBe("discoveredCheck");
    expect(result.motifs.some((m) => m.id === "skewer")).toBe(true);
});

test("a missed larger discovery stays the main lesson while retaining its distinct smaller skewer", () => {
    const review = classifyMistakeReviewMotifs({
        fen: "8/p2R1pk1/1p2r3/1p2n2b/2P1K3/6PP/3QP3/8 b - - 0 1",
        bestMoveUci: "e5c4",
        pvUci: ["e5c4"],
        playedMoveUci: "g7f6",
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({
        id: "discoveredCheck",
        relevance: "primary",
        value: 680,
    });
    expect(review.missedMotifs.find((m) => m.id === "skewer")).toMatchObject({
        relevance: "secondary",
        value: 100,
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "discoveredCheck",
        source: "missed",
    });
});

test("a liability-refuted pin is not advertised as a missed opportunity", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "d1d5",
        pvUci: line,
        playedMoveUci: "d1d2",
        refutationUci: [],
    });
    expect(review.missedMotifs.some((m) => m.id === "pin")).toBe(false);
});
