import type { Color } from "chessops";
import { match } from "ts-pattern";
import type { BestMoves, Score, ScoreValue } from "@/bindings";
import type { Annotation } from "./annotation";

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
    return clamp(
        103.1668 * Math.exp(-0.04354 * (getWinChance(prevCP) - getWinChance(nextCP))) - 3.1669 + 1,
        0,
        100,
    );
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
    const { prevCP, nextCP } = normalizeScores(prev, next, color);
    const delta = getWinningChances(prevCP) - getWinningChances(nextCP);

    if (delta >= 0.3) return "blunder";
    if (delta >= 0.2) return "mistake";
    if (delta >= 0.1) return "inaccuracy";
    return null;
}

export function getLichessGameAccuracy(
    centipawns: (number | null)[],
    startColor: Color,
): { white: number; black: number } | null {
    const allWinPercents = [15, ...centipawns].map((cp) => (cp === null ? null : getWinChance(cp)));
    if (allWinPercents.length < 3) return null;

    const windowSize = clamp(Math.floor(centipawns.length / 10), 2, 8);
    const usableWindowSize = Math.min(windowSize, allWinPercents.length);
    const windows: (number | null)[][] = [
        ...Array.from({ length: Math.max(0, usableWindowSize - 2) }, () =>
            allWinPercents.slice(0, usableWindowSize),
        ),
        ...slidingWindows(allWinPercents, usableWindowSize),
    ];
    const weights = windows.map((window) =>
        window.every((value): value is number => value !== null)
            ? clamp(standardDeviation(window), 0.5, 12)
            : null,
    );

    const samples: Record<Color, { accuracy: number; weight: number }[]> = {
        white: [],
        black: [],
    };

    for (let i = 0; i < allWinPercents.length - 1; i++) {
        const prev = allWinPercents[i];
        const next = allWinPercents[i + 1];
        const weight = weights[i];
        if (prev === null || next === null || weight === null) continue;

        const color: Color = (i % 2 === 0) === (startColor === "white") ? "white" : "black";
        const accuracy =
            color === "white"
                ? accuracyFromWinPercents(prev, next)
                : accuracyFromWinPercents(next, prev);
        samples[color].push({ accuracy, weight });
    }

    const white = colorAccuracy(samples.white);
    const black = colorAccuracy(samples.black);
    return white === null || black === null ? null : { white, black };
}

function accuracyFromWinPercents(before: number, after: number): number {
    if (after >= before) return 100;

    const winDiff = before - after;
    const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) + -3.166924740191411;
    return clamp(raw + 1, 0, 100);
}

function slidingWindows<T>(values: T[], size: number): T[][] {
    const windows: T[][] = [];
    for (let i = 0; i <= values.length - size; i++) {
        windows.push(values.slice(i, i + size));
    }
    return windows;
}

function standardDeviation(values: number[]): number {
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

function colorAccuracy(samples: { accuracy: number; weight: number }[]): number | null {
    if (samples.length === 0) return null;

    const weightedTotal = samples.reduce((sum, sample) => sum + sample.accuracy * sample.weight, 0);
    const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
    if (totalWeight <= 0) return null;

    const harmonic = samples.some((sample) => sample.accuracy <= 0)
        ? 0
        : samples.length / samples.reduce((sum, sample) => sum + 1 / sample.accuracy, 0);

    return (weightedTotal / totalWeight + harmonic) / 2;
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
    const { prevCP, nextCP } = normalizeScores(prev || { type: "cp", value: 0 }, next, color);
    const winChanceDiff = getWinChance(prevCP) - getWinChance(nextCP);

    if (winChanceDiff > 20) {
        return "??";
    }
    if (winChanceDiff > 10) {
        return "?";
    }
    if (winChanceDiff > 5) {
        return "?!";
    }

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
