import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [corePath, gamePath, preparationPath, discoveryPath, output] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path, "utf8"));
const prior = read("benchmarks/tactical-relevance/built-worker-adapter106.json");
const sample = read("benchmarks/tactical-relevance/discovered-capture-development.json");
const contexts = read("benchmarks/tactical-relevance/nature-context-development.json");
const key = row => row.lane ? `${row.id}:${row.lane}` : row.id;
const newIds = sample.cases.flatMap(row => ["original", "reflected"].flatMap(side =>
  ["root", "line"].map(lane => `${row.id}:${side}:${lane}`))).concat(
  contexts.cases.flatMap(row => ["source", "best", "response"].map(lane => `${row.id}:${lane}`)));
const groups = [
  ["cases", corePath, prior.cases.map(key)],
  ["contexts", gamePath, prior.contexts.map(key)],
  ["controls", preparationPath, prior.controls.map(key)],
  ["discovery", discoveryPath, newIds],
];
const receipt = { scope: "Allowlisted public production-controller inputs. Timings exclude engine and rendered UI. Stability and source parity are not accuracy. Private course inputs are excluded from this receipt.", changedPriorHeadlines: [] };
const all = [];
for (const [name, path, ids] of groups) {
  const expected = new Set(ids);
  const rows = read(path).cases.map(row => {
    assert(expected.delete(key(row)), "Unexpected or duplicate public case");
    assert(row.primary.every(theme => /^[A-Za-z0-9_]+$/.test(theme)));
    for (const time of [row.startupMs, row.classificationMs]) assert(Number.isFinite(time) && time >= 0);
    return { id: row.id, ...(row.lane ? { lane: row.lane } : {}),
      startupMs: row.startupMs, classificationMs: row.classificationMs, primary: row.primary };
  });
  assert.equal(expected.size, 0);
  for (const old of prior[name] ?? [])
    if (JSON.stringify(old.primary) !== JSON.stringify(rows.find(row => key(row) === key(old)).primary))
      receipt.changedPriorHeadlines.push({ group: name, id: key(old) });
  receipt[name] = rows;
  all.push(...rows);
}
assert.equal(all.length, 1003);
const times = all.map(row => row.classificationMs).sort((a, b) => a - b);
receipt.timing = { publicInputCount: all.length, scope: "Classification and structured transfer after worker startup, milliseconds",
  medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * 0.95)],
  maxMs: times.at(-1), maxStartupMs: Math.max(...all.map(row => row.startupMs)) };
receipt.inputHashes = groups.map(([name, path]) => ({ group: name,
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ changedPriorHeadlines: receipt.changedPriorHeadlines, timing: receipt.timing }));
