import { describe, expect, test } from "vitest";
import { positionSchema } from "@/components/files/opening";
import {
    classifyMistakeReviewNature,
    getMistakeReviewMotifBatch,
    getMistakeReviewMotifCounts,
    getMistakeReviewMotifs,
    migrateMistakeReviewDeckMotifClassifications,
} from "@/utils/mistakeReview";
import {
    classifyMistakeReviewMotifs,
    tacticalMotifPerspective,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import {
    captureAttractionIdeaFen,
    captureAttractionIdeaLine,
} from "@/utils/tests/fixtures/captureAttractionIdea";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "@/utils/tests/fixtures/mixedTargetFork";
import { createPhoneReviewCard } from "../mistakeReview";
import { parsePgnDatabase } from "../pgn";
import { reconcileSharedReviewScores, sharedReviewDeck } from "../sharedReview";

// The scores deliberately exercise relevance gates; they are controlled
// transport inputs, not an independent evaluation of these chess moves.
function phoneCard(reflected: boolean, playerCp: number, proved = false) {
    const base = proved ? captureAttractionIdeaFen.replace("np6", "n7") : captureAttractionIdeaFen;
    const fen = reflected ? reflectMixedForkFen(base) : base;
    const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
    const pv = captureAttractionIdeaLine.map(flip);
    const reply = [flip("b7c8")];
    const playedSteps = replayTacticalLine(fen, [flip("c1d2"), ...reply]);
    const bestSteps = replayTacticalLine(fen, pv);
    expect(playedSteps).toHaveLength(2);
    expect(bestSteps).toHaveLength(pv.length);
    const game = parsePgnDatabase("constructed-score-parity", [
        `[White "${reflected ? "Opponent" : "Tester"}"]`,
        `[Black "${reflected ? "Tester" : "Opponent"}"]`,
        '[Date "2026.10.02"]', '[SetUp "1"]', `[FEN "${fen}"]`, "",
        `1${reflected ? "..." : "."} ${playedSteps[0].san} *`,
    ].join("\n")).games[0];
    const sign = reflected ? -1 : 1;
    const after = playerCp > 0 ? 0 : -900;
    const engine = (uci: string[], san: string[], cp: number) => ({
        source: "stockfish" as const, depth: 18, multipv: 1,
        uciMoves: uci, sanMoves: san,
        score: { type: "cp" as const, value: sign * cp },
    });
    const card = createPhoneReviewCard(game, 0, "Tester",
        engine(pv, bestSteps.map(step => step.san), playerCp),
        engine(reply, [playedSteps[1].san], after), 1780000000000);
    expect(card).not.toBeNull();
    return { card: card!, before: sign * playerCp, after: sign * after, loss: playerCp - after };
}

describe.each([false, true])("shared export, reflected=%s", reflected => {
    test.each([300, -300])("preserves conditional primary and unknown nature at player cp %s", async playerCp => {
        const { card, before, after, loss } = phoneCard(reflected, playerCp);
        const deck = sharedReviewDeck([card]);
        const position = { ...deck.positions[0], mistakeReview: positionSchema.shape.mistakeReview.parse(
            JSON.parse(JSON.stringify(deck.positions[0].mistakeReview)),
        ) };
        const metadata = position.mistakeReview!;
        expect(metadata.cpPerspective).toBe("white");
        expect(metadata.cpBefore).toBeCloseTo(before);
        expect(metadata.cpAfter).toBeCloseTo(after);
        expect(metadata.cpLoss).toBe(loss);
        expect(metadata.winProbabilityDrop).toBe(card.drop);
        const fresh = classifyMistakeReviewMotifs({ fen: position.fen, ...metadata });
        const migrated = await migrateMistakeReviewDeckMotifClassifications({
            ...deck, positions: [{ ...position, mistakeReview: {
                ...metadata, motifClassifierVersion: "synthetic-old-classifier",
            } }],
        });
        const restored = migrated.deck.positions[0];
        for (const motifs of [card.tacticalClassification!.missedMotifs, fresh.missedMotifs,
            restored.mistakeReview!.missedMotifs!]) {
            expect(motifs.some(motif => motif.id === "attractionIdea")).toBe(playerCp > 0);
            const primary = motifs.find(motif => motif.relevance === "primary");
            expect(primary?.id).toBe(playerCp > 0 ? "attractionIdea" : undefined);
            expect(primary && tacticalMotifPerspective(primary)).toBe(playerCp > 0 ? "Conditional idea" : undefined);
        }
        expect(classifyMistakeReviewNature(position).nature).toBe("unknown");
        expect(classifyMistakeReviewNature(restored).nature).toBe("unknown");
        expect(restored.mistakeReview?.cpPerspective).toBe("white");
        expect(restored.card).toEqual(position.card);
    });

    test("preserves independently proved tactical nature through export and refresh", async () => {
        const { card } = phoneCard(reflected, 300, true);
        const deck = sharedReviewDeck([card]);
        const position = { ...deck.positions[0], mistakeReview: positionSchema.shape.mistakeReview.parse(
            JSON.parse(JSON.stringify(deck.positions[0].mistakeReview)),
        ) };
        expect(card.tacticalClassification?.missedMotifs[0]?.id).toBe("forkPreparation");
        position.mistakeReview!.motifClassifierVersion = "synthetic-old-classifier";
        const migrated = await migrateMistakeReviewDeckMotifClassifications({ ...deck, positions: [position] });
        expect(migrated.deck.positions[0].mistakeReview?.missedMotifs?.[0]?.id).toBe("forkPreparation");
        expect(classifyMistakeReviewNature(migrated.deck.positions[0]).nature).toBe("tactical");
    });
});

test("unmarked legacy metadata remains readable without inferring or flipping its score convention", () => {
    const legacy = { playerColor: "black", cpBefore: 300, cpAfter: 900, cpLoss: 600 };
    const restored = positionSchema.shape.mistakeReview.parse(legacy)!;
    expect(restored).toEqual(legacy);
    expect(restored.cpPerspective).toBeUndefined();
    expect(positionSchema.shape.mistakeReview.safeParse({ ...legacy, cpPerspective: "player" }).success).toBe(false);
});

test.each([300, -300])("matching legacy Black export refreshes dependent primary and nature at player cp %s", async playerCp => {
    const { card } = phoneCard(true, playerCp);
    const deck = sharedReviewDeck([card]);
    const fresh = deck.positions[0];
    const saved = { ...fresh, mistakeReview: {
        ...fresh.mistakeReview!, cpPerspective: undefined,
        cpBefore: -fresh.mistakeReview!.cpBefore!, cpAfter: -fresh.mistakeReview!.cpAfter!,
        nature: "tactical" as const, natureConfidence: "high" as const,
        natureClassifierVersion: 0, natureMotifClassifierVersion: "old-motif",
    } };
    // Reproduce the stale computed arrays, including the false idea created
    // by the old Black losing-score inversion; this is not a gold label.
    Object.assign(saved.mistakeReview, classifyMistakeReviewMotifs({ fen: saved.fen, ...saved.mistakeReview }));
    const repaired = { ...saved, mistakeReview: reconcileSharedReviewScores(fresh, saved) };
    expect(repaired.mistakeReview?.cpPerspective).toBe("white");
    expect(repaired.mistakeReview?.cpLoss).toBe(saved.mistakeReview.cpLoss);
    expect(repaired.mistakeReview?.motifClassifierVersion).toBeUndefined();
    expect(repaired.mistakeReview?.natureClassifierVersion).toBeUndefined();
    expect(repaired.mistakeReview?.natureMotifClassifierVersion).toBeUndefined();
    expect(getMistakeReviewMotifs(repaired)).toEqual([]);
    expect(getMistakeReviewMotifCounts([repaired])).toEqual({});
    expect(getMistakeReviewMotifBatch([repaired], "attractionIdea", { includeScheduled: true })).toEqual([]);
    expect(repaired.mistakeReview?.allowedTimeline).toEqual([]);
    expect(repaired.mistakeReview?.missedTimeline).toEqual([]);
    expect(repaired.mistakeReview?.pvUci).toEqual(saved.mistakeReview.pvUci);
    expect(repaired.mistakeReview?.refutationUci).toEqual(saved.mistakeReview.refutationUci);
    const migrated = await migrateMistakeReviewDeckMotifClassifications({ ...deck, positions: [repaired] });
    const restored = migrated.deck.positions[0];
    expect(restored.mistakeReview?.missedMotifs?.some(m => m.id === "attractionIdea")).toBe(playerCp > 0);
    expect(restored.mistakeReview?.nature).toBe("unknown");
    expect(classifyMistakeReviewNature(restored).nature).toBe("unknown");
});

test("an already White-relative desktop reanalysis is not replaced by the original phone scores", () => {
    const fresh = sharedReviewDeck([phoneCard(true, 300).card]).positions[0];
    const saved = { ...fresh, mistakeReview: { ...fresh.mistakeReview!, cpBefore: -425, cpAfter: -30 } };
    expect(reconcileSharedReviewScores(fresh, saved)).toBe(saved.mistakeReview);
});

test.each([16, 24])("an unmarked newer desktop evaluation at depth %s is not guessed to be a legacy export", reachedDepth => {
    const fresh = sharedReviewDeck([phoneCard(true, 300).card]).positions[0];
    const saved = { ...fresh, mistakeReview: {
        ...fresh.mistakeReview!, cpPerspective: undefined, cpBefore: -425, cpAfter: -30, reachedDepth,
    } };
    expect(reconcileSharedReviewScores(fresh, saved)).toBe(saved.mistakeReview);
});

test("a known opposite score tuple at a newer depth is not attributed to the legacy exporter", () => {
    const fresh = sharedReviewDeck([phoneCard(true, 300).card]).positions[0];
    const saved = { ...fresh, mistakeReview: {
        ...fresh.mistakeReview!, cpPerspective: undefined, cpBefore: 300, cpAfter: 0, reachedDepth: 24,
    } };
    expect(reconcileSharedReviewScores(fresh, saved)).toBe(saved.mistakeReview);
});

test("an already-correct unmarked tuple gets provenance without invalidating current judgments", () => {
    const fresh = sharedReviewDeck([phoneCard(true, 300).card]).positions[0];
    const saved = { ...fresh, mistakeReview: { ...fresh.mistakeReview!, cpPerspective: undefined } };
    expect(reconcileSharedReviewScores(fresh, saved)).toEqual(fresh.mistakeReview);
});
