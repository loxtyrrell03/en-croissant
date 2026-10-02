import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { collectTacticalSampleEvidence, selectTacticalDevelopmentCases } from "./tactical-sample-evidence.mjs";

// Selection uses only fixed source strata, IDs and source-game identities.
// Never inspect classifier labels/scores to decide which rows to retain.
const [source, output, exclusionsArgument, profile = "secondary"] = process.argv.slice(2);
const frozenExclusions = exclusionsArgument === "-" ? undefined : exclusionsArgument;
const profiles = {
  secondary: {
    seed: "secondary-theme-broad-2026-09-14",
    perTheme: 3,
    themes: [
      "interference",
      "defensiveMove",
      "zugzwang",
      "xRayAttack",
      "trappedPiece",
      "advancedPawn",
    ],
  },
  "cross-phase": {
    seed: "cross-phase-relevance-2026-09-14",
    perTheme: 2,
    themes: ["quietMove", "clearance", "deflection", "pawnEndgame", "rookEndgame", "opening"],
  },
};
const selectedProfile = profiles[profile];
if (!selectedProfile) throw new Error(`Unknown sampling profile: ${profile}`);
if (!source || !output || existsSync(output))
  throw new Error("Provide a local Lichess fixture and a new output filename");
const raw = readFileSync(source, "utf8");
const sourceSha256 = createHash("sha256").update(raw).digest("hex");
if (sourceSha256 !== "c80356923da60cce5b48b37046a878290f36997862f921b944015a3cf69ccc88")
  throw new Error("Unexpected source fixture; review its provenance before sampling");
const directory = "benchmarks/tactical-relevance";
const excludedIds = new Set();
const excludedGames = new Set();
if (frozenExclusions) {
  const frozen = JSON.parse(readFileSync(frozenExclusions, "utf8"));
  for (const id of frozen.excludedIds) excludedIds.add(id);
  for (const game of frozen.excludedGames) excludedGames.add(game);
}
for (const file of frozenExclusions
  ? []
  : readdirSync(directory).filter((name) => /\.(json|md)$/.test(name))) {
  const content = readFileSync(join(directory, file), "utf8");
  const evidence = collectTacticalSampleEvidence(content, file.endsWith(".md") ? "markdown" : "json");
  for (const id of evidence.excludedIds) excludedIds.add(id);
  for (const game of evidence.excludedGames) excludedGames.add(game);
}
const { seed, perTheme } = selectedProfile;
const rows = raw
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
const cases = selectTacticalDevelopmentCases(rows, { excludedIds, excludedGames }, selectedProfile);
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Fixed stratified development audit. Source motifs nominate mechanisms, not correct primary labels. No holdout rows are classified and no accuracy score is implied.",
      license: "CC0-1.0",
      sourceFixture:
        "chessmistaketrainer/benchmarks/tactical-classifier/lichess-2026-08-02-fixture-v1.jsonl",
      sourceSha256,
      seed,
      ...(frozenExclusions ? {} : {
        exclusionBasis: "Structured position/result/judgement identities and narrative reviews; nested exclusion inventories and metadata are not prior case evidence.",
        reuseBoundary: "New relative to recorded public cases, not an independent unseen dataset: this source fixture has already supported development. No holdout rows are selected.",
      }),
      ...(profile === "secondary" ? {} : { profile, perTheme }),
      selection: `First ${perTheme === 3 ? "three" : "two"} SHA-256 ordered unseen development rows per stratum, excluding prior source games and IDs. Distinct games across strata. Selection precedes chess judgement, engine analysis and classifier output.`,
      excludedIds: [...excludedIds].sort(),
      excludedGames: [...excludedGames].sort(),
      cases,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
process.stdout.write(
  JSON.stringify(
    {
      selected: cases.map(({ id, stratum, startFen, bestLine, sourceThemes }) => ({
        id,
        stratum,
        startFen,
        bestLine,
        sourceThemes,
      })),
    },
    null,
    2,
  ),
);
