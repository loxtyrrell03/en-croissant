import { createEmptyCard } from "ts-fsrs";
import { expect, test } from "vitest";
import { positionSchema } from "@/components/files/opening";
import { getMistakeReviewMissedMotifs, getMistakeReviewMissedTimeline } from "../mistakeReview";
import { classifyMistakeReviewMotifs, MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } from "../tacticalMotifs/mistakeReviewAdapter";

test("value-less mating deflection keeps its outcome dependency through save, parse and current-record readers", () => {
    const input = {
        fen: "1r3rk1/p1pn1ppp/b4b2/6q1/3PB3/1P2P2P/PBPN1P2/R2QK2R b KQ - 2 15",
        bestMoveUci: "g5e3", playedMoveUci: "g5h5", pvUci: ["g5e3", "f2e3", "f6h4"],
        refutationUci: ["a2a3"], cpBefore: -600, cpAfter: 0,
    };
    const classification = classifyMistakeReviewMotifs(input);
    const before = classification.missedMotifs.find(m => m.label === "Mating Deflection");
    expect(before).toMatchObject({ id: "deflection", outcome: "mate", verifiedCombination: true });
    expect(before?.value).toBeUndefined();
    const saved = JSON.stringify({ fen: input.fen, answer: "Qxe3+", answerUci: input.bestMoveUci,
        card: createEmptyCard(), comment: "Preserve annotation", mistakeReview: { ...input, ...classification } });
    const parsed = positionSchema.parse(JSON.parse(saved));
    const loaded = { fen: parsed.fen, answer: parsed.answer, card: createEmptyCard(), mistakeReview: parsed.mistakeReview };
    expect(parsed.mistakeReview?.motifClassifierVersion).toBe(MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION);
    expect(getMistakeReviewMissedMotifs(loaded).find(m => m.label === "Mating Deflection")).toEqual(before);
    expect(getMistakeReviewMissedTimeline(loaded).filter(m => m.outcome === "mate")).toEqual(
        classification.missedTimeline?.filter(m => m.outcome === "mate"));
    expect(parsed.comment).toBe("Preserve annotation");
});

test("unrecognized outcome dependency cannot pass the saved-record schema", () => {
    const raw = { fen: "8/8/8/8/8/8/K7/7k w - - 0 1", answer: "", card: createEmptyCard(),
        mistakeReview: { allowedMotifs: [], missedMotifs: [{ id: "deflection", label: "Invalid metadata",
            confidence: "high", evidence: "Synthetic invalid record", source: "missed", ply: 1,
            moveUci: "a2a3", outcome: "certain-win" }], motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } };
    expect(positionSchema.safeParse(raw).success).toBe(false);
});
