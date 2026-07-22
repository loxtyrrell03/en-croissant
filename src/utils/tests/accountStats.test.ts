import { describe, expect, test } from "vitest";
import {
    getAccountStatsRatingBandComparisons,
    mapAccountRatingToLichess,
} from "@/utils/accountStats";

describe("account stats rating mapping", () => {
    test("keeps Lichess ratings on the Lichess scale", () => {
        expect(mapAccountRatingToLichess(1812, "lichess", "blitz")).toEqual({
            lichessRating: 1812,
            uncertainty: 0,
            source: "Lichess game ratings",
        });
    });

    test("maps Chess.com ratings with interpolated ChessGoals bands", () => {
        expect(mapAccountRatingToLichess(1500, "chesscom", "rapid")).toMatchObject({
            lichessRating: 1930,
            uncertainty: 100,
        });
        expect(mapAccountRatingToLichess(1050, "chesscom", "bullet")).toMatchObject({
            lichessRating: 1340,
            uncertainty: 120,
        });
    });

    test("compares the current Lichess band with adjacent rating bands", () => {
        const bands = getAccountStatsRatingBandComparisons(1812, "blitz");

        expect(bands.map((band) => band.id)).toEqual(["below", "current", "above"]);
        expect(bands[1]).toMatchObject({ min: 1700, max: 1899, center: 1800 });
        expect(bands[0].metrics.opening).toBeLessThan(bands[1].metrics.opening);
        expect(bands[2].metrics.endgame).toBeGreaterThan(bands[1].metrics.endgame);
    });
});
