import { expect, test } from "vitest";
import {
    proveCheckingMaterialAttack,
    replayTacticalLine,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

const fen = "7k/1ppQ3p/p2b2p1/3p4/8/2P2q1P/PP2R3/3K4 b - - 3 40";
const line = ["f3f1", "d1d2", "d6f4", "e2e3", "f1f2", "d2d1", "f4e3"];

test.each([line, ["f3f1"]])("Qf1+ wins material or mates against each legal reply: %j", (...pv) => {
    const proof = proveCheckingMaterialAttack(replayTacticalLine(fen, pv));
    expect(proof).not.toBeNull();
    expect(proof?.branches.map((branch) => branch.reply)).toEqual(["Kc2", "Kd2", "Re1"]);
    expect(proof?.gain).toBe(170);
});

test.each([
    line,
    line.slice(0, 3),
    ["f3f1"],
    ["f3f1", "d1c2", "f1e2", "c2c1", "d6f4", "c1b1", "e2d1"],
    ["f3f1", "e2e1", "f1d3", "d1c1", "d6f4", "e1e3", "f4e3"],
])("the root lesson survives short and branch-dependent PVs: %j", (...pvUci) => {
    expect(replayTacticalLine(fen, pvUci)).toHaveLength(pvUci.length);
    expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]).toMatchObject({
        id: "forcingAttack",
        ply: 1,
    });
});

test("the opening check does not draw a future pin, and the timeline does not repeat the attack", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Regression" });
    expect(scan.arrows.map((arrow) => arrow.from + arrow.to)).toEqual(["f3f1", "f1d1"]);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.filter((m) => m.id === "forcingAttack")).toHaveLength(1);
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "fork", ply: 5, relevance: "secondary" }),
    );
    expect(result.timeline?.find((m) => m.id === "pin")?.evidence).toContain("already pinned");
});

test.each([
    ["missing attacking bishop", fen.replace("p2b2p1", "p5p1")],
    ["capturing the checking queen", fen.replace("PP2R3", "PP2R2N")],
    ["an immediate rook capture already works", fen.replace("3K4", "2K5")],
])("does not turn %s into a necessary forcing attack", (_name, position) => {
    const steps = replayTacticalLine(position, ["f3f1"]);
    expect(steps).toHaveLength(1);
    expect(proveCheckingMaterialAttack(steps)).toBeNull();
});

test("an exhausted budget cannot borrow a cached proof", () => {
    const steps = replayTacticalLine(fen, line);
    expect(proveCheckingMaterialAttack(steps)).not.toBeNull();
    expect(proveCheckingMaterialAttack(steps, 0)).toBeNull();
});

test("capturing the checker is an actual legal defensive resource", () => {
    expect(replayTacticalLine(fen.replace("PP2R3", "PP2R2N"), ["f3f1", "h2f1"])).toHaveLength(2);
});

test("a checking castle does not invent a direct checking piece on the vacated rook square", () => {
    const steps = replayTacticalLine("3k4/8/8/8/8/8/8/R3K3 w Q - 0 1", ["e1a1"]);
    expect(steps[0].after.isCheck()).toBe(true);
    expect(proveCheckingMaterialAttack(steps)).toBeNull();
});

test("a rook move revealing a bishop check is not labelled with a fictitious rook checking ray", () => {
    const position = "5q1k/7p/8/4R3/8/8/1B3PPP/6K1 w - - 0 1";
    const pv = ["e5b5", "h8g8", "b5g5", "g8f7", "g5f5", "f7e7", "f5f8"];
    const steps = replayTacticalLine(position, pv);
    expect(steps).toHaveLength(7);
    expect(steps[0].after.isCheck()).toBe(true);
    expect(proveCheckingMaterialAttack(steps)).toBeNull();
});

test("two irrelevant pawn moves cannot manufacture a new cause from the same existing attack", () => {
    const continuation = ["f3f1", "d1d2", "d6f4", "e2e3", "f4e3", "d2e3"];
    const position = fen.replace(" b ", " w ");
    expect(replayTacticalLine(position, ["a2a3", ...continuation])).toHaveLength(7);
    const result = classifyMistakeReviewMotifs({
        fen: position,
        playedMoveUci: "a2a3",
        bestMoveUci: "a2a4",
        refutationUci: continuation,
        pvUci: ["a2a4", ...continuation],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "forcingAttack", comparison: "persists" });
});
