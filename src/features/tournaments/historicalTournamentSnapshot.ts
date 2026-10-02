import { cachedTournamentEvidence } from "./tournamentForecastEvidence";
import { isValidTournamentTargetRound } from "./tournamentRoundMetadata";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import type { EvidenceTournamentPlayer, EvidenceTournamentSnapshot } from "./tournamentSnapshotEvidenceTypes";

/** Keep unscoped malformed evidence visible so resolution fails closed. Future
 * records are removed before their contents can affect an earlier checkpoint. */
function beforeRound<T extends { round: number }>(rows: T[] | undefined, round: number): T[] | undefined {
  if (rows === undefined || !Array.isArray(rows)) return rows;
  return rows.filter(row => !row || !Number.isInteger(row.round) || row.round < round);
}

function historicalPlayer(player: EvidenceTournamentPlayer, round: number): EvidenceTournamentPlayer {
  // Never change a future published points value to synthetic zero while
  // leaving its source/round claim attached to that zero.
  if (Number.isInteger(player.scoreRound) && player.scoreRound! >= round) {
    return { ...player, points: 0, rank: null, scoreKnown: false, scoreRound: null, scoreSource: "unknown" };
  }
  return player;
}

/** A pure backcast input, not a simulated outcome. No solver is called. Missing
 * prior assignments/results or invalid evidence refuse the backcast. Published
 * historical adjustments survive; current/future totals cannot repair it. */
export function historicalTournamentSnapshot(snapshot: TournamentSnapshot, round: number): EvidenceTournamentSnapshot | null {
  if (!isValidTournamentTargetRound(snapshot, round) || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.pairings)) return null;
  const source: EvidenceTournamentSnapshot = snapshot, versioned = source.evidenceVersion === 1;
  const sliced: EvidenceTournamentSnapshot = { ...source,
    players: source.players.map(player => historicalPlayer(player, round)),
    pairings: source.pairings.filter(pairing => pairing.round < round),
    roundStandings: versioned ? beforeRound(source.roundStandings, round) : [],
    roundStatus: versioned ? beforeRound(source.roundStatus, round) : undefined,
    roundCoverage: versioned ? beforeRound(source.roundCoverage, round) : undefined,
    incompletePairingRounds: Array.isArray(source.incompletePairingRounds)
      ? source.incompletePairingRounds.filter(value => value < round) : source.incompletePairingRounds,
    completedRound: round - 1, publishedRound: round - 1, liveRound: null, nextRound: round, phase: "between-rounds",
  };
  const evidence = cachedTournamentEvidence(sliced, round);
  if (!evidence || !evidence.allAssignmentsKnown || !evidence.allIndividualResultsKnown || !evidence.allAggregateScoresKnown) return null;
  const resolved = new Map(evidence.players.map(player => [player.startNumber, player]));
  return { ...sliced, evidenceVersion: 1,
    players: sliced.players.map(player => {
      const history = resolved.get(player.startNumber)!, score = history.aggregate;
      return { ...player, active: true, rank: null, points: score.points!, scoreKnown: true,
        scoreRound: round - 1, scoreSource: score.source as "initial" | "published" | "reconstructed",
        // Compatibility fields derive from resolved assignments, never legacy
        // free-text flags promoted merely by this synthetic evidence version.
        notPairedRounds: history.rounds.filter(row => row.assignment === "not-paired" || row.assignment === "not-yet-entered").map(row => row.round),
        halfPointByeRounds: history.rounds.filter(row => row.opponentStartNumber === null && row.award === .5).map(row => row.round),
      };
    }),
  };
}
