import { expect, test } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { calculatePairingForecast } from "../pairingForecast";
import { swissAccelerationPoints, accelerationVirtualPoints } from "../swissPairingSettings";

function fixture(): TournamentSnapshot {
  return {
    tournamentId: "rule-test", title: "Synthetic Open", sourceUrl: "https://chess-results.com/tnr1.aspx",
    format: "swiss", formatLabel: "Swiss-System", totalRounds: 9, nextRound: 1,
    completedRound: 0, publishedRound: 0, liveRound: null, phase: "registration",
    section: null, dateRange: null, timeControl: null, sourceUpdatedAt: null, fetchedAt: "test",
    warnings: [], pairings: [], roundStandings: [], incompletePairingRounds: [],
    players: Array.from({ length: 32 }, (_, i) => ({
      startNumber: i + 1, name: `Player ${i + 1}`, active: true, rating: 1800,
      points: 0, rank: null, fideId: null, federation: null, title: null,
    })),
  };
}

test("fallback pairing groups include declared acceleration without changing scores or probabilities", () => {
  const ordinary = fixture(), accelerated = { ...fixture(), formatLabel: "Swiss-System Baku" };
  const original = structuredClone(accelerated);
  const before = calculatePairingForecast(ordinary, 1), after = calculatePairingForecast(accelerated, 1);
  expect(before.candidates[0].player.startNumber).toBe(17);
  expect(after.candidates[0].player.startNumber).toBe(9);
  expect(after.candidates.map(c => c.probability)).toEqual(before.candidates.map(c => c.probability));
  expect(after.otherProbability).toBe(before.otherProbability);
  expect(after.candidates.every(c => c.player.points === 0)).toBe(true);
  expect(accelerated).toEqual(original);
});

test("only earlier published geometry can establish acceleration and the bonus expires", () => {
  const event = fixture();
  event.pairings = [0, 16].flatMap(offset => Array.from({ length: 8 }, (_, i) => ({
    round: 1, board: offset + i + 1, whiteStartNumber: offset + i + 1,
    blackStartNumber: offset + i + 9, result: null, decided: false, whitePoints: null, blackPoints: null,
  })));
  expect(swissAccelerationPoints(event, 1).size).toBe(0);
  expect(swissAccelerationPoints(event, 2).get(1)).toBe(1);
  expect(swissAccelerationPoints(event, 2).has(17)).toBe(false);
  expect(swissAccelerationPoints(event, 3).get(1)).toBe(0.5);
  expect(swissAccelerationPoints(event, 4).size).toBe(0);
  expect(swissAccelerationPoints({ ...event, pairings: event.pairings.map(p => ({ ...p, round: 8 })) }, 2).size).toBe(0);
  expect(Array.from({ length: 9 }, (_, i) => accelerationVirtualPoints("baku", i + 1, 9))).toEqual([1, 1, 1, 0.5, 0.5, 0, 0, 0, 0]);
});

test("published assignments override the projected acceleration groups", () => {
  const event = { ...fixture(), formatLabel: "Swiss-System Baku" };
  event.pairings = [{ round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: 32,
    result: null, decided: false, whitePoints: null, blackPoints: null }];
  expect(calculatePairingForecast(event, 1)).toMatchObject({
    kind: "confirmed", candidates: [{ player: { startNumber: 32 }, probability: 1 }],
  });
});

test("visible exclusions and sparse starting numbers preserve the full-roster acceleration boundary", () => {
  const event = { ...fixture(), formatLabel: "Swiss-System Baku" };
  event.players.forEach(p => { p.startNumber = 100 + p.startNumber * 3; });
  event.players[0].active = false;
  event.players.reverse();
  const points = swissAccelerationPoints(event, 1);
  expect([...points.keys()]).toEqual(Array.from({ length: 16 }, (_, i) => 103 + i * 3));
  expect(points.has(151)).toBe(false);
});
