import type { PairingForecast } from "./pairingForecast";

/** A complete forecast can mean that no later pairing remains while the final
 * round is still live. Preserve the source-aware summary instead of declaring
 * that the tournament itself has finished. */
export function completedForecastHeading(forecast: Pick<PairingForecast, "summary">): string {
  return forecast.summary.trim() || "No next pairing to predict";
}
