import { describe, expect, test } from "vitest";
import { inferSwissAcceleration } from "../exactSwissForecast";
import { calculatePairingForecast } from "../pairingForecast";
import {
  completedRoundReplayCases,
  liveRoundReplayCases,
  loadHistoricalSwissSnapshots,
} from "./historicalSwissReplay";

interface Accuracy {
  cases: number;
  ranks: number[];
  top1: number;
  top3: number;
  top6: number;
}

function accuracy(
  cases: ReturnType<typeof completedRoundReplayCases>,
): Accuracy {
  let top1 = 0;
  let top3 = 0;
  let top6 = 0;
  const ranks = Array.from({ length: 6 }, () => 0);
  for (const replay of cases) {
    const candidates = calculatePairingForecast(replay.snapshot, replay.player).candidates.map(
      (candidate) => candidate.player.startNumber,
    );
    const rank = candidates.indexOf(replay.actualOpponent);
    if (rank >= 0) ranks[rank] += 1;
    if (candidates[0] === replay.actualOpponent) top1 += 1;
    if (candidates.slice(0, 3).includes(replay.actualOpponent)) top3 += 1;
    if (candidates.slice(0, 6).includes(replay.actualOpponent)) top6 += 1;
  }
  return {
    cases: cases.length,
    ranks: ranks.map((count) => count / cases.length),
    top1: top1 / cases.length,
    top3: top3 / cases.length,
    top6: top6 / cases.length,
  };
}

describe("historical Swiss forecast replay", () => {
  const snapshots = loadHistoricalSwissSnapshots();

  test("covers varied field sizes, sections, round counts, byes, and withdrawals", () => {
    expect(snapshots).toHaveLength(15);
    expect(Math.min(...snapshots.map((snapshot) => snapshot.players.length))).toBe(16);
    expect(Math.max(...snapshots.map((snapshot) => snapshot.players.length))).toBe(400);
    expect(new Set(snapshots.map((snapshot) => snapshot.totalRounds)).size).toBeGreaterThan(3);
    expect(snapshots.some((snapshot) => snapshot.section !== null)).toBe(true);
    expect(
      snapshots.some((snapshot) =>
        snapshot.pairings.some(
          (pairing) => pairing.whiteStartNumber === null || pairing.blackStartNumber === null,
        ),
      ),
    ).toBe(true);
    expect(
      snapshots.some((snapshot) =>
        snapshot.players.some((player) => (player.notPairedRounds?.length ?? 0) > 0),
      ),
    ).toBe(true);
    expect(snapshots.filter((snapshot) => inferSwissAcceleration(snapshot))).toHaveLength(1);
    expect(snapshots.filter((snapshot) => !inferSwissAcceleration(snapshot))).toHaveLength(14);
  });

  test(
    "keeps the completed-round fallback above its historical accuracy floor",
    () => {
      const result = accuracy(completedRoundReplayCases(snapshots));
      console.log("HISTORICAL_FALLBACK_COMPLETE", result);
      expect(result.cases).toBe(1_676);
      expect(result.top1).toBeGreaterThanOrEqual(0.48);
      expect(result.top3).toBeGreaterThanOrEqual(0.81);
      expect(result.top6).toBeGreaterThanOrEqual(0.89);
    },
    15_000,
  );

  test("can replay every paired player rather than only the leading boards", () => {
    const leadingBoards = completedRoundReplayCases(snapshots);
    const wholeFields = completedRoundReplayCases(snapshots, null);

    expect(leadingBoards).toHaveLength(1_676);
    expect(wholeFields.length).toBeGreaterThan(14_000);
    expect(
      new Set(wholeFields.map((replay) => `${replay.tournamentId}:${replay.player}`)).size,
    ).toBeGreaterThan(1_600);
  });

  test(
    "measures fallback coverage across every paired player",
    () => {
      const result = accuracy(completedRoundReplayCases(snapshots, null));

      console.log("HISTORICAL_FALLBACK_WHOLE_FIELD", result);
      expect(result.cases).toBeGreaterThan(14_000);
      expect(result.top1).toBeGreaterThanOrEqual(0.35);
      expect(result.top3).toBeGreaterThanOrEqual(0.65);
      expect(result.top6).toBeGreaterThanOrEqual(0.8);
    },
    150_000,
  );

  test("narrows the field as more live results arrive", () => {
    const checkpoints = [0, 0.1, 0.25, 0.5, 0.75, 1].map((resolved) => ({
      resolved,
      ...accuracy(liveRoundReplayCases(snapshots, resolved)),
    }));
    console.log("HISTORICAL_FALLBACK_LIVE", checkpoints);
    expect(checkpoints.every((checkpoint) => checkpoint.cases === 1_676)).toBe(true);
    expect(checkpoints.at(-1)!.top1).toBeGreaterThan(checkpoints[0].top1);
    expect(checkpoints.at(-1)!.top3).toBeGreaterThan(checkpoints[0].top3);
    expect(checkpoints.at(-1)!.top6).toBeGreaterThan(checkpoints[0].top6);
    expect(checkpoints[0].top1).toBeGreaterThanOrEqual(0.15);
    expect(checkpoints[3].top1).toBeGreaterThanOrEqual(0.4);
    expect(checkpoints[3].top6).toBeGreaterThanOrEqual(0.79);
    expect(checkpoints.at(-1)!.top1).toBeGreaterThanOrEqual(0.47);
    expect(checkpoints.at(-1)!.top3).toBeGreaterThanOrEqual(0.77);
    expect(checkpoints.at(-1)!.top6).toBeGreaterThanOrEqual(0.88);
  }, 90_000);
});
