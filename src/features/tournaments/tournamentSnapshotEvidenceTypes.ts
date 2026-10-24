import type { TournamentPairing, TournamentPlayer, TournamentSnapshot } from "@/features/tournaments/platform";
import type { PairingScore, PublishedGameResult } from "./publishedPairingResult";

/** Additive producer contract. Absent/unsupported versions never authorize
 * numeric compatibility values or claimed source metadata. */
export type TournamentScoreEvidence =
  | { scoreKnown: true; scoreRound: number; scoreSource: "published" | "reconstructed" | "initial" }
  | { scoreKnown: false; scoreRound: null; scoreSource: "unknown" };

export type EvidenceTournamentPlayer = TournamentPlayer;
export interface TournamentRoundStatusEvidence {
  round: number;
  startNumber: number;
  kind: "not-paired" | "not-yet-entered";
  /** An explicit no-game assignment does not by itself establish zero. */
  award: PairingScore | null;
}
export interface TournamentRoundCoverageEvidence {
  round: number;
  pairingPage: "readable" | "unavailable" | "unreadable";
  statusPage: "readable" | "unavailable" | "unreadable";
  unresolvedRows: number;
  duplicateStartNumbers: number[];
  unaccountedStartNumbers: number[];
}
export type EvidenceTournamentSnapshot = TournamentSnapshot;

export type AssignmentIssue = "missing-assignment" | "duplicate-assignment" | "self-pairing" |
  "unknown-player" | "status-conflict" | "invalid-status" | "duplicate-roster";
export interface ResolvedRoundAssignment {
  round: number;
  assignment: "paired" | "solo" | "not-paired" | "not-yet-entered" | "missing" | "conflict";
  result: "known" | "live-pending" | "unknown";
  award: PairingScore | null;
  opponentStartNumber: number | null;
  color: "white" | "black" | null;
  /** Preserve explicit forfeits separately from played/pending assignments. */
  namedResult: PublishedGameResult | null;
  issues: AssignmentIssue[];
  /** Legacy producer used a permissive status parser. These are hints only. */
  legacyStatusHint: { notPaired: boolean; halfPointBye: boolean } | null;
}
export type AggregateIssue = "unknown-history" | "invalid-score-evidence" | "duplicate-score-row" |
  "invalid-standings" | "conflicting-published-totals" | "conflicting-reconstructed-totals" |
  "unverified-reconstructed-total";
export type RoundEvidenceIssue = "explicit-incomplete" | "unreadable-pairings" | "unresolved-rows" |
  "reported-duplicates" | "reported-unaccounted" | "invalid-coverage" | "invalid-status" |
  "unknown-player" | "empty-assignment";
export interface ResolvedAggregateScore {
  points: number | null;
  scoreKnown: boolean;
  /** Requested, exact scope, including when the total is unknown. */
  throughRound: number;
  source: "published" | "reconstructed" | "initial" | "unknown";
  basisRound: number | null;
  issues: AggregateIssue[];
}
export interface ResolvedPlayerEvidence {
  startNumber: number;
  aggregate: ResolvedAggregateScore;
  rounds: ResolvedRoundAssignment[];
  /** Target assignments are independent of prior-history admission. */
  target: ResolvedRoundAssignment;
}
export interface ResolvedTournamentEvidence {
  targetRound: number;
  aggregateThroughRound: number;
  sourceVersionRecognized: boolean;
  players: ResolvedPlayerEvidence[];
  roundIssues: { round: number; reasons: RoundEvidenceIssue[] }[];
  targetIssues: RoundEvidenceIssue[];
  /** Invalid additive containers whose historical scope cannot be established. */
  evidenceIssues: ("invalid-round-status" | "invalid-round-coverage")[];
  allAggregateScoresKnown: boolean;
  allAssignmentsKnown: boolean;
  allIndividualResultsKnown: boolean;
  /** Allows ordinary immediate live named games, but no historical guessing. */
  allRequiredResultsAvailable: boolean;
  hasAssignmentConflicts: boolean;
}

export type EvidencePairing = TournamentPairing;
