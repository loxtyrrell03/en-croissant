import { createEmptyCard } from "ts-fsrs";
import { expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import {
    getMistakeReviewAllowedMotifs, getMistakeReviewMissedMotifs,
    getMistakeReviewMotifs, getMistakeReviewMotifCounts, getMistakeReviewMotifBatch,
    getMistakeReviewNature, migrateMistakeReviewDeckMotifClassifications,
    needsMistakeReviewDeckMotifMigration, type MistakeReviewDeck,
} from "../mistakeReview";
import {
    buildMistakeReviewTacticalExplanation, classifyMistakeReviewMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    staleDiscoveryInput, staleDiscoveryClassification, retainedForkInput, staleForkClassification,
} from "./fixtures/staleMotifSnapshots";

function deck(positions: Position[]): MistakeReviewDeck {
    return { version: 1, name: "Synthetic motif lifecycle", positions, logs: [], createdAt: 1, updatedAt: 1 } as unknown as MistakeReviewDeck;
}
function position(input = staleDiscoveryInput, classification = staleDiscoveryClassification): Position {
    return { fen: input.fen, answer: "", answerUci: input.bestMoveUci, reviewKey: "synthetic-stale-motif",
        comment: "Keep this annotation", card: { ...createEmptyCard(), reps: 3, due: new Date("2026-01-01") },
        mistakeReview: { ...input, ...classification } };
}
function explanation(card: Position) {
    return buildMistakeReviewTacticalExplanation({
        allowedMotifs: getMistakeReviewAllowedMotifs(card), missedMotifs: getMistakeReviewMissedMotifs(card),
    });
}

test.each([
    { id: "obsolete discovery", input: staleDiscoveryInput, old: staleDiscoveryClassification },
    { id: "already played fork", input: retainedForkInput, old: staleForkClassification },
])("$id cannot remain a current high-confidence accusation while migration is pending", ({ input, old }) => {
    expect(replayTacticalLine(input.fen, input.pvUci)).toHaveLength(input.pvUci.length);
    const card = position(input, old);
    expect(needsMistakeReviewDeckMotifMigration(deck([card]))).toBe(true);
    expect(getMistakeReviewMotifs(card)).toEqual([]);
    expect(getMistakeReviewMotifCounts([card])).toEqual({});
    expect(getMistakeReviewMotifBatch([card], old.missedMotifs[0].id, { includeScheduled: true })).toEqual([]);
    expect(explanation(card)).toBeNull();
    expect(getMistakeReviewNature(card)).toBe("unknown");
    expect(card.mistakeReview?.missedMotifs).toEqual(old.missedMotifs);
});

test.each([undefined, "", "site-55.adapter-9999", 170, null])("missing, malformed or future provenance abstains: %s", version => {
    const card = position();
    card.mistakeReview = { ...card.mistakeReview, motifClassifierVersion: version } as Position["mistakeReview"];
    expect(getMistakeReviewMotifs(card)).toEqual([]);
    expect(getMistakeReviewMotifCounts([card])).toEqual({});
    expect(getMistakeReviewMotifBatch([card], "discoveredAttack", { includeScheduled: true })).toEqual([]);
});

test("stale bulk counts and practice do not synchronously inspect FEN or continuation evidence", () => {
    const card = position();
    const rows = Array.from({ length: 1100 }, (_, index) => ({ ...card, reviewKey: `stale-${index}`,
        get fen(): string { throw Error("Bulk motif lookup must not classify"); },
        mistakeReview: { ...card.mistakeReview,
            get pvUci(): string[] { throw Error("Bulk motif lookup must not read a PV"); } },
    }));
    expect(getMistakeReviewMotifCounts(rows)).toEqual({});
    expect(getMistakeReviewMotifBatch(rows, "discoveredAttack", { includeScheduled: true })).toEqual([]);
});

test("migration removes the historically false discovery without converting empty proof into positional certainty", async () => {
    const old = position();
    const before = JSON.stringify(old);
    const result = await migrateMistakeReviewDeckMotifClassifications(deck([old]), { chunkSize: 1 });
    const current = result.deck.positions[0];
    expect(result.updatedCount).toBe(1);
    expect(getMistakeReviewMotifs(current)).toEqual([]);
    expect(explanation(current)).toBeNull();
    expect(getMistakeReviewNature(current)).toBe("unknown");
    expect(needsMistakeReviewDeckMotifMigration(result.deck)).toBe(false);
    expect(current.card).toBe(old.card);
    expect(current.comment).toBe(old.comment);
    expect(current.mistakeReview?.pvUci).toBe(old.mistakeReview?.pvUci);
    expect(JSON.stringify(old)).toBe(before);
});

test.each([false, true])("current fresh proof/context survives with optional timelines omitted=%s", omitTimelines => {
    const input = { ...retainedForkInput, playedMoveUci: "g1f1" };
    const classification = classifyMistakeReviewMotifs(input);
    const card = position(input, omitTimelines ? { ...classification, allowedTimeline: undefined, missedTimeline: undefined } : classification);
    expect(getMistakeReviewMissedMotifs(card)[0]).toMatchObject({ id: "fork", source: "missed", confidence: "high" });
    expect(getMistakeReviewMotifCounts([card]).fork.total).toBe(1);
    expect(getMistakeReviewMotifBatch([card], "fork", { includeScheduled: true })).toHaveLength(1);
    expect(explanation(card)?.title).toBe("What you missed: Fork");
    expect(needsMistakeReviewDeckMotifMigration(deck([card]))).toBe(false);
});

test("fresh migration restores neutral both-moves context, not the obsolete missed-fork wording", async () => {
    const old = position(retainedForkInput, staleForkClassification);
    const result = await migrateMistakeReviewDeckMotifClassifications(deck([old]));
    const current = result.deck.positions[0];
    expect(explanation(current)?.title).toBe("Both moves create this fork");
    expect(getMistakeReviewMissedMotifs(current)[0]).toMatchObject({ id: "fork", source: "available", comparison: "persists" });
    expect(getMistakeReviewNature(current)).toBe("unknown");
    expect(getMistakeReviewMotifCounts([current]).fork.total).toBe(1);
    expect(current.card).toBe(old.card);
});

test.each([
    ["allowedMotifs", undefined], ["missedMotifs", null], ["missedMotifs", [null]],
    ["allowedTimeline", "not-an-array"], ["missedTimeline", [{ ...staleDiscoveryClassification.missedMotifs[0], confidence: "certain" }]],
])("current version does not excuse an incomplete or malformed atomic record: %s", (field, value) => {
    const card = position();
    card.mistakeReview = { ...card.mistakeReview, motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION, [field]: value } as Position["mistakeReview"];
    expect(getMistakeReviewAllowedMotifs(card)).toEqual([]);
    expect(getMistakeReviewMissedMotifs(card)).toEqual([]);
    expect(needsMistakeReviewDeckMotifMigration(deck([card]))).toBe(true);
});
