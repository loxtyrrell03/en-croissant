import type { Color } from "chessops";
import { match } from "ts-pattern";
import type { BestMoves, Score, ScoreValue } from "@/bindings";
import type { Annotation } from "./annotation";
import { accuracyWeights, gameAccuracy, moveAccuracy, winPercent } from "./gameAccuracy";

export const INITIAL_SCORE: Score = {
    value: {
        type: "cp",
        value: 15,
    },
    wdl: null,
};

const CP_CEILING = 1000;
const LICHESS_WIN_CHANCE_MULTIPLIER = -0.00368208;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function formatScore(score: ScoreValue, precision = 2): string {
    let scoreText = match(score.type)
        .with("cp", () => Math.abs(score.value / 100).toFixed(precision))
        .with("mate", () => `M${Math.abs(score.value)}`)
        .with("dtz", () => `DTZ${Math.abs(score.value)}`)
        .exhaustive();
    if (score.type !== "dtz") {
        if (score.value > 0) {
            scoreText = `+${scoreText}`;
        }
        if (score.value < 0) {
            scoreText = `-${scoreText}`;
        }
    }
    return scoreText;
}

export function getWinChance(centipawns: number) {
    return 50 + 50 * getWinningChances(centipawns);
}

export function getWinningChances(centipawns: number) {
    const cp = clamp(centipawns, -CP_CEILING, CP_CEILING);
    return clamp(2 / (1 + Math.exp(LICHESS_WIN_CHANCE_MULTIPLIER * cp)) - 1, -1, 1);
}

export function scoreValueToCentipawns(score: ScoreValue): number | null {
    if (!Number.isFinite(score.value)) return null;
    if (score.type === "cp") return clamp(score.value, -CP_CEILING, CP_CEILING);
    if (score.type === "mate") return CP_CEILING * Math.sign(score.value || 1);
    return null;
}

export function normalizeScore(score: ScoreValue, color: Color): number {
    let cp = scoreValueToCentipawns(score) ?? 0;
    if (color === "black") cp *= -1;
    return clamp(cp, -CP_CEILING, CP_CEILING);
}

function normalizeScores(
    prev: ScoreValue,
    next: ScoreValue,
    color: Color,
): { prevCP: number; nextCP: number } {
    return {
        prevCP: normalizeScore(prev, color),
        nextCP: normalizeScore(next, color),
    };
}

export function getAccuracy(prev: ScoreValue, next: ScoreValue, color: Color): number {
    const { prevCP, nextCP } = normalizeScores(prev, next, color);
    return moveAccuracy(prevCP, nextCP, true);
}

export function getCPLoss(prev: ScoreValue, next: ScoreValue, color: Color): number {
    const { prevCP, nextCP } = normalizeScores(prev, next, color);

    return Math.max(0, prevCP - nextCP);
}

export type LichessJudgement = "inaccuracy" | "mistake" | "blunder";

export function getLichessJudgement(
    prev: ScoreValue,
    next: ScoreValue,
    color: Color,
): LichessJudgement | null {
    if (!Number.isFinite(prev.value) || !Number.isFinite(next.value) || prev.type === "dtz" || next.type === "dtz") return null;
    const direction = color === "white" ? 1 : -1;
    if (prev.type === "cp" && next.type === "cp") {
        const loss = (winPercent(prev.value, false) - winPercent(next.value, false)) * direction;
        return loss >= 15 ? "blunder" : loss >= 10 ? "mistake" : loss >= 5 ? "inaccuracy" : null;
    }
    const losesMate = prev.type === "mate" && prev.value * direction > 0 && (next.type === "cp" || next.value * direction < 0);
    const allowsMate = prev.type === "cp" && next.type === "mate" && next.value * direction < 0;
    if (!losesMate && !allowsMate) return null;
    const remainingAdvantage = losesMate ? next.type === "cp" ? next.value * direction : 0 : -prev.value * direction;
    return remainingAdvantage > 999 ? "inaccuracy" : remainingAdvantage > 700 ? "mistake" : "blunder";
}

export function getLichessGameAccuracy(
    centipawns: (number | null)[],
    startColor: Color,
    initialCp: number | null = 15,
): { white: number | null; black: number | null } | null {
    const positions = [initialCp, ...centipawns];
    if (!centipawns.length || !positions.every((cp): cp is number => cp !== null && Number.isFinite(cp))) return null;
    const weights = accuracyWeights(positions);
    const samples: Record<Color, { accuracy: number; weight: number }[]> = {
        white: [],
        black: [],
    };

    for (let i = 0; i < centipawns.length; i++) {
        const color: Color = (i % 2 === 0) === (startColor === "white") ? "white" : "black";
        samples[color].push({ accuracy: moveAccuracy(positions[i], positions[i + 1], color === "white"), weight: weights[i] });
    }

    return { white: gameAccuracy(samples.white), black: gameAccuracy(samples.black) };
}

export function getAnnotation(
    prevprev: ScoreValue | null,
    prev: ScoreValue | null,
    next: ScoreValue,
    color: Color,
    prevMoves: BestMoves[],
    is_sacrifice?: boolean,
    move?: string,
): Annotation {
    const { nextCP } = normalizeScores(prev || { type: "cp", value: 0 }, next, color);
    const judgement = getLichessJudgement(prev || { type: "cp", value: 0 }, next, color);
    if (judgement) return { blunder: "??", mistake: "?", inaccuracy: "?!" }[judgement] as Annotation;

    if (prevMoves.length > 1) {
        const scores = normalizeScores(prevMoves[0].score.value, prevMoves[1].score.value, color);
        if (
            getWinChance(scores.prevCP) - getWinChance(scores.nextCP) > 10 &&
            move === prevMoves[0].sanMoves[0]
        ) {
            const scores = normalizeScores(
                prevprev || { type: "cp", value: 0 },
                prevMoves[0].score.value,
                color,
            );
            if (is_sacrifice) {
                return "!!";
            }
            if (getWinChance(scores.nextCP) - getWinChance(scores.prevCP) > 5) {
                return "!";
            }
        } else if (is_sacrifice && nextCP > -200) {
            return "!?";
        }
    }
    return "";
}
