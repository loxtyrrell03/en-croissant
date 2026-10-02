import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { resolveTournamentSnapshotEvidence as resolve } from "../src/features/tournaments/tournamentSnapshotEvidence.ts";
import type { EvidenceTournamentSnapshot as Snapshot, ResolvedTournamentEvidence as Resolved } from "../src/features/tournaments/tournamentSnapshotEvidenceTypes.ts";

function fixture(): Snapshot {
  return { tournamentId: "tiny-evidence", sourceUrl: "fixture://evidence", title: "Synthetic evidence",
    section: null, format: "swiss", formatLabel: "Swiss-System", totalRounds: 4, completedRound: 1,
    publishedRound: 1, liveRound: null, nextRound: 2, phase: "between-rounds", dateRange: null,
    timeControl: null, sourceUpdatedAt: null, fetchedAt: "synthetic", warnings: [],
    players: [1, 2, 3, 4].map(startNumber => ({ startNumber, name: `Player ${startNumber}`, fideId: null,
      federation: null, title: null, rating: null, rank: startNumber, points: 0, active: true })),
    pairings: [{ round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: 3, whitePoints: 999,
      blackPoints: 999, result: "1-0", decided: true },
      { round: 1, board: 2, whiteStartNumber: 2, blackStartNumber: 4, whitePoints: 999,
        blackPoints: 999, result: "½-½", decided: true }],
    roundStandings: [], incompletePairingRounds: [] };
}
const player = (resolved: Resolved, id = 1) => resolved.players.find(player => player.startNumber === id)!;
const sourceScore = (snapshot: Snapshot, id: number, points: number, round = 1) => {
  snapshot.evidenceVersion = 1;
  Object.assign(snapshot.players.find(player => player.startNumber === id)!, {
    points, scoreKnown: true, scoreRound: round, scoreSource: "published" });
};
let checks = 0, groups = 0;
const eq = (actual: unknown, expected: unknown, message?: string) => { checks++; assert.deepEqual(actual, expected, message); };
const ok = (condition: unknown, message?: string) => { checks++; assert.ok(condition, message); };
const test = (name: string, run: () => void) => { run(); groups++; console.log(`PASS ${name}`); };
const start = performance.now();

test("legacy scores require complete history, not rank, default zero or pairing-column numbers", () => {
  const snapshot = fixture(), before = structuredClone(snapshot), result = resolve(snapshot, 2);
  eq(result.players.map(player => player.aggregate.points), [1, .5, 0, .5]);
  eq(result.players.map(player => player.aggregate.source), ["reconstructed", "reconstructed", "reconstructed", "reconstructed"]);
  ok(result.allAssignmentsKnown && result.allRequiredResultsAvailable && result.allAggregateScoresKnown);
  eq(snapshot, before);
  snapshot.pairings.shift();
  snapshot.roundStandings = [{ round: 1, players: snapshot.players }];
  eq(player(resolve(snapshot, 2)).aggregate.points, null);
  eq(player(resolve(snapshot, 2)).aggregate.scoreKnown, false);
  eq(resolve(snapshot, 2).allAssignmentsKnown, false);
});

test("version is required and explicit published totals do not invent individual results", () => {
  const snapshot = fixture(); snapshot.pairings[0].result = null;
  sourceScore(snapshot, 1, 0);
  const result = resolve(snapshot, 2);
  eq(player(result).aggregate.points, 0); eq(player(result).aggregate.source, "published");
  eq(player(result).rounds[0].result, "unknown"); eq(result.allRequiredResultsAvailable, false);
  for (const version of [undefined, 0, 2]) {
    snapshot.evidenceVersion = version;
    eq(player(resolve(snapshot, 2)).aggregate.points, null);
  }
});

test("published adjustments and exact round scope remain authoritative", () => {
  const snapshot = fixture(); sourceScore(snapshot, 1, .5);
  eq(player(resolve(snapshot, 2)).aggregate.points, .5); // Known win plus organizer adjustment.
  eq(player(resolve(snapshot, 2)).rounds[0].award, 1);
  snapshot.completedRound = 2;
  snapshot.pairings.push({ ...snapshot.pairings[1], round: 2, whiteStartNumber: 1, blackStartNumber: 4 });
  const score = player(resolve(snapshot, 3)).aggregate;
  eq(score.points, 1); eq(score.basisRound, 1); eq(score.throughRound, 2); eq(score.source, "reconstructed");
  sourceScore(snapshot, 1, 9, 3);
  eq(player(resolve(snapshot, 3)).aggregate.points, 1.5); // Future claim cannot be used.
});

test("invalid or unknown compatibility values are unusable", () => {
  for (const points of [NaN, Infinity]) {
    const snapshot = fixture(); snapshot.pairings.shift(); sourceScore(snapshot, 1, points);
    const score = player(resolve(snapshot, 2)).aggregate;
    eq(score.points, null); ok(score.issues.includes("invalid-score-evidence"));
  }
  for (const scoreRound of [-1, .5, NaN]) {
    const snapshot = fixture(); snapshot.pairings.shift(); sourceScore(snapshot, 1, 1, scoreRound);
    eq(player(resolve(snapshot, 2)).aggregate.points, null);
  }
  const snapshot = fixture(); snapshot.pairings.shift(); sourceScore(snapshot, 1, 99);
  Object.assign(snapshot.players[0], { scoreKnown: false, scoreRound: null, scoreSource: "unknown" });
  eq(player(resolve(snapshot, 2)).aggregate.points, null);
});

test("partial standings preserve per-player authority and reject scope mismatch", () => {
  const snapshot = fixture(); snapshot.evidenceVersion = 1; snapshot.pairings[0].result = "unreadable";
  const row = { ...snapshot.players[0], points: 0, rank: null, scoreKnown: true as const, scoreRound: 1, scoreSource: "published" as const };
  snapshot.roundStandings = [{ round: 1, players: [row] }];
  const result = resolve(snapshot, 2);
  eq(player(result).aggregate.points, 0); eq(player(result, 3).aggregate.points, null);
  eq(player(result, 2).aggregate.points, .5);
  row.scoreRound = 0;
  eq(player(resolve(snapshot, 2)).aggregate.points, null);
  ok(player(resolve(snapshot, 2)).aggregate.issues.includes("invalid-score-evidence"));
  row.scoreRound = 3; // A historical table cannot be made future-scoped by a mismatching row.
  eq(player(resolve(snapshot, 2)).aggregate.points, null);
  ok(player(resolve(snapshot, 2)).aggregate.issues.includes("invalid-score-evidence"));
});

test("conflicting published totals and duplicate standings rows are exposed", () => {
  const snapshot = fixture(); sourceScore(snapshot, 1, .5);
  snapshot.roundStandings = [{ round: 1, players: [{ ...snapshot.players[0], points: 1 }] }];
  const score = player(resolve(snapshot, 2)).aggregate;
  eq(score.points, null); ok(score.issues.includes("conflicting-published-totals"));
  snapshot.players[0].scoreKnown = false;
  snapshot.roundStandings[0].players.push({ ...snapshot.roundStandings[0].players[0] });
  const duplicate = player(resolve(snapshot, 2)).aggregate;
  ok(duplicate.issues.includes("duplicate-score-row")); eq(duplicate.points, null); // Do not erase a possible published adjustment.
});

test("immediate live pending is distinct from historical unknown and target publication", () => {
  for (const [result, decided] of [[null, false], ["1F-unknown", true], ["1-0", false]] as const) {
    const snapshot = fixture(); Object.assign(snapshot, { completedRound: 0, liveRound: 1, phase: "round-in-progress" });
    Object.assign(snapshot.pairings[0], { result, decided });
    const live = resolve(snapshot, 2);
    eq(player(live).rounds[0].result, "live-pending"); eq(player(live).rounds[0].opponentStartNumber, 3);
    eq(player(live).rounds[0].color, "white"); eq(player(live).aggregate.points, 0);
    eq(live.allAssignmentsKnown, true); eq(live.allRequiredResultsAvailable, true); eq(live.allIndividualResultsKnown, false);
    snapshot.completedRound = 1;
    eq(player(resolve(snapshot, 2)).rounds[0].result, "unknown");
    snapshot.completedRound = 0; snapshot.liveRound = 2;
    eq(player(resolve(snapshot, 3)).rounds[0].result, "unknown");
    snapshot.pairings.push({ ...snapshot.pairings[0], round: 2, blackStartNumber: 4 });
    const published = resolve(snapshot, 2);
    eq(player(published).target.assignment, "paired"); eq(player(published).target.opponentStartNumber, 4);
    eq(player(published).target.result, "unknown"); eq(published.allRequiredResultsAvailable, false);
  }
});

test("solo awards remain known in either seat including legacy false zero", () => {
  for (const black of [false, true]) for (const [result, expected] of [["0", 0], ["½", .5], ["1", 1], [null, null], ["-", null]] as const) {
    const snapshot = fixture(); Object.assign(snapshot.pairings[0], { whiteStartNumber: black ? null : 1,
      blackStartNumber: black ? 1 : null, result, decided: false });
    const resolved = player(resolve(snapshot, 2));
    eq(resolved.rounds[0].assignment, "solo"); eq(resolved.rounds[0].award, expected); eq(resolved.aggregate.points, expected);
  }
});

test("missing rows are not zero or implicit late entry; explicit no-game awards are separate", () => {
  const snapshot = fixture(); snapshot.evidenceVersion = 1; snapshot.pairings.shift();
  snapshot.roundCoverage = [{ round: 1, pairingPage: "readable", statusPage: "unavailable", unresolvedRows: 0,
    duplicateStartNumbers: [], unaccountedStartNumbers: [] }];
  let result = resolve(snapshot, 2);
  eq(player(result).rounds[0].assignment, "missing"); eq(player(result).aggregate.points, null); eq(result.allAssignmentsKnown, false);
  snapshot.roundStatus = [{ round: 1, startNumber: 1, kind: "not-paired", award: null },
    { round: 1, startNumber: 3, kind: "not-yet-entered", award: 0 }];
  result = resolve(snapshot, 2);
  eq(result.allAssignmentsKnown, true); eq(result.allRequiredResultsAvailable, false);
  eq(player(result).aggregate.points, null); eq(player(result, 3).aggregate.points, 0);
  snapshot.roundStatus[0].award = .5;
  eq(resolve(snapshot, 2).allRequiredResultsAvailable, true); eq(player(resolve(snapshot, 2)).aggregate.points, .5);
  const complete = fixture(); complete.evidenceVersion = 1; complete.roundCoverage = snapshot.roundCoverage;
  ok(resolve(complete, 2).allAssignmentsKnown); // Unavailable art40 alone does not invalidate complete rows.
});

test("legacy status projections remain unverified hints, including permissive old absence grammar", () => {
  const snapshot = fixture(); snapshot.pairings.shift();
  snapshot.players[0].notPairedRounds = [1]; snapshot.players[2].halfPointByeRounds = [1];
  const result = resolve(snapshot, 2);
  eq(result.allAssignmentsKnown, false); eq(player(result).aggregate.points, null); eq(player(result, 3).aggregate.points, null);
  eq(player(result).rounds[0].legacyStatusHint, { notPaired: true, halfPointBye: false });
  eq(player(result, 3).rounds[0].legacyStatusHint, { notPaired: false, halfPointBye: true });
});

test("duplicate, self and unknown-player assignments reject all affected histories", () => {
  for (const mutation of ["identical", "second-opponent", "self", "outside-roster"] as const) {
    const snapshot = fixture();
    if (mutation === "identical") snapshot.pairings.push({ ...snapshot.pairings[0] });
    if (mutation === "second-opponent") snapshot.pairings.push({ ...snapshot.pairings[0], blackStartNumber: 4 });
    if (mutation === "self") snapshot.pairings[0].blackStartNumber = 1;
    if (mutation === "outside-roster") snapshot.pairings[0].blackStartNumber = 99;
    const result = resolve(snapshot, 2);
    eq(result.hasAssignmentConflicts, true); eq(result.allAssignmentsKnown, false); eq(result.allRequiredResultsAvailable, false);
    eq(player(result).aggregate.points, null); eq(player(result).rounds[0].assignment, "conflict");
    if (mutation === "identical") eq(player(result, 3).rounds[0].assignment, "conflict");
    if (mutation === "second-opponent") eq(player(result, 2).rounds[0].assignment, "conflict");
  }
  const sameBoard = fixture(); sameBoard.pairings[1].board = 1;
  ok(resolve(sameBoard, 2).allAssignmentsKnown);
});

test("status conflicts are separate; matching solo status does not double-count", () => {
  const snapshot = fixture(); snapshot.evidenceVersion = 1;
  snapshot.roundStatus = [{ round: 1, startNumber: 1, kind: "not-paired", award: 0 }];
  eq(player(resolve(snapshot, 2)).rounds[0].assignment, "conflict");
  Object.assign(snapshot.pairings[0], { blackStartNumber: null, result: "0" });
  eq(player(resolve(snapshot, 2)).aggregate.points, 0);
  snapshot.roundStatus[0].award = .5;
  eq(player(resolve(snapshot, 2)).rounds[0].assignment, "conflict");
  snapshot.roundStatus[0].award = 0; snapshot.roundStatus.push({ ...snapshot.roundStatus[0] });
  ok(player(resolve(snapshot, 2)).rounds[0].issues.includes("status-conflict"));
});

test("source incompleteness is separate from recognized result and total evidence", () => {
  const snapshot = fixture(); snapshot.evidenceVersion = 1; snapshot.incompletePairingRounds = [1];
  const result = resolve(snapshot, 2);
  eq(result.allAssignmentsKnown, false); eq(result.allIndividualResultsKnown, true); eq(result.allAggregateScoresKnown, true);
  eq(result.roundIssues, [{ round: 1, reasons: ["explicit-incomplete"] }]);
  snapshot.incompletePairingRounds = [];
  snapshot.roundCoverage = [{ round: 1, pairingPage: "readable", statusPage: "readable", unresolvedRows: 1,
    duplicateStartNumbers: [2], unaccountedStartNumbers: [3] }];
  eq(resolve(snapshot, 2).roundIssues[0].reasons, ["unresolved-rows", "reported-duplicates", "reported-unaccounted"]);
});

test("future totals, provenance, coverage and target pregame points never repair earlier history", () => {
  const snapshot = fixture(); snapshot.evidenceVersion = 1; snapshot.pairings[0].decided = false;
  const before = resolve(snapshot, 2), changed = structuredClone(snapshot);
  sourceScore(changed, 1, 99, 4);
  changed.roundStandings = [{ round: 4, players: changed.players.map(p => ({ ...p, points: Infinity, scoreKnown: true, scoreRound: 4, scoreSource: "published" })) }];
  changed.roundStatus = [{ round: 4, startNumber: 1, kind: "not-paired", award: 1 }];
  changed.roundCoverage = [{ round: 4, pairingPage: "unavailable", statusPage: "unreadable", unresolvedRows: 999,
    duplicateStartNumbers: [1], unaccountedStartNumbers: [2] }];
  changed.pairings.push({ ...changed.pairings[0], round: 4, whitePoints: 500, blackPoints: 500 });
  eq(resolve(changed, 2), before);
  changed.pairings.push({ ...changed.pairings[0], round: 2, blackStartNumber: 4, whitePoints: 1, blackPoints: 1 });
  const target = resolve(changed, 2);
  eq(player(target).aggregate, player(before).aggregate); eq(player(target).rounds, player(before).rounds);
  eq(player(target).target.assignment, "paired");
});

test("opening scope is known initial zero and malformed round arguments are rejected", () => {
  const snapshot = fixture(); const result = resolve(snapshot, 1);
  eq(result.aggregateThroughRound, 0); eq(player(result).aggregate.points, 0); eq(player(result).aggregate.source, "initial");
  eq(player(result).target.assignment, "paired"); eq(result.allIndividualResultsKnown, true);
  for (const target of [0, -1, .5, NaN]) { checks++; assert.throws(() => resolve(snapshot, target), RangeError); }
});

test("negative published adjustments are valid without rewriting game history", () => {
  const snapshot = fixture(); sourceScore(snapshot, 1, -.5);
  const result = resolve(snapshot, 2);
  eq(player(result).aggregate.points, -.5); eq(player(result).aggregate.source, "published");
  eq(player(result).rounds[0].award, 1);
  eq(player(result).aggregate.issues, []);
});

test("same-scope reconstructed conflicts are order independent and published authority overrides", () => {
  const snapshot = fixture(); sourceScore(snapshot, 1, .5);
  snapshot.players[0].scoreSource = "reconstructed";
  snapshot.roundStandings = [{ round: 1, players: [{ ...snapshot.players[0], points: 1 }] }];
  let result = player(resolve(snapshot, 2)).aggregate;
  eq(result.points, null); ok(result.issues.includes("conflicting-reconstructed-totals"));
  snapshot.players[0].points = 1; snapshot.roundStandings[0].players[0].points = .5;
  result = player(resolve(snapshot, 2)).aggregate;
  eq(result.points, null); ok(result.issues.includes("conflicting-reconstructed-totals"));
  snapshot.roundStandings[0].players[0].scoreSource = "published";
  eq(player(resolve(snapshot, 2)).aggregate.points, .5);
});

test("matching versioned solo status safely supplies an explicit missing award", () => {
  for (const award of [0, .5, 1] as const) {
    const snapshot = fixture(); snapshot.evidenceVersion = 1;
    Object.assign(snapshot.pairings[0], { blackStartNumber: null, result: null, decided: false });
    snapshot.roundStatus = [{ round: 1, startNumber: 1, kind: "not-paired", award }];
    const resolved = player(resolve(snapshot, 2));
    eq(resolved.rounds[0].assignment, "solo"); eq(resolved.rounds[0].award, award); eq(resolved.aggregate.points, award);
  }
});

test("orphan and empty rows remain field issues even with complete roster assignments", () => {
  for (const [whiteStartNumber, blackStartNumber, issue] of [[88, 99, "unknown-player"], [null, null, "empty-assignment"]] as const) {
    const snapshot = fixture(); snapshot.pairings.push({ ...snapshot.pairings[0], whiteStartNumber, blackStartNumber });
    const result = resolve(snapshot, 2);
    eq(result.allAssignmentsKnown, false); ok(result.roundIssues[0].reasons.includes(issue));
    eq(result.allAggregateScoresKnown, true);
  }
});

test("malformed additive containers and historical rows fail closed; future poison is ignored", () => {
  for (const property of ["roundStatus", "roundCoverage"] as const) {
    for (const value of [null, {}, "malformed", [null], [{ round: "1" }]]) {
      const snapshot = fixture(); snapshot.evidenceVersion = 1;
      Object.assign(snapshot, { [property]: value });
      const result = resolve(snapshot, 2);
      eq(result.allAssignmentsKnown, false); ok(result.evidenceIssues.length > 0);
    }
    const snapshot = fixture(); snapshot.evidenceVersion = 1;
    Object.assign(snapshot, { [property]: [{ round: 1 }] });
    eq(resolve(snapshot, 2).allAssignmentsKnown, false); ok(resolve(snapshot, 2).roundIssues.length > 0);
    Object.assign(snapshot, { [property]: [{ round: 3, poison: true }] });
    ok(resolve(snapshot, 2).allAssignmentsKnown); eq(resolve(snapshot, 2).evidenceIssues, []);
  }
  const snapshot = fixture(); snapshot.evidenceVersion = 1;
  snapshot.roundStatus = [{ round: 1, startNumber: 88, kind: "not-paired", award: 0 }];
  eq(resolve(snapshot, 2).allAssignmentsKnown, false);
});

test("target self/duplicate conflicts are independent of valid historical totals", () => {
  const snapshot = fixture(), before = resolve(snapshot, 2);
  snapshot.pairings.push({ ...snapshot.pairings[0], round: 2, blackStartNumber: 1 });
  let result = resolve(snapshot, 2);
  eq(player(result).target.assignment, "conflict"); ok(player(result).target.issues.includes("self-pairing"));
  eq(player(result).aggregate, player(before).aggregate); eq(result.allAssignmentsKnown, true);
  snapshot.pairings.pop();
  snapshot.pairings.push({ ...snapshot.pairings[0], round: 2 }, { ...snapshot.pairings[0], round: 2, blackStartNumber: 4 });
  result = resolve(snapshot, 2);
  eq(player(result).target.assignment, "conflict"); eq(player(result).target.opponentStartNumber, null);
  snapshot.pairings.reverse(); eq(resolve(snapshot, 2), result);
});

test("recognized forfeits remain distinct from played games and pending named assignments", () => {
  const snapshot = fixture(); snapshot.pairings[0].result = "+--";
  let resolved = player(resolve(snapshot, 2));
  eq(resolved.rounds[0].namedResult?.forfeit, "black"); eq(resolved.rounds[0].award, 1);
  snapshot.pairings[0].result = "1-0";
  eq(player(resolve(snapshot, 2)).rounds[0].namedResult?.forfeit, undefined);
  snapshot.pairings[0].decided = false;
  resolved = player(resolve(snapshot, 2));
  eq(resolved.rounds[0].namedResult, null); eq(resolved.rounds[0].opponentStartNumber, 3); eq(resolved.rounds[0].color, "white");
});

test("future declared status and completion labels cannot change historical admission", () => {
  const snapshot = fixture(); snapshot.evidenceVersion = 1; snapshot.pairings[0].decided = false;
  const prior = resolve(snapshot, 2);
  snapshot.phase = "complete";
  snapshot.roundStatus = [{ round: 2, startNumber: 1, kind: "not-paired", award: 0 }];
  const result = resolve(snapshot, 2);
  eq(player(result).aggregate, player(prior).aggregate); eq(player(result).rounds, player(prior).rounds);
  eq(player(result).target.assignment, "not-paired"); eq(result.allRequiredResultsAvailable, false);
  snapshot.players = []; snapshot.pairings = [];
  eq(resolve(snapshot, 2).allAggregateScoresKnown, false); eq(resolve(snapshot, 2).allAssignmentsKnown, false);
});

test("later derived totals cannot erase earlier published adjustments or conflicts", () => {
  const snapshot = fixture(); snapshot.completedRound = 2;
  snapshot.pairings.push({ ...snapshot.pairings[0], round: 2, blackStartNumber: 4 },
    { ...snapshot.pairings[1], round: 2, blackStartNumber: 3 });
  sourceScore(snapshot, 1, .5, 1);
  snapshot.roundStandings = [{ round: 1, players: [{ ...snapshot.players[0] }] }];
  const control = player(resolve(snapshot, 3)).aggregate;
  eq(control.points, 1.5); eq(control.basisRound, 1);
  sourceScore(snapshot, 1, 2, 2); snapshot.players[0].scoreSource = "reconstructed";
  let actual = player(resolve(snapshot, 3)).aggregate;
  eq(actual.points, 1.5); eq(actual.basisRound, 1); eq(actual.scoreKnown, true);
  ok(actual.issues.includes("conflicting-reconstructed-totals"));
  snapshot.roundStandings.push({ round: 1, players: [{ ...snapshot.roundStandings[0].players[0], points: .75 }] });
  actual = player(resolve(snapshot, 3)).aggregate;
  eq(actual.points, null); ok(actual.issues.includes("conflicting-published-totals"));
  snapshot.roundStandings.pop(); snapshot.pairings[2].decided = false;
  actual = player(resolve(snapshot, 3)).aggregate;
  eq(actual.points, null); ok(actual.issues.includes("unverified-reconstructed-total"));
  snapshot.pairings[2].decided = true; snapshot.players[0].points = 1.5;
  actual = player(resolve(snapshot, 3)).aggregate;
  eq(actual.points, 1.5); eq(actual.issues, []);
  // A newer published total can itself include another organizer adjustment.
  snapshot.players[0].scoreSource = "published"; snapshot.players[0].points = 1.25;
  actual = player(resolve(snapshot, 3)).aggregate;
  eq(actual.points, 1.25); eq(actual.basisRound, 2); eq(actual.source, "published");
});

test("malformed claimed score metadata fails closed even with completely known games", () => {
  for (const invalid of [{ scoreSource: "invented" }, { scoreKnown: false }, { scoreRound: null }, { scoreSource: null }]) {
    const snapshot = fixture(); sourceScore(snapshot, 1, 1); Object.assign(snapshot.players[0], invalid);
    const score = player(resolve(snapshot, 2)).aggregate;
    eq(score.points, null); ok(score.issues.includes("invalid-score-evidence"));
    snapshot.players[0].scoreRound = 3; // Explicit valid future scope is ignored first.
    eq(player(resolve(snapshot, 2)).aggregate.points, 1);
  }
});

test("malformed historical standings containers do not crash or authorize game-sum fallback", () => {
  for (const players of [null, {}, "unreadable", [null], [{ startNumber: "1" }]]) {
    const snapshot = fixture(); snapshot.evidenceVersion = 1;
    Object.assign(snapshot, { roundStandings: [{ round: 1, players }] });
    let result = resolve(snapshot, 2);
    eq(result.allAggregateScoresKnown, false); ok(player(result).aggregate.issues.includes("invalid-standings"));
    Object.assign(snapshot, { roundStandings: [{ round: 3, players }] });
    result = resolve(snapshot, 2);
    eq(result.allAggregateScoresKnown, true); eq(player(result).aggregate.points, 1);
  }
  for (const roundStandings of [null, {}, "unreadable", [null], [{ round: "1", players: [] }]]) {
    const snapshot = fixture(); snapshot.evidenceVersion = 1; Object.assign(snapshot, { roundStandings });
    eq(resolve(snapshot, 2).allAggregateScoresKnown, false);
  }
});

console.log(JSON.stringify({ groups, assertions: checks, elapsedMs: performance.now() - start,
  scope: "isolated pure evidence resolver; no product wiring, solver, worker, native or UI" }));
