import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";

const sample = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/broader-game-stockfish-18.json", "utf8"),
);
const root = sample.responses.find((r) => r.id === "context:QwS7iWSm:ply70:reply");
const before = sample.cases.find((r) => r.id === "context:QwS7iWSm:ply70");
const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const play = (p, uci) => {
  const m = parseUci(uci);
  assert.ok(m && p.isLegal(m));
  p.play(m);
};
const probes = [
  ...["f7f2", "d6e7", "f7e7"].map((searchMove) => ({
    id: "checking-pawn:root:" + searchMove,
    fen: root.fen,
    searchMove,
  })),
];
const checking = position(root.fen);
play(checking, "f7f2");
assert.equal(checking.isCheck(), true);
for (const [from, tos] of checking.allDests())
  for (const to of tos) {
    const reply = makeUci({ from, to }),
      next = checking.clone();
    play(next, reply);
    probes.push({
      id: "checking-pawn:reply:" + reply,
      fen: makeFen(next.toSetup()),
      searchMove: "d6e7",
    });
    if (reply === "h2h3")
      probes.push({
        id: "checking-pawn:quiet-king",
        fen: makeFen(next.toSetup()),
        searchMove: "g8h8",
      });
  }
for (const king of ["h2g1", "h2h1"]) {
  const p = position(before.fen);
  play(p, king);
  probes.push({
    id: "checking-pawn:uncheck:" + king,
    fen: makeFen(p.toSetup()),
    searchMove: "f7f2",
  });
  play(p, "f7f2");
  probes.push({
    id: "checking-pawn:passed-pawn:" + king,
    fen: makeFen(p.toSetup()),
    searchMove: "e6e7",
  });
}
writeFileSync(
  process.argv[2],
  JSON.stringify(
    { samplePath: "benchmarks/tactical-relevance/broader-game-context.json", probes },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`Prepared ${probes.length} legal checking-capture and defensive move-order searches.`);
