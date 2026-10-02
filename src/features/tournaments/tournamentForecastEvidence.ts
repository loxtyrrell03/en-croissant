import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { resolveTournamentSnapshotEvidence } from "./tournamentSnapshotEvidence";
import type { ResolvedTournamentEvidence } from "./tournamentSnapshotEvidenceTypes";
import { isValidTournamentTargetRound } from "./tournamentRoundMetadata";

const resolvedCache = new WeakMap<TournamentSnapshot, Map<number, ResolvedTournamentEvidence | null>>();
const preparedCache = new WeakMap<TournamentSnapshot, Map<number, TournamentForecastEvidence>>();
/** Bound the resolver's allocated player/round records, not the model's field
 * size. Oversized or malformed snapshots remain unavailable rather than freeze
 * the renderer; their source is not discarded or assigned a zero probability. */
export const MAX_RESOLVED_PLAYER_ROUNDS = 250_000;

export function cachedTournamentEvidence(
  snapshot: TournamentSnapshot,
  targetRound: number,
): ResolvedTournamentEvidence | null {
  let rounds = resolvedCache.get(snapshot);
  if (rounds?.has(targetRound)) return rounds.get(targetRound)!;
  let result: ResolvedTournamentEvidence | null = null;
  if (Number.isSafeInteger(targetRound) && targetRound >= 1 &&
      Number.isSafeInteger(snapshot.completedRound) && snapshot.completedRound >= 0 &&
      Array.isArray(snapshot.players) && Array.isArray(snapshot.pairings) &&
      targetRound <= MAX_RESOLVED_PLAYER_ROUNDS / Math.max(1, snapshot.players.length)) {
    const ids = snapshot.players.map(player => player?.startNumber);
    if (ids.length > 0 && ids.every(id => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length) {
      try { result = resolveTournamentSnapshotEvidence(snapshot, targetRound); }
      catch { /* Unreadable saved evidence must never authorize guessed totals. */ }
    }
  }
  if (!rounds) { rounds = new Map(); resolvedCache.set(snapshot, rounds); }
  rounds.set(targetRound, result);
  return result;
}

export type ForecastEvidenceIssue = "invalid-evidence" | "conflicting-target" | "incomplete-history" |
  "unknown-results" | "unknown-scores" | "adjusted-score" | "unknown-availability";

export interface TournamentForecastEvidence {
  snapshot: TournamentSnapshot;
  evidence: ResolvedTournamentEvidence | null;
  numericalAvailable: boolean;
  solverCompatible: boolean;
  issue: ForecastEvidenceIssue | null;
}

export function hasConflictingTournamentTarget(evidence: ResolvedTournamentEvidence | null): boolean {
  return evidence === null || evidence.evidenceIssues.length > 0 ||
    evidence.players.some(player => player.target.assignment === "conflict") ||
    evidence.targetIssues.some(issue => ["invalid-status", "invalid-coverage", "unknown-player", "empty-assignment", "reported-duplicates", "unresolved-rows"].includes(issue));
}

export function forecastEvidenceHelp(issue: ForecastEvidenceIssue | null): string | null {
  switch (issue) {
    case "invalid-evidence": return "The score and round history could not be verified. Pairing chances are unavailable; refresh the tournament to check the source.";
    case "conflicting-target": return "The next round has conflicting or unreadable assignment information. Pairing chances are unavailable until the organiser clarifies it.";
    case "incomplete-history": return "Some earlier assignments are missing or conflicting. Pairing chances are unavailable; an absent row is not a confirmed absence.";
    case "unknown-results": return "Some earlier results or no-game awards are unknown. Pairing chances remain unavailable until that history can be verified.";
    case "unknown-scores": return "Some players' scores could not be verified. Missing scores are unknown, not zero, so pairing chances are unavailable.";
    case "adjusted-score": return "Published totals differ from the recorded game awards. Those totals are preserved, but pairing chances are unavailable for this score adjustment.";
    case "unknown-availability": return "An older participation flag could not be verified. Pairing chances are unavailable until the tournament is refreshed; the player may still be entered.";
    default: return null;
  }
}

/** Resolve source evidence before any private participation projection. The
 * installed Swiss engine rebuilds scores from history and ignores Player.points;
 * authoritative adjusted totals must not silently enter a different score group. */
export function prepareTournamentForecastEvidence(
  snapshot: TournamentSnapshot,
  targetRound: number,
): TournamentForecastEvidence {
  let rounds = preparedCache.get(snapshot);
  const cached = rounds?.get(targetRound);
  if (cached) return cached;
  const evidence = isValidTournamentTargetRound(snapshot, targetRound)
    ? cachedTournamentEvidence(snapshot, targetRound) : null;
  if (evidence === null) {
    const result: TournamentForecastEvidence = { snapshot, evidence: null,
      numericalAvailable: false, solverCompatible: false, issue: "invalid-evidence" };
    if (!rounds) { rounds = new Map(); preparedCache.set(snapshot, rounds); }
    rounds.set(targetRound, result);
    return result;
  }
  let issue: ForecastEvidenceIssue | null = hasConflictingTournamentTarget(evidence) ? "conflicting-target" :
    !evidence.allAssignmentsKnown ? "incomplete-history" :
    !evidence.allRequiredResultsAvailable ? "unknown-results" :
    !evidence.allAggregateScoresKnown ? "unknown-scores" : null;
  if (evidence && issue === null && evidence.players.some(player => {
    const history = player.rounds.filter(row => row.round <= evidence.aggregateThroughRound);
    return history.some(row => row.result !== "known" || row.award === null) ||
      history.reduce((sum, row) => sum + row.award!, 0) !== player.aggregate.points;
  })) issue = "adjusted-score";
  const sourcePlayers = Array.isArray(snapshot.players) ? snapshot.players : [];
  if (issue === null && snapshot.evidenceVersion !== 1 && sourcePlayers.some(player =>
      !player.active || player.notPairedRounds?.includes(targetRound) ||
      player.halfPointByeRounds?.includes(targetRound))) issue = "unknown-availability";
  const byPlayer = new Map(evidence?.players.map(player => [player.startNumber, player]) ?? []);
  const players = sourcePlayers.map(player => {
    const resolved = byPlayer.get(player.startNumber);
    const aggregate = resolved?.aggregate;
    const known = aggregate?.scoreKnown === true && aggregate.points !== null;
    const statuses = snapshot.evidenceVersion === 1 && resolved ? [...resolved.rounds, resolved.target]
      .filter(row => row.assignment === "not-paired" || row.assignment === "not-yet-entered") : [];
    return {
      ...player,
      // Keep invalid/unknown source claims intact. Cleaning them to an empty
      // claim would let a serialized private view pass a later admission.
      ...(known ? { points: aggregate!.points!, scoreKnown: true,
        scoreRound: aggregate!.throughRound, scoreSource: aggregate!.source } : {}),
      // Legacy rank/compatibility points never establish a current score group.
      rank: snapshot.evidenceVersion === 1 && player.scoreKnown === true &&
        player.scoreSource === "published" && player.scoreRound === evidence?.aggregateThroughRound ? player.rank : null,
      // Compatibility arrays were parsed permissively by older producers.
      // Only explicit resolved statuses authorize a no-game projection now.
      ...(snapshot.evidenceVersion === 1 ? {
        active: !statuses.some(row => row.round === targetRound),
        notPairedRounds: statuses.map(row => row.round),
        halfPointByeRounds: statuses.filter(row => row.award === 0.5).map(row => row.round),
      } : {}),
    };
  });
  const prepared = { ...snapshot, players };
  const result = { snapshot: prepared, evidence, numericalAvailable: issue === null, solverCompatible: issue === null, issue };
  if (!rounds) { rounds = new Map(); preparedCache.set(snapshot, rounds); }
  rounds.set(targetRound, result);
  // Re-entering through exact/sample admission retains the same source proof.
  preparedCache.set(prepared, new Map([[targetRound, result]]));
  if (evidence) resolvedCache.set(prepared, new Map([[targetRound, evidence]]));
  return result;
}
