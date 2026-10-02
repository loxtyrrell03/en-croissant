import { describe, expect, test } from "vitest";
import type { TournamentPairing } from "@/features/tournaments/platform";
import { trackerFixture } from "./trackerFixture";
import { publishedNoOpponentScore, hasUnscoredNoOpponentHistory } from "../publishedNoOpponentScore";
import { priorZeroPointAbsences, estimatedAttendance, swissParticipationScenario } from "../swissParticipation";
import { calculatePairingForecast } from "../pairingForecast";
import { calculateExactSwissForecast } from "../exactSwissForecast";

function snapshot(result: string | null = "1", black = false) {
  const s = structuredClone(trackerFixture().record.snapshot);
  Object.assign(s, { totalRounds: 5, completedRound: 0, publishedRound: 1, liveRound: 1, nextRound: 2, phase: "round-in-progress" });
  s.players = s.players.map(p => ({ ...p, rank: null, points: 0, notPairedRounds: [], halfPointByeRounds: [] }));
  const game = (white: number | null, black: number | null, result: string | null, board: number): TournamentPairing => ({ round: 1, board, whiteStartNumber: white, blackStartNumber: black, whitePoints: null, blackPoints: null, result, decided: true });
  s.pairings = [game(1, 4, "1-0", 1), game(2, 5, "½-½", 2), game(3, 6, "0-1", 3), { ...game(black ? null : 7, black ? 7 : null, result, 4), decided: false }];
  return s;
}

describe("published no-opponent score semantics", () => {
  test.each([false, true])("all explicit score forms read the occupied seat (Black: %s)", black => {
    for (const [value, points] of [["0", 0], ["0f", 0], ["½", .5], ["1/2", .5], ["0.5", .5], [".5", .5], ["1", 1], ["1f", 1], ["+", 1]] as const) {
      for (const result of [value, black ? `0-${value}` : `${value}-0`, black ? `--${value}` : `${value}--`]) {
        const s = snapshot(result, black), original = structuredClone(s);
        expect(publishedNoOpponentScore(s.pairings[3])).toBe(points);
        expect(priorZeroPointAbsences(s, 7, 2)).toBe(points === 0 ? 1 : 0);
        const equivalent = snapshot(points === 0 ? "0-0" : points === .5 ? "½-½" : black ? "0-1" : "1-0", black);
        equivalent.pairings[3].decided = true;
        for (const p of s.players) expect(calculatePairingForecast(s, p.startNumber)).toEqual(calculatePairingForecast(equivalent, p.startNumber));
        expect(s).toEqual(original);
      }
    }
  });

  test.each([null, "", "-", "--", "---", "?", "unknown", "2", "0.7", "1-?"])("unknown score %s cannot imply withdrawal or exact history", result => {
    const s = snapshot(result);
    expect(publishedNoOpponentScore(s.pairings[3])).toBeNull();
    expect(priorZeroPointAbsences(s, 7, 2)).toBe(0);
    expect(estimatedAttendance(s, 7, 2)).toBe(1);
    expect(swissParticipationScenario(s, 2)).toBe(s);
    expect(hasUnscoredNoOpponentHistory(s, 2)).toBe(true);
    expect(calculateExactSwissForecast(s, 2, 1)).toBeNull();
    const forecast = calculatePairingForecast(s, 1, { exactSwiss: { opponentStartNumber: 7, color: "white", system: "dutch", acceleration: null, estimatedLiveResults: false } });
    expect(forecast.kind).toBe("estimated");
    expect(forecast.candidates[0]?.reasons.some(reason => reason.startsWith("Whole-field"))).toBe(false);
    expect(forecast.caveat).toContain("pairing chances are unavailable");
    expect(forecast.candidates.every(candidate => candidate.probability === null)).toBe(true);
    expect(forecast.otherProbability).toBeNull();
    expect(forecast.confidence).toBe("unavailable");
  });

  test("unknown scores break an earlier absence streak and do not inspect future rounds", () => {
    const s = snapshot("0");
    s.pairings.push({ ...s.pairings[3], round: 2, result: "---" });
    expect(priorZeroPointAbsences(s, 7, 3)).toBe(0);
    expect(hasUnscoredNoOpponentHistory(s, 2)).toBe(false);
    expect(hasUnscoredNoOpponentHistory(s, 3)).toBe(true);
    expect(hasUnscoredNoOpponentHistory(s, 2)).toBe(false);
  });

  test("resolves when an immutable refresh supplies the missing score", () => {
    const s = snapshot(null), known = { ...s, pairings: s.pairings.map((g, i) => i === 3 ? { ...g, result: "1" } : g) };
    expect(calculateExactSwissForecast(s, 2, 1)).toBeNull();
    expect(calculateExactSwissForecast(known, 2, 1)).not.toBeNull();
    expect(hasUnscoredNoOpponentHistory(s, 2)).toBe(true);
    expect(hasUnscoredNoOpponentHistory(known, 2)).toBe(false);
  });

  test("keeps known half-point and full-point bye solver histories consistent across notation", () => {
    for (const black of [true, false]) for (const result of ["1", "½"]) {
      const scalar = snapshot(result, black), paired = snapshot(result === "½" ? "½-½" : black ? "0-1" : "1-0", black);
      for (const p of scalar.players) expect(calculateExactSwissForecast(scalar, 2, p.startNumber)).toEqual(calculateExactSwissForecast(paired, 2, p.startNumber));
    }
  });

  test("paired games, missing seats and published target assignments keep their own meaning", () => {
    const s = snapshot(null);
    expect(publishedNoOpponentScore(s.pairings[0])).toBeNull();
    expect(publishedNoOpponentScore({ ...s.pairings[3], whiteStartNumber: null })).toBeNull();
    s.nextRound = 1;
    expect(calculatePairingForecast(s, 7).summary).toBe("Round 1: no opponent assigned");
    expect(calculatePairingForecast(s, 1).kind).toBe("confirmed");
  });
});
