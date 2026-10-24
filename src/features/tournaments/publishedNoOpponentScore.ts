import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { publishedNoOpponentScore } from "./publishedPairingResult";
export { publishedNoOpponentScore } from "./publishedPairingResult";

/** A no-opponent assignment establishes a score only when its occupied seat
 * explicitly contains one. Dashes and missing scores remain unknown. */
const unscoredHistory = new WeakMap<TournamentSnapshot, { round: number; unknown: boolean }>();
export function hasUnscoredNoOpponentHistory(snapshot: TournamentSnapshot, targetRound: number): boolean {
  const cached = unscoredHistory.get(snapshot);
  if (cached?.round === targetRound) return cached.unknown;
  const unknown = snapshot.pairings.some(pairing => pairing.round > 0 && pairing.round < targetRound &&
    (pairing.whiteStartNumber === null) !== (pairing.blackStartNumber === null) && publishedNoOpponentScore(pairing) === null);
  unscoredHistory.set(snapshot, { round: targetRound, unknown });
  return unknown;
}
