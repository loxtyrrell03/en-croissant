import { describe, expect, test, vi } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { historicalPairingReliability } from "../pairingHistoryReliability";
import { historyAdjustedProbabilities, contextualSwissProbabilities } from "../pairingHistoryCalibration";

function snapshot(): TournamentSnapshot {
  const games = [[1, 1, 2, "1-0"], [1, 3, null, "1"], [2, 1, 3, "½-½"], [2, 2, null, "1"]] as const;
  return { tournamentId: "history", format: "swiss", formatLabel: "Swiss-System", title: "Open", totalRounds: 5,
    nextRound: 3, completedRound: 2, publishedRound: 2, liveRound: null,
    players: [1, 2, 3].map(startNumber => ({ startNumber, name: String(startNumber), points: 99, active: true, rating: 2000 })),
    pairings: games.map(([round, whiteStartNumber, blackStartNumber, result], i) => ({ round, board: i % 2 + 1, whiteStartNumber, blackStartNumber, result, decided: true })),
  } as TournamentSnapshot;
}

describe("chronological tournament reliability", () => {
  test("compares an earlier round using its preceding history and excludes first-round calibration", () => {
    const s = snapshot(), copy = structuredClone(s);
    expect(historicalPairingReliability(s, 2)).toBeUndefined();
    expect(historicalPairingReliability(s, 3)).toEqual({ matched: 2, compared: 2, rounds: [2] });
    expect(historicalPairingReliability(s, 3)).toBe(historicalPairingReliability(s, 3));
    expect(s).toEqual(copy);
  });
  test("ignores target and future outcomes, standings and future availability when backcasting", () => {
    const s = snapshot(), changed = structuredClone(s);
    for (const p of changed.players) { p.active = false; p.rank = 999; p.points = -999; p.notPairedRounds = [2, 3, 99]; p.halfPointByeRounds = [2, 3, 99]; }
    changed.pairings.push({ ...changed.pairings[0], round: 3, result: "0-1", decided: false });
    expect(historicalPairingReliability(changed, 3)).toEqual(historicalPairingReliability(s, 3));
  });
  test("declines live results, incomplete earlier history and large fields", () => {
    const s = snapshot(); s.pairings[2].decided = false;
    expect(historicalPairingReliability(s, 3)).toBeUndefined();
    const missing = snapshot(); missing.incompletePairingRounds = [1];
    expect(historicalPairingReliability(missing, 3)).toBeUndefined();
    const silentHole = snapshot(); silentHole.pairings = silentHole.pairings.filter(p => p.round !== 1);
    expect(historicalPairingReliability(silentHole, 3)).toBeUndefined();
    const large = snapshot(); while (large.players.length < 121) large.players.push({ ...large.players[0], startNumber: large.players.length + 1 });
    expect(historicalPairingReliability(large, 3)).toBeUndefined();
  });
});

describe("shrunk historical calibration", () => {
  const prior = [.6016882089, .1340015827, .0625164864, .0385122659, .0240042205, .0100237404];
  test("raises or lowers confidence from prior-round evidence while retaining candidate order and Other mass", () => {
    for (const matched of [0, 10, 60, 100]) {
      const p = historyAdjustedProbabilities(prior, { matched, compared: 100, rounds: [2, 3] });
      expect(p.every(x => Number.isFinite(x) && x > 0 && x < 1)).toBe(true);
      expect(p.reduce((a, b) => a + b, 0)).toBeLessThan(1);
      expect(p.every((x, i) => !i || x <= p[i - 1] + 1e-12)).toBe(true);
      if (matched === 0) expect(p[0]).toBeLessThan(prior[0]);
      if (matched === 100) expect(p[0]).toBeGreaterThan(prior[0]);
    }
    expect(prior[0]).toBe(.6016882089);
  });
  test("keeps uncalibrated and invalid history unchanged", () => {
    expect(historyAdjustedProbabilities(prior, undefined)).toBe(prior);
    for (const h of [{ matched: 1, compared: 0 }, { matched: 2, compared: 1 }, { matched: NaN, compared: 2 }]) {
      expect(historyAdjustedProbabilities(prior, { ...h, rounds: [2] })).toBe(prior);
    }
  });
  test("keeps new calibration out of unvalidated systems, large fields and live solver byes", () => {
    const bye = { opponentStartNumber: null, color: null, estimatedLiveResults: false, system: "dutch" as const, acceleration: null };
    const p = contextualSwissProbabilities(prior, bye, false, 4, 30, 4);
    expect(p.slice(0, 4).reduce((a, b) => a + b, 0)).toBeCloseTo(1 - 47 / 57);
    expect(contextualSwissProbabilities(prior, { ...bye, estimatedLiveResults: true }, false, 4, 30, 4)).toBe(prior);
    expect(contextualSwissProbabilities(prior, bye, false, 4, 121, 4)).toBe(prior);
    expect(contextualSwissProbabilities(prior, { ...bye, system: "burstein" }, false, 4, 30, 4)).toBe(prior);
    expect(contextualSwissProbabilities(prior, bye, false, 1, 30, 4)).toBe(prior);
  });
  test("the actual worker entry point supplies historical evidence on a settled forecast", async () => {
    const s = snapshot();
    let handler: ((event: { data: unknown }) => void) | undefined;
    const postMessage = vi.fn();
    vi.stubGlobal("self", { addEventListener: (_: string, callback: typeof handler) => { handler = callback; }, postMessage });
    try {
      await import("../exactSwissForecast.worker");
      handler!({ data: { id: 41, snapshot: s, targetRound: 3, myStartNumber: 2, system: "dutch" } });
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 41, forecasts: expect.objectContaining({ 2: expect.objectContaining({
        history: { matched: 2, compared: 2, rounds: [2] },
      }) }) }));
    } finally { vi.unstubAllGlobals(); }
  });
});
