import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci, parseSquare } from "chessops/util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function promotionClearanceProbes(trace) {
  const probes = [];
  const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const add = (id, fen, searchMove) =>
    probes.push({ id, fen, ...(searchMove ? { searchMove } : {}) });
  const walk = (node, id) => {
    const pos = position(node.fen),
      move = parseUci(node.moveUci);
    assert.ok(pos.isLegal(move));
    add(id, node.fen, node.moveUci);
    pos.play(move);
    if (node.replies) {
      const legal = [...pos.allDests()].flatMap(([from, tos]) =>
        [...tos].map((to) => makeUci({ from, to })),
      );
      assert.deepEqual(new Set(node.replies.map((r) => r.replyUci)), new Set(legal));
      for (const reply of node.replies) {
        const next = pos.clone();
        next.play(parseUci(reply.replyUci));
        assert.equal(makeFen(next.toSetup()), reply.next.fen);
        walk(reply.next, `${id}:${reply.replyUci}`);
      }
    }
  };
  const root = position(trace.fen);
  root.play(parseUci(trace.pvUci[0]));
  assert.deepEqual(
    new Set(trace.proof.branches.map((b) => b.replyUci)),
    new Set(
      [...root.allDests()].flatMap(([from, tos]) => [...tos].map((to) => makeUci({ from, to }))),
    ),
  );
  for (const branch of trace.proof.branches) {
    const next = root.clone();
    next.play(parseUci(branch.replyUci));
    assert.equal(makeFen(next.toSetup()), branch.node.fen);
    walk(branch.node, `brn5j:${branch.replyUci}`);
  }
  add("brn5j:root", trace.fen, trace.pvUci[0]);
  add("brn5j:missed", trace.fen, "b6b8");
  for (const [id, remove, place] of [
    ["no-cleared-rook", "b6", null],
    ["no-forking-knight", "f1", null],
    ["second-promotion-guard", null, ["a8", "rook"]],
    ["counter-promotion", null, ["d2", "pawn"]],
  ]) {
    const pos = position(trace.fen);
    if (remove) pos.board.take(parseSquare(remove));
    if (place) pos.board.set(parseSquare(place[0]), { role: place[1], color: "black" });
    add(`control:${id}`, makeFen(pos.toSetup()), trace.pvUci[0]);
  }
  return probes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tracePath, output] = process.argv.slice(2),
    probes = promotionClearanceProbes(JSON.parse(readFileSync(tracePath, "utf8")));
  writeFileSync(
    output,
    JSON.stringify(
      { samplePath: "benchmarks/tactical-relevance/cross-phase-development.json", probes },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(`Prepared ${probes.length} selected-witness and contrary searches.`);
}
