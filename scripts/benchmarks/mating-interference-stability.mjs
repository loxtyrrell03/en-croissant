import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { privateReportPath } from "./private-pgn-sample.mjs";
const [beforePath, afterPath, rareBeforePath, rareAfterPath, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const clean = (value) =>
  JSON.stringify(value, (key, value) =>
    ["motifClassifierVersion", "version"].includes(key) ? undefined : value,
  );
const before = read(beforePath).results.flatMap((group) => group.cases),
  after = read(afterPath).results.flatMap((group) => group.cases);
assert.equal(before.length, 246);
assert.equal(after.length, 246);
const changes = [];
for (const row of after) {
  const old = before.find((other) => other.id === row.id);
  assert(old);
  for (const mode of ["sourceResult", "scan"])
    if (clean(row[mode]) !== clean(old[mode])) changes.push(`${row.id}/${mode}`);
  if (row.id === "private-easy:10") {
    const comparable = structuredClone(row.scan);
    assert.equal(comparable.motifs[0].id, "deflection");
    const timeline = comparable.variations[0].timeline;
    const added = timeline.pop();
    assert.equal(added.id, "forcingAttack");
    assert.equal(added.ply, 5);
    assert.equal(added.value, 100);
    assert.equal(clean(comparable), clean(old.scan));
  }
  if (row.id === "private-easy:190") {
    for (const mode of ["sourceResult", "scan"]) {
      assert.equal(row[mode].motifs[0].id, "interference");
      assert.equal(row[mode].motifs[0].value, 230);
    }
    assert.equal(old.scan.motifs[0].id, "tacticalPreparation");
    assert.deepEqual(
      row.scan.arrows.map((arrow) => [arrow.from, arrow.to]),
      [
        ["e6", "e7"],
        ["c7", "g7"],
        ["g4", "g7"],
      ],
    );
  }
}
assert.deepEqual(changes.sort(), [
  "private-easy:10/scan",
  "private-easy:190/scan",
  "private-easy:190/sourceResult",
]);
const rareBefore = read(rareBeforePath).cases,
  rareAfter = read(rareAfterPath).cases;
assert.equal(rareAfter.length, 20);
for (const row of rareAfter)
  for (const mode of ["result", "scan"])
    assert.equal(
      clean(row[mode]),
      clean(rareBefore.find((old) => old.id === row.id)[mode]),
      row.id,
    );
const summary = {
  privatePositions: 246,
  unchangedPrivateFullResults: 244,
  changedModes: changes,
  rareFullResultsUnchanged: 20,
};
writeFileSync(
  privateReportPath(output),
  JSON.stringify(
    { scope: "Exact-input structural differential; unchanged does not mean correct.", summary },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(summary));
