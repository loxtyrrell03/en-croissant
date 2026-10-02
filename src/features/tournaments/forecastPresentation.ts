import { publishedGameResult, publishedResultLabel } from "./publishedPairingResult";
import { completedForecastHeading } from "./completedForecastHeading";
import type { TournamentPairing, TournamentSnapshot } from "@/features/tournaments/platform";
import type { PairingForecast } from "./pairingForecast";

export function tournamentResultLabel(pairing: TournamentPairing, snapshot: TournamentSnapshot): string {
  return publishedResultLabel(pairing, snapshot);
}

export function forecastHeading(forecast: PairingForecast | null, beforePlay: boolean): string {
  if (forecast?.kind === "complete") return completedForecastHeading(forecast);
  const round = forecast?.round;
  const prefix = round ? `Round ${round} · ` : "";
  if (forecast?.kind === "confirmed") return `${prefix}Published pairing`;
  if (forecast?.kind === "scheduled") return `${prefix}Scheduled pairing`;
  if (forecast?.kind === "inferred") return `${prefix}Expected pairing`;
  if (forecast?.kind === "unavailable") return `${prefix}Pairing unavailable`;
  return round ? `${prefix}Predicted opponents` : beforePlay ? "Round 1 predictions" : "Predicted opponents";
}

/** Count only the listed games in the preceding round. Byes are assignments,
 * not games; incomplete source lists must never imply full result coverage. */
export function precedingResultContext(snapshot: TournamentSnapshot, forecast: PairingForecast | null) {
  if (forecast?.kind !== "estimated" || forecast.round === null || forecast.round <= 1) return null;
  const round = forecast.round - 1;
  const games = snapshot.pairings.filter(pairing => pairing.round === round &&
    pairing.whiteStartNumber !== null && pairing.blackStartNumber !== null);
  const reported = games.filter(pairing => publishedGameResult(pairing) !== null).length;
  const incomplete = snapshot.incompletePairingRounds?.includes(round) ?? false;
  const label = !games.length ? `Round ${round} results not available` :
    `Round ${round}: ${reported} of ${games.length} listed games have results${incomplete ? " · list incomplete" : ""}`;
  return { round, reported, total: games.length, incomplete, label };
}
