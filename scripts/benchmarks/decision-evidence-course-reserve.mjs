// A fresh course reserve excludes every previously inspected root and every
// identified player pair, with one new exercise per pair. Paid course data
// stays in private, versioned samples.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PgnParser } from "chessops/pgn";
import { annotatedGameGroup, auditGroups, headerGameGroup } from "./decision-evidence-groups.mjs";
import { preparePrivatePgnSample, privateReportPath } from "./private-pgn-sample.mjs";

const [courseRoot, priorAuditPath, outputDirectory, countArg = "20", ...additionalSamples] =
  process.argv.slice(2);
if (!outputDirectory) throw new Error("Provide courses, prior group audit and a private directory");
const count = Number(countArg);
if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid per-course count");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const rootKey = (fen) => fen.split(" ").slice(0, 4).join(" ");
const priorAuditBytes = readFileSync(priorAuditPath);
const priorAudit = JSON.parse(priorAuditBytes);
const priorGroups = new Set(priorAudit.cases.map((row) => row.sourceGroup));
const seenPositions = new Set(priorAudit.cases.map((row) => rootKey(row.fen)));
for (const path of additionalSamples)
  for (const row of JSON.parse(readFileSync(path, "utf8")).cases)
    seenPositions.add(rootKey(row.fen));

const cases = [];
const sources = [];
for (const [prefix, category] of [
  ["08 -", "tactical-course"],
  ["09 -", "positional-course"],
]) {
  const directory = readdirSync(courseRoot).find((name) => name.startsWith(prefix));
  if (!directory) throw new Error(`Missing course ${prefix}`);
  const candidates = [];
  for (const chapter of readdirSync(join(courseRoot, directory))
    .filter((name) => name.endsWith(".pgn"))
    .sort()) {
    const source = readFileSync(join(courseRoot, directory, chapter), "utf8");
    const moves = preparePrivatePgnSample(source, Number.MAX_SAFE_INTEGER);
    const games = [];
    new PgnParser((game, error) => {
      if (error) throw error;
      games.push(game);
    }).parse(source);
    sources.push({
      category,
      chapter,
      sha256: moves.sourceSha256,
      eligible: moves.eligiblePositions,
    });
    for (const row of moves.cases) {
      const key = rootKey(row.fen);
      if (seenPositions.has(key)) continue;
      const game = games[row.sourceGame - 1];
      const annotations = [
        ...(game.comments ?? []),
        ...Array.from(game.moves.mainline(), (node) => node.comments ?? []).flat(),
      ];
      const identity =
        annotations.map(annotatedGameGroup).find(Boolean) ??
        headerGameGroup(game.headers.get("Black") ?? "");
      if (!identity) continue;
      const sourceGroup = `annotated-game:${hash(identity)}`;
      if (priorGroups.has(sourceGroup)) continue;
      candidates.push({
        ...row,
        id: hash(key).slice(0, 20),
        sourceGroup,
        category,
        chapter,
        split: "validation",
        identityResolution: "player-pair",
      });
    }
  }
  const start = cases.length;
  for (const row of candidates.sort((a, b) =>
    hash(`reserve-v1:${a.id}`).localeCompare(hash(`reserve-v1:${b.id}`)),
  )) {
    if (priorGroups.has(row.sourceGroup) || seenPositions.has(rootKey(row.fen))) continue;
    cases.push(row);
    priorGroups.add(row.sourceGroup);
    seenPositions.add(rootKey(row.fen));
    if (cases.length - start === count) break;
  }
  if (cases.length - start !== count) throw new Error(`Insufficient unseen ${category} groups`);
}
const sample = JSON.stringify(
  {
    version: 2,
    sources,
    cases,
    excludedAuditSha256: hash(priorAuditBytes),
    protocol:
      "Hash selected, source-pair resolved; all prior player pairs and exact roots excluded.",
  },
  null,
  2,
);
const grouping = {
  sampleSha256: hash(sample),
  cases: cases.map(({ id, fen, split, sourceGroup, identityResolution }) => ({
    id,
    fen,
    split,
    sourceGroup,
    identityResolution,
  })),
  ...auditGroups(cases),
};
writeFileSync(privateReportPath(join(outputDirectory, "course-sample.json")), sample, {
  flag: "wx",
});
writeFileSync(
  privateReportPath(join(outputDirectory, "course-group-audit-final.json")),
  JSON.stringify(grouping, null, 2),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    cases: cases.length,
    uniqueSourcePairs: new Set(cases.map((row) => row.sourceGroup)).size,
    chaptersRead: sources.length,
  }),
);
