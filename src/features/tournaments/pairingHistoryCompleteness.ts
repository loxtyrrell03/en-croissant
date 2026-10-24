import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { publishedGameResult, publishedNoOpponentScore } from "./publishedPairingResult";
import { cachedTournamentEvidence } from "./tournamentForecastEvidence";

export const UNKNOWN_PRIOR_RESULTS_HELP = "Some earlier results are missing, so pairing chances are unavailable. Candidates use incomplete results; refresh to check for updates.";

/** Ordinary unfinished games in the immediate live round can be modelled.
 * Missing historical results and unscored solo assignments cannot. Aggregate
 * standings do not establish the individual results required to reconstruct
 * pairings. Missing rows are handled separately; never infer a zero score. */
export function hasUnknownPriorPairingResults(snapshot: TournamentSnapshot, targetRound: number): boolean {
  if (snapshot.evidenceVersion === 1) {
    // A status page can supply an explicit award for an otherwise unscored
    // solo row. Use the same reconciled result as forecast admission.
    const evidence = cachedTournamentEvidence(snapshot, targetRound);
    return evidence === null || !evidence.allRequiredResultsAvailable;
  }
  return snapshot.pairings.some(pairing => {
    if (pairing.round <= 0 || pairing.round >= targetRound) return false;
    const white = pairing.whiteStartNumber !== null, black = pairing.blackStartNumber !== null;
    if (white !== black) return publishedNoOpponentScore(pairing) === null;
    if (!white || publishedGameResult(pairing) !== null) return false;
    return !(pairing.round === snapshot.liveRound && pairing.round === targetRound - 1 &&
      pairing.round > snapshot.completedRound);
  });
}
