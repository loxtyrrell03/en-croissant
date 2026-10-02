import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { publishedGameResult, publishedNoOpponentScore } from "./publishedPairingResult";
import { hasAuthoritativeTournamentCompletion, isValidTournamentTargetRound } from "./tournamentRoundMetadata";

const cache = new WeakMap<TournamentSnapshot, TournamentSnapshot>();

/** Immutable source snapshots may come from an older native parser. Demote
 * unsupported reported results; never reveal a result whose flag is false. */
export function normalizeTournamentResults(snapshot: TournamentSnapshot): TournamentSnapshot {
  const cached = cache.get(snapshot);
  if (cached) return cached;
  let currentChanged = false;
  const pairings = snapshot.pairings.map(pairing => {
    if (!pairing.decided || publishedGameResult(pairing) || publishedNoOpponentScore(pairing) !== null) return pairing;
    if (pairing.round === snapshot.publishedRound) currentChanged = true;
    return { ...pairing, decided: false };
  });
  let normalized = pairings.every((pairing, index) => pairing === snapshot.pairings[index])
    ? snapshot : { ...snapshot, pairings };
  // Published completed standings retain authority. Otherwise old completion
  // metadata derived from unreadable current results must not claim completion.
  if (isValidTournamentTargetRound(snapshot, snapshot.publishedRound) &&
      snapshot.publishedRound > snapshot.completedRound && !hasAuthoritativeTournamentCompletion(snapshot)) {
    const games = pairings.filter(pairing => pairing.round === snapshot.publishedRound &&
      pairing.whiteStartNumber !== null && pairing.blackStartNumber !== null);
    const staleCompletion = snapshot.phase === "complete" &&
      games.some(pairing => publishedGameResult(pairing) === null);
    if (currentChanged || staleCompletion) {
      // An explicit valid published target still confirms the source pairing.
      // An already-pending live final round remains live even with no results.
      // Demoted invalid true flags retain the earlier repair: a live marker
      // derived only from those unsupported results cannot establish play.
      const publishedTarget = snapshot.nextRound === snapshot.publishedRound;
      const live = !publishedTarget && (games.some(pairing => publishedGameResult(pairing) !== null) ||
        (!currentChanged && snapshot.liveRound === snapshot.publishedRound));
      const next = snapshot.publishedRound + 1;
      // Do not turn malformed explicit targets into a valid terminal null.
      // Forecast/worker admission must still reject the source's bad target.
      const invalidTarget = snapshot.nextRound !== null && !isValidTournamentTargetRound(snapshot, snapshot.nextRound);
      normalized = { ...normalized,
        phase: live ? "round-in-progress" : "pairings-published",
        liveRound: live ? snapshot.publishedRound : null,
        nextRound: invalidTarget ? snapshot.nextRound : live
          ? isValidTournamentTargetRound(snapshot, next) ? next : null
          : snapshot.publishedRound,
      };
    }
  }
  cache.set(snapshot, normalized);
  cache.set(normalized, normalized);
  return normalized;
}
