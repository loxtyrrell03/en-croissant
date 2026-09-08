import { readFileSync } from "node:fs";
import { parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import { checkingForkPreparationEscape, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    tacticalMotifPerspective,
} from "../tacticalMotifs/mistakeReviewAdapter";

// The frozen real Rc5 mistake: Ra5 Rb1+ Kf2 holds a draw; Rc5 permits
// Rb1+ Kf2 Nd3+ and loses the rook. No source puzzle tag is the oracle.
const fen = "8/7R/5kp1/4Rp2/5n2/7P/1r6/5K2 w - - 0 45";
const line = ["b2b1", "f1f2", "f4d3", "f2g3", "d3c5"];

test.each([line, ["b2b1"]])(
    "the real moved rook supplies a causal witness without borrowing a PV: %j",
    (...refutationUci) => {
        const result = classifyMistakeReviewMotifs({
            fen,
            playedMoveUci: "e5c5",
            bestMoveUci: "e5a5",
            pvUci: ["e5a5"],
            refutationUci,
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "forkPreparation",
            comparison: "prevented",
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Kf2 answers Rb1+");
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("rook on a5");
        expect(result.allowedTimeline?.[0].comparison).toBe("prevented");
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
            "Why the move was tactically bad",
        );
    },
);

test("the legal escape exists with Ra5, but not when the rook remains on the fork square", () => {
    const better = replayTacticalLine(fen, ["e5a5", "b2b1"])[1];
    const actual = replayTacticalLine(fen, ["e5c5", "b2b1"])[1];
    expect(checkingForkPreparationEscape(better, [parseSquare("a5")!])).toBe("Kf2");
    expect(checkingForkPreparationEscape(actual, [parseSquare("c5")!])).toBeNull();
    expect(replayTacticalLine(fen, ["e5a5", "b2b1", "f1f2", "f4d3", "f2g3", "d3a5"])).toHaveLength(
        5,
    );
});

test.each([0, -1, NaN, Infinity])(
    "an invalid escape budget cannot become evidence: %s",
    (budget) => {
        const better = replayTacticalLine(fen, ["e5a5", "b2b1"])[1];
        expect(checkingForkPreparationEscape(better, [parseSquare("a5")!], budget)).toBeNull();
    },
);

test("removing the fork does not certify safety when the same target can be captured", () => {
    const position = fen.replace("8/7R", "r7/7R");
    const better = replayTacticalLine(position, ["e5a5", "b2b1"])[1];
    expect(replayTacticalLine(position, ["e5a5", "b2b1", "f1f2", "a8a5"])).toHaveLength(4);
    expect(checkingForkPreparationEscape(better, [parseSquare("a5")!])).toBeNull();
});

test("a missing target cannot make the comparison vacuously safe", () => {
    const better = replayTacticalLine(fen, ["e5a5", "b2b1"])[1];
    expect(checkingForkPreparationEscape(better, [])).toBeNull();
    expect(checkingForkPreparationEscape(better, [parseSquare("a4")!])).toBeNull();
});

test("real frozen engine replies identify the same primary cause and keep later fork details", () => {
    const rows = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/causal-stockfish-18.json", "utf8"),
    );
    const row = rows.find(
        (item: { name: string }) =>
            item.name === "The real Rc5 mistake permits a checking fork preparation",
    );
    const result = classifyMistakeReviewMotifs({
        fen: row.fen,
        playedMoveUci: row.played,
        bestMoveUci: row.before[0].pvUci[0],
        pvUci: row.before[0].pvUci,
        refutationUci: row.after[0].pvUci,
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "forkPreparation",
        comparison: "prevented",
    });
    expect(result.allowedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
});

test("a real verified attack without causal proof stays visible without a false accusation", () => {
    const rows = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/causal-stockfish-18.json", "utf8"),
    );
    const row = rows.find(
        (item: { name: string }) =>
            item.name === "The real Qxd4 mistake allows the checking clearance",
    );
    const result = classifyMistakeReviewMotifs({
        fen: row.fen,
        playedMoveUci: row.played,
        bestMoveUci: row.before[0].pvUci[0],
        pvUci: row.before[0].pvUci,
        refutationUci: row.after[0].pvUci,
    });
    const explanation = buildMistakeReviewTacticalExplanation(result)!;
    expect(explanation.primary).toMatchObject({ id: "clearance", ply: 1 });
    expect(explanation.primary.comparison).toBeUndefined();
    expect(explanation.title).toBe("Tactic after the move");
    expect(explanation.text).toContain(
        "has not established whether the better move prevents or reduces it",
    );
    expect(tacticalMotifPerspective(explanation.primary)).toBe("Opponent tactic");
    expect(result.allowedTimeline?.length).toBeGreaterThan(0);
});
