import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

const [mode, input, output] = process.argv.slice(2);
assert(["contexts", "nature-contexts", "nature-controls", "capture-choice", "discovered-capture"].includes(mode));
const sample = JSON.parse(
  readFileSync(
    mode === "discovered-capture" ? "benchmarks/tactical-relevance/discovered-capture-development.json" : mode === "nature-controls" ? "benchmarks/tactical-relevance/nature-countercheck-controls.json" : `benchmarks/tactical-relevance/${mode === "nature-contexts" ? "nature" : "quiet-game"}-context-development.json`,
    "utf8",
  ),
);
const bytes = readFileSync(input),
  report = JSON.parse(bytes);
const allowed = new Set();
const after = (fen, uci) => {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap(),
    move = parseUci(uci);
  assert(move && pos.isLegal(move));
  pos.play(move);
  return makeFen(pos.toSetup());
};
if (mode === "discovered-capture") {
  for (const row of sample.cases) for (const reflected of [false, true]) {
    const fields = row.fen.split(" ");
    if (reflected) {
      fields[0] = fields[0].split("/").reverse().join("/").replace(/[a-zA-Z]/g, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
      fields[1] = fields[1] === "w" ? "b" : "w";
    }
    const fen = fields.join(" ");
    allowed.add(fen);
    const nextFen = after(fen, reflected ? row.root.replace(/[1-8]/g, rank => String(9 - Number(rank))) : row.root);
    allowed.add(nextFen);
    const pos = Chess.fromSetup(parseFen(nextFen).unwrap()).unwrap();
    for (const [from, dests] of pos.allDests()) for (const to of dests) {
      assert(!(pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)));
      const next = pos.clone();
      assert(next.isLegal({ from, to }));
      next.play({ from, to });
      allowed.add(makeFen(next.toSetup()));
    }
  }
  assert.equal(report.searches.length, report.requested);
  assert.equal(new Set(report.searches.map(row => row.id)).size, report.requested);
} else if (mode === "nature-controls") {
  for (const row of sample.cases) {
    let position = row.fen;
    allowed.add(position);
    for (const move of row.moves) {
      position = after(position, move);
      allowed.add(position);
    }
  }
  assert.equal(report.searches.length, 8);
} else if (mode === "contexts" || mode === "nature-contexts") {
  for (const row of sample.cases) {
    allowed.add(row.fen);
    allowed.add(after(row.fen, row.sourceUci[0]));
  }
  assert.equal(report.searches.length, sample.cases.length * 3);
} else {
  const row = sample.cases.find((row) => row.id === "context:C9q6jvtW:ply41");
  assert(row);
  allowed.add(row.fen);
  for (const move of ["c8c6", "f5g4"]) allowed.add(after(row.fen, move));
  assert.equal(report.searches.length, 64);
}
const searches = report.searches.map(({ id, fen, searchMove, lines }) => {
  assert(allowed.has(fen), "Only the selected public game boards may be published");
  for (const line of lines) {
    let position = fen;
    for (const move of line.pvUci) position = after(position, move);
    if (searchMove) assert.equal(line.pvUci[0], searchMove);
    assert.equal(line.depth, 16);
  }
  return { id, fen, ...(searchMove ? { searchMove } : {}), lines };
});
writeFileSync(
  output,
  JSON.stringify(
    {
      engine: "Stockfish 18, one thread, 32 MB hash, depth 16",
      scope:
        "Fresh engine searches of selected public game boards and, where included, mechanism controls. Scores are full-position estimates from the side to move, not certified local material gains or human primary-theme labels.",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      searches,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`${searches.length} legally validated public search receipts.`);
