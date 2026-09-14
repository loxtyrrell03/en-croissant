import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { parseUci, makeUci } from "chessops/util";
import { matingMechanismProbes } from "./mating-mechanism-probes.mjs";
import { matingMechanismExamples } from "../../src/utils/tests/fixtures/matingMechanismRelevance.ts";

const [enginePath, tracePath, output] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const sample = read("benchmarks/tactical-relevance/cross-phase-development.json");
const engine = read(enginePath),
  trace = read(tracePath),
  requests = matingMechanismProbes();
const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const play = (pos, uci) => {
  const move = parseUci(uci);
  assert.ok(move && pos.isLegal(move));
  const next = pos.clone();
  next.play(move);
  return next;
};
const legal = (pos) =>
  [...pos.allDests()].flatMap(([from, tos]) => [...tos].map((to) => makeUci({ from, to })));
assert.equal(engine.sourceSha256, sample.sourceSha256);
assert.equal(engine.completed, requests.length);
assert.equal(engine.searches.length, requests.length);
assert.equal(trace.cases.length, matingMechanismExamples.length);
assert.equal(new Set(engine.searches.map((s) => s.id)).size, requests.length);
const searches = engine.searches.map((search, index) => {
  const expected = requests[index];
  for (const key of ["id", "fen", "searchMove"]) assert.equal(search[key], expected[key]);
  for (const line of search.lines) {
    assert.equal(line.depth, 16);
    if (expected.searchMove) assert.equal(line.pvUci[0], expected.searchMove);
    let pos = position(search.fen);
    for (const move of line.pvUci) pos = play(pos, move);
  }
  const example = matingMechanismExamples.find((e) => search.id.startsWith(e.id + ":"));
  if (example && !search.id.endsWith(":missed")) {
    const bound = search.id.endsWith(":root")
      ? (example.pvUci.length + 1) / 2
      : search.id.includes(":last-") || example.id === "49h84"
        ? 1
        : search.id.endsWith(":" + example.pvUci[1])
          ? 2
          : 1;
    assert.ok(search.lines[0].mate > 0 && search.lines[0].mate <= bound, search.id);
  }
  return {
    id: search.id,
    fen: search.fen,
    ...(search.searchMove ? { searchMove: search.searchMove } : {}),
    lines: search.lines,
  };
});
const cases = trace.cases.map((row, index) => {
  const expected = matingMechanismExamples[index];
  assert.equal(row.id, expected.id);
  assert.equal(row.fen, expected.fen);
  assert.deepEqual(row.pvUci, expected.pvUci);
  assert.ok(row.proof);
  const root = play(position(row.fen), row.pvUci[0]);
  if (row.id === "49h84") {
    assert.deepEqual(legal(root), [row.pvUci[1]]);
    const after = play(root, row.pvUci[1]);
    assert.ok(play(after, row.proof.captureUci).isCheckmate());
    assert.equal(row.proof.blocker, parseUci(row.pvUci[1]).to);
  } else {
    const replies = [...row.proof.mating, ...row.proof.declined].map((b) =>
      makeUci(parseSan(root, b.reply)),
    );
    assert.deepEqual(new Set(replies), new Set(legal(root)));
    for (const branch of row.proof.mating) {
      const next = play(root, makeUci(parseSan(root, branch.reply)));
      const entered = play(next, makeUci(parseSan(next, branch.mate)));
      assert.deepEqual(
        new Set(branch.continuation.map((b) => b.replyUci)),
        new Set(legal(entered)),
      );
      for (const reply of branch.continuation) {
        const leaf = play(entered, reply.replyUci);
        assert.equal(makeFen(leaf.toSetup()), reply.fen);
        assert.ok(play(leaf, reply.mateUci).isCheckmate());
      }
    }
    for (const branch of row.proof.declined) {
      const next = play(root, makeUci(parseSan(root, branch.reply)));
      assert.ok(play(next, makeUci(parseSan(next, branch.answer))).isCheckmate());
    }
  }
  return { ...expected, proof: row.proof };
});
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Final 37 fresh depth-16 searches for three previously frozen real-game mating mechanisms, complete root/selected-branch defences, missed moves and eight constructed controls. Repeated witness searches are not independent puzzles. The sole-blocker/restored-receiver geometry probes are not legal variations. No paid inputs are exported.",
      sourceSha256: sample.sourceSha256,
      cases,
      searches,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  `Validated ${cases.length} complete mechanism traces and ${searches.length} fresh searches.`,
);
