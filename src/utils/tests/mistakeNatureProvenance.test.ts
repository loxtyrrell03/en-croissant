import { createEmptyCard } from "ts-fsrs";
import { expect, test } from "vitest";
import { positionSchema, type Position } from "@/components/files/opening";
import {
    classifyMistakeReviewNature,
    getMistakeReviewNature,
    getMistakeReviewNatureBatch,
    getMistakeReviewNatureConfidence,
    getMistakeReviewNatureCounts,
    getMistakeReviewNatureReason,
    migrateMistakeReviewDeckNatureClassifications,
    needsMistakeReviewDeckNatureMigration,
    type MistakeReviewDeck,
} from "../mistakeReview";
import { MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } from "../tacticalMotifs/mistakeReviewAdapter";

// These were all unresolved in the immutable adapter-168 provenance receipt.
// Kn14A now has an independent all-replies counterthreat proof; the other
// cases still lack one. Constructed played alternatives are not score gold.
const publicCases = [
    { id: "Kn14A", fen: "1k2b2R/2p5/Qp1p4/3Pp3/N3P3/PK3r2/1P6/1q6 w - - 15 40",
        bestMoveUci: "a4c3", playedMoveUci: "b3b4", pvUci: ["a4c3", "f3c3", "b3c3", "b1c1", "c3b3"], cpBefore: 487 },
    { id: "DVs4F", fen: "8/8/k2p4/pp1P4/P2K4/1P6/8/8 b - - 1 50",
        bestMoveUci: "a6b6", playedMoveUci: "a6a7", pvUci: ["a6b6", "a4b5", "b6b5"] },
    { id: "queen-ending promotion", fen: "Q7/4K3/2p5/2P1k3/8/8/3p4/8 b - - 0 53",
        bestMoveUci: "d2d1q", playedMoveUci: "e5d5", pvUci: ["d2d1q"] },
];
const quiet = {
    id: "quiet opening", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    bestMoveUci: "g1f3", playedMoveUci: "h2h3",
    pvUci: ["g1f3", "g8f6", "g2g3", "g7g6"],
    refutationUci: ["g8f6", "g1f3", "g7g6", "g2g3"],
    cpLoss: 60, winProbabilityDrop: 4, reachedDepth: 18,
};
function card(input = publicCases[0], metadata: Record<string, unknown> = {}): Position {
    return {
        fen: input.fen, answer: "", answerUci: input.bestMoveUci, reviewKey: input.id,
        card: createEmptyCard(), mistakeReview: { ...input, ...metadata },
    } as Position;
}
function deck(positions: Position[]): MistakeReviewDeck {
    // Nature migration only reads positions; no storage/settings API is used.
    return { version: 1, name: "Synthetic provenance regression", positions, logs: [], createdAt: 1, updatedAt: 1 } as unknown as MistakeReviewDeck;
}

test.each(publicCases)("fresh nature follows the available proof, not a frozen empty result: $id", input => {
    expect(classifyMistakeReviewNature(card(input))).toMatchObject(input.id === "Kn14A"
        ? { nature: "tactical", confidence: "high" }
        : { nature: "unknown", confidence: "low" });
});

test.each(publicCases)("stale positional metadata cannot override current evidence or practice routing: $id", input => {
    const position = card(input, { nature: "positional", natureConfidence: "high", natureClassifierVersion: 0 });
    const nature = input.id === "Kn14A" ? "tactical" : "unknown";
    expect(getMistakeReviewNature(position)).toBe(nature);
    expect(getMistakeReviewNatureConfidence(position)).toBe(input.id === "Kn14A" ? "high" : "low");
    expect(getMistakeReviewNatureReason(position)).toContain(input.id === "Kn14A" ? "blocks check" : "does not establish");
    expect(getMistakeReviewNatureCounts([position])[nature].total).toBe(1);
    expect(getMistakeReviewNatureBatch([position], "positional", { includeScheduled: true })).toEqual([]);
    expect(getMistakeReviewNatureBatch([position], nature, { includeScheduled: true })).toEqual([position]);
});

test.each([undefined, 3, 4, NaN, "4"])("missing, invalid or old dependency metadata cannot certify tactical nature: %s", version => {
    // DVs4F remains the unresolved control even after Kn14A gains a proof.
    const position = card(publicCases[1], {
        nature: "tactical", natureConfidence: "high", natureReason: "Old certainty", natureClassifierVersion: version,
        motifClassifierVersion: "site-55.adapter-166",
    });
    expect(getMistakeReviewNature(position)).toBe("unknown");
    expect(getMistakeReviewNatureConfidence(position)).toBe("low");
    expect(getMistakeReviewNatureReason(position)).not.toBe("Old certainty");
    expect(needsMistakeReviewDeckNatureMigration(deck([position]))).toBe(true);
});

test("opposite stale tactical label cannot erase a genuine quiet positional estimate", () => {
    const position = card(quiet, { nature: "tactical", natureConfidence: "high", natureClassifierVersion: 0 });
    expect(getMistakeReviewNature(position)).toBe("positional");
    expect(getMistakeReviewNatureConfidence(position)).toBe("medium");
    expect(getMistakeReviewNatureReason(position)).toContain("not proof that no deeper tactic exists");
});

test("large summary counts abstain for stale cards without needing synchronous classification", () => {
    const positions = Array.from({ length: 1001 }, (_, index) => card(publicCases[0], {
        nature: "positional", natureConfidence: "high", natureClassifierVersion: 0, occurrenceCount: index + 1,
    }));
    expect(getMistakeReviewNatureCounts(positions)).toMatchObject({
        positional: { total: 0 }, tactical: { total: 0 }, unknown: { total: 1001 },
    });
});

test("no migration or unavailable board still gives honest unknown rather than saved certainty", () => {
    const position = { ...card(publicCases[0], { nature: "positional", natureConfidence: "high" }), fen: "invalid" };
    expect(getMistakeReviewNature(position)).toBe("unknown");
    expect(getMistakeReviewNatureConfidence(position)).toBe("low");
});

test("migration stamps independent nature dependency provenance and round-trips without relabeling motif arrays", async () => {
    const original = card(quiet, { nature: "tactical", natureClassifierVersion: 4, motifClassifierVersion: "old-motifs" });
    const migrated = await migrateMistakeReviewDeckNatureClassifications(deck([original]));
    expect(migrated.updatedCount).toBe(1);
    const parsed = positionSchema.parse(JSON.parse(JSON.stringify(migrated.deck.positions[0])));
    const saved: Position = { ...card(quiet), mistakeReview: parsed.mistakeReview };
    expect(saved.mistakeReview).toMatchObject({
        nature: "positional", natureConfidence: "medium", natureClassifierVersion: 4,
        natureMotifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        motifClassifierVersion: "old-motifs",
    });
    expect(getMistakeReviewNature(saved)).toBe("positional");
    expect(needsMistakeReviewDeckNatureMigration(deck([saved]))).toBe(false);
    expect(original.mistakeReview?.nature).toBe("tactical");
});

test.each(["natureConfidence", "natureReason", "natureAspect", "tacticalSignals", "allowedNature", "missedNatureReason"])(
    "partial current metadata is never mixed with new evidence: %s", async field => {
        const migrated = await migrateMistakeReviewDeckNatureClassifications(deck([card(quiet)]));
        const position = migrated.deck.positions[0];
        const corrupted = { ...position, fen: "invalid", mistakeReview: { ...position.mistakeReview, [field]: undefined } };
        expect(getMistakeReviewNature(corrupted)).toBe("unknown");
        expect(getMistakeReviewNatureConfidence(corrupted)).toBe("low");
        expect(needsMistakeReviewDeckNatureMigration(deck([corrupted]))).toBe(true);
    },
);
