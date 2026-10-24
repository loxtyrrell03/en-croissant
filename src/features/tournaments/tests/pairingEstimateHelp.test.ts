import { expect, test } from "vitest";
import { pairingEstimateHelp, pairingEstimateUnavailableReason } from "../pairingScoreHelp";
import { calculatePairingForecast } from "../pairingForecast";
import { trackerFixture } from "./trackerFixture";

test("first-round help follows the forecast round in small and large Swiss fields", () => {
  for (const size of [9, 174]) {
    const s = trackerFixture().record.snapshot;
    s.players = Array.from({ length: size }, (_, i) => ({ ...s.players[0], startNumber: i + 1 }));
    Object.assign(s, { completedRound: 1, liveRound: null, publishedRound: 1, nextRound: 2, roundStandings: [] });
    s.pairings = s.players.filter((_, i) => i % 2 === 0).map((p, i) => ({ round: 1, board: i + 1,
      whiteStartNumber: p.startNumber, blackStartNumber: s.players[i * 2 + 1]?.startNumber ?? null,
      whitePoints: null, blackPoints: null, result: s.players[i * 2 + 1] ? "1-0" : "½", decided: true }));
    const before = structuredClone(s);
    expect(pairingEstimateHelp(s, { kind: "estimated", round: 1 })).toContain("Before round one");
    expect(pairingEstimateHelp(s, { kind: "estimated", round: 2 })).toBeNull();
    expect(s).toEqual(before);
  }
});

test("published assignments, inferred round robins and unavailable states keep their own wording", () => {
  const s = trackerFixture().record.snapshot;
  for (const kind of ["confirmed", "scheduled", "inferred", "unavailable"] as const) {
    expect(pairingEstimateHelp(s, { kind, round: 1 })).toBeNull();
  }
  expect(pairingEstimateHelp(s, null)).toBeNull();
  expect(pairingEstimateHelp(s, { kind: "estimated", round: null })).toBeNull();
  s.format = "round-robin";
  expect(pairingEstimateHelp(s, { kind: "estimated", round: 1 })).toBeNull();
});

test("later missing scores retain their specific help and a known-score refresh clears it", () => {
  const s = trackerFixture().record.snapshot;
  Object.assign(s, { completedRound: 1, liveRound: null, publishedRound: 1, nextRound: 2, roundStandings: [] });
  s.players = [s.players[0]];
  s.pairings = [{ round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: null,
    whitePoints: null, blackPoints: null, result: null, decided: false }];
  expect(pairingEstimateHelp(s, { kind: "estimated", round: 2 })).toContain("earlier results are missing");
  const refreshed = { ...s, pairings: s.pairings.map(g => ({ ...g, result: "½" })) };
  expect(pairingEstimateHelp(refreshed, { kind: "estimated", round: 2 })).toBeNull();
});

test("opening-round help leaves the calculated candidates and probabilities intact", () => {
  const s = trackerFixture().record.snapshot;
  Object.assign(s, { pairings: [], roundStandings: [], completedRound: 0, publishedRound: 0,
    liveRound: null, nextRound: 1, phase: "registration" });
  s.players = s.players.map(p => ({ ...p, rank: null, points: 0, notPairedRounds: [], halfPointByeRounds: [] }));
  const forecast = calculatePairingForecast(s, s.players[0].startNumber, { exactSwiss: null });
  const before = structuredClone(forecast);
  expect(forecast.kind).toBe("estimated");
  expect(pairingEstimateHelp(s, forecast)).toContain("no validated probability");
  expect(forecast).toEqual(before);
});


function participationFixture() {
  const s = trackerFixture().record.snapshot;
  Object.assign(s, { totalRounds: 5, completedRound: 0, liveRound: 1, publishedRound: 1, nextRound: 2,
    phase: "round-in-progress", roundStandings: [], incompletePairingRounds: [], warnings: [] });
  s.players = s.players.slice(0, 3).map(p => ({ ...p, points: 0, rank: null, active: true, notPairedRounds: [], halfPointByeRounds: [] }));
  s.pairings = [
    { round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: 2, whitePoints: 0, blackPoints: 0, result: "1-0", decided: true },
    { round: 1, board: 2, whiteStartNumber: 3, blackStartNumber: null, whitePoints: 0, blackPoints: null, result: "½", decided: true },
  ];
  s.players[1].active = false;
  s.players[1].notPairedRounds = [2];
  return s;
}

test("complete listed results still explain an unverified next-round absence without modifying forecasts", () => {
  const s = participationFixture(), forecast = calculatePairingForecast(s, 1, { exactSwiss: null });
  const before = structuredClone({ s, forecast });
  expect(forecast.kind).toBe("estimated");
  expect(forecast.candidates.every(c => c.probability === null)).toBe(true);
  expect(pairingEstimateHelp(s, forecast)).toContain("Saved tournament data");
  expect(pairingEstimateHelp(s, forecast)).toContain("Refresh the tournament");
  expect(pairingEstimateUnavailableReason(s, forecast)).toBe("Refresh to verify a scheduled bye or absence.");
  expect({ s, forecast }).toEqual(before);
});

test("a verified next-round absence clears the reason without requiring a future award", () => {
  const s = participationFixture();
  s.evidenceVersion = 1;
  s.roundStatus = [{ round: 2, startNumber: 2, kind: "not-paired", award: null }];
  const forecast = calculatePairingForecast(s, 1, { exactSwiss: null });
  expect(forecast.kind).toBe("estimated");
  expect(forecast.candidates.some(c => c.probability !== null)).toBe(true);
  expect(pairingEstimateHelp(s, forecast)).toBeNull();
  expect(pairingEstimateUnavailableReason(s, forecast)).toBeNull();
});

test("published assignments and numerical forecasts have no unavailability notice", () => {
  const s = participationFixture();
  const forecast = calculatePairingForecast(s, 1, { exactSwiss: null });
  for (const kind of ["confirmed", "scheduled", "inferred", "unavailable", "complete"] as const) {
    expect(pairingEstimateUnavailableReason(s, { ...forecast, kind })).toBeNull();
    expect(pairingEstimateHelp(s, { ...forecast, kind })).toBeNull();
  }
  expect(pairingEstimateUnavailableReason(s, { ...forecast, candidates: forecast.candidates.map(c => ({ ...c, probability: .4 })) })).toBeNull();
  expect(pairingEstimateUnavailableReason(s, { ...forecast, candidates: [] })).toBeNull();
});

test("resolver-only missing assignments explain refusal even without a native incomplete flag", () => {
  const s = participationFixture();
  s.players[1].active = true; s.players[1].notPairedRounds = [];
  s.pairings = s.pairings.slice(0, 1);
  const forecast = calculatePairingForecast(s, 1, { exactSwiss: null });
  expect(pairingEstimateHelp(s, forecast)).toContain("assignments are missing");
  expect(pairingEstimateUnavailableReason(s, forecast)).toContain("earlier assignments are incomplete");
});
