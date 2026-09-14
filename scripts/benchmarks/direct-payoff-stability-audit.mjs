import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const [beforePath, afterPath, rareBeforePath, rareAfterPath, output] = process.argv.slice(2);
assert(beforePath && afterPath && rareBeforePath && rareAfterPath && output);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const before = read(beforePath),
  after = read(afterPath),
  rareBefore = read(rareBeforePath),
  rareAfter = read(rareAfterPath);
const clean = (value) =>
  JSON.stringify(value, (key, item) =>
    ["motifClassifierVersion", "version"].includes(key) ? undefined : item,
  );
const changes = [];
function compare(old, current, id, mode, path = []) {
  if (clean(old) === clean(current)) return;
  if (
    old?.id === "hangingPiece" &&
    current?.id === old.id &&
    old.label === "Hanging Piece" &&
    /^(Fork|Discovery|Pin|Skewer) Payoff$/.test(current.label)
  ) {
    const { label: oldLabel, evidence: oldEvidence, ...oldRest } = old;
    const { label: newLabel, evidence: newEvidence, ...newRest } = current;
    assert.equal(
      clean(oldRest),
      clean(newRest),
      "A payoff cannot change value, position, identity or causation",
    );
    changes.push({
      id,
      mode,
      path,
      ply: current.ply,
      moveUci: current.moveUci,
      value: current.value,
      oldLabel,
      newLabel,
      oldEvidence,
      newEvidence,
    });
    return;
  }
  assert(
    old && current && typeof old === "object" && typeof current === "object",
    `Unexpected semantic change: ${id}/${mode}/${path.join("/")}`,
  );
  const keys = (value) =>
    Object.keys(value)
      .filter((key) => !["motifClassifierVersion", "version"].includes(key))
      .sort();
  assert.deepEqual(keys(old), keys(current), "No additions or removals are expected");
  for (const key of keys(current)) compare(old[key], current[key], id, mode, [...path, key]);
}
let total = 0;
assert.equal(before.results.length, after.results.length);
for (const [index, group] of after.results.entries()) {
  assert.equal(group.cases.length, before.results[index].cases.length);
  for (const [caseIndex, row] of group.cases.entries()) {
    const old = before.results[index].cases[caseIndex];
    assert.equal(row.id, old.id);
    total++;
    for (const mode of ["sourceResult", "scan"]) compare(old[mode], row[mode], row.id, mode);
  }
}
const privateChanges = changes.slice();
assert.equal(rareBefore.cases.length, rareAfter.cases.length);
for (const [index, row] of rareAfter.cases.entries()) {
  const old = rareBefore.cases[index];
  assert.equal(row.id, old.id);
  for (const mode of ["result", "scan"]) compare(old[mode], row[mode], row.id, mode);
}
const rareChanges = changes.slice(privateChanges.length);
const count = (rows) => new Set(rows.map((row) => row.id)).size;
const summary = {
  privatePositions: total,
  privatePositionsWithPayoffChanges: count(privateChanges),
  privateSourceResultsChanged: count(privateChanges.filter((row) => row.mode === "sourceResult")),
  privateLiveResultsChanged: count(privateChanges.filter((row) => row.mode === "scan")),
  privateChangedEventsAcrossResultsAndVariations: privateChanges.length,
  rarePositions: rareAfter.cases.length,
  rarePositionsWithPayoffChanges: count(rareChanges),
  primaryOrOtherSemanticChanges: 0,
};
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Exact source/live structural comparison. Only four approved generic-capture-to-payoff labels and their explanations may change; values, primary lists, actors, plies, board arrows and causal comparisons must remain identical. Stability does not certify the underlying tactic.",
      summary,
      changes,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(summary));
