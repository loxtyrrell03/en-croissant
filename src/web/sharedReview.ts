import { createEmptyCard } from "ts-fsrs";
import type { PhoneReviewCard } from "./mistakeReview";
import type { MistakeReviewDeck } from "@/utils/mistakeReview";
import type { Position } from "@/components/files/opening";

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
                ...c.tacticalClassification,
                playerName: c.player,
                playerColor: c.color,
                playedMoveSan: c.played,
                playedMoveUci: c.playedUci,
                bestMoveSan: c.bestSan,
                bestMoveUci: c.best,
                pvSan: c.pvSan,
                pvUci: c.pv,
                refutationSan: c.refutation,
                refutationUci: c.refutationUci,
                refutationCandidates: c.refutationCandidates,
                bestCandidates: c.bestCandidates,
                previousFen: c.previousFen,
                previousMoveUci: c.previousMoveUci,
                tacticalHistory: c.tacticalHistory,
                winProbabilityDrop: c.drop,
                // Phone chances are player-relative; saved review evaluations
                // are White-relative. Loss remains player-relative for both sides.
                cpPerspective: "white",
                cpBefore: chanceCp(c.before) * (c.color === "black" ? -1 : 1),
                cpAfter: chanceCp(c.after) * (c.color === "black" ? -1 : 1),
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

/** Repair only a legacy export matched to its authoritative phone card.
 * Unmarked standalone desktop records have an ambiguous origin: never flip
 * their signs merely because the player is Black. Marked records may contain
 * newer desktop analysis and must not be replaced by the original phone score.
 */
export function reconcileSharedReviewScores(fresh: Position, saved: Position) {
    const next = fresh.mistakeReview;
    const old = saved.mistakeReview;
    if (!next || !old || old.cpPerspective !== undefined || next.cpPerspective !== "white" ||
        !fresh.reviewKey?.startsWith("pc:") || fresh.reviewKey !== saved.reviewKey ||
        fresh.fen !== saved.fen || fresh.sideToMove !== saved.sideToMove ||
        next.playerColor !== old.playerColor || next.playerColor !== fresh.sideToMove ||
        !next.playedMoveUci || next.playedMoveUci !== old.playedMoveUci ||
        !next.bestMoveUci || next.bestMoveUci !== old.bestMoveUci ||
        fresh.answerUci !== saved.answerUci ||
        ![next.cpBefore, next.cpAfter, next.cpLoss].every(value => Number.isFinite(value))) return old;
    const changed = old.cpBefore !== next.cpBefore || old.cpAfter !== next.cpAfter || old.cpLoss !== next.cpLoss;
    // Matching moves alone do not prove that an unmarked saved evaluation is
    // the old export: the desktop may have reanalysed the same move. Recognize
    // only the original player's-score tuple, at its original export depth.
    const legacyBlackTuple = next.playerColor === "black" &&
        old.cpBefore === -next.cpBefore! && old.cpAfter === -next.cpAfter! && old.cpLoss === next.cpLoss &&
        (old.reachedDepth === undefined || old.reachedDepth === 16);
    if (changed && !legacyBlackTuple) return old;
    return {
        ...old,
        cpPerspective: next.cpPerspective,
        cpBefore: next.cpBefore,
        cpAfter: next.cpAfter,
        cpLoss: next.cpLoss,
        // Retain raw lines/history but require fresh classification against
        // the repaired inputs. Legacy motif getters do not gate by version,
        // so clear dependent badges as well as invalidating their judgments.
        ...(changed ? {
            allowedMotifs: [],
            missedMotifs: [],
            allowedTimeline: [],
            missedTimeline: [],
            motifClassifierVersion: undefined,
            natureClassifierVersion: undefined,
            natureMotifClassifierVersion: undefined,
        } : {}),
    };
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
