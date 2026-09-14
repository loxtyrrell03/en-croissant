import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tablebaseCases } from "../../src/utils/tests/fixtures/tablebaseRelevance.ts";

const [input, output] = process.argv.slice(2);
assert(input && output, "<private worker report> <new public receipt> required");
const prior = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/built-worker-adapter99.json", "utf8"),
);
const report = JSON.parse(readFileSync(input, "utf8"));
const allowed = new Set([
  ...prior.cases.map((row) => row.id),
  ...tablebaseCases.map((row) => `tablebase:${row.id}`),
]);
assert.equal(report.cases.length, allowed.size);
assert.equal(new Set(report.cases.map((row) => row.id)).size, allowed.size);
const cases = report.cases.map((row) => {
  assert(allowed.has(row.id), "Private or unknown input cannot enter the public receipt");
  for (const key of ["elapsedMs", "startupMs", "classificationMs"])
    assert(Number.isFinite(row[key]) && row[key] >= 0);
  assert(
    Array.isArray(row.primary) &&
      row.primary.every((id) => typeof id === "string" && /^[a-zA-Z0-9_]+$/.test(id)),
  );
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
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Actual application controller and fresh production worker imports on this Node host. Only allowlisted public IDs and timing/primary summaries are included. Excludes engine, network lookup and native UI latency; source agreement is not general accuracy.",
      deadlineMs: 3000,
      startupDeadlineMs: 20000,
      cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`Published ${cases.length} allowlisted public worker summaries.`);
