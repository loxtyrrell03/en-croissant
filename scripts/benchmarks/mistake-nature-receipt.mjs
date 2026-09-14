import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [beforePath, afterPath, causalPath, output] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path, "utf8"));
const expected = new Map(["nature", "quiet-game"].flatMap(prefix =>
  read(`benchmarks/tactical-relevance/${prefix}-context-development.json`).cases.map(row => [row.id, row.fen])));
const before = read(beforePath).cases, after = read(afterPath).cases;
assert.equal(expected.size, 45);
assert.equal(before.length, expected.size);
assert.equal(after.length, expected.size);
const cases = after.map(row => {
  assert.equal(expected.get(row.id), row.input.fen, "Only the fixed public game contexts may be published");
  expected.delete(row.id);
  const previous = before.find(item => item.id === row.id);
  assert.deepEqual(previous.input, row.input);
  assert.deepEqual(previous.motifs, row.motifs, "This milestone changes nature, not motif proofs");
  return { id: row.id, fen: row.input.fen, best: row.input.bestMoveSan, played: row.input.playedMoveSan,
    cpLoss: row.input.cpLoss ?? null, before: previous.nature, after: row.nature,
    motifHeadline: row.explanation?.title ?? null };
});
assert.equal(expected.size, 0);
const causal = read(causalPath).cases;
const roots = read("benchmarks/tactical-relevance/causal-stockfish-18.json");
assert.equal(causal.length, roots.length);
for (const row of causal) {
  const original = roots.find(item => item.name === row.name);
  assert(original && original.fen === row.input.fen && original.played === row.input.playedMoveUci);
}
const count = key => cases.reduce((total, row) => {
  total[row[key].nature] = (total[row[key].nature] ?? 0) + 1;
  return total;
}, {});
writeFileSync(output, JSON.stringify({
  scope: "Mistake-nature v3 to v4 on 45 fixed public game boards, plus 32 reused causal lessons. Withholding an unsupported cause is not a correct-negative claim or an accuracy percentage. The source puzzle endpoints were previously reviewed; these are not representative all-chess holdouts.",
  sourceSha256: [beforePath, afterPath, causalPath].map(path => createHash("sha256").update(readFileSync(path)).digest("hex")),
  before: count("before"), after: count("after"), cases,
  causal: causal.map(row => ({ name: row.name, nature: row.nature, primary: row.explanation.primary.id, source: row.explanation.primary.source })),
}, null, 2) + "\n", { flag: "wx" });
console.log(`${cases.length} public context comparisons and ${causal.length} frozen causal lessons.`);
