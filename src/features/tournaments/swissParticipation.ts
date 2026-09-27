import { publishedNoOpponentScore } from "./publishedNoOpponentScore";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import attendance from "./swissAttendanceWeights.json" with { type: "json" };

const projected = new WeakMap<TournamentSnapshot, Map<number, TournamentSnapshot>>();

/** Only explicit earlier zero-point absences count. A played loss, requested
 * half-point bye, unreadable round or unscored bye is not withdrawal evidence. */
export function priorZeroPointAbsences(snapshot: TournamentSnapshot, player: number, targetRound: number): number {
  const entry = snapshot.players.find(p => p.startNumber === player);
  if (!entry) return 0;
  let count = 0;
  for (let round = targetRound - 1; round > 0; round--) {
    if (snapshot.incompletePairingRounds?.includes(round) || entry.halfPointByeRounds?.includes(round)) break;
    const game = snapshot.pairings.find(p => p.round === round && (p.whiteStartNumber === player || p.blackStartNumber === player));
    if (game) {
      if (game.whiteStartNumber !== null && game.blackStartNumber !== null) break;
      if (publishedNoOpponentScore(game) !== 0) break;
    } else if (!entry.notPairedRounds?.includes(round)) break;
    count++;
  }
  return count;
}

export function estimatedAttendance(snapshot: TournamentSnapshot, player: number, targetRound: number): number {
  const count = priorZeroPointAbsences(snapshot, player, targetRound);
  return count === 0 ? 1 : count === 1 ? attendance.oneAbsence : attendance.repeatedAbsence;
}

/** This private solver scenario must never replace the source roster or its
 * confirmed availability. Public forecasts keep returning players as possible
 * alternatives and use Other for the estimated no-opponent probability. */
export function swissParticipationScenario(snapshot: TournamentSnapshot, targetRound: number): TournamentSnapshot {
  if (snapshot.format !== "swiss" || snapshot.players.length > 120 || targetRound < 2) return snapshot;
  let rounds = projected.get(snapshot);
  const cached = rounds?.get(targetRound);
  if (cached) return cached;
  const players = snapshot.players.map(p => p.active && priorZeroPointAbsences(snapshot, p.startNumber, targetRound) > 0 ? { ...p, active: false } : p);
  const scenario = players.some((p, i) => p !== snapshot.players[i]) ? { ...snapshot, players } : snapshot;
  if (!rounds) { rounds = new Map(); projected.set(snapshot, rounds); }
  rounds.set(targetRound, scenario);
  // Make applying the same assumption again cheap and idempotent.
  if (scenario !== snapshot) projected.set(scenario, new Map([[targetRound, scenario]]));
  return scenario;
}
