import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { castlingAliasCases } from "../../src/utils/tests/fixtures/castlingRelevance.ts";

const [input, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const prior = read("benchmarks/tactical-relevance/built-worker-adapter101.json");
const context = read("benchmarks/tactical-relevance/castling-stockfish-18.json");
const ids = new Set([
  ...prior.cases.map((row) => row.id),
  ...castlingAliasCases.map((row) => `castling-control:${row.id}`),
  ...context.cases.flatMap((row) => [
    `castling-source:${row.id}`,
    `castling-best:${row.id}`,
    `castling-reply:${row.id}`,
  ]),
  ...context.rareSearches.map((row) => `rare-root:${row.id}`),
]);
const report = read(input);
assert.equal(ids.size, 727);
assert.equal(report.cases.length, ids.size);
assert.equal(new Set(report.cases.map((row) => row.id)).size, ids.size);
const cases = report.cases.map((row) => {
  assert(ids.has(row.id), "Unknown or private input cannot enter a public receipt");
  for (const key of ["elapsedMs", "startupMs", "classificationMs"])
    assert(Number.isFinite(row[key]) && row[key] >= 0);
  assert(row.primary.every((id) => typeof id === "string" && /^[a-zA-Z0-9_]+$/.test(id)));
  assert.equal(row.matchesSource, true);
  return {
    id: row.id,
    elapsedMs: row.elapsedMs,
    startupMs: row.startupMs,
    classificationMs: row.classificationMs,
    primary: row.primary,
    matchesSource: true,
  };
});
for (const old of prior.cases)
  assert.deepEqual(cases.find((row) => row.id === old.id).primary, old.primary);
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Allowlisted public IDs only. Actual application controller and cold production worker on this Node host; excludes engine/network/native UI. Source agreement and unchanged headlines are not accuracy estimates.",
      startupDeadlineMs: 20000,
      deadlineMs: 3000,
      priorHeadlinesUnchanged: prior.cases.length,
      cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
const elapsed = cases.map((row) => row.elapsedMs).sort((a, b) => a - b);
console.log(
  JSON.stringify({
    cases: cases.length,
    priorHeadlinesUnchanged: prior.cases.length,
    mean: elapsed.reduce((a, b) => a + b, 0) / elapsed.length,
    median: elapsed[Math.floor(elapsed.length / 2)],
    p95: elapsed[Math.ceil(elapsed.length * 0.95) - 1],
    max: elapsed.at(-1),
    maxCompute: Math.max(...cases.map((row) => row.classificationMs)),
  }),
);
