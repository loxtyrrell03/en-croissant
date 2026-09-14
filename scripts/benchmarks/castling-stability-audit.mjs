import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { privateReportPath } from "./private-pgn-sample.mjs";

const [beforePath, afterPath, rareBeforePath, rareAfterPath, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const clean = (x) =>
  JSON.stringify(x, (key, value) =>
    ["motifClassifierVersion", "version"].includes(key) ? undefined : value,
  );
const before = read(beforePath),
  after = read(afterPath),
  rareBefore = read(rareBeforePath),
  rareAfter = read(rareAfterPath);
assert.equal(after.results.length, before.results.length);
let privatePositions = 0;
for (const [g, group] of after.results.entries()) {
  assert.equal(group.cases.length, before.results[g].cases.length);
  for (const [index, row] of group.cases.entries()) {
    const old = before.results[g].cases[index];
    assert.equal(row.id, old.id);
    for (const mode of ["sourceResult", "scan"])
      assert.equal(clean(row[mode]), clean(old[mode]), `${row.id}/${mode}`);
    privatePositions++;
  }
}
assert.equal(rareBefore.cases.length, rareAfter.cases.length);
for (const [index, row] of rareAfter.cases.entries()) {
  const old = rareBefore.cases[index];
  assert.equal(row.id, old.id);
  for (const mode of ["result", "scan"])
    assert.equal(clean(row[mode]), clean(old[mode]), `${row.id}/${mode}`);
}
const summary = { privatePositions, rarePositions: rareAfter.cases.length, fullResultsChanged: 0 };
writeFileSync(
  privateReportPath(output),
  JSON.stringify(
    {
      scope:
        "Exact complete source/live result comparison, excluding version metadata only. Unchanged is not independently certified accurate.",
      summary,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(summary));
