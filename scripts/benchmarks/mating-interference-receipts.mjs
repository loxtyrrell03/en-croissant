import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
  matingInterferenceCases,
  reflectMatingInterference,
} from "../../src/utils/tests/fixtures/matingInterference.ts";

const [mode, input, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const examples = matingInterferenceCases.flatMap((row) => [
  row,
  { ...reflectMatingInterference(row), id: `${row.id}:black` },
]);
const report = read(input);
let receipt;
if (mode === "engine") {
  assert.equal(report.completed, 213);
  const publicIds = new Set(examples.map((row) => row.id));
  const searches = report.searches
    .filter((row) =>
      [...publicIds].some(
        (id) =>
          row.id === `${id}:best` ||
          row.id === `${id}:root` ||
          row.id.startsWith(`${id}:defence:`) ||
          row.id.startsWith(`${id}:decision:`),
      ),
    )
    .map((row) => ({
      id: row.id,
      fen: row.fen,
      searchMove: row.searchMove,
      lines: row.lines.map((line) => ({
        multipv: line.multipv,
        depth: line.depth,
        cp: line.cp,
        mate: line.mate,
        pvUci: line.pvUci,
        pvSan: line.pvSan,
      })),
    }));
  assert.equal(searches.length, 124);
  assert(!searches.some((row) => row.id.includes("private")));
  receipt = {
    scope:
      "Allowlisted constructed controls only. 213 fresh depth-16 searches: 124 public and 89 private. Every defence and recorded choice for the two public and two private positive mechanisms; private chess content is excluded. Full-position scores are not local proof values.",
    searches,
  };
} else if (mode === "worker") {
  const prior = read("benchmarks/tactical-relevance/built-worker-adapter102.json");
  const ids = new Set([
    ...prior.cases.map((row) => row.id),
    ...examples.map((row) => `mating-interference:${row.id}`),
    ...examples.flatMap((row) =>
      ["best", "root"].map((mode) => `mating-interference-engine:${row.id}:${mode}`),
    ),
  ]);
  assert.equal(report.cases.length, 763);
  assert.equal(ids.size, 763);
  assert.equal(new Set(report.cases.map((row) => row.id)).size, ids.size);
  const cases = report.cases.map((row) => {
    assert(ids.has(row.id));
    assert.equal(row.matchesSource, true);
    for (const key of ["elapsedMs", "startupMs", "classificationMs"])
      assert(Number.isFinite(row[key]) && row[key] >= 0);
    assert(row.primary.every((id) => typeof id === "string" && /^[a-zA-Z0-9_]+$/.test(id)));
    return {
      id: row.id,
      elapsedMs: row.elapsedMs,
      startupMs: row.startupMs,
      classificationMs: row.classificationMs,
      primary: row.primary,
      matchesSource: true,
    };
  });
  const changed = prior.cases.filter(
    (old) =>
      JSON.stringify(cases.find((row) => row.id === old.id).primary) !==
      JSON.stringify(old.primary),
  );
  receipt = {
    scope:
      "Allowlisted public IDs only. Actual controller and cold production worker; excludes engine/network/native UI. Stability and source agreement are not accuracy.",
    priorCount: prior.cases.length,
    changedPriorHeadlines: changed.map((row) => row.id),
    cases,
  };
  const elapsed = cases.map((row) => row.elapsedMs).sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      cases: cases.length,
      changed: receipt.changedPriorHeadlines,
      median: elapsed[Math.floor(elapsed.length / 2)],
      p95: elapsed[Math.ceil(elapsed.length * 0.95) - 1],
      max: elapsed.at(-1),
      maxCompute: Math.max(...cases.map((row) => row.classificationMs)),
    }),
  );
} else throw new Error("Use engine or worker mode");
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
