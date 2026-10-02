import test from "node:test";
import assert from "node:assert/strict";
import { collectTacticalSampleEvidence, selectTacticalDevelopmentCases } from "../benchmarks/tactical-sample-evidence.mjs";

const fen = "7k/8/8/8/8/8/P7/6K1 w - - 0 1";
const collect = (value) => collectTacticalSampleEvidence(JSON.stringify(value));
const empty = () => ({ excludedIds: new Set(), excludedGames: new Set() });
const row = (id, game, themes = ["pin"], split = "development") => ({
  id: `lichess:${id}`, sourceGroup: `game:${game}`, sourceGameUrl: `https://lichess.org/${game}`,
  split, sourceThemes: themes, startFen: fen, sourceFen: fen,
  precedingMove: "h8h7", bestLine: ["a2a3"],
});
const profile = { seed: "synthetic-output-blind", perTheme: 1, themes: ["pin", "skewer"] };

test("exclusion inventories and nested metadata are not examined positions", () => {
  const result = collect({
    excludedIds: ["lichess:old01"], excludedGames: ["game:oldgame1"],
    metadata: { cases: [row("meta1", "metagame")] },
    selection: { candidates: [row("meta2", "metagam2")] },
    nested: { excludedIds: ["lichess:old02"], excludedGames: ["game:oldgame2"] },
    scope: "Unexamined metadata mentions lichess:old03 and https://lichess.org/oldgame3",
  });
  assert.equal(result.excludedIds.size, 0);
  assert.equal(result.excludedGames.size, 0);
});

test("real nested positions retain puzzle and source-game exclusions", () => {
  const result = collect({ cases: [row("real1", "game0001")], reports: [{
    positions: [{ id: "context:game0002:ply15", fen }],
    results: [{ sourcePuzzleId: "real3", input: { fen }, gameId: "game0003" }],
  }] });
  assert.deepEqual([...result.excludedIds].sort(), ["lichess:real1", "lichess:real3"]);
  assert.deepEqual([...result.excludedGames].sort(), ["game:game0001", "game:game0002", "game:game0003"]);
});

test("reviewed output-only and provisional-judgement records remain prior evidence", () => {
  const result = collect([{ id: "lichess:real1", primary: null },
    { id: "lichess:real2", judgment: "Unresolved, not a correct negative" },
    { id: "lichess:meta1", description: "An unused metadata reference" }]);
  assert.deepEqual([...result.excludedIds].sort(), ["lichess:real1", "lichess:real2"]);
});

test("narrative reviews retain genuine prior puzzle and game references", () => {
  const result = collectTacticalSampleEvidence("Reviewed lichess:real1 at [the game](https://lichess.org/game0001).", "markdown");
  assert.deepEqual([...result.excludedIds], ["lichess:real1"]);
  assert.deepEqual([...result.excludedGames], ["game:game0001"]);
});

test("a quiet-mate exclusion of the whole old fixture does not exhaust that fixture", () => {
  const rows = [row("new01", "game0001"), row("new02", "game0002", ["skewer"])];
  const evidence = collect({ excludedIds: rows.map(r => r.id), excludedGames: rows.map(r => r.sourceGroup),
    cases: [row("quiet", "game9999", ["mateIn2"])] });
  assert.deepEqual(selectTacticalDevelopmentCases(rows, evidence, profile).map(r => r.id), rows.map(r => r.id));
  assert(evidence.excludedIds.has("lichess:quiet"));
});

test("selection is deterministic and ignores scores, labels and input ordering", () => {
  const rows = [row("new01", "game0001"), row("new02", "game0002"),
    row("new03", "game0003", ["skewer"]), row("new04", "game0004", ["skewer"])];
  const expected = selectTacticalDevelopmentCases(rows, empty(), profile);
  const changed = rows.toReversed().map(r => ({ ...r, result: "win", classifierCorrect: false, cp: -9000 }));
  assert.deepEqual(selectTacticalDevelopmentCases(changed, empty(), profile), expected);
});

test("holdout and unknown splits never become candidates even when development is exhausted", () => {
  const rows = [row("hold1", "game0001", ["pin"], "holdout"),
    row("other", "game0002", ["pin"], undefined), row("new03", "game0003", ["skewer"])];
  rows[1].split = "unknown";
  assert.throws(() => selectTacticalDevelopmentCases(rows, empty(), profile), /Insufficient new development rows: pin/);
});

test("prior IDs and every other position from a prior source game stay excluded", () => {
  const rows = [row("old01", "game0001"), row("new02", "game0002"),
    row("new03", "game0003"), row("new04", "game0004", ["skewer"])];
  const evidence = { excludedIds: new Set(["lichess:old01"]), excludedGames: new Set(["game:game0002"]) };
  assert.deepEqual(selectTacticalDevelopmentCases(rows, evidence, profile).map(r => r.id), ["lichess:new03", "lichess:new04"]);
});

test("strata cannot reuse one source game and short strata are reported, not replaced", () => {
  const rows = [row("new01", "game0001", ["pin", "skewer"]),
    row("new02", "game0001", ["skewer"]), row("new03", "game0003", ["skewer"])];
  const selected = selectTacticalDevelopmentCases(rows, empty(), profile);
  assert.equal(new Set(selected.map(r => r.sourceGroup)).size, 2);
  assert.equal(selected[1].id, "lichess:new03");
  assert.throws(() => selectTacticalDevelopmentCases(rows.slice(0, 2), empty(), profile), /Insufficient new development rows: skewer/);
});

test("malformed archives fail visibly rather than silently marking every case unseen", () => {
  assert.throws(() => collectTacticalSampleEvidence("not json"), SyntaxError);
});
