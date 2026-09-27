import ownResult from "./ownResultCalibrationWeights.json" with { type: "json" };
import firstRound from "./firstRoundCalibrationWeights.json" with { type: "json" };
import model from "./pairingCalibrationWeights.json" with { type: "json" };
import largeFallback from "./largeFallbackWeights.json" with { type: "json" };

/** Preserve opponent order; calibrate its probabilities separately. Unallocated
 * rank mass remains outside the shortlist, including a possible bye. See the
 * frozen development counts and validation in docs/benchmarks/pairing-2026-09-10.
 */
export function calibratedRankProbabilities(exact: boolean, round: number, resolved: number | null, fieldSize = Infinity, ownResultKnown: boolean | null = null): number[] {
  const probabilities: Record<string, number[]> = model.probabilities;
  const prefix = exact ? "exact:" : "fallback:";
  if (round === 1) {
    // The continuation validation covers small fields only. Larger/unknown
    // fields retain their existing calibration; no extrapolated gain is claimed.
    if (fieldSize > 0 && fieldSize <= firstRound.maxPlayers) {
      return [...firstRound.probabilities[exact ? "exact" : "fallback"]];
    }
    return [...probabilities[prefix + "first"]];
  }
  const keys = ["0", "25", "50", "75", "complete"];
  const position = Math.max(0, Math.min(1, resolved ?? 1)) * 4;
  const lower = Math.floor(position);
  // Large fallback guesses have a different error rate from small-field
  // reconstructions. During partial rounds, a centered, event-balanced contrast
  // distinguishes whether this player's visible result is known. First rounds,
  // complete/empty result masks and successful solver forecasts stay unchanged.
  const large: Record<string, number[]> | null = !exact && Number.isFinite(fieldSize) && fieldSize > largeFallback.minPlayersExclusive
    ? resolved !== null && resolved > 0 && resolved < 1 && ownResultKnown !== null
      ? ownResult.probabilities[ownResultKnown ? "true" : "false"]
      : largeFallback.probabilities
    : null;
  const a = large?.[keys[lower]] ?? probabilities[prefix + keys[lower]];
  const b = large?.[keys[Math.min(4, lower + 1)]] ?? probabilities[prefix + keys[Math.min(4, lower + 1)]];
  return a.map((value, index) => value + (b[index] - value) * (position - lower));
}
