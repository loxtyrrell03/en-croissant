import { expect, test } from "vitest";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    tacticalMotifPerspective,
} from "../tacticalMotifs/mistakeReviewAdapter";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";

const fork: TacticalMotifEvidence = {
    id: "fork",
    label: "Fork",
    source: "missed",
    ply: 3,
    moveUci: "c5e5",
    confidence: "high",
    value: 500,
    evidence: "Qe5+ forks the king and rook.",
};
test("a future motif in the better line is not labelled a verified missed opportunity", () => {
    expect(tacticalMotifPerspective(fork)).toBe("Continuation idea");
    const explanation = buildMistakeReviewTacticalExplanation({
        allowedMotifs: [],
        missedMotifs: [fork],
    });
    expect(explanation?.title).toBe("Tactic in the better line");
    expect(explanation?.text).toContain("depends on the replies shown");
    expect(explanation?.text).not.toContain("The better move had this tactic");
    expect(explanation?.source).toBe("missed");
});
test("an immediate missed fork retains its clear missed-opportunity explanation", () => {
    const immediate = { ...fork, ply: 1 };
    expect(tacticalMotifPerspective(immediate)).toBe("Missed opportunity");
    expect(
        buildMistakeReviewTacticalExplanation({ allowedMotifs: [], missedMotifs: [immediate] })
            ?.title,
    ).toBe("What you missed: Fork");
});
test("a constructed legal continuation preserves the later fork without blaming the first move", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "2k4r/1p3p2/2p3q1/P1Q3p1/3R4/8/6B1/6K1 w - - 0 1",
        bestMoveUci: "g2h3",
        playedMoveUci: "a5a6",
        pvUci: ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "fork", ply: 3 });
    expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe("Tactic in the better line");
    expect(result.missedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
});
test("a verified immediate opponent threat outranks the conditional missed line", () => {
    const threat: TacticalMotifEvidence = {
        ...fork,
        id: "hangingPiece",
        label: "Hanging Piece",
        source: "allowed",
        ply: 1,
        value: 320,
        comparison: "prevented",
    };
    const result = buildMistakeReviewTacticalExplanation({
        allowedMotifs: [threat],
        missedMotifs: [fork],
    });
    expect(result?.primary.id).toBe("hangingPiece");
    expect(result?.secondary).toBeUndefined();
    expect(tacticalMotifPerspective(threat)).toBe("Overlooked threat");
});
test("a later opponent motif retains its existing neutral continuation wording", () => {
    const opponent = { ...fork, source: "allowed" as const };
    expect(
        buildMistakeReviewTacticalExplanation({ allowedMotifs: [opponent], missedMotifs: [] })
            ?.title,
    ).toBe("Tactic in the continuation");
});
test("the existing handling of verified mating consequences remains unchanged", () => {
    const mate = { ...fork, id: "mateIn2", label: "Mate in 2", value: 10000 };
    expect(tacticalMotifPerspective(mate)).toBe("Missed opportunity");
    expect(
        buildMistakeReviewTacticalExplanation({ allowedMotifs: [], missedMotifs: [mate] })?.title,
    ).toBe("What you missed: Mate in 2");
});
