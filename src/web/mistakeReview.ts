import type { WebColor, WebEngineLine, WebEngineScore, WebGame } from "./model";
import { normalizeWebFen } from "./pgn";
import { classifyMistakeReviewMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";

export const PHONE_REVIEW_VERSION = 1;
export const DAILY_REVIEW_LIMIT = 5;
const DAY = 86_400_000;
export type PhoneReviewCard = {
    id: string;
    gameKey: string;
    gameTitle: string;
    gameDate: string;
    player: string;
    fen: string;
    color: WebColor;
    ply: number;
    played: string;
    best: string;
    bestSan: string;
    pv: string[];
    pvSan: string[];
    refutation: string[];
    before: number;
    after: number;
    drop: number;
    explanation: string;
    createdAt: number;
    due: number;
    streak: number;
    reviews: number;
    lastReviewed?: number;
    hidden?: boolean;
};
export type PhoneReviewState = {
    version: 1;
    cards: PhoneReviewCard[];
    scanned: string[];
    player: string;
};
export const emptyPhoneReview = (): PhoneReviewState => ({
    version: 1,
    cards: [],
    scanned: [],
    player: "",
});
export function playerKey(name: string) {
    return name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .sort()
        .join(" ");
}
export function reviewGameKey(game: WebGame) {
    // Stable across repeated imports; comments/clock annotations are not game identity.
    const content = [
        playerKey(game.white),
        playerKey(game.black),
        game.date,
        game.moves[0]?.fenBefore,
        ...game.moves.map((m) => m.uci ?? m.san),
    ].join("|");
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++)
        hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
}
export function reviewScanKey(game: WebGame, player: string) {
    return `${PHONE_REVIEW_VERSION}:${reviewGameKey(game)}:${playerKey(player)}`;
}
export function reviewPlayerColor(game: WebGame, player: string): WebColor | null {
    const name = playerKey(player);
    if (!name) return null;
    const white = playerKey(game.white) === name,
        black = playerKey(game.black) === name;
    return white === black ? null : white ? "white" : "black";
}
export function reviewCp(score: WebEngineScore, color: WebColor) {
    const cp = score.type === "mate" ? (score.value >= 0 ? 10000 : -10000) : score.value;
    return cp * (color === "white" ? 1 : -1);
}
// An evaluation-derived winning-chance estimate, not a calibrated personal prediction.
export function reviewChance(cp: number) {
    return 100 / (1 + Math.exp(-0.00368208 * cp));
}
export function usefulReviewSwing(before: number, after: number) {
    return (
        Number.isFinite(before) &&
        Number.isFinite(after) &&
        before - after >= 12 &&
        before >= 15 &&
        after <= 85
    );
}
export function createPhoneReviewCard(
    game: WebGame,
    index: number,
    player: string,
    best: WebEngineLine,
    reply: WebEngineLine,
    now = Date.now(),
): PhoneReviewCard | null {
    const move = game.moves[index],
        color = reviewPlayerColor(game, player);
    if (
        !color ||
        move.color !== color ||
        !move.uci ||
        !best.uciMoves[0] ||
        best.uciMoves[0] === move.uci ||
        Math.min(best.depth, reply.depth) < 14
    )
        return null;
    const cpBefore = reviewCp(best.score, color),
        cpAfter = reviewCp(reply.score, color);
    const before = reviewChance(cpBefore),
        after = reviewChance(cpAfter);
    if (!usefulReviewSwing(before, after)) return null;
    const motifs = classifyMistakeReviewMotifs({
        fen: move.fenBefore,
        bestMoveUci: best.uciMoves[0],
        bestMoveSan: best.sanMoves[0],
        playedMoveUci: move.uci,
        playedMoveSan: move.san,
        pvUci: best.uciMoves,
        refutationUci: reply.uciMoves,
        cpBefore,
        cpAfter,
        cpLoss: cpBefore - cpAfter,
        winProbabilityDrop: before - after,
        reachedDepth: Math.min(best.depth, reply.depth),
    });
    const motif = motifs.allowedMotifs[0] ?? motifs.missedMotifs[0];
    const gameKey = reviewGameKey(game);
    return {
        id: `${gameKey}:${index}:${playerKey(player)}`,
        gameKey,
        gameTitle: `${game.white} – ${game.black}`,
        gameDate: game.date,
        player,
        fen: move.fenBefore,
        color,
        ply: index + 1,
        played: move.san,
        best: best.uciMoves[0],
        bestSan: best.sanMoves[0] ?? best.uciMoves[0],
        pv: best.uciMoves.slice(0, 8),
        pvSan: best.sanMoves.slice(0, 8),
        refutation: reply.sanMoves.slice(0, 6),
        before,
        after,
        drop: before - after,
        explanation: motif
            ? `${motif.label}: ${motif.evidence}`
            : `Keep the position's chances with ${best.sanMoves[0] ?? best.uciMoves[0]}. Compare the best line with the reply to ${move.san}.`,
        createdAt: now,
        due: now,
        streak: 0,
        reviews: 0,
    };
}
export function selectGameReviewCards(cards: PhoneReviewCard[]) {
    const chosen: PhoneReviewCard[] = [];
    for (const card of [...cards].sort((a, b) => b.drop - a.drop || a.ply - b.ply)) {
        if (
            chosen.some(
                (c) =>
                    Math.abs(c.ply - card.ply) < 4 ||
                    normalizeWebFen(c.fen) === normalizeWebFen(card.fen),
            )
        )
            continue;
        chosen.push(card);
        if (chosen.length === 3) break;
    }
    return chosen;
}
export function localReviewDay(now: number) {
    const d = new Date(now);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
export function selectDailyReview(cards: PhoneReviewCard[], now = Date.now(), player?: string) {
    const relevant = cards.filter((c) => !player || playerKey(c.player) === playerKey(player));
    const today = localReviewDay(now);
    const done = relevant.filter((c) => c.lastReviewed && localReviewDay(c.lastReviewed) === today);
    const remaining = Math.max(0, DAILY_REVIEW_LIMIT - done.length);
    const score = (c: PhoneReviewCard) =>
        c.drop +
        Math.max(
            0,
            20 - (now - (Date.parse(c.gameDate.replaceAll(".", "-")) || c.createdAt)) / DAY / 7,
        );
    const eligible = relevant.filter((c) => !c.hidden && c.due <= now && !done.includes(c));
    const due = eligible
        .filter((c) => c.reviews > 0)
        .sort((a, b) => a.due - b.due || score(b) - score(a));
    const fresh = eligible.filter((c) => c.reviews === 0).sort((a, b) => score(b) - score(a));
    const result: PhoneReviewCard[] = [];
    // Reserve two slots for new learning when available; overdue reviews cannot fill every day.
    const ordered = [...due.slice(0, 3), ...fresh.slice(0, 2), ...due.slice(3), ...fresh.slice(2)];
    const seen = new Set(done.map((c) => normalizeWebFen(c.fen)));
    for (const c of ordered) {
        if (result.length >= remaining) break;
        if (
            seen.has(normalizeWebFen(c.fen)) ||
            [...done, ...result].filter((p) => p.gameKey === c.gameKey).length >= 2
        )
            continue;
        result.push(c);
        seen.add(normalizeWebFen(c.fen));
    }
    return result;
}
export function gradePhoneReview(
    card: PhoneReviewCard,
    grade: "again" | "good" | "easy" | "hide",
    now = Date.now(),
): PhoneReviewCard {
    const streak = grade === "again" ? 0 : card.streak + (grade === "easy" ? 2 : 1);
    const days = grade === "again" ? 1 : [1, 3, 7, 14, 30, 60][Math.min(streak - 1, 5)];
    return {
        ...card,
        hidden: grade === "hide" || card.hidden,
        streak,
        reviews: card.reviews + 1,
        lastReviewed: now,
        due: now + days * DAY,
    };
}
