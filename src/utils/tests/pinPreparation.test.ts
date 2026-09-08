import { expect, test } from "vitest";
import {
    proveForcingClearance,
    proveQuietTacticalPreparation,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "@/utils/tacticalMotifs/causalTactics";
import { makeFen } from "chessops/fen";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

const fen = "2rr2k1/1p3pp1/4p3/p2pP1N1/1n1q4/1Q1B4/1P3P1P/5RK1 w - - 0 22";
const line = ["d3h7", "g8f8", "b3f3", "d8d7", "g5e6", "f8e7", "e6d4"];
test("Bh7+ clears a winning queen route against both legal king replies", () => {
    const proof = proveForcingClearance(replayTacticalLine(fen, line));
    expect(proof).toMatchObject({
        branches: [
            { reply: "Kf8", preparation: "Qf3" },
            { reply: "Kh8", preparation: "Qh3" },
        ],
    });
});

const alternative = [
    "d3h7",
    "g8h8",
    "b3h3",
    "d8d7",
    "h7g6",
    "h8g8",
    "g6f7",
    "d7f7",
    "h3h7",
    "g8f8",
    "g5e6",
    "f8e8",
    "e6d4",
];

test.each([line, alternative])(
    "clearance is primary and the selected queen route is drawn: %j",
    (...pvUci) => {
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(pvUci.length);
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "clearance", ply: 1, confidence: "high" });
        expect(result.motifs[0].evidence).toContain("Kf8 is met by Qf3; Kh8 is met by Qh3");
        const scan = buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Regression" });
        expect(scan.motifs[0].id).toBe("clearance");
        expect(scan.arrows.map((a) => `${a.from}${a.to}`)).toContain(pvUci[2]);
    },
);

test("the quiet pin and subsequent fork remain at their actual plies", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "pin", ply: 3, relevance: "secondary" }),
    );
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 5 }));
    const pin = result.timeline!.find((m) => m.id === "pin" && m.ply === 3)!;
    expect(result.timeline!.some((m) => m.id === "pin" && m.ply === 5)).toBe(false);
    expect(result.timeline!.find((m) => m.id === "fork" && m.ply === 5)?.evidence).toContain(
        "The pawn on f7 cannot capture on e6 because it is pinned to its king on f8.",
    );
    const fork = result.timeline!.find((m) => m.id === "fork" && m.ply === 5)!;
    expect(tacticalBoardEvidence(fen, line, fork)?.arrows).toEqual(
        expect.arrayContaining([
            { from: "e6", to: "d4" },
            { from: "e6", to: "f8" },
            { from: "f3", to: "f8" },
        ]),
    );
    expect(tacticalBoardEvidence(fen, line, pin)).toMatchObject({
        square: "f7",
        arrows: [
            { from: "f3", to: "f8" },
            { from: "g5", to: "e6" },
        ],
    });
});

test("the stationary queen participates in the other branch's discovered checking attack", () => {
    expect(
        proveQuietTacticalPreparation(replayTacticalLine(fen, alternative).slice(2)),
    ).toMatchObject({ forced: true });
});

test("a cooperative line cannot hide a bishop that captures the prepared queen", () => {
    const position = fen.replace("1n1q4", "1n1q2b1");
    const steps = replayTacticalLine(position, line);
    expect(steps).toHaveLength(7);
    expect(proveQuietTacticalPreparation(steps.slice(2))).toBeNull();
    expect(proveForcingClearance(steps)).toBeNull();
});

test("an unrelated pawn move cannot borrow a pin already on the board", () => {
    const position = replayTacticalLine(fen, line)[2].after.clone();
    position.turn = "white";
    const suffix = ["h2h3", ...line.slice(3)];
    const steps = replayTacticalLine(makeFen(position.toSetup()), suffix);
    expect(steps).toHaveLength(5);
    expect(proveQuietTacticalPreparation(steps)).toBeNull();
});

test("clearance and pin proofs abstain on exhausted budgets even after a cached success", () => {
    const steps = replayTacticalLine(fen, line);
    expect(proveForcingClearance(steps)).not.toBeNull();
    expect(proveForcingClearance(steps, 0)).toBeNull();
    expect(proveQuietTacticalPreparation(steps.slice(2))).not.toBeNull();
    expect(proveQuietTacticalPreparation(steps.slice(2), 0)).toBeNull();
});

test("a cleared queen route cannot borrow an already available rook attack", () => {
    const position = fen.replace("5RK1", "5RKR").replace("1P3P1P", "1P3P2");
    const steps = replayTacticalLine(position, line);
    expect(steps).toHaveLength(7);
    expect(proveForcingClearance(steps)).toBeNull();
});
test("Qf3's new pin enables the checking knight fork", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(7);
    expect(proveQuietTacticalPreparation(steps.slice(2))).toMatchObject({
        forced: true,
        pin: { pinner: 21, front: 53, rear: 61 },
    });
});
