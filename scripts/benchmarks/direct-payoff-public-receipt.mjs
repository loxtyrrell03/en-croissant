import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci, makeUci } from "chessops/util";
import {
  directMaterialPayoffCases,
  reflectPayoff,
} from "../../src/utils/tests/fixtures/directMaterialPayoff.ts";

const [enginePath, workerPath, engineOutput, workerOutput] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
assert(enginePath && workerPath && engineOutput && workerOutput);
const allowed = new Map();
for (const row of [...directMaterialPayoffCases, ...directMaterialPayoffCases.map(reflectPayoff)]) {
  const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  for (const [index, uci] of row.pvUci.entries()) {
    const move = parseUci(uci);
    assert(move && pos.isLegal(move));
    allowed.set(`payoff:${row.id}:ply${index + 1}`, {
      fen: makeFen(pos.toSetup()),
      searchMove: uci,
    });
    pos.play(move);
  }
}
const real = directMaterialPayoffCases[0];
const pos = Chess.fromSetup(parseFen(real.fen).unwrap()).unwrap();
pos.play(parseUci(real.pvUci[0]));
for (const [from, destinations] of pos.allDests())
  for (const to of destinations) {
    const move = { from, to };
    assert(pos.isLegal(move));
    allowed.set(`payoff:real-defence:${makeUci(move)}`, {
      fen: makeFen(pos.toSetup()),
      searchMove: makeUci(move),
    });
  }
const engine = read(enginePath);
assert.equal(
  engine.sourceSha256,
  createHash("sha256")
    .update(readFileSync("src/utils/tests/fixtures/directMaterialPayoff.ts"))
    .digest("hex"),
);
assert.equal(engine.completed, allowed.size);
assert.equal(new Set(engine.searches.map((row) => row.id)).size, allowed.size);
const searches = engine.searches.map((row) => {
  assert.deepEqual({ fen: row.fen, searchMove: row.searchMove }, allowed.get(row.id));
  for (const line of row.lines) {
    assert.equal(line.depth, 16);
    assert.equal(line.pvUci[0], row.searchMove);
    const board = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    for (const uci of line.pvUci) {
      const move = parseUci(uci);
      assert(move && board.isLegal(move));
      board.play(move);
    }
  }
  return { id: row.id, fen: row.fen, searchMove: row.searchMove, lines: row.lines };
});
writeFileSync(
  engineOutput,
  JSON.stringify(
    {
      scope:
        "Fresh fixed-move Stockfish 18 depth-16 searches on public mechanism/colour controls and every legal defence of the real discovery. Scores are root-side-relative whole-position evaluations, not local capture values or accuracy labels.",
      searches,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);

const prior = read("benchmarks/tactical-relevance/built-worker-adapter100.json");
const context = read("benchmarks/tactical-relevance/black-context-stockfish-18.json");
const ids = new Set([
  ...prior.cases.map((row) => row.id),
  ...[...directMaterialPayoffCases, ...directMaterialPayoffCases.map(reflectPayoff)].map(
    (row) => `direct-payoff:${row.id}`,
  ),
  ...[...context.cases, ...context.responses].map((row) => `black-context:${row.id}`),
]);
const worker = read(workerPath);
assert.equal(worker.cases.length, ids.size);
assert.equal(new Set(worker.cases.map((row) => row.id)).size, ids.size);
const cases = worker.cases.map((row) => {
  assert(ids.has(row.id), "Private or unknown input cannot enter public receipt");
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
  workerOutput,
  JSON.stringify(
    {
      scope:
        "Actual application controller and fresh production worker imports on this Node host. Allowlisted public IDs and timing/primary summaries only. Excludes engine, network lookup and native UI latency; source agreement is not general accuracy.",
      deadlineMs: 3000,
      startupDeadlineMs: 20000,
      cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  `Exported ${searches.length} public engine probes and ${cases.length} public worker summaries.`,
);
