import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Deliberate allow-list: never copy a mixed/private course report into Git.
const [rootReport, witnessReport] = process.argv.slice(2);
const fixture = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/secondary-theme-development.json", "utf8"),
);
const roots = JSON.parse(readFileSync(rootReport, "utf8"));
const witnesses = JSON.parse(readFileSync(witnessReport, "utf8"));
if (
  roots.sourceSha256 !== fixture.sourceSha256 ||
  roots.cases.length !== 18 ||
  witnesses.searches.length !== 33 ||
  witnesses.sourceSha256 !== fixture.sourceSha256
)
  throw new Error("Incomplete/unrecognized public sample");
for (const row of roots.cases) {
  const original = fixture.cases.find((c) => c.id === row.id);
  if (
    !original ||
    original.startFen !== row.fen ||
    JSON.stringify(original.bestLine) !== JSON.stringify(row.sourceUci)
  )
    throw new Error("Unexpected source input");
}
const output = "benchmarks/tactical-relevance/secondary-theme-stockfish-18.json";
writeFileSync(
  resolve(output),
  JSON.stringify(
    {
      scope:
        "Eighteen frozen CC0 real-game roots plus 33 fresh decision/control searches. Initial root classifications use adapter 91 and are a baseline, not expected answers. All scores are side-to-move full-position depth-16 engine estimates, not local proof bounds or exact endgame outcomes.",
      license: "CC0-1.0",
      sourceSha256: fixture.sourceSha256,
      cases: roots.cases,
      decisionScope:
        "Decision probes include constructed controls and explicitly labelled turn-swap counterfactuals. They are not all playable game continuations.",
      searches: witnesses.searches,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
process.stdout.write(`Wrote public-only source/decision receipt: ${output}\n`);
