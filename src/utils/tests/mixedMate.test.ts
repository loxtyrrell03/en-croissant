import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { proveCheckingMate, replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

const fen = "rnbqkbnr/pppp3p/5Pp1/3Q4/8/2N5/PP3PPP/R1B1KBNR w KQ - 2 10";
const pv = [
    "f6f7",
    "e8e7",
    "f7g8b",
    "h8g8",
    "f1c4",
    "f8g7",
    "d5f7",
    "e7d6",
    "c3e4",
    "d6c6",
    "f7d5",
    "c6b6",
    "d5b5",
];

test("the real f7+ mating attack survives quiet promotion and development", () => {
    const proof = proveCheckingMate(replayTacticalLine(fen, pv));
    expect(proof).toMatchObject({ maxMoves: 7 });
    const result = classifyPositionTacticalMotifs({ fen, pvUci: pv });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn7", ply: 1 });
    expect(result.timeline?.at(-1)?.ply).toBe(13);
    expect(result.timeline?.filter((motif) => motif.ply === 13).map((motif) => motif.id)).toEqual([
        "swallowstailMate",
    ]);
    expect(result.motifs.some((motif) => motif.id === "attacking_undefended_piece")).toBe(false);
});

test("a quiet-move mating proof cannot be borrowed by an exhausted search or incomplete line", () => {
    expect(proveCheckingMate(replayTacticalLine(fen, pv))).not.toBeNull();
    expect(proveCheckingMate(replayTacticalLine(fen, pv), 0)).toBeNull();
    expect(proveCheckingMate(replayTacticalLine(fen, pv.slice(0, 5)))).toBeNull();
});

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "even immediate mate cannot bypass an invalid proof budget: %s",
    (budget) => {
        const last = replayTacticalLine(fen, pv).at(-1)!;
        expect(proveCheckingMate([last], budget)).toBeNull();
    },
);

test("Ke8 is explained by allowing the mating attack, not a smaller material fork", () => {
    const classification = classifyMistakeReviewMotifs({
        fen: "rnbq1bnr/pppp1k1p/5Pp1/3Q4/8/2N5/PP3PPP/R1B1KBNR b KQ - 1 9",
        bestMoveUci: "f7f6",
        playedMoveUci: "f7e8",
        pvUci: ["f7f6"],
        refutationUci: pv,
        cpBefore: 690,
        cpAfter: 10000,
        cpLoss: 9310,
    });
    const explanation = buildMistakeReviewTacticalExplanation(classification);
    expect(explanation).toMatchObject({ source: "allowed", primary: { id: "mateIn7", ply: 1 } });
    expect(explanation?.text).toContain("f7+");
});

test.each(["q", "r", "n"])(
    "the displayed recapture erases promotion role %s, so underpromotion is not called necessary",
    (role) => {
        const alternative = pv.map((uci) => (uci === "f7g8b" ? `f7g8${role}` : uci));
        const steps = replayTacticalLine(fen, alternative);
        expect(steps).toHaveLength(13);
        expect(makeFen(steps[3].after.toSetup())).toBe(
            makeFen(replayTacticalLine(fen, pv)[3].after.toSetup()),
        );
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: pv }).timeline?.find(
                (motif) => motif.id === "underPromotion",
            )?.evidence,
        ).toBe("fxg8=B promotes the pawn to a bishop.");
    },
);

test("all legal replies to quiet development are tested, not just the displayed bishop move", () => {
    const defended = fen.replace("3Q4", "1p1Q4");
    const steps = replayTacticalLine(defended, pv);
    expect(steps).toHaveLength(13);
    expect(steps.at(-1)?.after.isCheckmate()).toBe(true);
    expect(replayTacticalLine(defended, [...pv.slice(0, 5), "b5c4"])).toHaveLength(6);
    expect(proveCheckingMate(steps)).toBeNull();
});

test("a legal capture of the checking pawn defeats the cooperative quiet-move line", () => {
    const defended = fen.replace("5Pp1", "5Ppn");
    const steps = replayTacticalLine(defended, pv);
    expect(steps).toHaveLength(13);
    expect(steps.at(-1)?.after.isCheckmate()).toBe(true);
    expect(replayTacticalLine(defended, ["f6f7", "h6f7"])).toHaveLength(2);
    expect(proveCheckingMate(steps)).toBeNull();
    expect(classifyPositionTacticalMotifs({ fen: defended, pvUci: pv }).motifs[0]?.id).not.toBe(
        "mateIn7",
    );
});
