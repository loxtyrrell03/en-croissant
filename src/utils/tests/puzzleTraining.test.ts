import { describe, expect, test } from "vitest";
import type { DailyGoal } from "@/state/atoms";
import {
    buildPuzzleTrendRows,
    getActivePuzzleGoals,
    puzzleNumber,
    rankPuzzleThemes,
} from "@/utils/puzzleTraining";

describe("puzzleTraining", () => {
    test("ranks weakest puzzle themes first by default", () => {
        const rows = [
            { attempts: BigInt(10), accuracy: 0.8, skill: 1600, weaknessScore: 20, recentAccuracy: 0.7 },
            { attempts: BigInt(4), accuracy: 0.4, skill: 1350, weaknessScore: 90, recentAccuracy: 0.5 },
            { attempts: BigInt(20), accuracy: 0.6, skill: 1450, weaknessScore: 50, recentAccuracy: 0.6 },
        ];

        expect(rankPuzzleThemes(rows, "weakness").map((row) => row.weaknessScore)).toEqual([
            90, 50, 20,
        ]);
    });

    test("ranks accuracy ties by larger sample", () => {
        const rows = [
            { attempts: BigInt(3), accuracy: 0.75, skill: 1500, weaknessScore: 10, recentAccuracy: 0.7 },
            { attempts: BigInt(18), accuracy: 0.75, skill: 1500, weaknessScore: 10, recentAccuracy: 0.7 },
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
            elo: 1513,
            attempts: 7,
            accuracy: 71,
            mastered: 2,
        });
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
