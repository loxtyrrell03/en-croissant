import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { auditTacticalMotifs } from "../tacticalMotifs/causalTactics";
import { positionSchema } from "@/components/files/opening";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";

const fen = "3r1nk1/2q3p1/2nppb1p/8/2P1PPQ1/2N5/1B4PP/5R1K w - - 0 1";
const review = () =>
    classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "h2h3",
        bestMoveUci: "c3d5",
        pvUci: ["c3d5", "f6b2", "d5c7"],
        refutationUci: [],
    });
const opponent: TacticalMotifEvidence = {
    id: "hangingPiece",
    label: "Hanging Piece",
    confidence: "high",
    source: "allowed",
    ply: 1,
    moveUci: "f7g6",
    value: 900,
    comparison: "prevented",
    evidence: "The queen can be captured.",
};
const missed = (): TacticalMotifEvidence => ({ ...review().missedMotifs[0], source: "missed" });

test("a verified compound fork remains secondary without inflating its local value", () => {
    const fork = missed();
    expect(fork).toMatchObject({ id: "fork", value: 80, verifiedCombination: true });
    const explanation = buildMistakeReviewTacticalExplanation({
        allowedMotifs: [opponent],
        missedMotifs: [fork],
    });
    expect(explanation?.primary.id).toBe("hangingPiece");
    expect(explanation?.secondary).toMatchObject({ id: "fork", value: 80 });
    expect(explanation?.text).toContain("also missed a tactical opportunity");
});

test.each([
    { verifiedCombination: undefined },
    { value: 0 },
    { value: -80 },
    { value: undefined },
    { confidence: "low" as const },
    { confidence: "medium" as const },
    { ply: 3 },
    { id: "hangingPiece" },
])("metadata cannot promote weak, late, incidental or nonpositive lessons: %j", (change) => {
    const explanation = buildMistakeReviewTacticalExplanation({
        allowedMotifs: [opponent],
        missedMotifs: [{ ...missed(), ...change }],
    });
    expect(explanation?.primary.id).toBe("hangingPiece");
    expect(explanation?.secondary).toBeUndefined();
});

test("uncompared or pre-existing danger is not promoted into an additional cause", () => {
    for (const comparison of [undefined, "persists"] as const) {
        const explanation = buildMistakeReviewTacticalExplanation({
            allowedMotifs: [{ ...opponent, comparison }],
            missedMotifs: [missed()],
        });
        expect(explanation?.primary.source).toBe("missed");
        expect(explanation?.secondary).toBeUndefined();
    }
});

test("only one other significant lesson accompanies the primary", () => {
    const explanation = buildMistakeReviewTacticalExplanation({
        allowedMotifs: [opponent],
        missedMotifs: [
            missed(),
            { ...missed(), id: "forkPreparation", label: "Fork Preparation", value: 50 },
        ],
    });
    expect(explanation?.secondary).toBeDefined();
    expect(explanation?.text.match(/also missed/g)).toHaveLength(1);
});

test("two-minor preparation carries proof metadata rather than an inflated value", () => {
    const result = classifyPositionTacticalMotifs({
        fen: "2k5/1pq5/6Q1/P1n5/8/Rb6/5PPP/6K1 w - - 0 1",
        pvUci: ["a3b3"],
    });
    expect(result.motifs[0]).toMatchObject({
        id: "forkPreparation",
        value: 50,
        verifiedCombination: true,
    });
});

test("an exchange-for-pawn fork is also proof-backed, not an incidental small gain", () => {
    const result = classifyPositionTacticalMotifs({
        fen: "3qk2r/8/8/4N3/2BP4/8/PPP2PPP/R4RK1 w k - 0 1",
        pvUci: ["e5f7"],
    });
    expect(result.motifs[0]).toMatchObject({ id: "fork", value: 80, verifiedCombination: true });
    const explanation = buildMistakeReviewTacticalExplanation({
        allowedMotifs: [opponent],
        missedMotifs: [{ ...result.motifs[0], source: "missed" }],
    });
    expect(explanation?.secondary).toMatchObject({ id: "fork", value: 80 });
});

test("a supplied marker cannot turn an ordinary geometric fork into a proved combination", () => {
    const proposal: TacticalMotifEvidence = {
        ...missed(),
        moveUci: "e5f7",
        verifiedCombination: true,
    };
    const position = "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5";
    const result = auditTacticalMotifs(position, ["e5f7"], [proposal]);
    expect(result.find((m) => m.id === "fork")?.verifiedCombination).toBeUndefined();
    expect(proposal.verifiedCombination).toBe(true);
});

test("saving and restoring a review retains the proof-derived lesson marker", () => {
    const input = { ...review(), allowedMotifs: [opponent], missedMotifs: [missed()] };
    const restored = positionSchema.shape.mistakeReview.parse(JSON.parse(JSON.stringify(input)))!;
    expect(restored.missedMotifs?.[0].verifiedCombination).toBe(true);
    expect(
        buildMistakeReviewTacticalExplanation({
            allowedMotifs: restored.allowedMotifs!,
            missedMotifs: restored.missedMotifs!,
        })?.secondary?.id,
    ).toBe("fork");
    const legacy = { ...input, missedMotifs: [{ ...missed(), verifiedCombination: undefined }] };
    expect(positionSchema.shape.mistakeReview.safeParse(legacy).success).toBe(true);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "a queen blunder retains the significant missed compound fork",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 155);
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: "g4g6",
            bestMoveUci: row.sourceUci[0],
            pvUci: row.sourceUci,
            refutationUci: ["f7g6"],
        });
        const explanation = buildMistakeReviewTacticalExplanation(review);
        expect(explanation?.primary).toMatchObject({
            source: "allowed",
            id: "hangingPiece",
            comparison: "prevented",
        });
        expect(explanation?.secondary).toMatchObject({ source: "missed", id: "fork", value: 80 });
    },
);
