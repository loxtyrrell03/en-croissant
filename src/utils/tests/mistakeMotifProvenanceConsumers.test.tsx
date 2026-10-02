import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptyCard } from "ts-fsrs";
import { expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import { TacticalLineExplanation } from "@/components/panels/tactics/TacticalLineExplanation";
import {
    getStoredMistakeReviewMotifClassification,
    getMistakeReviewAllowedMotifs, getMistakeReviewMissedMotifs,
    getMistakeReviewAllowedTimeline, getMistakeReviewMissedTimeline,
    getMistakeReviewMotifCounts, migrateMistakeReviewDeckMotifClassifications,
    needsMistakeReviewDeckMotifMigration, type MistakeReviewDeck,
} from "../mistakeReview";
import { classifyMistakeReviewMotifs, MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } from "../tacticalMotifs/mistakeReviewAdapter";
import { staleDiscoveryInput, staleDiscoveryClassification, retainedForkInput, staleForkClassification } from "./fixtures/staleMotifSnapshots";

function position(input = staleDiscoveryInput, classification = staleDiscoveryClassification): Position {
    return { fen: input.fen, answer: "", answerUci: input.bestMoveUci, card: createEmptyCard(),
        reviewKey: "synthetic-motif-consumer", mistakeReview: { ...input, ...classification } };
}
function deck(card: Position): MistakeReviewDeck {
    return { version: 1, name: "Synthetic motif consumer", positions: [card], logs: [], createdAt: 1, updatedAt: 1 } as unknown as MistakeReviewDeck;
}
function lineText(card: Position) {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<MantineProvider><TacticalLineExplanation
        moves={card.mistakeReview?.pvUci ?? []} motifs={getMistakeReviewMissedTimeline(card)}
    /></MantineProvider>);
    return container.textContent ?? "";
}

test("the actual timeline component cannot render a stale high-confidence discovery or its payoff", () => {
    const card = position();
    expect(getMistakeReviewMissedTimeline(card)).toEqual([]);
    expect(getMistakeReviewAllowedTimeline(card)).toEqual([]);
    expect(lineText(card)).not.toMatch(/Discovered Attack|Discovery Payoff|Every legal reply permits/);
});

test("after migration the retained fork timeline shows the current neutral comparison", async () => {
    const card = position(retainedForkInput, staleForkClassification);
    expect(lineText(card)).not.toMatch(/Fork Payoff|Ndf7 forks/);
    const migrated = (await migrateMistakeReviewDeckMotifClassifications(deck(card))).deck.positions[0];
    expect(lineText(migrated)).toContain("Ndf7 and Nhf7 both fork");
    expect(lineText(migrated)).toContain("does not establish that the moves are equally good");
    expect(getMistakeReviewMissedMotifs(migrated)[0]).toMatchObject({ source: "available", comparison: "persists" });
});

test("a current root-only record without optional timelines has a valid shared fallback", () => {
    const input = { ...retainedForkInput, playedMoveUci: "g1f1" };
    const current = classifyMistakeReviewMotifs(input);
    const card = position(input, { ...current, allowedTimeline: undefined, missedTimeline: undefined });
    expect(getStoredMistakeReviewMotifClassification(card.mistakeReview)).not.toBeNull();
    expect(getMistakeReviewMissedTimeline(card)).toEqual(getMistakeReviewMissedMotifs(card));
    expect(getMistakeReviewAllowedTimeline(card)).toEqual(getMistakeReviewAllowedMotifs(card));
    expect(lineText(card)).toContain("Ndf7 forks");
});

test("explicit empty current timelines do not resurrect root labels", () => {
    const input = { ...retainedForkInput, playedMoveUci: "g1f1" };
    const card = position(input, { ...classifyMistakeReviewMotifs(input), allowedTimeline: [], missedTimeline: [] });
    expect(getMistakeReviewMissedMotifs(card)).not.toEqual([]);
    expect(getMistakeReviewMissedTimeline(card)).toEqual([]);
});

test("a successful current empty record is known empty and is not migrated repeatedly", () => {
    const card = position(staleDiscoveryInput, classifyMistakeReviewMotifs(staleDiscoveryInput));
    expect(getStoredMistakeReviewMotifClassification(card.mistakeReview)).toMatchObject({ allowedMotifs: [], missedMotifs: [] });
    expect(needsMistakeReviewDeckMotifMigration(deck(card))).toBe(false);
    expect(lineText(card)).not.toContain("Discovered Attack");
});

test("invalid current timelines abstain atomically and migration can replace a same-version malformed record", async () => {
    const card = position();
    card.mistakeReview = { ...card.mistakeReview, motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        missedTimeline: [null] } as unknown as Position["mistakeReview"];
    expect(getMistakeReviewMissedMotifs(card)).toEqual([]);
    expect(getMistakeReviewMissedTimeline(card)).toEqual([]);
    const migrated = await migrateMistakeReviewDeckMotifClassifications(deck(card));
    expect(migrated.updatedCount).toBe(1);
    expect(needsMistakeReviewDeckMotifMigration(migrated.deck)).toBe(false);
    expect(getStoredMistakeReviewMotifClassification(migrated.deck.positions[0].mistakeReview)).not.toBeNull();
});

test("stored validation is reused but invalidates on immutable array replacement or version change", () => {
    const card = position(staleDiscoveryInput, classifyMistakeReviewMotifs(staleDiscoveryInput));
    const first = getStoredMistakeReviewMotifClassification(card.mistakeReview);
    expect(first).not.toBeNull();
    expect(getStoredMistakeReviewMotifClassification(card.mistakeReview)).toBe(first);
    card.mistakeReview!.missedMotifs = [...card.mistakeReview!.missedMotifs!];
    const replaced = getStoredMistakeReviewMotifClassification(card.mistakeReview);
    expect(replaced).not.toBe(first);
    expect(replaced).toEqual(first);
    card.mistakeReview!.motifClassifierVersion = "old";
    expect(getStoredMistakeReviewMotifClassification(card.mistakeReview)).toBeNull();
});

test("a failed asynchronous migration cannot bring the old labels back", async () => {
    const card = { ...position(), get fen(): string { throw Error("Unavailable synthetic input"); } };
    await expect(migrateMistakeReviewDeckMotifClassifications(deck(card))).rejects.toThrow("Unavailable synthetic input");
    expect(getMistakeReviewMotifCounts([card])).toEqual({});
    expect(getMistakeReviewMissedMotifs(card)).toEqual([]);
    expect(getMistakeReviewMissedTimeline(card)).toEqual([]);
});

test("prereveal/no-migration readers do not inspect continuation data even for a current root-only record", () => {
    const card = position(staleDiscoveryInput, classifyMistakeReviewMotifs(staleDiscoveryInput));
    card.mistakeReview = { ...card.mistakeReview,
        get pvUci(): string[] { throw Error("Stored-only lookup must not classify"); },
        get refutationUci(): string[] { throw Error("Stored-only lookup must not classify"); },
    };
    expect(getStoredMistakeReviewMotifClassification(card.mistakeReview)).not.toBeNull();
    expect(getMistakeReviewMissedMotifs(card)).toEqual([]);
    expect(getMistakeReviewMotifCounts([card])).toEqual({});
});
