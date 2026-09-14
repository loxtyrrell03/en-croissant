import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import {
  interferenceExamples,
  compensatedInterference,
} from "../../src/utils/tests/fixtures/interferenceRelevance.ts";
import { interferenceWitnessProbes } from "./interference-relevance-probes.mjs";
import { interferenceControlProbes } from "./interference-relevance-controls.mjs";

const [tracePath, initialPath, witnessPath, controlPath, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const trace = read(tracePath);
const sourceSha256 = "c80356923da60cce5b48b37046a878290f36997862f921b944015a3cf69ccc88";
const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const replay = (fen, line) => {
  const pos = position(fen);
  for (const uci of line) {
    const move = parseUci(uci);
    assert.ok(move && pos.isLegal(move), `Illegal receipt move ${uci}`);
    pos.play(move);
  }
  return pos;
};
const legalMoves = (pos) =>
  [...pos.allDests()].flatMap(([from, tos]) => [...tos].map((to) => makeUci({ from, to })));
const validate = (fen, move, branches) => {
  const after = replay(fen, [move]);
  assert.equal(branches.length, legalMoves(after).length);
  assert.deepEqual(new Set(branches.map((b) => b.replyUci)), new Set(legalMoves(after)));
  for (const branch of branches) {
    assert.equal(branch.fen, makeFen(replay(fen, [move, branch.replyUci]).toSetup()));
    const next = replay(branch.fen, [branch.answerUci]);
    if (branch.recut) validate(branch.fen, branch.answerUci, branch.recut);
    if (branch.continuation) {
      const expected = new Set(
        legalMoves(next).map((reply) =>
          makeFen(replay(makeFen(next.toSetup()), [reply]).toSetup()),
        ),
      );
      assert.equal(branch.continuation.length, expected.size);
      assert.deepEqual(new Set(branch.continuation.map((leaf) => leaf.fen)), expected);
      for (const leaf of branch.continuation) replay(leaf.fen, [leaf.moveUci]);
    }
  }
};
assert.equal(trace.cases.length, interferenceExamples.length);
for (const [index, item] of interferenceExamples.entries()) {
  const row = trace.cases[index];
  assert.equal(row.id, item.id);
  assert.equal(row.row.startFen, item.fen);
  assert.deepEqual(row.row.bestLine, item.pvUci);
  validate(item.fen, item.pvUci[0], row.proof.branches);
}
assert.equal(trace.compensated.fen, compensatedInterference.fen);
assert.deepEqual(trace.compensated.pvUci, compensatedInterference.pvUci);
validate(trace.compensated.fen, trace.compensated.pvUci[0], trace.compensated.proof.branches);
const initial = interferenceExamples.flatMap((item) => {
  const pos = replay(item.fen, [item.pvUci[0]]);
  return legalMoves(pos).map((reply) => ({
    id: `${item.id}:${reply}`,
    fen: makeFen(replay(makeFen(pos.toSetup()), [reply]).toSetup()),
  }));
});
const sanitize = (path, requests) => {
  const report = read(path),
    allowed = new Map(requests.map((p) => [p.id, p]));
  assert.equal(report.sourceSha256, sourceSha256);
  assert.equal(report.completed, allowed.size);
  assert.equal(report.searches.length, allowed.size);
  assert.equal(new Set(report.searches.map((s) => s.id)).size, allowed.size);
  return report.searches.map((search) => {
    const expected = allowed.get(search.id);
    assert.ok(expected, `Unexpected private input ${search.id}`);
    assert.equal(search.fen, expected.fen);
    assert.equal(search.searchMove, expected.searchMove);
    assert.ok(search.lines.length > 0);
    const lines = search.lines.map(({ depth, multipv, cp, mate, pvUci, pvSan }) => {
      replay(search.fen, pvUci);
      if (search.searchMove) assert.equal(pvUci[0], search.searchMove);
      return { depth, multipv, cp, mate, pvUci, pvSan };
    });
    return {
      id: search.id,
      fen: search.fen,
      ...(search.searchMove ? { searchMove: search.searchMove } : {}),
      lines,
    };
  });
};
const receipt = {
  scope:
    "CC0 real-game and constructed development audit. Local all-defence material bounds are distinct from side-to-move full-position Stockfish estimates. These searches do not measure all-position accuracy or certify optimal witness play. No paid course data is exported.",
  sourceSha256,
  initialSearches: sanitize(initialPath, initial),
  witnessSearches: sanitize(witnessPath, interferenceWitnessProbes(trace)),
  controlSearches: sanitize(controlPath, interferenceControlProbes(trace)),
  proofs: trace.cases.map(({ id, row, proof }) => ({
    id,
    fen: row.startFen,
    pvUci: row.bestLine,
    proof,
  })),
  compensated: trace.compensated,
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
process.stdout.write(
  `Exported ${receipt.initialSearches.length + receipt.witnessSearches.length + receipt.controlSearches.length} allow-listed, legally replayed searches.\n`,
);
