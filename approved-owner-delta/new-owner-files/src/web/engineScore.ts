import type { WebColor, WebEngineScore } from "./model";

export function normalizeWebEngineScoreForWhite(
    score: WebEngineScore,
    sideToMove: WebColor,
): WebEngineScore {
    if (sideToMove === "white") return score;
    return { ...score, value: -score.value };
}

export function formatWebEngineScore(score: WebEngineScore) {
    if (score.type === "mate") {
        return `${score.value >= 0 ? "+" : "-"}M${Math.abs(score.value)}`;
    }
    const pawns = score.value / 100;
    return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}
