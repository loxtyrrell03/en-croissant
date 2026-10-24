import { describe, expect, test } from "vitest";
import { trackerFixture } from "./trackerFixture";
import { calculatePairingForecast } from "../pairingForecast";
import { exactSwissForecastKey } from "../exactSwissForecastClient";
import { prepareTournamentForecastEvidence } from "../tournamentForecastEvidence";
import { mergeTournamentRoster } from "../tournamentRoster";
import { parseTournamentPreps, serializeTournamentPreps } from "../tournamentPrepStore";
import { canEnterManualResult, manualResultInput, reconcileManualResults, setManualResult, tournamentPredictionSnapshot } from "../manualTournamentResults";

export function manualFixture() {
  const { record } = trackerFixture();
  const s = record.snapshot;
  s.players = s.players.slice(0, 6).map(p => ({ ...p, points: 0, rank: null, scoreKnown: true, scoreSource: "initial", scoreRound: 0 }));
  Object.assign(s, { totalRounds: 5, completedRound: 0, publishedRound: 1, liveRound: 1, nextRound: 2,
    phase: "round-in-progress", evidenceVersion: 1 });
  s.pairings = [
    { round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: 2, whitePoints: 0, blackPoints: 0, result: null, decided: false },
    { round: 1, board: 2, whiteStartNumber: 3, blackStartNumber: 4, whitePoints: 0, blackPoints: 0, result: "1-0", decided: true },
    { round: 1, board: 3, whiteStartNumber: 5, blackStartNumber: 6, whitePoints: 0, blackPoints: 0, result: "1/2-1/2", decided: true },
  ];
  return record;
}

describe("temporary manual tournament results", () => {
  test.each(["1-0", "1/2-1/2", "0-1"] as const)("uses %s in predictions without changing source or completion", result => {
    const record = manualFixture(), source = structuredClone(record.snapshot), p = source.pairings[0];
    const before = structuredClone(source), input = manualResultInput(source, p, result);
    const projected = tournamentPredictionSnapshot(source, [input]);
    expect(source).toEqual(before);
    expect(projected.completedRound).toBe(source.completedRound);
    expect(projected.phase).toBe(source.phase);
    expect(projected.pairings[0]).toEqual({ ...p, result, decided: true });
    const evidence = prepareTournamentForecastEvidence(projected, 2);
    expect(evidence.solverCompatible).toBe(true);
    expect(evidence.evidence?.players[0].rounds[0].award).toBe(result === "1-0" ? 1 : result === "0-1" ? 0 : 0.5);
    const expected = { ...source, pairings: source.pairings.map((p, i) => i === 0 ? { ...p, result, decided: true } : p) };
    expect(calculatePairingForecast(projected, 1)).toEqual(calculatePairingForecast(expected, 1));
    expect(exactSwissForecastKey(projected, 2, 1)).not.toBe(exactSwissForecastKey(source, 2, 1));
  });
  test("changing and clearing an assumption updates the forecast input and restores the source", () => {
    const { snapshot } = manualFixture(), p = snapshot.pairings[0], input = manualResultInput(snapshot, p, "1-0");
    const values = setManualResult(snapshot, [], input, "1-0");
    const projected = tournamentPredictionSnapshot(snapshot, values);
    expect(tournamentPredictionSnapshot(snapshot, values)).toBe(projected);
    const changed = setManualResult(snapshot, values, input, "0-1");
    expect(changed).toHaveLength(1);
    expect(calculatePairingForecast(tournamentPredictionSnapshot(snapshot, changed), 1)).not.toEqual(calculatePairingForecast(projected, 1));
    expect(tournamentPredictionSnapshot(snapshot, setManualResult(snapshot, changed, input, null))).toEqual(snapshot);
  });
  test("persists across reopen and is retired when an official draw arrives", () => {
    const record = manualFixture();
    record.manualResults = [manualResultInput(record.snapshot, record.snapshot.pairings[0], "1-0")];
    const loaded = parseTournamentPreps(serializeTournamentPreps({ [record.id]: record }))[record.id];
    expect(loaded.manualResults).toEqual(record.manualResults);
    const official = { ...record.snapshot, pairings: record.snapshot.pairings.map((p, i) => i === 0 ? { ...p, result: "½-½", decided: true } : p) };
    const refreshed = mergeTournamentRoster(loaded, official).record;
    expect(refreshed.manualResults).toEqual([]);
    expect(tournamentPredictionSnapshot(official, record.manualResults).pairings[0].result).toBe("½-½");
    expect(setManualResult(official, record.manualResults, record.manualResults[0], "0-1")).toEqual([]);
    const reverted = mergeTournamentRoster(refreshed, record.snapshot).record;
    expect(reverted.manualResults).toEqual([]);
  });
  test("official forfeits also win; unsupported source text stays pending", () => {
    const { snapshot } = manualFixture();
    const input = manualResultInput(snapshot, snapshot.pairings[0], "0-1");
    for (const result of ["+--", "--+", "0-0"]) {
      const source = { ...snapshot, pairings: snapshot.pairings.map((p, i) => i === 0 ? { ...p, result, decided: true } : p) };
      expect(reconcileManualResults(source, [input])).toEqual([]);
      expect(tournamentPredictionSnapshot(source, [input]).pairings[0].result).toBe(result);
    }
    const unreadable = { ...snapshot, pairings: snapshot.pairings.map((p, i) => i === 0 ? { ...p, result: "pending", decided: true } : p) };
    expect(reconcileManualResults(unreadable, [input])).toEqual([input]);
  });
  test("never carries a result to a changed opponent, colour or identity", () => {
    const { snapshot } = manualFixture(), input = manualResultInput(snapshot, snapshot.pairings[0], "1-0");
    expect(reconcileManualResults({ ...snapshot, players: snapshot.players.map(p => p.startNumber === 2 ? { ...p, fideId: "999" } : p) }, [input])).toEqual([]);
    expect(reconcileManualResults({ ...snapshot, pairings: snapshot.pairings.map((p, i) => i === 0 ? { ...p, whiteStartNumber: 2, blackStartNumber: 1 } : p) }, [input])).toEqual([]);
    expect(reconcileManualResults({ ...snapshot, pairings: snapshot.pairings.map((p, i) => i === 0 ? { ...p, blackStartNumber: 3 } : p) }, [input])).toEqual([]);
  });
  test("rejects conflicting assignments, missing seats, future rounds and invalid stored results", () => {
    const { snapshot } = manualFixture(), p = snapshot.pairings[0], input = manualResultInput(snapshot, p, "1-0");
    expect(canEnterManualResult({ ...snapshot, pairings: [...snapshot.pairings, p] }, p)).toBe(false);
    expect(canEnterManualResult({ ...snapshot, players: [...snapshot.players, snapshot.players[0]] }, p)).toBe(false);
    expect(canEnterManualResult({ ...snapshot, pairings: [{ ...p, blackStartNumber: null }] }, p)).toBe(false);
    expect(canEnterManualResult({ ...snapshot, pairings: [{ ...p, round: 3 }] }, { ...p, round: 3 })).toBe(false);
    expect(reconcileManualResults(snapshot, [{ ...input, result: "2-0" }, null, "1-0"])).toEqual([]);
    expect(reconcileManualResults(snapshot, { result: "1-0" })).toEqual([]);
    expect(canEnterManualResult({ ...snapshot, roundStatus: [{ round: 1, startNumber: 1, kind: "not-paired", award: null }] }, p)).toBe(false);
  });
  test("a pending override never establishes published rank or points", () => {
    const { snapshot } = manualFixture(), p = snapshot.pairings[0];
    const projected = tournamentPredictionSnapshot(snapshot, [manualResultInput(snapshot, p, "1-0")]);
    expect(projected.players).toBe(snapshot.players);
    expect(projected.roundStandings).toBe(snapshot.roundStandings);
  });
});
