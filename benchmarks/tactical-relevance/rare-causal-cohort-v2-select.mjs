// Output-blind public development selection. Prints data; never runs a classifier.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  collectTacticalSampleEvidence,
  selectTacticalDevelopmentCases,
} from "../../scripts/benchmarks/tactical-sample-evidence.mjs";

const source = process.argv[2];
if (!source) throw Error("Supply the existing immutable public fixture path");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const raw = readFileSync(source, "utf8");
const sourceSha256 = hash(raw);
if (sourceSha256 !== "c80356923da60cce5b48b37046a878290f36997862f921b944015a3cf69ccc88")
  throw Error("Unexpected fixture checksum");
const rows = raw
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
const exclusions = { excludedIds: new Set(), excludedGames: new Set() };
const exclusionFiles = [];
// Only repository-published benchmark evidence is read, never owner stores or
// private corpora. Omit explicitly owner/ordinary-account and mixed worker data.
const omitted = /(?:private|owner|chesscom|ordinary|built-worker)/i;
for (const name of readdirSync("benchmarks/tactical-relevance").sort()) {
  if (!/\.(json|md)$/.test(name) || omitted.test(name) || name.startsWith("rare-causal-cohort-v2"))
    continue;
  const path = `benchmarks/tactical-relevance/${name}`;
  const content = readFileSync(path, "utf8");
  const found = collectTacticalSampleEvidence(content, name.endsWith(".md") ? "markdown" : "json");
  for (const id of found.excludedIds) exclusions.excludedIds.add(id);
  for (const game of found.excludedGames) exclusions.excludedGames.add(game);
  for (const match of content.matchAll(
    /https:\/\/lichess\.org\/training\/([a-zA-Z0-9]{5})(?=[/#?\s)".]|$)/g,
  ))
    exclusions.excludedIds.add(`lichess:${match[1]}`);
  exclusionFiles.push({ path, sha256: hash(content) });
}
// A prior reviewed puzzle excludes every row from its source game, even if an
// old result omitted the game URL. No holdout position is selected or evaluated.
for (const row of rows)
  if (exclusions.excludedIds.has(row.id)) exclusions.excludedGames.add(row.sourceGroup);
const seed = "rare-causal-audit-2026-10-02-v2";
const themes = [
  "interference",
  "clearance",
  "deflection",
  "attraction",
  "xRayAttack",
  "intermezzo",
  "defensiveMove",
  "trappedPiece",
];
const cases = selectTacticalDevelopmentCases(rows, exclusions, { seed, themes, perTheme: 1 });
const used = new Set(cases.map((row) => row.sourceGroup));
const candidateGames = new Map();
for (const row of rows) {
  if (
    row.split !== "development" ||
    exclusions.excludedIds.has(row.id) ||
    exclusions.excludedGames.has(row.sourceGroup) ||
    used.has(row.sourceGroup)
  )
    continue;
  if (!candidateGames.has(row.sourceGroup))
    candidateGames.set(row.sourceGroup, {
      sourceGroup: row.sourceGroup,
      sourceGameUrl: row.sourceGameUrl.split("#")[0],
      selectionHash: hash(`${seed}:controls:${row.sourceGroup}`),
    });
}
const controlGames = [...candidateGames.values()]
  .sort((a, b) => a.selectionHash.localeCompare(b.selectionHash))
  .slice(0, 2);
if (controlGames.length !== 2) throw Error("Insufficient new public control games");
const remaining = rows.filter(
  (row) =>
    row.split === "development" &&
    !exclusions.excludedIds.has(row.id) &&
    !exclusions.excludedGames.has(row.sourceGroup),
);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      scope:
        "Output-blind source-game-disjoint development selection, not holdout, source-label truth or population accuracy",
      sourceFixture:
        "chessmistaketrainer/benchmarks/tactical-classifier/lichess-2026-08-02-fixture-v1.jsonl",
      sourceSha256,
      seed,
      themes,
      perTheme: 1,
      selection:
        "First SHA256(seed:id)-ordered eligible development row per ordered stratum; distinct source games. Controls are first two remaining SHA256(seed:controls:sourceGroup)-ordered games. No rating/result/engine/classifier filtering. Unavailable exports or plies are retained, never replaced.",
      reuseBoundary:
        "New relative to recorded public benchmark review; source fixture has already supported development. Not an independent unseen corpus.",
      exclusionBoundary:
        "Published benchmark JSON/Markdown evidence only; exclusion metadata is not evidence. Explicit owner/private/ordinary-account and mixed worker files are omitted; owner data are not accessed.",
      exclusionFiles,
      excludedIds: [...exclusions.excludedIds].sort(),
      excludedGames: [...exclusions.excludedGames].sort(),
      eligibleDevelopmentRows: remaining.length,
      eligibleStrata: Object.fromEntries(
        themes.map((theme) => [
          theme,
          remaining.filter((r) => r.sourceThemes.includes(theme)).length,
        ]),
      ),
      cases,
      controlGames,
      controlReachedPlies: [12, 20, 28],
      adjudication:
        "Not yet run. Source motifs nominate hypotheses only. Ordinary fixed-ply contexts are not presumed negatives. Freeze board hypotheses and contrary controls before any classifier call.",
    },
    null,
    2,
  ),
);
