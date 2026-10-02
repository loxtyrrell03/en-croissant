import { describe, expect, test } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { calculatePairingForecast, formatForecastPercent } from "../pairingForecast";
import { calculateExactSwissForecast, type ExactSwissForecast } from "../exactSwissForecast";

function event(size: number): TournamentSnapshot {
  return {
    tournamentId: "synthetic-opening", sourceUrl: "", title: "Synthetic Open",
    section: "Open", format: "swiss", formatLabel: "Swiss-System", totalRounds: 5,
    completedRound: 0, publishedRound: 0, liveRound: null, nextRound: 1,
    phase: "registration", dateRange: null, timeControl: null, sourceUpdatedAt: null,
    fetchedAt: "2026-10-01T00:00:00Z", warnings: [], pairings: [],
    players: Array.from({ length: size }, (_, i) => ({
      startNumber: i + 1, name: `Player ${i + 1}`, fideId: null, federation: "WLS",
      title: null, rating: 2200 - i, rank: i + 1, points: 0, active: true,
    })),
  };
}

describe("truthful first-round probability contract", () => {
  test.each([2, 22, 120, 121, 174])("declines numeric chances across solver and fallback paths for %i entrants", size => {
    const snapshot = event(size), before = structuredClone(snapshot);
    for (const system of ["dutch", "burstein", "dubov", "lim"] as const) {
      const exact: ExactSwissForecast = { opponentStartNumber: size, color: "white", estimatedLiveResults: false, system, acceleration: null };
      for (const result of [null, exact]) {
        const forecast = calculatePairingForecast(snapshot, 1, { exactSwiss: result });
        expect(forecast.kind).toBe("estimated");
        expect(forecast.candidates.length).toBeGreaterThan(0);
        expect(forecast.candidates.every(c => c.probability === null)).toBe(true);
        expect(forecast.otherProbability).toBeNull();
        expect(forecast.confidence).toBe("unavailable");
        expect(forecast.caveat).toContain("not calibrated");
        expect(formatForecastPercent(forecast.candidates[0].probability)).toBe("Unknown");
        if (result) expect(forecast.candidates[0].player.startNumber).toBe(size);
      }
    }
    expect(snapshot).toEqual(before);
  });

  test("retains the solver's conditional opponent for every opening-round player without inventing confidence", () => {
    const snapshot = event(22);
    snapshot.evidenceVersion = 1;
    snapshot.roundStatus = [3, 14].map(startNumber => ({ round: 1, startNumber, kind: "not-paired", award: null }));
    snapshot.players[2].notPairedRounds = [1];
    snapshot.players[13].notPairedRounds = [1];
    for (const me of snapshot.players.filter(p => !p.notPairedRounds?.includes(1))) {
      const exact = calculateExactSwissForecast(snapshot, 1, me.startNumber);
      expect(exact?.opponentStartNumber).not.toBeNull();
      const forecast = calculatePairingForecast(snapshot, me.startNumber, { exactSwiss: exact });
      expect(forecast.candidates[0].player.startNumber).toBe(exact?.opponentStartNumber);
      expect(forecast.candidates[0].probability).toBeNull();
    }
  });

  test("uses forecast round rather than phase and keeps later-round numerical estimates", () => {
    const snapshot = event(22);
    snapshot.phase = "between-rounds";
    expect(calculatePairingForecast(snapshot, 1).otherProbability).toBeNull();
    snapshot.nextRound = 2;
    snapshot.completedRound = 1;
    snapshot.publishedRound = 1;
    snapshot.pairings = Array.from({ length: 11 }, (_, i) => ({ round: 1, board: i + 1,
      whiteStartNumber: i + 1, blackStartNumber: i + 12, whitePoints: 0, blackPoints: 0, result: "½-½", decided: true }));
    const later = calculatePairingForecast(snapshot, 1);
    expect(later.candidates.every(c => typeof c.probability === "number")).toBe(true);
    expect(later.otherProbability).not.toBeNull();
    expect(later.candidates.reduce((sum, c) => sum + c.probability!, later.otherProbability!)).toBeCloseTo(1);
  });

  test("published opponents and byes remain authoritative in round one", () => {
    const snapshot = event(22);
    snapshot.pairings = [{ round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: 22, whitePoints: 0, blackPoints: 0, result: null, decided: false }];
    const published = calculatePairingForecast(snapshot, 1);
    expect(published.kind).toBe("confirmed");
    expect(published.candidates[0].probability).toBe(1);
    expect(published.otherProbability).toBe(0);
    snapshot.pairings[0] = { ...snapshot.pairings[0], blackStartNumber: null, result: "½" };
    expect(calculatePairingForecast(snapshot, 1)).toMatchObject({ kind: "confirmed", candidates: [], summary: "Round 1 half-point bye published" });
    snapshot.pairings = [];
    snapshot.players[0].notPairedRounds = [1];
    snapshot.players[0].halfPointByeRounds = [1];
    expect(calculatePairingForecast(snapshot, 1)).toMatchObject({ kind: "unavailable", candidates: [] });
    const explicit: TournamentSnapshot = { ...snapshot, evidenceVersion: 1,
      roundStatus: [{ round: 1, startNumber: 1, kind: "not-paired", award: 0.5 }] };
    expect(calculatePairingForecast(explicit, 1)).toMatchObject({ kind: "scheduled", candidates: [] });
  });
});

describe("truthful incomplete-history probability contract", () => {
  test.each([2, 3, 5])("all estimated players abstain in round %i when any prior list is explicitly incomplete", round => {
    const source = event(22);
    Object.assign(source, { nextRound: round, phase: "between-rounds", publishedRound: round - 1, completedRound: round - 1 });
    source.pairings = Array.from({ length: round - 1 }, (_, r) =>
      Array.from({ length: 11 }, (_, i) => ({ round: r + 1, board: i + 1,
        whiteStartNumber: i + 1, blackStartNumber: 12 + ((i + r) % 11),
        whitePoints: null, blackPoints: null, result: "½-½", decided: true }))).flat();
    const before = structuredClone(source);
    const incomplete = { ...source, incompletePairingRounds: [1] };
    for (const player of source.players) {
      const base = calculatePairingForecast(source, player.startNumber);
      const forecast = calculatePairingForecast(incomplete, player.startNumber);
      expect(forecast.kind).toBe("estimated");
      expect(forecast.candidates.map(c => [c.player.startNumber, c.color, c.reasons])).toEqual(base.candidates.map(c => [c.player.startNumber, c.color, c.reasons]));
      expect(forecast.candidates.every(c => c.probability === null)).toBe(true);
      expect(forecast.otherProbability).toBeNull(); expect(forecast.confidence).toBe("unavailable");
      expect(forecast.caveat).toContain("earlier assignments are missing"); expect(forecast.caveat).not.toContain("Round 1");
      const stale: ExactSwissForecast = { opponentStartNumber: player.startNumber === 22 ? 1 : 22, color: "white", estimatedLiveResults: false, system: "dutch", acceleration: null };
      expect(calculatePairingForecast(incomplete, player.startNumber, { exactSwiss: stale })).toEqual(forecast);
    }
    expect(source).toEqual(before);
  });

  test("live incomplete rounds abstain while future/nonpositive flags and ordinary unresolved results do not", () => {
    const source = event(22);
    Object.assign(source, { nextRound: 3, liveRound: 2, completedRound: 1, publishedRound: 2, phase: "round-in-progress" });
    source.pairings = [
      ...Array.from({ length: 11 }, (_, i) => ({ round: 1, board: i + 1,
        whiteStartNumber: i + 1, blackStartNumber: i + 12, whitePoints: null, blackPoints: null, result: "½-½", decided: true })),
      ...Array.from({ length: 11 }, (_, i) => ({ round: 2, board: i + 1,
        whiteStartNumber: 2 * i + 1, blackStartNumber: 2 * i + 2, whitePoints: null, blackPoints: null, result: null, decided: false })),
    ];
    const base = calculatePairingForecast(source, 1);
    expect(base.candidates.every(c => typeof c.probability === "number")).toBe(true);
    expect(calculatePairingForecast({ ...source, incompletePairingRounds: [0, -1, 3, 9] }, 1)).toEqual(base);
    const incomplete = calculatePairingForecast({ ...source, incompletePairingRounds: [2] }, 1);
    expect(incomplete.otherProbability).toBeNull();
    expect(calculatePairingForecast({ ...source, incompletePairingRounds: [] }, 1)).toEqual(base);
  });

  test("published assignments and round-robin rules keep precedence over incomplete-history flags", () => {
    const source = event(22); Object.assign(source, { nextRound: 3, completedRound: 2, publishedRound: 3, incompletePairingRounds: [1] });
    source.pairings = [{ round: 3, board: 1, whiteStartNumber: 1, blackStartNumber: 22, whitePoints: 0, blackPoints: 0, result: null, decided: false }];
    expect(calculatePairingForecast(source, 1)).toMatchObject({ kind: "confirmed", candidates: [{ probability: 1 }], otherProbability: 0 });
    source.pairings[0] = { ...source.pairings[0], blackStartNumber: null, result: "½" };
    expect(calculatePairingForecast(source, 1)).toMatchObject({ kind: "confirmed", candidates: [], otherProbability: 0 });
    const rr = { ...event(6), format: "round-robin" as const, formatLabel: "Round Robin", nextRound: 2 };
    const normal = calculatePairingForecast(rr, 1), flagged = calculatePairingForecast({ ...rr, incompletePairingRounds: [1] }, 1);
    // With no incompatible observed pairing, the existing inferred RR path
    // stays identical; the abstention rule only changes Swiss estimates.
    expect(normal.kind).toBe("inferred"); expect(flagged).toEqual(normal);
  });
});
