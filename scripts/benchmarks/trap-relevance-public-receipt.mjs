import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { trappedRookFen } from "../../src/utils/tests/fixtures/trapRelevance.ts";
import { buildTrapProbes } from "./trap-relevance-probes.mjs";

// Explicitly permit only this public/constructed audit. Never copy arbitrary
// private course reports or their classifier fields into the repository.
const [tracePath, initialPath, finalPath, requestsPath, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const trace = read(tracePath),
  initial = read(initialPath),
  final = read(finalPath),
  requests = read(requestsPath);
const sourceSha256 = "c80356923da60cce5b48b37046a878290f36997862f921b944015a3cf69ccc88";
assert.equal(trace.fen, trappedRookFen);
assert.equal(trace.move, "g1f2");
assert.equal(trace.oldFen, "4k2r/3nbppp/8/4p3/4P3/4Q3/PBq2PPP/RN2K2R b KQk - 0 17");
assert.deepEqual(
  trace.otherTraps.map((r) => [r.id, r.fen, r.move]),
  [
    ["counterplay", "rn4kr/pQ3pp1/1q5p/1B6/3P1PP1/4P1K1/PP5P/7R w - - 1 26", "b7d5"],
    ["j8Up4", "6k1/5p2/4p1pQ/7P/3b4/7r/2P3K1/8 b - - 3 36", "d4e3"],
    ["S9vEb", "5rk1/1qpn1ppp/2b1pn2/Q1b5/1P2pP2/P1N3N1/2PP2PP/R1B2R1K b - - 0 16", "f8a8"],
  ],
);
const legal = (fen, line) => {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  for (const uci of line) {
    const move = parseUci(uci);
    assert.ok(move && pos.isLegal(move), `Illegal receipt move ${uci}`);
    pos.play(move);
  }
  return makeFen(pos.toSetup());
};
const root = Chess.fromSetup(parseFen(trappedRookFen).unwrap()).unwrap();
root.play(parseUci("g1f2"));
for (const item of [
  { fen: trace.fen, move: trace.move, proof: trace.proof },
  { fen: trace.oldFen, move: "c2b2", proof: trace.oldProof },
  ...trace.otherTraps,
]) {
  const position = Chess.fromSetup(parseFen(legal(item.fen, [item.move])).unwrap()).unwrap();
  const replies = [...position.allDests()].flatMap(([from, tos]) =>
    [...tos].map((to) => makeUci({ from, to })),
  );
  assert.deepEqual(new Set(item.proof.branches.map((b) => b.replyUci)), new Set(replies));
  for (const branch of item.proof.branches) {
    assert.equal(branch.fen, legal(item.fen, [item.move, branch.replyUci]));
    const after = Chess.fromSetup(
      parseFen(legal(branch.fen, [branch.answerUci])).unwrap(),
    ).unwrap();
    const leaves = new Set(
      [...after.allDests()].flatMap(([from, tos]) =>
        [...tos].map((to) => legal(makeFen(after.toSetup()), [makeUci({ from, to })])),
      ),
    );
    for (const leaf of branch.continuation ?? []) {
      assert.ok(leaves.has(leaf.fen));
      legal(leaf.fen, [leaf.moveUci]);
    }
  }
}
const expectedInitial = new Map(
  [...root.allDests()].flatMap(([from, tos]) =>
    [...tos].map((to) => {
      const move = { from, to },
        pos = root.clone();
      pos.play(move);
      return [`rook-trap:${makeUci(move)}`, { fen: makeFen(pos.toSetup()) }];
    }),
  ),
);
expectedInitial.set("rook-trap:defender-capture", {
  fen: legal(trappedRookFen, ["g1f2", "e7g5"]),
  searchMove: "e4g5",
});
assert.deepEqual(requests.probes, buildTrapProbes(trace));
const allowed = new Map(buildTrapProbes(trace).map((p) => [p.id, p]));
const sanitize = (report, expected) => {
  assert.equal(report.sourceSha256, sourceSha256);
  assert.equal(report.completed, expected.size);
  assert.equal(report.searches.length, expected.size);
  assert.equal(new Set(report.searches.map((s) => s.id)).size, expected.size);
  return report.searches.map((search) => {
    const request = expected.get(search.id);
    assert.ok(request, `Unexpected search ${search.id}`);
    assert.equal(search.fen, request.fen);
    assert.equal(search.searchMove, request.searchMove);
    assert.ok(search.lines.length > 0);
    const lines = search.lines.map(({ depth, multipv, cp, mate, pvUci, pvSan }) => {
      legal(search.fen, pvUci);
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
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "CC0 real-game and constructed development audit. Full-position side-to-move Stockfish scores are not local material bounds, optimal-witness guarantees, or an all-position accuracy metric. No paid course content is included.",
      sourceSha256,
      initialSearches: sanitize(initial, expectedInitial),
      searches: sanitize(final, allowed),
      proofs: {
        fen: trace.fen,
        move: trace.move,
        proof: trace.proof,
        oldFen: trace.oldFen,
        oldProof: trace.oldProof,
        otherTraps: trace.otherTraps.map(({ id, fen, move, proof }) => ({ id, fen, move, proof })),
      },
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
process.stdout.write(
  `Exported ${initial.searches.length + final.searches.length} allow-listed legal engine searches.\n`,
);
