import type { TournamentSnapshot } from "@/features/tournaments/platform";

/** Zero is the source contract's unknown total, not an unknown target. Keep
 * this independent of nextRound so historical backcasts remain valid. */
export function isValidTournamentTargetRound(
  snapshot: Pick<TournamentSnapshot, "totalRounds">,
  round: unknown,
): round is number {
  return typeof round === "number" && Number.isSafeInteger(round) && round >= 1 &&
    Number.isSafeInteger(snapshot.totalRounds) && snapshot.totalRounds >= 0 &&
    (snapshot.totalRounds === 0 || round <= snapshot.totalRounds);
}

export function hasAuthoritativeTournamentCompletion(
  snapshot: Pick<TournamentSnapshot, "totalRounds" | "completedRound">,
): boolean {
  return Number.isSafeInteger(snapshot.totalRounds) && snapshot.totalRounds > 0 &&
    Number.isSafeInteger(snapshot.completedRound) && snapshot.completedRound >= snapshot.totalRounds;
}
