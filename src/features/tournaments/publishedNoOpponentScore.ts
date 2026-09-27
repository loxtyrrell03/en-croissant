import type { TournamentPairing, TournamentSnapshot } from "@/features/tournaments/platform";

/** A no-opponent assignment establishes a score only when its occupied seat
 * explicitly contains one. Dashes and missing scores remain unknown. */
export function publishedNoOpponentScore(pairing: TournamentPairing): 0 | 0.5 | 1 | null {
  if ((pairing.whiteStartNumber === null) === (pairing.blackStartNumber === null)) return null;
  const result = (pairing.result ?? "").replace(/\s+/g, "").toLowerCase();
  const seats = /^(1f?|0f?|1\/2|0?\.5|½|\+|-)?-(1f?|0f?|1\/2|0?\.5|½|\+|-)?$/.exec(result);
  const score = seats ? seats[pairing.whiteStartNumber !== null ? 1 : 2] : result;
  if (score === "0" || score === "0f") return 0;
  if (["½", "1/2", "0.5", ".5"].includes(score ?? "")) return 0.5;
  if (["1", "1f", "+"].includes(score ?? "")) return 1;
  return null;
}

const unscoredHistory = new WeakMap<TournamentSnapshot, { round: number; unknown: boolean }>();
export function hasUnscoredNoOpponentHistory(snapshot: TournamentSnapshot, targetRound: number): boolean {
  const cached = unscoredHistory.get(snapshot);
  if (cached?.round === targetRound) return cached.unknown;
  const unknown = snapshot.pairings.some(pairing => pairing.round > 0 && pairing.round < targetRound &&
    (pairing.whiteStartNumber === null) !== (pairing.blackStartNumber === null) && publishedNoOpponentScore(pairing) === null);
  unscoredHistory.set(snapshot, { round: targetRound, unknown });
  return unknown;
}
