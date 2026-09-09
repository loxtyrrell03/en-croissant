import { expect, test } from "vitest";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
    tacticalMotifPerspective,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { positionSchema } from "@/components/files/opening";

const fen = "3qk2r/p1ppppb1/8/4N3/2B5/8/5PPP/6RK b k - 0 1";

test("saved review retains the constructive acceptance comparison and actual-ply fork", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "4k3/7r/8/8/6pN/4r1P1/6PK/5R2 w - - 0 1",
        playedMoveUci: "f1f2",
        bestMoveUci: "f1f4",
        pvUci: ["f1f4"],
        refutationUci: ["h7h4", "g3h4", "g4g3", "h2g1", "g3f2", "g1f2"],
    });
    const restored = positionSchema.shape.mistakeReview.parse(JSON.parse(JSON.stringify(result)));
    expect(restored?.allowedMotifs?.[0]).toMatchObject({
        id: "forkPreparation",
        comparison: "prevented",
    });
    expect(restored?.allowedMotifs?.[0].comparisonEvidence).toContain("After Rf4, gxh4");
    expect(restored?.allowedTimeline?.some((m) => m.id === "fork" && m.ply === 3)).toBe(true);
});

test("keeping a fork's victims does not mean keeping the same material loss", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "g7h6",
        bestMoveUci: "a7a6",
        refutationUci: ["e5f7", "d8c8", "f7h8"],
        pvUci: ["a7a6", "e5f7", "d8c8", "f7h8", "g7h8"],
    });
    expect(result.allowedMotifs[0].id).toBe("fork");
    expect(result.allowedMotifs[0].comparison).toBe("reduced");
    expect(tacticalMotifPerspective(result.allowedMotifs[0])).toBe("More costly");
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("2.8 pawns rather than 6.0");
    expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
        "made an existing tactic more costly",
    );
    expect(result.allowedTimeline?.find((m) => m.ply === 1 && m.id === "fork")?.comparison).toBe(
        "reduced",
    );
    const restored = positionSchema.shape.mistakeReview.parse(JSON.parse(JSON.stringify(result)));
    expect(restored?.allowedMotifs?.[0].comparison).toBe("reduced");
});

test("the comparison's recapture is legal, and moving the bishop removes it", () => {
    const kept = replayTacticalLine(fen, ["a7a6", "e5f7", "d8c8", "f7h8", "g7h8"]);
    expect(kept).toHaveLength(5);
    expect(kept[4].san).toBe("Bxh8");
    expect(kept[4].balance).toBe(-280);
    const moved = replayTacticalLine(fen, ["g7h6", "e5f7", "d8c8", "f7h8", "h6h8"]);
    expect(moved).toHaveLength(4);
    expect(moved[3].balance).toBe(-600);
});

test("two choices that retain the same protection retain the existing fork verdict", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "a7a5",
        bestMoveUci: "a7a6",
        refutationUci: ["e5f7", "d8c8", "f7h8", "g7h8"],
        pvUci: ["a7a6", "e5f7", "d8c8", "f7h8", "g7h8"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "fork", comparison: "persists" });
    expect(tacticalMotifPerspective(result.allowedMotifs[0])).toBe("Existing danger");
});

test("moving the rook out of the two-target fork with castling actually prevents it", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "g7h6",
        bestMoveUci: "e8g8",
        pvUci: ["e8g8"],
        refutationUci: ["e5f7", "d8c8", "f7h8"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "fork", comparison: "prevented" });
    expect(tacticalMotifPerspective(result.allowedMotifs[0])).toBe("Overlooked threat");
});

test("the reflected f2 fork compares the same settled loss for the opposite colour", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "6rk/5ppp/8/2b5/4n3/8/P1PPPPB1/3QK2R w K - 0 1",
        playedMoveUci: "g2h3",
        bestMoveUci: "a2a3",
        refutationUci: ["e4f2", "d1c1", "f2h1"],
        pvUci: ["a2a3", "e4f2", "d1c1", "f2h1", "g2h1"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "fork", comparison: "reduced" });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("2.8 pawns rather than 6.0");
});

test("a known promotion-backed fork retains its existing-danger comparison", () => {
    const result = classifyMistakeReviewMotifs({
        fen: "8/2P4p/1n3k2/p7/P7/4NKp1/8/8 b - - 5 64",
        playedMoveUci: "h7h6",
        bestMoveUci: "h7h5",
        refutationUci: ["e3d5", "b6d5", "c7c8q"],
        pvUci: ["h7h5", "e3d5", "b6d5", "c7c8q"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "fork", comparison: "persists" });
});
