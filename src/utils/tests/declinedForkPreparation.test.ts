import { expect, test } from "vitest";
import { proveCaptureForkPreparation, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
const fen = "3r2k1/p4pp1/2Q2n1p/7q/8/3N4/2P2PPP/R3K3 b - - 0 1";
test("a checking decline can be answered without losing the prepared fork", () => {
    const errors: string[] = [];
    const proof = proveCaptureForkPreparation(replayTacticalLine(fen, ["d8d3"])[0], 8192, (r) =>
        errors.push(r),
    );
    expect({ proof, errors }).toMatchObject({ proof: expect.any(Object), errors: [] });
});
test("a valuable interposer can be taken by the checking queen's ally", () => {
    const steps = replayTacticalLine(fen, [
        "d8d3",
        "c6a8",
        "g8h7",
        "c2d3",
        "h5e5",
        "a8e4",
        "f6e4",
        "d3e4",
    ]);
    expect(steps).toHaveLength(8);
    expect(steps[5].after.isCheck()).toBe(true);
    expect(steps[7].balance).toBe(400);
    expect(proveCaptureForkPreparation(steps[0])?.declined).toContainEqual({
        reply: "Qa8+",
        answer: "Kh7",
        delayedForks: [{ acceptance: "cxd3", fork: "Qe5+" }],
    });
});
test("taking that protected interposer with the queen loses the intended gain", () => {
    const steps = replayTacticalLine(fen, [
        "d8d3",
        "c6a8",
        "g8h7",
        "c2d3",
        "h5e5",
        "a8e4",
        "e5e4",
        "d3e4",
    ]);
    expect(steps).toHaveLength(8);
    expect(steps[7].balance).toBe(-180);
});
test.each([fen.replace("2Q2n1p", "2Q2b1p"), fen.replace("p4pp1", "p4ppp")])(
    "missing allied capture or king flight prevents certification: %s",
    (position) => {
        expect(proveCaptureForkPreparation(replayTacticalLine(position, ["d8d3"])[0])).toBeNull();
    },
);
test("declining by capturing a knight permits a compensating pawn recapture", () => {
    const steps = replayTacticalLine(fen, ["d8d3", "c6f6", "g7f6", "c2d3"]);
    expect(steps).toHaveLength(4);
    expect(steps[3].balance).toBe(400);
    expect(proveCaptureForkPreparation(steps[0])?.declined).toContainEqual({
        reply: "Qxf6",
        answer: "gxf6",
    });
});
test("the headline explains preparation and does not move the later fork onto the current board", () => {
    const pvUci = ["d8d3", "c2d3", "h5e5", "e1d2", "e5a1"];
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
    expect(
        buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Constructed" }).arrows.map(
            (a) => a.from + a.to,
        ),
    ).toEqual(["d8d3"]);
});
test("a premature fork retains the missed preparation lesson", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "d8d3",
        playedMoveUci: "h5e5",
        pvUci: ["d8d3"],
        refutationUci: ["d3e5"],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
});
test("bounded budgets cannot borrow a successful proof", () => {
    const root = replayTacticalLine(fen, ["d8d3"])[0];
    expect(proveCaptureForkPreparation(root)).not.toBeNull();
    for (const limit of [0, -1, 1, 1.5, NaN, Infinity])
        expect(proveCaptureForkPreparation(root, limit)).toBeNull();
});
test("an unchanged prepared fork is not blamed on an unrelated pawn move", () => {
    const before = fen.replace("2P2PPP", "1PP2PPP").replace(" b ", " w ");
    const review = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "b2b4",
        playedMoveUci: "b2b3",
        pvUci: ["b2b4"],
        refutationUci: ["d8d3", "c2d3", "h5e5"],
    });
    expect(review.allowedMotifs[0]).toMatchObject({ id: "forkPreparation" });
    expect(review.allowedMotifs[0].comparison).not.toBe("prevented");
});
test("the same interposition mechanism survives colour reflection", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: ["d1d6"] }).motifs[0],
    ).toMatchObject({ id: "forkPreparation", ply: 1 });
});
