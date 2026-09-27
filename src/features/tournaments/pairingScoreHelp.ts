import type { TournamentSnapshot } from "@/features/tournaments/platform";
import type { PairingForecast } from "./pairingForecast";
import { hasUnscoredNoOpponentHistory } from "./publishedNoOpponentScore";

export function pairingEstimateHelp(
  snapshot: TournamentSnapshot,
  forecast: Pick<PairingForecast, "kind" | "round"> | null | undefined,
): string | null {
  if (forecast?.kind !== "estimated" || forecast.round === null) return null;
  if (snapshot.format === "swiss" && forecast.round === 1) {
    return "These percentages estimate your next opponent, not your chance of winning. Before round one, unverified pairing rules, late entries and availability make them especially uncertain.";
  }
  if (!hasUnscoredNoOpponentHistory(snapshot, forecast.round)) return null;
  return "An earlier no-opponent score is missing. These percentages estimate your next opponent and may change when the score is published.";
}
