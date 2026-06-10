import type { PuzzleTrainingMode } from "@/bindings";
import type { DailyGoal } from "@/state/atoms";

export type PuzzleThemeSort = "weakness" | "accuracy" | "skill" | "attempts" | "recent";

export type PuzzleThemeRankable = {
    attempts: bigint | number;
    accuracy: number;
    skill: number;
    weaknessScore: number;
    recentAccuracy: number;
};

export type PuzzleTrendLike = {
    dateKey: string;
    puzzleElo: number;
    attempts: bigint | number;
    accuracy: number;
    mastered: bigint | number;
};

export const PUZZLE_TRAINING_MODE_ORDER: PuzzleTrainingMode[] = [
    "coach",
    "srsReview",
    "themeFocus",
    "ratingLadder",
    "random",
];

export const PUZZLE_TRAINING_MODE_GUIDE: Record<
    PuzzleTrainingMode,
    { label: string; purpose: string }
> = {
    coach: {
        label: "Coach",
        purpose: "Chooses the next useful puzzle from due reviews, weak themes, and rating fit.",
    },
    srsReview: {
        label: "SRS",
        purpose: "Reviews puzzles that are due so failed or shaky patterns come back on schedule.",
    },
    themeFocus: {
        label: "Theme",
        purpose:
            "Trains the selected theme, falling back wider only when the filtered pool is empty.",
    },
    ratingLadder: {
        label: "Ladder",
        purpose: "Pushes puzzle difficulty upward from your current range or progressive setting.",
    },
    random: {
        label: "Random",
        purpose: "Samples any puzzle that matches the current rating and theme filters.",
    },
};

export function puzzleNumber(value: bigint | number | null | undefined) {
    if (value === null || value === undefined) return 0;
    return Number(value);
}

export function rankPuzzleThemes<T extends PuzzleThemeRankable>(
    rows: readonly T[],
    sort: PuzzleThemeSort | string | null,
) {
    const data = [...rows];
    switch (sort) {
        case "accuracy":
            return data.sort(
                (a, b) =>
                    b.accuracy - a.accuracy || puzzleNumber(b.attempts) - puzzleNumber(a.attempts),
            );
        case "skill":
            return data.sort((a, b) => b.skill - a.skill);
        case "attempts":
            return data.sort((a, b) => puzzleNumber(b.attempts) - puzzleNumber(a.attempts));
        case "recent":
            return data.sort((a, b) => b.recentAccuracy - a.recentAccuracy);
        default:
            return data.sort((a, b) => b.weaknessScore - a.weaknessScore);
    }
}

export function buildPuzzleTrendRows(points: readonly PuzzleTrendLike[]) {
    return points.map((point) => ({
        date: point.dateKey,
        elo: Number(point.puzzleElo.toFixed(1)),
        attempts: puzzleNumber(point.attempts),
        accuracy: Math.round(point.accuracy * 100),
        mastered: puzzleNumber(point.mastered),
    }));
}

export function formatPuzzleEloChange(value: number | null | undefined) {
    if (value === null || value === undefined || Number.isNaN(value)) return "-";
    const rounded = Math.round(value);
    if (rounded > 0) return `+${rounded}`;
    return rounded.toString();
}

export function getActivePuzzleGoals(goals: readonly DailyGoal[]) {
    return goals.filter((goal) => goal.enabled && goal.kind === "puzzles");
}
