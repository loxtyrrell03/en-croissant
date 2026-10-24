// Output-blind nominations from the retained tiny public development fixture.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { collectTacticalSampleEvidence, selectTacticalDevelopmentCases } from "../../scripts/benchmarks/tactical-sample-evidence.mjs";

const source = process.argv[2];
if (!source) throw Error("Supply the retained public fixture path");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const raw = readFileSync(source, "utf8"), sourceSha256 = hash(raw);
if (sourceSha256 !== "c80356923da60cce5b48b37046a878290f36997862f921b944015a3cf69ccc88") throw Error("Unexpected fixture");
const rows = raw.trim().split(/\r?\n/).map((line) => JSON.parse(line));
const exclusions = { excludedIds: new Set(["lichess:EpYOT", "lichess:Qq0JW"]), excludedGames: new Set() };
const exclusionFiles = [];
for (const name of readdirSync("benchmarks/tactical-relevance").sort()) {
  if (!/\.(json|md)$/.test(name) || /(?:private|owner|chesscom|built-worker)/i.test(name) || name.startsWith("rare-mechanism-precision-v1")) continue;
  // Ordinary precision v1 is entirely public; other ordinary files may contain owner-account games.
  if (/ordinary/i.test(name) && !name.startsWith("ordinary-precision-v1")) continue;
  const path = `benchmarks/tactical-relevance/${name}`, content = readFileSync(path, "utf8");
  const found = collectTacticalSampleEvidence(content, name.endsWith(".md") ? "markdown" : "json");
  for (const id of found.excludedIds) exclusions.excludedIds.add(id);
  for (const game of found.excludedGames) exclusions.excludedGames.add(game);
  for (const match of content.matchAll(/https:\/\/lichess\.org\/training\/([a-zA-Z0-9]{5})(?=[/#?\s)".]|$)/g)) exclusions.excludedIds.add(`lichess:${match[1]}`);
  exclusionFiles.push({ path, sha256: hash(content) });
}
// Explicitly preserve the previous public-review exclusion inventory, not just its latest six positions.
const prior = JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-trap-adversarial-selection.json", "utf8"));
for (const id of prior.excludedIds) exclusions.excludedIds.add(id);
for (const game of prior.excludedGames) exclusions.excludedGames.add(game);
for (const row of prior.cases) { exclusions.excludedIds.add(row.id); exclusions.excludedGames.add(row.sourceGroup); }
for (const row of rows) if (exclusions.excludedIds.has(row.id)) exclusions.excludedGames.add(row.sourceGroup);
const seed = "rare-mechanism-precision-2026-10-02-v1", themes = ["interference", "deflection", "attraction"], perTheme = 2;
const cases = selectTacticalDevelopmentCases(rows, exclusions, { seed, themes, perTheme });
console.log(JSON.stringify({
  schemaVersion: 1, sourceSha256, seed, themes, perTheme,
  sourceFixture: "chessmistaketrainer/benchmarks/tactical-classifier/lichess-2026-08-02-fixture-v1.jsonl",
  baselineCommit: "9fad2cd685d88d10e962bd80384eb9aaf117072e",
  selection: "First SHA256(seed:id)-ordered eligible development rows per ordered stratum; two each with distinct source games. No classifier, engine, chess-quality or result filter. No replacements after observations.",
  scope: "New relative to recorded public review; already-used development source fixture, not an unseen holdout or population accuracy sample. Source labels nominate hypotheses, not adjudicated truth.",
  exclusionFiles, excludedIds: [...exclusions.excludedIds].sort(), excludedGames: [...exclusions.excludedGames].sort(), cases,
}, null, 2));
