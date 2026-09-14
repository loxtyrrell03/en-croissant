import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const save = (name, data) => {
  const path = `benchmarks/tactical-relevance/${name}`;
  const text = JSON.stringify(data, null, 2) + "\n";
  if (existsSync(path))
    assert.equal(readFileSync(path, "utf8"), text, "Refusing to replace a different receipt");
  else writeFileSync(path, text, { flag: "wx" });
};
const folder = process.argv[2];
const prior = read("benchmarks/tactical-relevance/built-worker-adapter98.json");
const sample = read("benchmarks/tactical-relevance/checking-pawn-development.json");
const publicIds = new Set([
  ...prior.cases.map((c) => c.id),
  ...[
    "root",
    "continuation",
    "missing-revealed-check",
    "no-material-victim",
    "checking-ray-interposition",
  ].map((id) => `direct-threat:${id}`),
  ...sample.cases.flatMap((c) => [`checking-capture:${c.id}`, `checking-capture:${c.id}:choice`]),
]);
const worker = read(join(folder, "adapter99-built-worker-final.json"));
assert.equal(publicIds.size, 527);
assert.equal(worker.cases.length, publicIds.size);
const cases = worker.cases.map((row) => {
  assert.ok(publicIds.delete(row.id), row.id);
  assert.equal(row.matchesSource, true);
  return {
    id: row.id,
    elapsedMs: row.elapsedMs,
    startupMs: row.startupMs,
    classificationMs: row.classificationMs,
    primary: row.primary,
    matchesSource: row.matchesSource,
  };
});
assert.equal(publicIds.size, 0);
const changed = prior.cases
  .filter(
    (row) =>
      JSON.stringify(row.primary) !== JSON.stringify(cases.find((c) => c.id === row.id).primary),
  )
  .map((row) => row.id);
assert.deepEqual(changed, []);
const times = cases.map((c) => c.elapsedMs).sort((a, b) => a - b);
save("built-worker-adapter99.json", {
  scope: worker.scope,
  deadlineMs: worker.deadlineMs,
  startupDeadlineMs: worker.startupDeadlineMs,
  cases,
});
const request = read(join(folder, "adapter99-direct-control-input.json"));
const engine = read(join(folder, "adapter99-direct-control-engine.json"));
assert.equal(request.probes.length, 10);
assert.equal(engine.searches.length, 10);
const searches = request.probes.map((probe) => {
  const row = engine.searches.find((s) => s.id === probe.id);
  assert.equal(row.fen, probe.fen);
  assert.equal(row.searchMove, probe.searchMove);
  for (const line of row.lines) {
    const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    assert.equal(line.pvUci[0], row.searchMove);
    for (const uci of line.pvUci) {
      const move = parseUci(uci);
      assert.ok(move && pos.isLegal(move));
      pos.play(move);
    }
  }
  return { id: row.id, fen: row.fen, searchMove: row.searchMove, lines: row.lines };
});
save("direct-threat-control-stockfish-18.json", {
  scope:
    "Ten fresh depth-16 Stockfish 18 searches on two constructed roots and legal witnesses. Scores are side-to-move full-position centipawns; they do not certify a local material bound or optimal move independently of search depth.",
  searches,
});
console.log(
  JSON.stringify(
    {
      publicCases: cases.length,
      unchangedPriorHeadlines: prior.cases.length,
      medianMs: times[Math.floor(times.length / 2)],
      p95Ms: times[Math.floor(times.length * 0.95)],
      maxMs: times.at(-1),
      maxStartupMs: Math.max(...cases.map((c) => c.startupMs)),
      maxClassificationMs: Math.max(...cases.map((c) => c.classificationMs)),
    },
    null,
    2,
  ),
);
