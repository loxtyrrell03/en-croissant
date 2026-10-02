import { publishedGameResult, publishedPairingScore } from "./publishedPairingResult";
import type {
  AggregateIssue, AssignmentIssue, EvidencePairing, EvidenceTournamentPlayer, EvidenceTournamentSnapshot,
  ResolvedAggregateScore, ResolvedRoundAssignment, ResolvedTournamentEvidence, TournamentRoundStatusEvidence,
  TournamentRoundCoverageEvidence, RoundEvidenceIssue,
} from "./tournamentSnapshotEvidenceTypes";

const validRound = (round: number) => Number.isInteger(round) && round >= 0;
const validAward = (award: unknown) => award === null || award === 0 || award === 0.5 || award === 1;
const members = (row: EvidencePairing) => [row.whiteStartNumber, row.blackStartNumber].filter((id): id is number => id !== null);
const unique = <T>(values: T[]): T[] => [...new Set(values)];

function scopedMetadata(snapshot: EvidenceTournamentSnapshot, target: number, versioned: boolean) {
  const status: TournamentRoundStatusEvidence[] = [], coverage: TournamentRoundCoverageEvidence[] = [];
  const issues: ResolvedTournamentEvidence["evidenceIssues"] = [];
  const byRound = new Map<number, RoundEvidenceIssue[]>();
  const problem = (round: number, issue: RoundEvidenceIssue) => byRound.set(round, [...(byRound.get(round) ?? []), issue]);
  const ids = (value: unknown): value is number[] => Array.isArray(value) && value.every(id => Number.isInteger(id) && id > 0);
  const page = (value: unknown) => ["readable", "unavailable", "unreadable"].includes(value as string);
  if (versioned) for (const kind of ["status", "coverage"] as const) {
    const entries = kind === "status" ? snapshot.roundStatus : snapshot.roundCoverage;
    const invalid = kind === "status" ? "invalid-round-status" : "invalid-round-coverage";
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) { issues.push(invalid); continue; }
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || !Number.isInteger(entry.round)) { issues.push(invalid); continue; }
      // Scope is checked first: even malformed future details are irrelevant.
      if (entry.round > target || entry.round <= 0) continue;
      if (kind === "status") {
        const value = entry as TournamentRoundStatusEvidence;
        if (!Number.isInteger(value.startNumber) || value.startNumber <= 0 || !validAward(value.award) ||
            !["not-paired", "not-yet-entered"].includes(value.kind)) problem(value.round, "invalid-status");
        else status.push(value);
      } else {
        const value = entry as TournamentRoundCoverageEvidence;
        if (!page(value.pairingPage) || !page(value.statusPage) || !Number.isInteger(value.unresolvedRows) || value.unresolvedRows < 0 ||
            !ids(value.duplicateStartNumbers) || !ids(value.unaccountedStartNumbers)) problem(value.round, "invalid-coverage");
        else coverage.push(value);
      }
    }
  }
  return { status, coverage, issues: unique(issues), byRound };
}

function resolveAssignments(snapshot: EvidenceTournamentSnapshot, round: number, target: number, versioned: boolean,
  status: TournamentRoundStatusEvidence[]): Map<number, ResolvedRoundAssignment> {
  const ids = snapshot.players.map(player => player.startNumber), roster = new Set(ids);
  const rows = snapshot.pairings.filter(row => row.round === round);
  const observations = status.filter(observation => observation.round === round);
  const issues = new Map<number, AssignmentIssue[]>();
  const add = (id: number, issue: AssignmentIssue) => issues.set(id, [...(issues.get(id) ?? []), issue]);
  for (const id of roster) {
    if (ids.filter(value => value === id).length > 1) add(id, "duplicate-roster");
    if (rows.filter(row => members(row).includes(id)).length > 1) add(id, "duplicate-assignment");
    if (observations.filter(status => status.startNumber === id).length > 1) add(id, "status-conflict");
  }
  for (const row of rows) {
    const assigned = members(row);
    if (assigned.some(id => !roster.has(id))) for (const id of assigned) add(id, "unknown-player");
    if (row.whiteStartNumber !== null && row.whiteStartNumber === row.blackStartNumber) add(row.whiteStartNumber, "self-pairing");
  }
  for (const status of observations) {
    if (!validAward(status.award) || !["not-paired", "not-yet-entered"].includes(status.kind)) add(status.startNumber, "invalid-status");
    for (const row of rows.filter(row => members(row).includes(status.startNumber))) {
      const award = publishedPairingScore(row, status.startNumber);
      if (members(row).length === 2 || status.kind === "not-yet-entered" ||
          (award !== null && status.award !== null && award !== status.award)) add(status.startNumber, "status-conflict");
    }
  }
  // An assignment involving a conflicted opponent is not a valid isolated
  // game for the other player either. Propagate across the connected rows.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const assigned = members(row), combined = unique(assigned.flatMap(id => issues.get(id) ?? []));
      for (const id of assigned) {
        const existing = issues.get(id) ?? [];
        if (combined.some(issue => !existing.includes(issue))) { issues.set(id, unique([...existing, ...combined])); changed = true; }
      }
    }
  }
  return new Map([...roster].map((id): [number, ResolvedRoundAssignment] => {
    const source = snapshot.players.find(player => player.startNumber === id)!;
    const notPaired = Array.isArray(source.notPairedRounds) && source.notPairedRounds.includes(round);
    const halfPointBye = Array.isArray(source.halfPointByeRounds) && source.halfPointByeRounds.includes(round);
    const legacyStatusHint = !versioned && (notPaired || halfPointBye) ? { notPaired, halfPointBye } : null;
    const base = { round, opponentStartNumber: null, color: null, award: null, namedResult: null, legacyStatusHint } as const;
    const conflict = unique(issues.get(id) ?? []);
    if (conflict.length) return [id, { ...base, assignment: "conflict", result: "unknown", issues: conflict }];
    const row = rows.find(row => members(row).includes(id));
    if (row) {
      const white = row.whiteStartNumber === id, opponent = white ? row.blackStartNumber : row.whiteStartNumber;
      const status = observations.find(observation => observation.startNumber === id);
      const award = publishedPairingScore(row, id) ?? (opponent === null ? status?.award ?? null : null);
      const livePending = opponent !== null && award === null && round < target &&
        round === target - 1 && round === snapshot.liveRound && round > snapshot.completedRound;
      return [id, { round, assignment: opponent === null ? "solo" : "paired", award,
        result: award !== null ? "known" : livePending ? "live-pending" : "unknown",
        opponentStartNumber: opponent, color: white ? "white" : "black", namedResult: publishedGameResult(row), issues: [], legacyStatusHint }];
    }
    const status = observations.find(status => status.startNumber === id);
    if (status) return [id, { ...base, assignment: status.kind, award: status.award,
      result: status.award === null ? "unknown" : "known", issues: [] }];
    return [id, { ...base, assignment: "missing", result: "unknown", issues: ["missing-assignment"] }];
  }));
}

type ScoreBasis = { round: number; points: number; source: "published" | "reconstructed" | "initial" };
function aggregateScore(snapshot: EvidenceTournamentSnapshot, id: number, through: number,
  rounds: ResolvedRoundAssignment[], versioned: boolean): ResolvedAggregateScore {
  const issues: AggregateIssue[] = [], bases: ScoreBasis[] = [{ round: 0, points: 0, source: "initial" }];
  function candidate(player: EvidenceTournamentPlayer, tableRound?: number) {
    // Future rows and source claims are excluded before validating contents;
    // poisoning future provenance cannot change an earlier resolution.
    if (tableRound === undefined && typeof player.scoreRound === "number" && validRound(player.scoreRound) && player.scoreRound > through) return;
    if (player.scoreKnown === undefined && player.scoreRound === undefined && player.scoreSource === undefined) return;
    if (player.scoreKnown === false && player.scoreRound === null && player.scoreSource === "unknown") return;
    if (player.scoreKnown !== true) { issues.push("invalid-score-evidence"); return; }
    if (!validRound(player.scoreRound!) || (tableRound !== undefined && player.scoreRound !== tableRound) ||
        !Number.isFinite(player.points) ||
        !["published", "reconstructed", "initial"].includes(player.scoreSource ?? "") ||
        (player.scoreSource === "initial" && (player.scoreRound !== 0 || player.points !== 0))) {
      issues.push("invalid-score-evidence"); return;
    }
    bases.push({ round: player.scoreRound!, points: player.points, source: player.scoreSource as ScoreBasis["source"] });
  }
  if (versioned) {
    const players = snapshot.players.filter(player => player.startNumber === id);
    if (players.length === 1) candidate(players[0]); else issues.push("duplicate-score-row");
    if (snapshot.roundStandings !== undefined && !Array.isArray(snapshot.roundStandings)) issues.push("invalid-standings");
    else for (const table of snapshot.roundStandings ?? []) {
      if (!table || typeof table !== "object" || !validRound(table.round)) { issues.push("invalid-standings"); continue; }
      if (table.round > through) continue;
      if (!Array.isArray(table.players) || table.players.some(player => !player || typeof player !== "object" ||
          !Number.isInteger(player.startNumber) || player.startNumber <= 0)) { issues.push("invalid-standings"); continue; }
      const matching = table.players.filter(player => player.startNumber === id);
      if (matching.length > 1) issues.push("duplicate-score-row");
      else if (matching.length) candidate(matching[0], table.round);
    }
  }
  const unknown = (): ResolvedAggregateScore => ({ points: null, scoreKnown: false, throughRound: through,
    source: "unknown", basisRound: null, issues: unique([...issues, "unknown-history"]) });
  // An ambiguous source table may contain an organizer adjustment. Falling
  // back to game sums would silently replace that published evidence.
  if (issues.some(issue => ["duplicate-score-row", "invalid-score-evidence", "invalid-standings"].includes(issue))) return unknown();
  function rollForward(basis: ScoreBasis, end: number): number | null {
    const later = rounds.filter(row => row.round > basis.round && row.round <= end);
    if (later.length !== end - basis.round || later.some(row => row.result !== "known" || row.award === null || row.issues.length)) return null;
    return basis.points + later.reduce((sum, row) => sum + row.award!, 0);
  }
  const published = bases.filter(base => base.source === "published");
  // A later derived claim cannot erase an earlier organizer adjustment or
  // conflict. Only a newer published total supplies a new authoritative anchor.
  const pool = published.length ? published : bases;
  const latestRound = Math.max(...pool.map(base => base.round));
  const authoritative = pool.filter(base => base.round === latestRound);
  if (new Set(authoritative.map(base => base.points)).size > 1) {
    issues.push(published.length ? "conflicting-published-totals" : "conflicting-reconstructed-totals"); return unknown();
  }
  const basis = authoritative[0];
  if (published.length) for (const derived of bases.filter(base => base.source === "reconstructed" && base.round > basis.round)) {
    const expected = rollForward(basis, derived.round);
    if (expected === null) issues.push("unverified-reconstructed-total");
    else if (expected !== derived.points) issues.push("conflicting-reconstructed-totals");
  }
  const points = rollForward(basis, through);
  if (points === null) return unknown();
  return { points, scoreKnown: true, throughRound: through, source: basis.round < through ? "reconstructed" : basis.source,
    basisRound: basis.round, issues: unique(issues) };
}

/** Pure evidence resolution only: no solver, attendance assumptions, mutation,
 * consumer wiring or inference of individual results from aggregate totals. */
export function resolveTournamentSnapshotEvidence(snapshot: EvidenceTournamentSnapshot, targetRound: number): ResolvedTournamentEvidence {
  if (!Number.isInteger(targetRound) || targetRound < 1) throw new RangeError("A positive target round is required");
  if (!validRound(snapshot.completedRound)) throw new RangeError("A nonnegative completed round is required");
  const versioned = snapshot.evidenceVersion === 1;
  const through = Math.min(snapshot.completedRound, targetRound - 1);
  const metadata = scopedMetadata(snapshot, targetRound, versioned);
  const assignments = Array.from({ length: targetRound }, (_, i) => resolveAssignments(snapshot, i + 1, targetRound, versioned, metadata.status));
  const roundIssues: ResolvedTournamentEvidence["roundIssues"] = [];
  const roster = new Set(snapshot.players.map(player => player.startNumber));
  let targetIssues: RoundEvidenceIssue[] = [];
  for (let round = 1; round <= targetRound; round++) {
    const reasons: RoundEvidenceIssue[] = [...(metadata.byRound.get(round) ?? [])];
    if (snapshot.incompletePairingRounds?.includes(round)) reasons.push("explicit-incomplete");
    const rows = snapshot.pairings.filter(row => row.round === round);
    if (rows.some(row => members(row).length === 0)) reasons.push("empty-assignment");
    if (rows.some(row => members(row).some(id => !roster.has(id))) ||
        metadata.status.some(status => status.round === round && !roster.has(status.startNumber))) reasons.push("unknown-player");
    const records = metadata.coverage.filter(record => record.round === round);
    if (records.length > 1) reasons.push("invalid-coverage");
    for (const record of records) {
      if (record.pairingPage !== "readable") reasons.push("unreadable-pairings");
      if (!Number.isInteger(record.unresolvedRows) || record.unresolvedRows < 0) reasons.push("invalid-coverage");
      if (record.unresolvedRows > 0) reasons.push("unresolved-rows");
      if (record.duplicateStartNumbers.length) reasons.push("reported-duplicates");
      if (record.unaccountedStartNumbers.length) reasons.push("reported-unaccounted");
      // No status-page success is required when unique pairing rows already
      // account for everyone. Its absence never fills a missing assignment.
    }
    if (round === targetRound) targetIssues = unique(reasons);
    else if (reasons.length) roundIssues.push({ round, reasons: unique(reasons) });
  }
  const players = unique(snapshot.players.map(player => player.startNumber)).map(startNumber => {
    const rounds = assignments.slice(0, -1).map(round => round.get(startNumber)!);
    return { startNumber, rounds, target: assignments[targetRound - 1].get(startNumber)!,
      aggregate: aggregateScore(snapshot, startNumber, through, rounds, versioned) };
  });
  const historical = players.flatMap(player => player.rounds);
  return { targetRound, aggregateThroughRound: through, sourceVersionRecognized: versioned, players, roundIssues, targetIssues, evidenceIssues: metadata.issues,
    allAggregateScoresKnown: players.length > 0 && players.every(player => player.aggregate.scoreKnown),
    allAssignmentsKnown: players.length > 0 && metadata.issues.length === 0 && roundIssues.length === 0 && historical.every(row => row.assignment !== "missing" && row.assignment !== "conflict"),
    allIndividualResultsKnown: players.length > 0 && historical.every(row => row.result === "known"),
    allRequiredResultsAvailable: players.length > 0 && historical.every(row => row.result === "known" || row.result === "live-pending"),
    hasAssignmentConflicts: historical.some(row => row.assignment === "conflict"),
  };
}
