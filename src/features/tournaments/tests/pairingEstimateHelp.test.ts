import { expect, test } from "vitest";
import { pairingEstimateHelp } from "../pairingScoreHelp";
import { calculatePairingForecast } from "../pairingForecast";
import { trackerFixture } from "./trackerFixture";

test("first-round help follows the forecast round in small and large Swiss fields", () => {
  for (const size of [9, 174]) {
    const s = trackerFixture().record.snapshot;
    s.players = Array.from({ length: size }, (_, i) => ({ ...s.players[0], startNumber: i + 1 }));
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
  s.pairings = [{ round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: null,
    whitePoints: null, blackPoints: null, result: null, decided: false }];
  expect(pairingEstimateHelp(s, { kind: "estimated", round: 2 })).toContain("score is missing");
  const refreshed = { ...s, pairings: s.pairings.map(g => ({ ...g, result: "½" })) };
  expect(pairingEstimateHelp(refreshed, { kind: "estimated", round: 2 })).toBeNull();
});

test("opening-round help leaves the calculated candidates and probabilities intact", () => {
  const s = trackerFixture().record.snapshot;
  Object.assign(s, { pairings: [], roundStandings: [], completedRound: 0, publishedRound: 0,
    liveRound: null, nextRound: 1, phase: "registration" });
  s.players = s.players.map(p => ({ ...p, rank: null, points: 0, notPairedRounds: [], halfPointByeRounds: [] }));
  const forecast = calculatePairingForecast(s, s.players[0].startNumber);
  const before = structuredClone(forecast);
  expect(forecast.kind).toBe("estimated");
  expect(pairingEstimateHelp(s, forecast)).toContain("especially uncertain");
  expect(forecast).toEqual(before);
});
