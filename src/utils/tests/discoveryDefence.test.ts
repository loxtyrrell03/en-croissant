import { expect, test } from "vitest";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { quietMaterialDefence, replayTacticalLine } from "../tacticalMotifs/causalTactics";

const fen = "2kr1br1/pp1n1p2/2p2p1p/q6b/2BpN3/P2Q1N1P/1PP2PP1/R3R1K1 w - - 0 15";
const reply = ["d7e5", "d3c3", "a5c3", "b2c3", "e5c4"];

test.each([reply, ["d7e5"]])(
    "Nh4 avoids the exposed knight and retains a defence to the other attacks: %j",
    (...refutationUci) => {
        const result = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: "f3h4",
            playedMoveUci: "f3d4",
            pvUci: ["f3h4"],
            refutationUci,
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "discoveredAttack",
            comparison: "prevented",
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Qb3");
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
            "Why the move was tactically bad",
        );
    },
);

test("the actual Qb3 defence still loses the knight, while the alternative has no Rxd4", () => {
    const actual = replayTacticalLine(fen, ["f3d4", "d7e5", "d3b3", "e5c4", "b3c4", "d8d4"]);
    const better = replayTacticalLine(fen, ["f3h4", "d7e5", "d3b3", "e5c4", "b3c4", "d8d4"]);
    expect(actual).toHaveLength(6);
    expect(actual[5].san).toBe("Rxd4");
    expect(better).toHaveLength(5);
    expect(better[4].after.board.get(27)?.role).toBe("pawn");
});

test("the bounded escape rejects the real forcing discovery but proves Qb3 after Nh4", () => {
    const actual = replayTacticalLine(fen, ["f3d4", "d7e5"])[1];
    const better = replayTacticalLine(fen, ["f3h4", "d7e5"])[1];
    expect(quietMaterialDefence(actual)).toBeNull();
    expect(quietMaterialDefence(better)).toBe("Qb3");
});

test("Qb3 also retains the concrete recapture against a checking fork", () => {
    const line = replayTacticalLine(fen, ["f3h4", "d7e5", "d3b3", "e5f3", "h4f3", "h5f3", "b3f3"]);
    expect(line).toHaveLength(7);
    expect(line[3].san).toBe("Nf3+");
    expect(line[4].san).toBe("Nxf3");
    expect(line[6].san).toBe("Qxf3");
});

test.each([0, 1, -1, Infinity, NaN])(
    "invalid or exhausted budgets never certify prevention: %s",
    (budget) => {
        const better = replayTacticalLine(fen, ["f3h4", "d7e5"])[1];
        expect(quietMaterialDefence(better, budget)).toBeNull();
    },
);

test("capturing the shared defender is not dismissed as an equal queen trade", () => {
    const line = replayTacticalLine(fen, ["f3d4", "d7e5", "d3c3", "a5c3", "b2c3", "e5c4"]);
    expect(line).toHaveLength(6);
    expect(line[5].san).toBe("Nxc4");
    expect(line[5].balance).toBeLessThan(-100);
});

test("Qc3 in the alternative position also loses the queen to the retained d-pawn", () => {
    const line = replayTacticalLine(fen, ["f3h4", "d7e5", "d3c3", "d4c3"]);
    expect(line).toHaveLength(4);
    expect(line[3].san).toBe("dxc3");
    expect(line[3].capture).toBe(900);
});

test("the reflected position keeps Black's queen defence and the same causal lesson", () => {
    const position = "r3r1k1/1pp2pp1/p2q1n1p/2bPn3/Q6B/2P2P1P/PP1N1P2/2KR1BR1 b - - 0 15";
    const result = classifyMistakeReviewMotifs({
        fen: position,
        bestMoveUci: "f6h5",
        playedMoveUci: "f6d5",
        pvUci: ["f6h5"],
        refutationUci: ["d2e4"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "discoveredAttack",
        comparison: "prevented",
    });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("Qb6");
});

test("a changed reply that now captures material is not waved away because its discovery vanished", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "f3e5",
        playedMoveUci: "f3d4",
        pvUci: ["f3e5"],
        refutationUci: ["d7e5"],
    });
    expect(result.allowedMotifs[0].id).toBe("discoveredAttack");
    expect(result.allowedMotifs[0].comparison).not.toBe("prevented");
});

test("an additional bishop attacking h4 prevents the claimed quiet defence", () => {
    const position = fen.replace("2p2p1p", "2p2b1p");
    const root = replayTacticalLine(position, ["f3h4", "d7e5"])[1];
    const capture = replayTacticalLine(position, ["f3h4", "d7e5", "d3b3", "f6h4"]);
    expect(capture).toHaveLength(4);
    expect(capture[3].san).toBe("Bxh4");
    expect(quietMaterialDefence(root)).toBeNull();
});
