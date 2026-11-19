import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { preparePrivatePgnSample, privateReportPath } from "./private-pgn-sample.mjs";

// Source categories describe the course, not independently adjudicated positions.
// Freeze chapter-disjoint development/validation groups before engine inspection.
const [courseRoot, destination, requested = "120"] = process.argv.slice(2);
if (!courseRoot || !destination) {
  throw new Error("Provide the course directory, private output path and optional sample size.");
}
const count = Number(requested);
if (!Number.isSafeInteger(count) || count < 8 || count % 4 !== 0) {
  throw new Error("Sample size must be a positive multiple of four, at least eight.");
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = [];
const candidates = [];
const seen = new Set();
for (const prefix of ["08 -", "09 -"]) {
  const directory = readdirSync(courseRoot).find((name) => name.startsWith(prefix));
  if (!directory) throw new Error(`Missing course ${prefix}`);
  const category = prefix === "08 -" ? "tactical-course" : "positional-course";
  const chapters = readdirSync(join(courseRoot, directory))
    .filter((name) => name.endsWith(".pgn"))
    .sort((a, b) => hash(a).localeCompare(hash(b)));
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const file = join(courseRoot, directory, chapter);
    const sample = preparePrivatePgnSample(readFileSync(file, "utf8"), Number.MAX_SAFE_INTEGER);
    const split = chapterIndex % 2 === 0 ? "development" : "validation";
    sources.push({
      category,
      split,
      chapter: basename(file),
      sha256: sample.sourceSha256,
      parsed: sample.parsedGames,
      eligible: sample.eligiblePositions,
      rejected: sample.rejected,
    });
    for (const row of sample.cases) {
      const identity = row.fen.split(" ").slice(0, 4).join(" ");
      if (seen.has(identity)) continue;
      seen.add(identity);
      candidates.push({ ...row, category, split, chapter, id: hash(identity).slice(0, 20) });
    }
  }
}
const cases = [];
for (const category of ["tactical-course", "positional-course"]) {
  for (const split of ["development", "validation"]) {
    const group = candidates
      .filter((row) => row.category === category && row.split === split)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (group.length < count / 4) throw new Error(`Insufficient ${category} ${split} positions`);
    cases.push(...group.slice(0, count / 4));
  }
}
const output = privateReportPath(destination);
writeFileSync(
  output,
  JSON.stringify(
    {
      version: 1,
      protocol:
        "Chapter-disjoint development/validation; hash-selected legal distinct exercise roots before engine output. Course names are weak labels. Keep paid contents private.",
      sources,
      cases,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    sources: sources.length,
    eligible: candidates.length,
    sampled: cases.length,
    output,
  }),
);
