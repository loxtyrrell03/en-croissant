import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { publishedGameResult, publishedNoOpponentScore } from "./publishedPairingResult";

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
  if (pairings.every((pairing, index) => pairing === snapshot.pairings[index])) {
    cache.set(snapshot, snapshot);
    return snapshot;
  }
  const normalized = { ...snapshot, pairings };
  // Published completed standings retain authority. Otherwise old completion
  // metadata derived from unreadable current results must not claim completion.
  if (currentChanged && snapshot.publishedRound > snapshot.completedRound &&
      !(snapshot.totalRounds > 0 && snapshot.completedRound >= snapshot.totalRounds)) {
    const games = pairings.filter(pairing => pairing.round === snapshot.publishedRound &&
      pairing.whiteStartNumber !== null && pairing.blackStartNumber !== null);
    if (games.some(pairing => publishedGameResult(pairing) !== null)) {
      normalized.phase = "round-in-progress";
      normalized.liveRound = snapshot.publishedRound;
      const next = snapshot.publishedRound + 1;
      normalized.nextRound = snapshot.totalRounds === 0 || next <= snapshot.totalRounds ? next : null;
    } else {
      normalized.phase = "pairings-published";
      normalized.liveRound = null;
      normalized.nextRound = snapshot.publishedRound;
    }
  }
  cache.set(snapshot, normalized);
  cache.set(normalized, normalized);
  return normalized;
}
