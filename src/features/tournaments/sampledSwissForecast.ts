import { isValidTournamentTargetRound } from "./tournamentRoundMetadata";
import { publishedGameResult } from "./publishedPairingResult";
import { normalizeTournamentResults } from "./normalizeTournamentResults";
import { hasUnknownPriorPairingResults } from "./pairingHistoryCompleteness";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { swissParticipationScenario } from "./swissParticipation";
import { historicalPairingReliability } from "./pairingHistoryReliability";
import { calculateExactSwissForecast, type ExactSwissForecast, type SwissPairingSystem } from "./exactSwissForecast";

export const SWISS_OUTCOME_SAMPLES = 16;
export const MAX_SAMPLED_SWISS_PLAYERS = 120;
type Field = Map<number, ExactSwissForecast>;
const cache = new WeakMap<TournamentSnapshot, { key: string; field: Field }>();

function randomGenerator(text: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each sample completes whole boards, then solves the entire field. Frequencies
 * choose an opponent; they must not be displayed as calibrated probabilities.
 * Run in a cancellable worker: an individual synchronous solve cannot yield.
 */
function calculateOutcomeSampledSwissForecast(
  snapshot: TournamentSnapshot,
  targetRound: number,
  myStartNumber: number,
  system: SwissPairingSystem = "dutch",
  seedSalt = "production-v1",
): ExactSwissForecast | null {
  if (!isValidTournamentTargetRound(snapshot, targetRound)) return null;
  snapshot = swissParticipationScenario(normalizeTournamentResults(snapshot), targetRound);
  if (hasUnknownPriorPairingResults(snapshot, targetRound)) return null;
  const baseline = calculateExactSwissForecast(snapshot, targetRound, myStartNumber, system);
  if (!snapshot.players.some(p => p.startNumber === myStartNumber && p.active && !p.notPairedRounds?.includes(targetRound))) return baseline;
  if (snapshot.incompletePairingRounds?.some(round => round > 0 && round < targetRound)) return baseline;
  if (system !== "dutch" || snapshot.players.length > MAX_SAMPLED_SWISS_PLAYERS || snapshot.liveRound !== targetRound - 1) return baseline;
  const unresolved = snapshot.pairings.filter(p => p.round < targetRound && publishedGameResult(p) === null && p.whiteStartNumber !== null && p.blackStartNumber !== null);
  const liveGames = snapshot.pairings.filter(p => p.round === snapshot.liveRound && p.whiteStartNumber !== null && p.blackStartNumber !== null);
  const resolved = liveGames.filter(p => publishedGameResult(p) !== null).length;
  // Sixteen samples are too sparse early in a live round. Independent model
  // selection found useful proper-score gains only after most results arrived.
  if (!unresolved.length || resolved <= liveGames.length / 2 || unresolved.some(p => p.round !== snapshot.liveRound)) return baseline;
  const key = JSON.stringify([targetRound, system, seedSalt, snapshot.title, snapshot.formatLabel, snapshot.totalRounds,
    snapshot.players.map(p => [p.startNumber, p.rating, p.points, p.active, (p.notPairedRounds ?? []).filter(r => r <= targetRound), (p.halfPointByeRounds ?? []).filter(r => r < targetRound)]),
    snapshot.pairings.filter(p => p.round < targetRound).map(p => [p.round, p.whiteStartNumber, p.blackStartNumber,
      p.whiteStartNumber !== null && p.blackStartNumber !== null && publishedGameResult(p) === null ? null : p.result, p.decided])]);
  const cached = cache.get(snapshot);
  if (cached?.key === key) return cached.field.get(myStartNumber) ?? baseline;
  const random = randomGenerator(key);
  const players = new Map(snapshot.players.map(p => [p.startNumber, p]));
  const active = snapshot.players.filter(p => p.active && !p.notPairedRounds?.includes(targetRound));
  const votes = new Map<number, Map<number | null, { count: number; white: number; black: number; exact: ExactSwissForecast }>>();
  let successful = 0;
  for (let sample = 0; sample < SWISS_OUTCOME_SAMPLES; sample++) {
    const completed = structuredClone(snapshot);
    for (const game of completed.pairings) {
      if (game.round >= targetRound || publishedGameResult(game) !== null || game.whiteStartNumber === null || game.blackStartNumber === null) continue;
      const white = players.get(game.whiteStartNumber), black = players.get(game.blackStartNumber);
      const rated = Boolean(white?.rating && black?.rating);
      const expected = rated ? 1 / (1 + 10 ** ((black!.rating! - white!.rating!) / 400)) : 0.5;
      const draw = rated ? 0.2 * (1 - Math.abs(2 * expected - 1)) : 0.1;
      const u = random(), whiteWin = Math.max(0, expected - draw / 2);
      game.result = u < whiteWin ? "1-0" : u < whiteWin + draw ? "1/2-1/2" : "0-1";
      game.decided = true;
    }
    const field = active.map(p => [p.startNumber, calculateExactSwissForecast(completed, targetRound, p.startNumber, system)] as const);
    if (field.some(([, forecast]) => forecast === null)) continue;
    successful++;
    for (const [player, forecast] of field) {
      const exact = forecast!;
      let choices = votes.get(player);
      if (!choices) { choices = new Map(); votes.set(player, choices); }
      const choice = choices.get(exact.opponentStartNumber) ?? { count: 0, white: 0, black: 0, exact };
      choice.count++; choice.white += Number(exact.color === "white"); choice.black += Number(exact.color === "black");
      choices.set(exact.opponentStartNumber, choice);
    }
  }
  // The fitted model assumes a complete ensemble. Do not condition on only the
  // successful samples and silently discard solver failure probability mass.
  const result: Field = new Map();
  if (successful === SWISS_OUTCOME_SAMPLES) for (const [player, choices] of votes) {
    const original = calculateExactSwissForecast(snapshot, targetRound, player, system);
    const best = [...choices.entries()].sort((a,b) => b[1].count-a[1].count ||
      Number(b[0] === original?.opponentStartNumber)-Number(a[0] === original?.opponentStartNumber) ||
      (a[0] ?? Infinity)-(b[0] ?? Infinity))[0][1];
    result.set(player, { ...best.exact, color: best.white === best.black ? best.exact.color : best.white > best.black ? "white" : "black",
      estimatedLiveResults: true, sampling: { samples: SWISS_OUTCOME_SAMPLES, successful } });
  }
  cache.set(snapshot, { key, field: result });
  return result.get(myStartNumber) ?? baseline;
}

/** The worker also supplies chronological reliability for settled Dutch
 * reconstructions. It never adds these extra solves to an unfinished ensemble. */
export function calculateSampledSwissForecast(snapshot: TournamentSnapshot, targetRound: number, myStartNumber: number,
  system: SwissPairingSystem = "dutch", seedSalt = "production-v1"): ExactSwissForecast | null {
  const forecast = calculateOutcomeSampledSwissForecast(snapshot, targetRound, myStartNumber, system, seedSalt);
  if (!forecast || forecast.estimatedLiveResults || forecast.opponentStartNumber === null || system !== "dutch") return forecast;
  const history = historicalPairingReliability(snapshot, targetRound);
  return history ? { ...forecast, history } : forecast;
}
