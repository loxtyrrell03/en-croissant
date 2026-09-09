import { expect, test } from "vitest";
import { parseSan } from "chessops/san";
import { attacks } from "chessops/attacks";
import { makeSquare } from "chessops/util";
import {
    capturePreparationAcceptanceDefence,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const before = "4k3/7r/8/8/6pN/4r1P1/6PK/5R2 w - - 0 1";
const line = ["h7h4", "g3h4", "g4g3", "h2g1", "g3f2", "g1f2"];

test("a safe acceptance after moving the target away refutes the pawn-fork preparation", () => {
    const actual = replayTacticalLine(before, ["f1f2", line[0]])[1];
    const better = replayTacticalLine(before, ["f1f4", line[0]])[1];
    expect(capturePreparationAcceptanceDefence(actual)).toBeNull();
    expect(capturePreparationAcceptanceDefence(better)).toMatchObject({ defence: "gxh4" });
    const review = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "f1f4",
        playedMoveUci: "f1f2",
        pvUci: ["f1f4"],
        refutationUci: line,
    });
    expect(review.allowedMotifs[0]).toMatchObject({
        id: "forkPreparation",
        comparison: "prevented",
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary.id).toBe("forkPreparation");
    expect(buildMistakeReviewTacticalExplanation(review)?.text).toContain("After Rf4, gxh4");
    expect(review.allowedTimeline?.some((m) => m.id === "fork" && m.ply === 3)).toBe(true);
    expect(review.allowedMotifs[0].comparisonEvidence).toContain("After Rf4, gxh4");
    expect(review.allowedMotifs[0].comparisonEvidence).toContain("g3+");
    expect(review.allowedMotifs[0].comparisonEvidence).toContain("g3+ Kh3");
    expect(review.allowedTimeline?.find((m) => m.id === "forkPreparation")?.comparison).toBe(
        "prevented",
    );
});

test.each([
    ["the capture already wins more than the offered piece", before.replace("6pN", "6pQ")],
    ["an off-square rook capture recovers the sacrifice", before.replace("4k3", "4kr2")],
    ["the accepting pawn is pinned to the king", before.replace("4k3", "1b2k3")],
    ["an immediate promotion remains", before.replace("6PK", "6pK")],
    [
        "a quiet knight fork still attacks two pieces",
        before.replace("6pN", "3n2pN").replace("5R2", "2B2R2"),
    ],
    ["acceptance counterchecks need a separate proof", before.replace("4k3/7r/8/8", "8/7r/8/6k1")],
])("do not certify acceptance when %s", (_name, fen) => {
    const steps = replayTacticalLine(fen, ["f1f4", line[0]]);
    expect(steps).toHaveLength(2);
    expect(capturePreparationAcceptanceDefence(steps[1])).toBeNull();
});

test("a still-exposed alternative rook cannot get a safety certificate", () => {
    const steps = replayTacticalLine(before, ["f1e1", line[0]]);
    expect(steps).toHaveLength(2);
    expect(capturePreparationAcceptanceDefence(steps[1])).toBeNull();
    const review = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "f1e1",
        playedMoveUci: "f1f2",
        pvUci: ["f1e1"],
        refutationUci: line,
    });
    expect(review.allowedMotifs[0].comparison).toBeUndefined();
});

test("the quiet-fork control is legal and really attacks both remaining pieces", () => {
    const fen = before.replace("6pN", "3n2pN").replace("5R2", "2B2R2");
    const steps = replayTacticalLine(fen, ["f1f4", "h7h4", "g3h4", "d4e2"]);
    expect(steps).toHaveLength(4);
    const fork = steps.at(-1)!;
    expect(fork.after.isCheck()).toBe(false);
    const piece = fork.after.board.get(fork.move.to)!;
    expect(
        [
            ...attacks(piece, fork.move.to, fork.after.board.occupied).intersect(
                fork.after.board.white,
            ),
        ]
            .map(makeSquare)
            .sort(),
    ).toEqual(["c1", "f4"]);
    // This geometric fork is not assumed profitable; it must be answered
    // before making a positive safety claim about accepting the offer.
});

test("no capture and promoting roots cannot enter the acceptance proof", () => {
    const quiet = replayTacticalLine(before, ["f1f4", "h7h5"])[1];
    expect(quiet).toBeDefined();
    expect(capturePreparationAcceptanceDefence(quiet)).toBeNull();
    const promoting = replayTacticalLine("7k/8/8/8/8/8/1p6/R5K1 b - - 0 1", ["b2a1q"])[0];
    expect(promoting).toBeDefined();
    expect(capturePreparationAcceptanceDefence(promoting)).toBeNull();
});

test("invalid/exhausted budgets abstain and cannot affect a later valid search", () => {
    const root = replayTacticalLine(before, ["f1f4", line[0]])[1];
    expect(capturePreparationAcceptanceDefence(root)).not.toBeNull();
    for (const limit of [0, -1, 1, 1.5, NaN, Infinity])
        expect(capturePreparationAcceptanceDefence(root, limit)).toBeNull();
    expect(capturePreparationAcceptanceDefence(root)).not.toBeNull();
});

test("choosing the same move cannot create a causal accusation", () => {
    const review = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "f1f2",
        playedMoveUci: "f1f2",
        pvUci: ["f1f2"],
        refutationUci: line,
    });
    expect(review.allowedMotifs[0]).toMatchObject({
        id: "forkPreparation",
        comparison: "persists",
    });
});

test("colour reflection preserves the constructive acceptance comparison", () => {
    const fields = before.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const reflect = (m: string) => m.replace(/[1-8]/g, (r) => String(9 - Number(r)));
    const review = classifyMistakeReviewMotifs({
        fen: fields.join(" "),
        bestMoveUci: reflect("f1f4"),
        playedMoveUci: reflect("f1f2"),
        pvUci: [reflect("f1f4")],
        refutationUci: line.map(reflect),
    });
    expect(review.allowedMotifs[0]).toMatchObject({
        id: "forkPreparation",
        comparison: "prevented",
    });
    expect(review.allowedMotifs[0].comparisonEvidence).toContain("After Rf5, gxh5");
});

test("a root-only refutation still names the actual preparation and its positive defence", () => {
    const review = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "f1f4",
        playedMoveUci: "f1f2",
        pvUci: ["f1f4"],
        refutationUci: [line[0]],
    });
    expect(review.allowedMotifs[0]).toMatchObject({
        id: "forkPreparation",
        comparison: "prevented",
        ply: 1,
    });
});

test("every displayed checking witness replays legally from the accepted offer", () => {
    const root = replayTacticalLine(before, ["f1f4", line[0]])[1];
    const proof = capturePreparationAcceptanceDefence(root)!;
    expect(proof.checkingDefences).toContain("g3+ Kh3");
    expect(proof.checkingDefences).toContain("Rh3+ gxh3 g3+ Kg1");
    for (const continuation of proof.checkingDefences) {
        const pos = root.after.clone();
        for (const san of [proof.defence, ...continuation.split(" ")]) {
            const move = parseSan(pos, san)!;
            expect(move).toBeDefined();
            expect(pos.isLegal(move)).toBe(true);
            pos.play(move);
        }
    }
});
