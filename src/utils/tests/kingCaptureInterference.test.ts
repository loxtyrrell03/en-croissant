import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    proveKingCaptureInterference,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "6R1/5k2/8/5r1p/5p1K/5P2/6P1/8 w - - 10 50";
const line = ["g8g5", "f5f6", "h4h5"];

test("the real rook ending proves king-safe interference even without a continuation", () => {
    const root = replayTacticalLine(fen, line)[0];
    const failures: string[] = [];
    const proof = proveKingCaptureInterference(root, 4096, (reason) => failures.push(reason));
    expect(failures).toEqual([]);
    expect(proof).toMatchObject({ gain: 100 });
    expect(proof!.branches.map((b) => b.replySan)).toContain("Rxg5");
    expect(proof!.branches.find((b) => b.replySan === "Rxg5")).toMatchObject({
        answerSan: "Kxg5",
        continuation: expect.arrayContaining([
            expect.objectContaining({ replySan: "h4", answerSan: "Kxf4", gain: 100 }),
        ]),
    });
    if (process.env.TACTICAL_KING_INTERFERENCE_RECEIPT)
        writeFileSync(
            process.env.TACTICAL_KING_INTERFERENCE_RECEIPT,
            JSON.stringify(proof, null, 2),
            {
                flag: "wx",
            },
        );
    for (const pvUci of [[line[0]], line]) {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs.map((m) => m.id)).toEqual(["interference"]);
        expect(result.motifs[0]).toMatchObject({ ply: 1, value: 100 });
        expect(result.motifs[0].evidence).toContain("making the king's capture safe");
        expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])).toEqual({
            square: "g5",
            arrows: [
                { from: "f5", to: "g5" },
                { from: "h4", to: "h5" },
            ],
        });
    }
});

test.each([
    ["6R1/5k2/8/5r1p/5pbK/5P2/6P1/8 w - - 10 50", "a second guard still makes Kxh5 illegal"],
    [
        "6R1/5k2/7p/5r1p/5p1K/5P2/6P1/8 w - - 10 50",
        "hxg5 takes the blocking rook without allowing a king recapture",
    ],
    [
        "6R1/5k2/8/5r1p/7K/5P2/6P1/8 w - - 10 50",
        "Rxf3+ needs a different recovery, outside this king-capture proof",
    ],
    ["6R1/5k2/N7/5r1p/5p1K/5P2/6P1/8 w - - 10 50", "Rf6 then Rxa6 loses an off-square knight"],
    ["6R1/5k2/8/7p/5p1K/5P2/6P1/8 w - - 10 50", "the king capture was already safe"],
] as const)("the local certificate abstains when %s (%s)", (position, _reason) => {
    const steps = replayTacticalLine(position, [line[0]]);
    expect(steps).toHaveLength(1);
    expect(proveKingCaptureInterference(steps[0])).toBeNull();
});

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "invalid or incomplete budgets cannot reuse success: %s",
    (limit) => {
        const root = replayTacticalLine(fen, line)[0];
        expect(proveKingCaptureInterference(root)).not.toBeNull();
        expect(proveKingCaptureInterference(root, limit)).toBeNull();
    },
);

test("colour reflection preserves the same pawn-winning cause", () => {
    const parts = fen.split(" ");
    parts[0] = parts[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-z]/gi, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
    parts[1] = "b";
    const pvUci = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const result = classifyPositionTacticalMotifs({ fen: parts.join(" "), pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "interference", value: 100, ply: 1 });
});

test("missing Rg5 teaches the interference opportunity, not an imaginary loose rook", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "g8g7",
        pvUci: line,
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "interference", ply: 1 });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "interference",
        source: "missed",
    });
});

test("a knight can interfere with a bishop's pawn defence, not only a rook ray", () => {
    const position = "k7/8/5bN1/8/3pK3/3P4/8/8 w - - 0 1";
    const pvUci = ["g6e5", "f6e5", "e4e5", "a8b7", "e5d4"];
    const steps = replayTacticalLine(position, pvUci);
    expect(steps).toHaveLength(5);
    expect(proveKingCaptureInterference(steps[0])).toMatchObject({ gain: 100 });
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "interference", ply: 1 });
    expect(result.timeline?.find((m) => m.label === "Interference Payoff")).toMatchObject({
        ply: 5,
    });
});

test("an unsafe supplied continuation cannot borrow the correct branch's pawn payoff", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["g8g5", "f7f6", "h4h5", "f5g5"] });
    expect(result.motifs[0].id).toBe("interference");
    expect(result.timeline?.some((m) => m.label === "Interference Payoff")).toBe(false);
});

test("a reached pawn capture without its preparation history has no interference payoff badge", () => {
    expect(replayTacticalLine("8/5k2/5r2/6Rp/5p1K/5P2/6P1/8 w - - 12 51", ["h4h5"])).toHaveLength(
        1,
    );
    const result = classifyPositionTacticalMotifs({
        fen: "8/5k2/5r2/6Rp/5p1K/5P2/6P1/8 w - - 12 51",
        pvUci: ["h4h5"],
    });
    expect(result.timeline?.some((m) => m.label === "Interference Payoff") ?? false).toBe(false);
});

test.each([
    [line, 3],
    [["g8g5", "f5g5", "h4g5", "h5h4", "g5f4"], 5],
    [["g8g5", "f7f6", "g5f5", "f6f5", "h4h5"], 5],
] as const)("the pawn payoff belongs to its actual capture: %s", (pvUci, ply) => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [...pvUci] });
    expect(result.motifs.map((m) => m.id)).toEqual(["interference"]);
    expect(result.timeline?.map((m) => [m.label, m.ply])).toEqual([
        ["Interference", 1],
        ["Interference Payoff", ply],
    ]);
});
