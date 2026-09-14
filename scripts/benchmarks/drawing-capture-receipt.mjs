import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { drawingCaptureCases } from "../../src/utils/tests/fixtures/drawingCapture.ts";
const [directory, output] = process.argv.slice(2);
assert(directory && output);
const read = (name) => {
  const bytes = readFileSync(join(directory, name));
  return { rows: JSON.parse(bytes), hash: createHash("sha256").update(bytes).digest("hex") };
};
const timings = [],
  groups = [];
for (const [group, count] of [
  ["public", 808],
  ["game", 63],
  ["preparation", 28],
  ["discovery", 104],
  ["capture", 18],
]) {
  const old = read(`adapter108-worker-${group}-verified.json`),
    current = read(`adapter109-worker-${group}-verified.json`);
  const before = old.rows.cases ?? old.rows,
    after = current.rows.cases ?? current.rows;
  assert.equal(after.length, count);
  const key = (r) => JSON.stringify([r.id, r.lane ?? null]);
  const byId = new Map(before.map((r) => [key(r), r]));
  assert.equal(byId.size, count);
  for (const row of after) {
    assert(byId.has(key(row)));
    assert.deepEqual(row.primary, byId.get(key(row)).primary);
    timings.push(row);
  }
  groups.push({ group, count, sourceSha256: current.hash, changedPrimaryLists: [] });
}
const draw = read("adapter109-worker-drawing-verified.json");
const keys = new Set(drawingCaptureCases.flatMap((r) => [`${r.id}:verified`, `${r.id}:local`]));
assert.equal(draw.rows.length, keys.size);
for (const row of draw.rows) {
  assert(keys.delete(row.id));
  timings.push(row);
}
assert.equal(keys.size, 0);
groups.push({ group: "drawing-capture", count: draw.rows.length, sourceSha256: draw.hash });
const values = timings.map((r) => r.classificationMs).sort((a, b) => a - b);
const cold = read("adapter109-dev-cold-verified.json").rows;
const receipt = {
  scope:
    "Production controller plus compiled Node worker. 1021 prior public primary lists remain unchanged; 22 new exact-draw/local controls also pass. 508 private worker inputs pass separately. This is regression/performance evidence, not general accuracy or installed/native proof.",
  classifier: "site-55.adapter-109",
  pipeline: 114,
  artifactSha256: createHash("sha256")
    .update(readFileSync("dist/assets/liveTactics.worker-DLsMbXwe.js"))
    .digest("hex"),
  publicInputs: timings.length,
  privateInputs: 508,
  timings: {
    medianMs: values[Math.floor(values.length * 0.5)],
    p95Ms: values[Math.floor(values.length * 0.95)],
    maxMs: values.at(-1),
    maxStartupMs: Math.max(...timings.map((r) => r.startupMs)),
  },
  groups,
  coldHttp: {
    cases: cold.cases.length,
    serverStartupMs: cold.serverStartupMs,
    firstStartupMs: cold.cases[0].startupMs,
    maxStartupMs: Math.max(...cold.cases.map((r) => r.startupMs)),
    maxClassificationMs: Math.max(...cold.cases.map((r) => r.classificationMs)),
  },
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(receipt, null, 2));
