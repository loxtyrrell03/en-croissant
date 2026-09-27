import weights from "./adaptiveSwissWeights.json" with { type: "json" };
import type { ExactSwissForecast } from "./exactSwissForecast";

export interface PairingHistoryReliability {
  /** Counts of earlier named-opponent reconstructions, not independent trials. */
  matched: number;
  compared: number;
  rounds: number[];
}

/** Historical reconstruction is event-specific evidence, not proof of arbiter
 * settings. Shrink toward the existing complete-round table and retain order,
 * finite alternatives and Other. This adjustment is limited to settled inputs. */
export function historyAdjustedProbabilities(
  probabilities: number[], history: PairingHistoryReliability | undefined,
): number[] {
  if (!history || history.compared <= 0 || history.matched < 0 || history.matched > history.compared ||
      !Number.isFinite(history.compared) || !Number.isFinite(history.matched) || !history.rounds.length || !probabilities.length) return probabilities;
  const base = probabilities[0];
  const reference = weights.historyReference;
  const prior = weights.historyPriorStatements;
  const rate = (history.matched + prior * reference) / (history.compared + prior);
  const next = probabilities[1] ?? 0;
  const floor = next / (1 - base + next);
  const top = Math.max(floor, Math.min(weights.historyMaxTop, base * rate / reference));
  const scale = (1 - top) / (1 - base);
  return probabilities.map((p, i) => i === 0 ? top : p * scale);
}

export function contextualSwissProbabilities(probabilities: number[], exact: ExactSwissForecast | null | undefined,
  exactUsed: boolean, round: number, fieldSize: number, candidateCount: number): number[] {
  if (!exact || exact.system !== "dutch" || fieldSize > weights.maxPlayers || fieldSize < 2) return probabilities;
  if (round === 1 && exactUsed) return [...weights.firstExactProbabilities];
  if (round <= 1 || exact.estimatedLiveResults) return probabilities;
  if (exact.opponentStartNumber === null) {
    const mass = probabilities.slice(0, candidateCount).reduce((sum, p) => sum + p, 0);
    return mass > 0 ? probabilities.map(p => p * (1 - weights.laterByeOtherProbability) / mass) : probabilities;
  }
  return exactUsed && round >= 3 ? historyAdjustedProbabilities(probabilities, exact.history) : probabilities;
}
