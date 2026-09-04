import { createEmptyCard } from "ts-fsrs";
import type { PhoneReviewCard } from "./mistakeReview";
import type { MistakeReviewDeck } from "@/utils/mistakeReview";

export const SHARED_REVIEW_NAME = "My online games";
export const SHARED_REVIEW_FILE = "My online games.mistake-review.json";
export const SHARED_REVIEW_SOURCE = "pc-online-review-v1";

export function isSharedReviewPath(path: string) {
    return path.replaceAll("\\", "/").endsWith(`/${SHARED_REVIEW_FILE}`);
}

export function sharedReviewDeck(
    cards: PhoneReviewCard[],
    enginePath = "",
    now = Date.now(),
): MistakeReviewDeck {
    return {
        version: 1,
        name: SHARED_REVIEW_NAME,
        source: SHARED_REVIEW_SOURCE,
        createdAt: Math.min(now, ...cards.map((c) => c.createdAt)),
        updatedAt: now,
        settings: {
            playerDb: "",
            playerId: 0,
            playerName: "My online accounts",
            enginePath,
            engineName: "Stockfish 18",
            analysisMode: "single",
            fastDepth: 16,
            deepDepth: 16,
            multiPv: 1,
            timeControls: [],
            dateRange: "all",
            thresholds: { inaccuracy: 50, mistake: 100, blunder: 200 },
            includeSeverities: { inaccuracy: true, mistake: true, blunder: true },
            minWinProbabilityDrop: 12,
            timeManagement: { enabled: false, minMoveSeconds: 20 },
        },
        daily: {
            reviewsPerDay: 5,
            newItemsPerDay: 2,
            gamePeriod: "all",
            minWinProbabilityDrop: 12,
            includeInaccuracies: true,
            includeMistakes: true,
            includeBlunders: true,
        },
        positions: cards.map((c) => ({
            fen: c.fen,
            answer: c.bestSan,
            answerUci: c.best,
            sideToMove: c.color,
            source: "Mistake Review",
            reviewKey: `pc:${c.id}`,
            importedAt: c.createdAt,
            priority: c.drop,
            tags: c.hidden ? ["Hidden"] : ["Mistake Review"],
            reason: c.explanation,
            evidence: `${c.gameTitle} · ${c.gameDate}`,
            card: {
                ...createEmptyCard(new Date(c.hidden ? "9999-01-01" : c.due)),
                reps: c.reviews,
                state: c.reviews ? 2 : 0,
                ...(c.lastReviewed ? { last_review: new Date(c.lastReviewed) } : {}),
            },
            mistakeReview: {
                playerName: c.player,
                playerColor: c.color,
                playedMoveSan: c.played,
                bestMoveSan: c.bestSan,
                bestMoveUci: c.best,
                pvSan: c.pvSan,
                pvUci: c.pv,
                refutationSan: c.refutation,
                winProbabilityDrop: c.drop,
                cpBefore: chanceCp(c.before),
                cpAfter: chanceCp(c.after),
                cpLoss: chanceCp(c.before) - chanceCp(c.after),
                severity: c.drop >= 25 ? "blunder" : "mistake",
                date: c.gameDate,
                ply: c.ply,
                moveNumber: Math.ceil(c.ply / 2),
                occurrenceCount: 1,
                engineName: "Stockfish 18",
                enginePath,
                reachedDepth: 16,
            },
        })),
        logs: [],
    };
}

function chanceCp(chance: number) {
    const bounded = Math.max(0.00001, Math.min(99.99999, chance));
    return Math.round(-Math.log(100 / bounded - 1) / 0.00368208);
}

// A stale device may update a review, but must not replace newly discovered cards.
export function mergeSharedProgress(
    cards: PhoneReviewCard[],
    incoming: MistakeReviewDeck,
): PhoneReviewCard[] {
    const positions = new Map(incoming.positions.map((p) => [p.reviewKey, p]));
    return cards.map((c) => {
        const p = positions.get(`pc:${c.id}`);
        if (!p) return c;
        const last = p.card.last_review ? new Date(p.card.last_review).getTime() : 0;
        const due = new Date(p.card.due).getTime();
        if (!Number.isFinite(last) || !Number.isFinite(due) || last <= (c.lastReviewed ?? 0))
            return c;
        return {
            ...c,
            lastReviewed: last,
            due,
            reviews: Math.max(c.reviews, p.card.reps),
            streak: Math.max(0, p.card.reps - p.card.lapses),
        };
    });
}
