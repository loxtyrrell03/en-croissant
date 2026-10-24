import { describe, expect, test } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { calculateExactSwissForecast } from "../exactSwissForecast";
import { calculatePairingForecast, formatForecastPercent } from "../pairingForecast";
import { estimatedAttendance, priorZeroPointAbsences, swissParticipationScenario } from "../swissParticipation";

function event(result: string | null = "0"): TournamentSnapshot {
  return {
    tournamentId: "participation-test", sourceUrl: "", title: "Open", section: null,
    format: "swiss", formatLabel: "Swiss-System", totalRounds: 5, completedRound: 1,
    publishedRound: 1, liveRound: null, nextRound: 2, phase: "between-rounds",
    dateRange: null, timeControl: null, sourceUpdatedAt: null, fetchedAt: "test", warnings: [],
    players: Array.from({ length: 5 }, (_, i) => ({ startNumber: i + 1, name: `Player ${i + 1}`, active: true,
      points: 0, rank: null, rating: 2000 - i * 20, fideId: null, federation: null, title: null })),
    pairings: [{ round: 1, board: 3, whiteStartNumber: 5, blackStartNumber: null,
      result, decided: result !== null, whitePoints: null, blackPoints: null }],
  };
}

describe("participation estimates from published history", () => {
  test("keeps source availability unchanged and the private scenario idempotent", () => {
    const s = event(), original = structuredClone(s), scenario = swissParticipationScenario(s, 2);
    expect(s).toEqual(original);
    expect(scenario.players[4].active).toBe(false);
    expect(swissParticipationScenario(s, 2)).toBe(scenario);
    expect(swissParticipationScenario(scenario, 2)).toBe(scenario);
    expect(estimatedAttendance(s, 5, 2)).toBeCloseTo(19 / 131);
  });
  test.each(["1", "1-0", "½", "1/2", null, "", "-"])("does not infer withdrawal from bye result %s", result => {
    const s = event(result);
    expect(priorZeroPointAbsences(s, 5, 2)).toBe(0);
    expect(swissParticipationScenario(s, 2)).toBe(s);
  });
  test("does not treat a played or forfeited loss, requested half bye or incomplete round as absence evidence", () => {
    for (const result of ["0-1", "--+"]) {
      const s = event(result); s.pairings[0].blackStartNumber = 1;
      expect(priorZeroPointAbsences(s, 5, 2)).toBe(0);
    }
    const half = event("½"); half.players[4].halfPointByeRounds = [1];
    expect(priorZeroPointAbsences(half, 5, 2)).toBe(0);
    const legacyHint = event(); legacyHint.players[4].halfPointByeRounds = [1];
    expect(priorZeroPointAbsences(legacyHint, 5, 2)).toBe(1);
    const incomplete = event(); incomplete.incompletePairingRounds = [1];
    expect(priorZeroPointAbsences(incomplete, 5, 2)).toBe(0);
  });
  test("requires positive absence evidence and ignores target/future information", () => {
    const s = event(); s.pairings = []; s.players[4].notPairedRounds = [2, 3];
    expect(priorZeroPointAbsences(s, 5, 2)).toBe(0);
    const legacy = { ...s, players: s.players.map(p => ({ ...p, notPairedRounds: [1, 2, 3] })) };
    expect(priorZeroPointAbsences(legacy, 5, 2)).toBe(0);
    const explicit: TournamentSnapshot = { ...legacy, evidenceVersion: 1,
      roundStatus: [{ round: 1, startNumber: 5, kind: "not-paired", award: 0 }] };
    expect(priorZeroPointAbsences(explicit, 5, 2)).toBe(1);
    expect(priorZeroPointAbsences({ ...explicit, pairings: [{ ...event("1").pairings[0], round: 3 }] }, 5, 2)).toBe(1);
  });
  test("resets the streak when play resumes and distinguishes repeated absences", () => {
    const s = event(); s.completedRound = 2; s.pairings.push({ ...s.pairings[0], round: 2 });
    expect(estimatedAttendance(s, 5, 3)).toBeCloseTo(4 / 345);
    const returned = { ...s, pairings: s.pairings.map((p, i) => i === 1 ? { ...p, blackStartNumber: 1, result: null, decided: false } : p) };
    expect(estimatedAttendance(returned, 5, 3)).toBe(1);
  });
  test("reserves no-opponent mass without confirming an inferred withdrawal", () => {
    const s = event();
    s.pairings.push(...[1, 3].map(number => ({ ...s.pairings[0], board: number,
      whiteStartNumber: number, blackStartNumber: number + 1, result: "1-0" })));
    const f = calculatePairingForecast(s, 5);
    expect(f.kind).toBe("estimated");
    expect(f.candidates).toHaveLength(4);
    expect(f.otherProbability).toBeGreaterThan(.85);
    expect(f.candidates.reduce((n, c) => n + c.probability!, f.otherProbability!)).toBeCloseTo(1);
    expect(f.caveat).toContain("not a confirmed withdrawal");
    const scheduled: TournamentSnapshot = { ...s, evidenceVersion: 1,
      roundStatus: [{ round: 2, startNumber: 5, kind: "not-paired", award: 0 }] };
    expect(calculatePairingForecast(scheduled, 5).kind).toBe("scheduled");
  });
  test("does not add another large-field solve scenario", () => {
    const s = event(); while (s.players.length < 121) s.players.push({ ...s.players[0], startNumber: s.players.length + 1 });
    expect(swissParticipationScenario(s, 2)).toBe(s);
  });
});

describe("bye scoring and truthful tiny percentages", () => {
  test.each(["1", "1-0", "1f", "+"])("credits a full-point bye written as %s and prevents a repeat bye", result => {
    const s = event(result); s.players = s.players.slice(0, 3); s.pairings[0].whiteStartNumber = 3;
    s.pairings.push({ ...s.pairings[0], board: 1, whiteStartNumber: 1, blackStartNumber: 2, result: "1-0" });
    expect(calculateExactSwissForecast(s, 2, 1)?.opponentStartNumber).toBe(3);
    expect(calculateExactSwissForecast(s, 2, 2)?.opponentStartNumber).toBeNull();
    expect(calculateExactSwissForecast(s, 2, 3)?.opponentStartNumber).toBe(1);
  });
  test("reads a Black-only full-point bye from its occupied seat", () => {
    const s = event("0-1"); s.players = s.players.slice(0, 3);
    s.pairings[0] = { ...s.pairings[0], whiteStartNumber: null, blackStartNumber: 3 };
    s.pairings.push({ ...s.pairings[0], board: 1, whiteStartNumber: 1, blackStartNumber: 2, result: "1-0" });
    expect(calculateExactSwissForecast(s, 2, 3)?.opponentStartNumber).toBe(1);
  });
  test("shows an interval for a positive estimate below one percent", () => {
    expect(formatForecastPercent(.0001)).toBe("<1%");
    expect(formatForecastPercent(.00999)).toBe("<1%");
    expect(formatForecastPercent(.01)).toBe("~1%");
    expect(formatForecastPercent(0)).toBe("--");
    expect(formatForecastPercent(NaN)).toBe("--");
  });
});
