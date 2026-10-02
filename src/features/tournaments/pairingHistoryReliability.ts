import { isValidTournamentTargetRound } from "./tournamentRoundMetadata";
import { cachedTournamentEvidence } from "./tournamentForecastEvidence";
import { historicalTournamentSnapshot } from "./historicalTournamentSnapshot";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { calculateExactSwissForecast, swissPairingSystemFor } from "./exactSwissForecast";
import type { PairingHistoryReliability } from "./pairingHistoryCalibration";
import weights from "./adaptiveSwissWeights.json" with { type: "json" };

const cache = new WeakMap<TournamentSnapshot, Map<number, PairingHistoryReliability | undefined>>();

/** Worker-only backcasts: reconstruct each earlier round using only what was
 * available before its publication, then compare with its now-published pairs.
 * Current/target-round pairs never enter the reliability observations. */
export function historicalPairingReliability(snapshot: TournamentSnapshot, target: number): PairingHistoryReliability | undefined {
  if (!isValidTournamentTargetRound(snapshot, target)) return undefined;
  if (snapshot.format !== "swiss" || swissPairingSystemFor(snapshot) !== "dutch" || snapshot.players.length > weights.maxPlayers || target < 3) return undefined;
  let rounds = cache.get(snapshot);
  if (rounds?.has(target)) return rounds.get(target);
  const evidence = cachedTournamentEvidence(snapshot, target);
  if (!evidence || !evidence.allAssignmentsKnown || !evidence.allIndividualResultsKnown || !evidence.allAggregateScoresKnown) return undefined;
  const result: PairingHistoryReliability = { matched: 0, compared: 0, rounds: [] };
  for (let round = Math.max(2, target - weights.historyLookbackRounds); round < target; round++) {
    const truth = new Map<number, number | null>();
    for (const player of evidence.players) truth.set(player.startNumber, player.rounds[round - 1].opponentStartNumber);
    if (truth.size !== snapshot.players.length) continue;
    const before = historicalTournamentSnapshot(snapshot, round);
    if (!before) continue;
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
