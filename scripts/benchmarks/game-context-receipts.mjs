import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

const [mode, input, output] = process.argv.slice(2);
assert(["contexts", "capture-choice"].includes(mode));
const sample = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/quiet-game-context-development.json", "utf8"),
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
if (mode === "contexts") {
  for (const row of sample.cases) {
    allowed.add(row.fen);
    allowed.add(after(row.fen, row.sourceUci[0]));
  }
  assert.equal(report.searches.length, 63);
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
        "Fresh engine searches of the selected public Lichess game boards. Scores are full-position estimates from the side to move, not certified local material gains or human primary-theme labels.",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      searches,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`${searches.length} legally validated public search receipts.`);
