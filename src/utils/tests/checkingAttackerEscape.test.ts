import { expect, test } from "vitest";
import { parseUci } from "chessops/util";
import {
    checkingAttackerCaptureEscape,
    replayTacticalLine,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "7k/1ppQ3p/p2b2p1/3p4/8/2P2q1P/PP6/3KR3 w - - 2 40";
const line = ["f3f1", "d1d2", "d6f4", "e2e3", "f1f2", "d2d1", "f4e3"];

test("the rejected capture controls have concrete legal refutations", () => {
    const pinned = replayTacticalLine("7k/8/8/8/8/4q3/8/K3R2r b - - 0 1", ["e3e2"])[0];
    expect(pinned.after.isLegal(parseUci("e1e2")!)).toBe(false);
    const defended = replayTacticalLine("7k/8/8/8/8/5r2/4Q1b1/K1B5 b - - 0 1", [
        "f3f1",
        "e2f1",
        "g2f1",
    ]);
    expect(defended).toHaveLength(3);
    expect(tacticalExchangeGain(defended[1].before, defended[1].move)).toBeLessThan(0);
    const mate = replayTacticalLine("1k5r/8/8/8/8/q4p2/5Pb1/4R1K1 b - - 0 1", [
        "a3a1",
        "e1a1",
        "h8h1",
    ]);
    expect(mate).toHaveLength(3);
    expect(mate[2].after.isCheckmate()).toBe(true);
});

test("Kc1 preserves Rxf1 as a legal answer to the now non-checking queen move", () => {
    const better = replayTacticalLine(fen, ["d1c1", "f3f1"])[1];
    expect(better.san).toBe("Qf1");
    expect(checkingAttackerCaptureEscape(better)).toMatchObject({ defence: "Rxf1" });
    expect(checkingAttackerCaptureEscape(better)!.gain).toBeGreaterThanOrEqual(100);
    expect(checkingAttackerCaptureEscape(replayTacticalLine(fen, ["e1e2", "f3f1"])[1])).toBeNull();
});

test.each([line, ["f3f1"]])(
    "the real Re2 cause has a legal witness without borrowing the old PV: %j",
    (...refutationUci) => {
        const result = classifyMistakeReviewMotifs({
            fen,
            playedMoveUci: "e1e2",
            bestMoveUci: "d1c1",
            pvUci: ["d1c1"],
            refutationUci,
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "forcingAttack",
            comparison: "prevented",
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain(
            "Rxf1 captures the attacking queen on f1",
        );
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
            "Why the move was tactically bad",
        );
    },
);

test.each([0, -1, NaN, Infinity, 1])(
    "invalid or exhausted proof budget cannot certify an escape: %s",
    (budget) => {
        const root = replayTacticalLine(fen, ["d1c1", "f3f1"])[1];
        expect(checkingAttackerCaptureEscape(root, budget)).toBeNull();
    },
);

test("a colour-reflected legal defence protects Black rather than assuming White", () => {
    const reflected = "3kr3/pp6/2p2Q1p/8/3P4/P2B2P1/1PPq3P/7K b - - 2 40";
    const root = replayTacticalLine(reflected, ["d8c8", "f6f8"])[1];
    expect(checkingAttackerCaptureEscape(root)).toMatchObject({ defence: "Rxf8" });
});

test("the real bishop countercheck has a legal king flight, not an assumed pass", () => {
    const steps = replayTacticalLine(fen, ["d1c1", "f3f1", "e1f1", "d6f4", "c1b1"]);
    expect(steps).toHaveLength(5);
    expect(steps[3].san).toBe("Bf4+");
    expect(steps[4].san).toBe("Kb1");
});

test.each([
    [
        "a pinned rook cannot capture the attacking queen",
        "7k/8/8/8/8/4q3/8/K3R2r b - - 0 1",
        "e3e2",
    ],
    [
        "a bishop recapture makes taking the offered rook lose material",
        "7k/8/8/8/8/5r2/4Q1b1/K1B5 b - - 0 1",
        "f3f1",
    ],
    [
        "winning the queen cannot excuse immediate back-rank mate",
        "1k5r/8/8/8/8/q4p2/5Pb1/4R1K1 b - - 0 1",
        "a3a1",
    ],
])("%s", (_name, position, move) => {
    const root = replayTacticalLine(position, [move])[0];
    expect(root).toBeDefined();
    expect(root.after.isCheck()).toBe(false);
    expect(checkingAttackerCaptureEscape(root)).toBeNull();
});

test("an off-square capture of the defender's queen is not hidden by a good recapture-only exchange", () => {
    const position = "7k/1pp4p/p2b2p1/3p4/8/2P2q1P/PP5Q/2K1R3 b - - 2 40";
    const steps = replayTacticalLine(position, ["f3f1", "e1f1", "d6h2"]);
    expect(steps).toHaveLength(3);
    expect(steps[2].san).toBe("Bxh2");
    expect(checkingAttackerCaptureEscape(steps[0])).toBeNull();
});
