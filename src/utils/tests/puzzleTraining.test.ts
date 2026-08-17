import { describe, expect, test } from "vitest";
import type { DailyGoal } from "@/state/atoms";
import {
    buildPuzzleTrendRows,
    formatPuzzleEloChange,
    getActivePuzzleGoals,
    puzzleNumber,
    PUZZLE_SELECTION_MODE_GUIDE,
    rankPuzzleThemes,
} from "@/utils/puzzleTraining";

describe("puzzleTraining", () => {
    test("ranks weakest puzzle themes first by default", () => {
        const rows = [
            {
                attempts: BigInt(10),
                accuracy: 0.8,
                skill: 1600,
                weaknessScore: 20,
                recentAccuracy: 0.7,
            },
            {
                attempts: BigInt(4),
                accuracy: 0.4,
                skill: 1350,
                weaknessScore: 90,
                recentAccuracy: 0.5,
            },
            {
                attempts: BigInt(20),
                accuracy: 0.6,
                skill: 1450,
                weaknessScore: 50,
                recentAccuracy: 0.6,
            },
        ];

        expect(rankPuzzleThemes(rows, "weakness").map((row) => row.weaknessScore)).toEqual([
            90, 50, 20,
        ]);
    });

    test("ranks accuracy ties by larger sample", () => {
        const rows = [
            {
                attempts: BigInt(3),
                accuracy: 0.75,
                skill: 1500,
                weaknessScore: 10,
                recentAccuracy: 0.7,
            },
            {
                attempts: BigInt(18),
                accuracy: 0.75,
                skill: 1500,
                weaknessScore: 10,
                recentAccuracy: 0.7,
            },
        ];

        expect(puzzleNumber(rankPuzzleThemes(rows, "accuracy")[0].attempts)).toBe(18);
    });

    test("builds compact chart rows from dashboard trend points", () => {
        const rows = buildPuzzleTrendRows([
            {
                dateKey: "2026-06-02",
                puzzleElo: 1512.6,
                attempts: BigInt(7),
                accuracy: 0.714,
                mastered: BigInt(2),
            },
        ]);

        expect(rows[0]).toEqual({
            date: "2026-06-02",
            elo: 1512.6,
            attempts: 7,
            accuracy: 71,
            mastered: 2,
        });
    });

    test("formats signed whole-number Elo changes", () => {
        expect(formatPuzzleEloChange(10.4)).toBe("+10");
        expect(formatPuzzleEloChange(-6.6)).toBe("-7");
        expect(formatPuzzleEloChange(0)).toBe("0");
        expect(formatPuzzleEloChange(undefined)).toBe("-");
    });

    test("describes the simplified puzzle training modes", () => {
        expect(Object.keys(PUZZLE_SELECTION_MODE_GUIDE).sort()).toEqual(["manual", "smart"]);
        expect(PUZZLE_SELECTION_MODE_GUIDE.smart.purpose).toContain("SRS");
        expect(PUZZLE_SELECTION_MODE_GUIDE.smart.purpose).toContain("weaker themes");
        expect(PUZZLE_SELECTION_MODE_GUIDE.manual.purpose).toContain("rating every attempt");
    });

    test("filters active puzzle daily goals", () => {
        const goals: DailyGoal[] = [
            { id: "puzzles", kind: "puzzles", title: "Puzzles", enabled: true, target: 5 },
            {
                id: "disabled",
                kind: "puzzles",
                title: "Disabled",
                enabled: false,
                target: 5,
            },
            {
                id: "openings",
                kind: "opening-review",
                title: "Openings",
                enabled: true,
                target: 5,
            },
        ];

        expect(getActivePuzzleGoals(goals).map((goal) => goal.id)).toEqual(["puzzles"]);
    });
});
