import { describe, expect, test } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import {
  pairingScore,
  projectedSideFromHistory,
  standingsAfterRound,
  tournamentPlayerStats,
} from "../tournamentInsights";

const snapshot: TournamentSnapshot = {
  tournamentId: "1",
  sourceUrl: "https://chess-results.com/tnr1.aspx",
  title: "Club Open",
  section: null,
  format: "swiss",
  formatLabel: "Swiss-System",
  totalRounds: 3,
  completedRound: 2,
  publishedRound: 2,
  liveRound: null,
  nextRound: 3,
  phase: "between-rounds",
  dateRange: null,
  timeControl: null,
  sourceUpdatedAt: null,
  fetchedAt: "2026-08-10T00:00:00.000Z",
  warnings: [],
  players: [
    { startNumber: 1, name: "Alpha", fideId: "1", federation: "ENG", title: null, rating: 2200, rank: 1, points: 1.5, active: true },
    { startNumber: 2, name: "Beta", fideId: "2", federation: "SCO", title: null, rating: 2000, rank: 2, points: 1, active: true },
    { startNumber: 3, name: "Gamma", fideId: "3", federation: "WLS", title: null, rating: 2100, rank: 3, points: 0.5, active: true },
  ],
  pairings: [
    { round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: 2, whitePoints: 0, blackPoints: 0, result: "1-0", decided: true },
    { round: 2, board: 1, whiteStartNumber: 3, blackStartNumber: 1, whitePoints: 0.5, blackPoints: 1, result: "½-½", decided: true },
  ],
};

describe("tournament insights", () => {
  test("scores common result forms for either side", () => {
    expect(pairingScore(snapshot.pairings[0], "white")).toBe(1);
    expect(pairingScore(snapshot.pairings[0], "black")).toBe(0);
    expect(pairingScore(snapshot.pairings[1], "white")).toBe(0.5);
  });

  test("builds player form and performance stats through a selected round", () => {
    const stats = tournamentPlayerStats(snapshot, 1, 2);
    expect(stats.games.map((game) => game.result)).toEqual(["Draw", "Win"]);
    expect(stats.score).toBe(1.5);
    expect(stats.averageOpponent).toBe(2050);
    expect(stats.performanceRating).toBeGreaterThan(2200);
    expect(projectedSideFromHistory(snapshot, 1)).toBe("white");
  });

  test("reconstructs old standings when an organizer table is not cached", () => {
    const roundOne = standingsAfterRound(snapshot, 1);
    expect(roundOne.map((player) => [player.name, player.points, player.scoreKnown])).toEqual([
      ["Alpha", 1, true],
      ["Beta", 0, true],
      ["Gamma", 0, false],
    ]);
    expect(roundOne.every(player => player.rank === null)).toBe(true);
    const complete = { ...snapshot, pairings: [...snapshot.pairings,
      { ...snapshot.pairings[0], board: 2, whiteStartNumber: 3, blackStartNumber: null, result: "½" }] };
    expect(standingsAfterRound(complete, 1).map(player => [player.name, player.points, player.scoreKnown, player.rankSource])).toEqual([
      ["Alpha", 1, true, "reconstructed"], ["Gamma", .5, true, "reconstructed"], ["Beta", 0, true, "reconstructed"],
    ]);
  });

  test("uses organizer-published historical ranks when available", () => {
    const withHistory: TournamentSnapshot = {
      ...snapshot,
      evidenceVersion: 1,
      roundStandings: [
        {
          round: 1,
          players: [
            { ...snapshot.players[1], rank: 1, points: 1, scoreKnown: true, scoreRound: 1, scoreSource: "published" },
            { ...snapshot.players[0], rank: 2, points: 1, scoreKnown: true, scoreRound: 1, scoreSource: "published" },
          ],
        },
      ],
    };
    expect(standingsAfterRound(withHistory, 1).map((player) => player.name)).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
    ]);
    expect(standingsAfterRound(withHistory, 1).map(player => [player.rank, player.rankSource, player.scoreKnown])).toEqual([
      [1, "published", true], [2, "published", true], [null, "unknown", false],
    ]);
  });
});
