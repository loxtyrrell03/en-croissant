import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { calculateExactSwissForecast, swissPairingSystemFor } from "./exactSwissForecast";
import type { PairingHistoryReliability } from "./pairingHistoryCalibration";
import weights from "./adaptiveSwissWeights.json" with { type: "json" };

const cache = new WeakMap<TournamentSnapshot, Map<number, PairingHistoryReliability | undefined>>();

/** Worker-only backcasts: reconstruct each earlier round using only what was
 * available before its publication, then compare with its now-published pairs.
 * Current/target-round pairs never enter the reliability observations. */
export function historicalPairingReliability(snapshot: TournamentSnapshot, target: number): PairingHistoryReliability | undefined {
  if (snapshot.format !== "swiss" || swissPairingSystemFor(snapshot) !== "dutch" || snapshot.players.length > weights.maxPlayers || target < 3 ||
      snapshot.incompletePairingRounds?.some(r => r > 0 && r < target) ||
      snapshot.pairings.some(p => p.round < target && !p.decided && p.whiteStartNumber !== null && p.blackStartNumber !== null)) return undefined;
  // Older runtimes omit completeness metadata. Require positive roster coverage
  // for every earlier round before allowing confidence to increase.
  for (let round = 1; round < target; round++) {
    const seen = new Set(snapshot.pairings.filter(p => p.round === round)
      .flatMap(p => [p.whiteStartNumber, p.blackStartNumber]).filter((n): n is number => n !== null));
    if (snapshot.players.some(p => !seen.has(p.startNumber))) return undefined;
  }
  let rounds = cache.get(snapshot);
  if (rounds?.has(target)) return rounds.get(target);
  const result: PairingHistoryReliability = { matched: 0, compared: 0, rounds: [] };
  for (let round = Math.max(2, target - weights.historyLookbackRounds); round < target; round++) {
    const truth = new Map<number, number | null>();
    for (const p of snapshot.pairings.filter(p => p.round === round)) {
      if (p.whiteStartNumber !== null) truth.set(p.whiteStartNumber, p.blackStartNumber);
      if (p.blackStartNumber !== null) truth.set(p.blackStartNumber, p.whiteStartNumber);
    }
    if (truth.size !== snapshot.players.length) continue;
    const before: TournamentSnapshot = { ...snapshot,
      players: snapshot.players.map(p => ({ ...p, active: true, rank: null, points: 0,
        notPairedRounds: p.notPairedRounds?.filter(r => r < round), halfPointByeRounds: p.halfPointByeRounds?.filter(r => r < round) })),
      pairings: snapshot.pairings.filter(p => p.round < round), roundStandings: [],
      completedRound: round - 1, publishedRound: round - 1, liveRound: null, nextRound: round, phase: "between-rounds",
    };
    let compared = 0;
    for (const p of before.players) {
      const exact = calculateExactSwissForecast(before, round, p.startNumber, swissPairingSystemFor(before));
      if (exact?.opponentStartNumber === null || exact?.opponentStartNumber === undefined) continue;
      result.compared++; compared++;
      result.matched += Number(truth.get(p.startNumber) === exact.opponentStartNumber);
    }
    if (compared) result.rounds.push(round);
  }
  const value = result.compared ? result : undefined;
  if (!rounds) { rounds = new Map(); cache.set(snapshot, rounds); }
  rounds.set(target, value);
  return value;
}
