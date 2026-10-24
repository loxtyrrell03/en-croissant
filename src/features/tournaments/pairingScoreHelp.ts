import type { TournamentSnapshot } from "@/features/tournaments/platform";
import type { PairingForecast } from "./pairingForecast";
import { forecastEvidenceHelp, prepareTournamentForecastEvidence } from "./tournamentForecastEvidence";
import { normalizeTournamentResults } from "./normalizeTournamentResults";
import { hasUnknownPriorPairingResults, UNKNOWN_PRIOR_RESULTS_HELP } from "./pairingHistoryCompleteness";

export function pairingEstimateHelp(
  snapshot: TournamentSnapshot,
  forecast: Pick<PairingForecast, "kind" | "round"> | null | undefined,
): string | null {
  if (forecast?.kind !== "estimated" || forecast.round === null) return null;
  if (snapshot.format === "swiss" && forecast.round === 1) {
    return "Before round one, no validated probability is available for this field. Candidates follow assumed pairing rules; final entries and organiser settings can change them.";
  }
  if (snapshot.format === "swiss" && snapshot.incompletePairingRounds?.some(round => round > 0 && round < forecast.round!)) {
    return "Some earlier pairing rows are missing, so pairing chances are unavailable. Candidates use incomplete history; refresh to check for the complete list.";
  }
  if (snapshot.format === "swiss" && hasUnknownPriorPairingResults(snapshot, forecast.round)) return UNKNOWN_PRIOR_RESULTS_HELP;
  const issue = prepareTournamentForecastEvidence(normalizeTournamentResults(snapshot), forecast.round).issue;
  if (issue === "unknown-availability") {
    return "Saved tournament data does not confirm whether a player has a bye or is sitting out the next round. Refresh the tournament to verify this before estimating pairing chances.";
  }
  return forecastEvidenceHelp(issue);
}

/** Keep the reason beside unknown chances; full detail uses the existing help. */
export function pairingEstimateUnavailableReason(
  snapshot: TournamentSnapshot,
  forecast: Pick<PairingForecast, "kind" | "round" | "candidates"> | null | undefined,
): string | null {
  if (forecast?.kind !== "estimated" || forecast.round === null ||
      !forecast.candidates.some(candidate => candidate.probability === null)) return null;
  if (snapshot.format === "swiss" && forecast.round === 1) return "Pairing chances are unavailable before round one.";
  const issue = prepareTournamentForecastEvidence(normalizeTournamentResults(snapshot), forecast.round).issue;
  switch (issue) {
    case "unknown-availability": return "Refresh to verify a scheduled bye or absence.";
    case "incomplete-history": return "Pairing chances are unavailable: earlier assignments are incomplete.";
    case "unknown-results": return "Pairing chances are unavailable: earlier results or bye points are missing.";
    case "unknown-scores": return "Pairing chances are unavailable: some scores could not be verified.";
    case "adjusted-score": return "Pairing chances are unavailable: published totals include a score adjustment.";
    case "conflicting-target": return "Pairing chances are unavailable: next-round assignments conflict.";
    default: return "Pairing chances are unavailable: tournament data needs verification.";
  }
}
