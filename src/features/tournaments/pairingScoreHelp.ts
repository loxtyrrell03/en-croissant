import type { TournamentSnapshot } from "@/features/tournaments/platform";
import type { PairingForecast } from "./pairingForecast";
import { hasUnscoredNoOpponentHistory } from "./publishedNoOpponentScore";

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
  if (!hasUnscoredNoOpponentHistory(snapshot, forecast.round)) return null;
  return "An earlier no-opponent score is missing. These percentages estimate your next opponent and may change when the score is published.";
}
