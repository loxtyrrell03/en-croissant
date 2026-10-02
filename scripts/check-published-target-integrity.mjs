import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculatePairingForecast } from "../src/features/tournaments/pairingForecast.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const row = (white, black, result = null) =>
  ({ round: 2, board: 1, whiteStartNumber: white, blackStartNumber: black,
    whitePoints: 1, blackPoints: 0, result, decided: false });
function fixture() {
  return { tournamentId: "target-integrity", sourceUrl: "fixture://target-integrity", title: "Synthetic Swiss",
    section: null, format: "swiss", formatLabel: "Swiss-System", totalRounds: 4, completedRound: 1,
    publishedRound: 2, liveRound: null, nextRound: 2, phase: "pairings-published", dateRange: null,
    timeControl: null, sourceUpdatedAt: null, fetchedAt: "synthetic", warnings: [], incompletePairingRounds: [],
    players: [1, 2, 3, 4].map(startNumber => ({ startNumber, name: `Player ${startNumber}`, rating: 2000,
      points: startNumber < 3 ? 1 : 0, rank: startNumber, active: true, fideId: null, federation: null, title: null })),
    roundStandings: [], pairings: [1, 2].map(id => ({ ...row(id, id + 2, "1-0"), round: 1, board: id, decided: true })) };
}

/** Actual fallback only; no exact/sampled imports or workers. Also run by Vitest. */
export function verifyPublishedTargetIntegrity() {
  const rows = [];
  let assertions = 0, groups = 0;
  const eq = (actual, expected) => { assertions++; assert.deepEqual(actual, expected); };
  const check = (name, source, id = 1) => {
    const before = JSON.stringify(source), forecast = calculatePairingForecast(source, id, { exactSwiss: null });
    eq(JSON.stringify(source), before);
    rows.push({ name, player: id, inputSHA256: sha(before), forecast });
    return forecast;
  };
  const conflict = (name, source, id = 1) => {
    const actual = check(name, source, id);
    eq({ kind: actual.kind, confidence: actual.confidence, candidates: actual.candidates },
      { kind: "unavailable", confidence: "unavailable", candidates: [] });
    eq(actual.summary, "Round 2 pairing has conflicting source data");
    return actual;
  };
  {
    const source = fixture(); source.pairings.push(row(1, 1));
    conflict("self", source); groups++;
  }
  {
    const source = fixture(); source.pairings.push(row(1, 3), row(1, 4));
    for (const id of [1, 3, 4]) {
      const forward = conflict("multiple-opponents-forward", source, id);
      const reversed = conflict("multiple-opponents-reversed", { ...source, pairings: [...source.pairings].reverse() }, id);
      eq(forward, reversed);
    }
    groups++;
  }
  {
    const source = fixture(); source.pairings.push(row(1, 3), row(1, 3));
    conflict("duplicate-identical", source); conflict("duplicate-identical-other-seat", source, 3); groups++;
  }
  {
    const source = fixture(); source.pairings.push(row(1, 3), row(3, 4));
    conflict("opponent-also-assigned", source); groups++;
  }
  {
    for (const id of [1, 3]) {
      const source = fixture(); source.pairings.push(row(1, 3)); source.players.push({ ...source.players[id - 1] });
      conflict(`duplicate-roster-${id}`, source);
    }
    groups++;
  }
  {
    const source = fixture(); source.pairings.push(row(1, null, "0"), row(1, 3));
    conflict("solo-and-named", source);
    source.pairings.pop(); source.pairings.push(row(null, 1, "0")); conflict("two-solo-rows", source); groups++;
  }
  {
    const source = fixture(); source.pairings.push(row(1, 99));
    const actual = check("outside-roster", source);
    eq(actual.kind, "unavailable"); eq(actual.candidates, []); groups++;
  }
  {
    for (const black of [false, true]) for (const result of [null, "*", "1-0", "1F-unknown"]) {
      const source = fixture(); source.pairings.push(row(black ? 3 : 1, black ? 1 : 3, result));
      const actual = check(`unique-named-${black}-${result}`, source);
      eq(actual.kind, "confirmed"); eq(actual.candidates.map(c => [c.player.startNumber, c.probability, c.color]),
        [[3, 1, black ? "black" : "white"]]);
    }
    groups++;
  }
  {
    for (const black of [false, true]) for (const result of [null, "0", "½", "1"]) {
      const source = fixture(); source.pairings.push(row(black ? null : 1, black ? 1 : null, result));
      const actual = check(`unique-solo-${black}-${result}`, source);
      eq(actual.kind, "confirmed"); eq(actual.candidates, []);
    }
    groups++;
  }
  {
    const source = fixture(); source.pairings.push(row(1, 3));
    const control = check("unique-control", source);
    source.players[0].active = false; source.players[0].notPairedRounds = [2]; source.format = "other";
    eq(check("published-precedence", source), control);
    source.players.push({ ...source.players[1] });
    source.pairings.push({ ...row(1, 4), round: 3 }, { ...row(1, 2), round: 1 });
    eq(check("unrelated-roster-and-other-round-conflicts", source), control); groups++;
  }
  return { groups, assertions, states: rows.length, rows,
    scope: "Actual pure fallback; no exact/sampled solver, worker, native, UI, corpus or deployment." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = performance.now(), result = verifyPublishedTargetIntegrity();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const receipt = { ...result, elapsedMs: performance.now() - started, node: process.version,
    sourceSHA256: sha(readFileSync(resolve(root, "src/features/tournaments/pairingForecast.ts"))),
    harnessSHA256: sha(readFileSync(fileURLToPath(import.meta.url))) };
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === "--output"), "Use [--output NEW_RECEIPT_PATH]");
  if (args.length) { const destination = resolve(args[1]); mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" }); }
  console.log(JSON.stringify({ ...receipt, rows: undefined }));
}
