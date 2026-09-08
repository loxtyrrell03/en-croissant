import { expect, test } from "vitest";
import {
    proveQuietTacticalPreparation,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

const fen = "8/4k3/7R/p3p2R/8/P6p/KP6/4q3 w - - 2 49";
const pvUci = ["h6b6", "e1e4", "h5h7", "e4h7", "b6b7", "e7d6", "b7h7"];

test("real Rb6 prepares mate or the queen-winning skewer", () => {
    const steps = replayTacticalLine(fen, pvUci);
    expect(steps).toHaveLength(7);
    expect(proveQuietTacticalPreparation(steps)).toMatchObject({
        gain: 400,
        target: 4,
        forced: false,
    });
    const result = classifyPositionTacticalMotifs({ fen, pvUci, rootCp: 575 });
    expect(result.motifs[0]).toMatchObject({
        id: "tacticalPreparation",
        ply: 1,
        confidence: "medium",
    });
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "skewer", ply: 5 }));
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "sacrifice", ply: 3, moveUci: "h5h7" }),
    );
    expect(result.timeline?.some((motif) => motif.id === "sacrifice" && motif.ply === 7)).toBe(
        false,
    );
    expect(result.motifs[0].evidence).toContain("threatens Rh7+");
    expect(result.motifs[0].evidence).toContain("not a forced reply sequence");
    expect(result.motifs.some((motif) => motif.id === "clearance" && motif.ply === 1)).toBe(false);
    expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])).toEqual({
        square: "b6",
        arrows: [{ from: "h5", to: "h7" }],
    });
});

test.each([undefined, -31, Number.NaN])(
    "conditional preparation needs a sound root evaluation (%s)",
    (rootCp) => {
        expect(classifyPositionTacticalMotifs({ fen, pvUci, rootCp }).motifs).toEqual([]);
    },
);

test("a real tactical defender defeats the cooperative queen-winning line", () => {
    const control = "3n4/4k3/7R/p3p2R/8/P6p/KP6/4q3 w - - 2 49";
    expect(replayTacticalLine(control, pvUci)).toHaveLength(7);
    expect(replayTacticalLine(control, [...pvUci.slice(0, 5), "d8b7"])).toHaveLength(6);
    expect(proveQuietTacticalPreparation(replayTacticalLine(control, pvUci))).toBeNull();
    expect(classifyPositionTacticalMotifs({ fen: control, pvUci, rootCp: 575 }).motifs).toEqual([]);
});

test("a checking line cannot substitute for proof against a different king defence", () => {
    proveQuietTacticalPreparation(replayTacticalLine(fen, pvUci));
    const alternative = ["h6b6", "e7d7", "h5h7", "d7c8", "b6b7", "e1h4", "h7h4"];
    expect(replayTacticalLine(fen, alternative)).toHaveLength(7);
    expect(proveQuietTacticalPreparation(replayTacticalLine(fen, alternative))).toBeNull();
});

test("a smaller proof budget cannot reuse the cached success", () => {
    const steps = replayTacticalLine(fen, pvUci);
    expect(proveQuietTacticalPreparation(steps)).not.toBeNull();
    expect(proveQuietTacticalPreparation(steps, 0)).toBeNull();
});

test("live tactics keeps the quiet root lesson and the skewer at its actual ply", () => {
    const scan = buildLiveTacticalScan({
        fen,
        pvUci,
        variations: [{ pvUci, cp: 575, depth: 16, multipv: 1 }],
        depth: 16,
        engineName: "Regression",
    });
    expect(scan.motifs[0]?.id).toBe("tacticalPreparation");
    expect(scan.labels[0]).toMatchObject({ square: "b6" });
    expect(scan.arrows).toContainEqual(expect.objectContaining({ from: "h5", to: "h7" }));
});

test("mistake review explains the missed preparation rather than only its final skewer", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "h6b6",
        playedMoveUci: "h5h3",
        pvUci,
        refutationUci: ["e1d2", "h3h1", "e5e4", "h6a6", "d2d5", "a2a1"],
        cpBefore: 575,
        cpAfter: 101,
        cpLoss: 474,
    });
    expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
        source: "missed",
        primary: { id: "tacticalPreparation", confidence: "medium" },
    });
    expect(result.missedTimeline).toContainEqual(expect.objectContaining({ id: "skewer", ply: 5 }));
});
