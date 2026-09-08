import { expect, test } from "vitest";
import { counterCaptureMaterialDefence, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

// Independently replay the newly identified defence. These branches are not
// an all-replies proof and must not alone certify a causal comparison.
const fen = "r5k1/5pp1/Br2p3/1PNpPb1q/3P4/4P1Q1/5K1P/6R1 b - - 6 32";

test("the better line has an independently checked countercapture defence", () => {
    const proof = counterCaptureMaterialDefence(replayTacticalLine(fen, ["f5g6", "c5d7"])[1]);
    expect(proof).toEqual({
        defence: "Rbxa6",
        defenceUci: "b6a6",
        checkingDefences: ["Nf6+ gxf6"],
    });
    expect(counterCaptureMaterialDefence(replayTacticalLine(fen, ["g7g6", "c5d7"])[1])).toBeNull();
});

test.each([["c5d7"], ["c5d7", "g8g7", "d7b6"]])(
    "the actual double threat has a causal defence, including a root-only input: %j",
    (...refutationUci) => {
        const result = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: "f5g6",
            playedMoveUci: "g7g6",
            pvUci: ["f5g6"],
            refutationUci,
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "doubleThreat",
            comparison: "prevented",
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Rbxa6");
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Nf6+ gxf6");
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
            "Why the move was tactically bad",
        );
    },
);

test.each([
    ["without the reserve rook", fen.replace("r5k1", "6k1")],
    [
        "without the bishop and b-pawn capture targets",
        fen.replace("Br2p3", "1r2p3").replace("1PNpPb1q", "2NpPb1q"),
    ],
    ["without the g7 defender", fen.replace("5pp1", "5p2")],
])("a materially different position cannot borrow the defence: %s", (_name, position) => {
    const line = replayTacticalLine(position, ["f5g6", "c5d7"]);
    expect(line).toHaveLength(2);
    expect(counterCaptureMaterialDefence(line[1])).toBeNull();
});

test("removing Ba6 also opens a different safe countercapture on b5", () => {
    const line = replayTacticalLine(fen.replace("Br2p3", "1r2p3"), ["f5g6", "c5d7"]);
    expect(counterCaptureMaterialDefence(line[1])?.defence).toBe("Rxb5");
});

test("a retained but pinned g7 pawn is not a legal checking-fork defence", () => {
    const root = replayTacticalLine(fen, ["f5e4", "c5d7"])[1];
    const fork = replayTacticalLine(fen, ["f5e4", "c5d7", "b6a6", "d7f6", "g7f6"]);
    expect(fork).toHaveLength(4);
    expect(counterCaptureMaterialDefence(root)).toBeNull();
});

test("colour reflection retains a legal countercapture and the causal lesson", () => {
    const reflected = "6r1/5k1p/4p1q1/3p4/1pnPpB1Q/bR2P3/5PP1/R5K1 w - - 6 32";
    const root = replayTacticalLine(reflected, ["f4g3", "c4d2"])[1];
    const proof = counterCaptureMaterialDefence(root);
    expect(proof).not.toBeNull();
    expect(proof?.checkingDefences).toContain("Nf3+ gxf3");
    const result = classifyMistakeReviewMotifs({
        fen: reflected,
        bestMoveUci: "f4g3",
        playedMoveUci: "g2g3",
        pvUci: ["f4g3"],
        refutationUci: ["c4d2"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "doubleThreat", comparison: "prevented" });
});

test.each([0, 1, -1, Infinity, NaN])(
    "invalid/exhausted countercapture budgets abstain: %s",
    (budget) => {
        expect(
            counterCaptureMaterialDefence(replayTacticalLine(fen, ["f5g6", "c5d7"])[1], budget),
        ).toBeNull();
    },
);

test("Bg6 keeps the legal pawn capture against Nd7's checking fork", () => {
    const defended = replayTacticalLine(fen, ["f5g6", "c5d7", "a8a6", "d7f6", "g7f6"]);
    const exposed = replayTacticalLine(fen, ["g7g6", "c5d7", "a8a6", "d7f6", "g7f6"]);
    expect(defended).toHaveLength(5);
    expect(defended[2].san).toBe("Raxa6");
    expect(defended[3].san).toBe("Nf6+");
    expect(defended[4].san).toBe("gxf6");
    expect(exposed).toHaveLength(4);
});

test("Raxa6 supplies compensation, but bxa6 Rxa6 still concedes 70 cp locally", () => {
    const pawn = replayTacticalLine(fen, ["f5g6", "c5d7", "a8a6", "b5a6", "b6a6"]);
    const knight = replayTacticalLine(fen, ["f5g6", "c5d7", "a8a6", "d7b6", "a6b6"]);
    expect(pawn).toHaveLength(5);
    expect(knight).toHaveLength(5);
    // Balance is from the initial side (Black); bishop/knight = 330/320 cp.
    expect(pawn[4].balance).toBe(-70);
    expect(knight[4].balance).toBe(150);
});

test("a later check without a fork does not erase the attacker's prior material concessions", () => {
    const line = replayTacticalLine(fen, [
        "f5g6",
        "c5d7",
        "b6a6",
        "g3g6",
        "f7g6",
        "g1g6",
        "h5g6",
        "d7f6",
        "g7f6",
        "e5f6",
    ]);
    expect(line).toHaveLength(10);
    expect(line[7].san).toBe("Nf6+");
    expect(line[8].san).toBe("gxf6");
    expect(line[9].san).toBe("exf6");
    expect(line[9].balance).toBe(1520);
});

test("a capturing root cannot borrow the quiet double-threat escape proof", () => {
    const root = replayTacticalLine(fen.replace("5pp1", "3p1pp1"), ["f5g6", "c5d7"])[1];
    expect(root.capture).toBe(100);
    expect(counterCaptureMaterialDefence(root)).toBeNull();
});

test("the checking fork remains a later event, not an extra root headline", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "f5g6",
        playedMoveUci: "g7g6",
        pvUci: ["f5g6"],
        refutationUci: ["c5d7", "b6b8", "d7f6", "g8h8", "f6h5"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "doubleThreat",
        ply: 1,
        comparison: "prevented",
    });
    expect(result.allowedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
    expect(result.allowedMotifs.some((motif) => motif.id === "fork" && motif.ply === 1)).toBe(
        false,
    );
});
