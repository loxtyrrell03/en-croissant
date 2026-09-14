import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";

const trap = "k6n/1p6/8/8/8/7Q/1P6/6K1 w - - 0 1";
const incidental = "k6n/1p3R1q/8/8/8/7Q/1P6/6K1 w - - 0 1";
const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const probes = [];
function add(id, pos, searchMove) {
  assert.ok(pos.isLegal(parseUci(searchMove)));
  probes.push({ id, fen: makeFen(pos.toSetup()), searchMove });
}
const root = position(trap);
add("direct-control:trap", root, "h3h7");
root.play(parseUci("h3h7"));
for (const [from, dests] of root.allDests())
  for (const to of dests) {
    const reply = { from, to },
      next = root.clone();
    next.play(reply);
    const target = next.board.knight.first();
    add(`direct-control:trap:${makeUci(reply)}`, next, makeUci({ from: 55, to: target }));
  }
const control = position(incidental);
for (const [i, uci] of ["h3h7", "h8f7", "h7f7"].entries()) {
  add(`direct-control:incidental:${i}`, control, uci);
  control.play(parseUci(uci));
}
writeFileSync(
  process.argv[2],
  JSON.stringify(
    { samplePath: "benchmarks/tactical-relevance/checking-pawn-development.json", probes },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`Prepared ${probes.length} legal synthetic root and defensive-witness searches.`);
