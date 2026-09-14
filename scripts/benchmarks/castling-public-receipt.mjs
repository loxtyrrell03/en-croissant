import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";

const [castlePath, rarePath, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const context = read("benchmarks/tactical-relevance/castling-context-development.json");
const rareSource = read("benchmarks/tactical-relevance/rare-theme-development.json");
const castles = read(castlePath),
  rare = read(rarePath);
assert.equal(castles.completed, 18);
assert.equal(rare.completed, 60);
assert.equal(castles.sourceSha256, context.sourceSha256);
const legal = (fen, line) => {
  assert.equal(line.depth, 16);
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  for (const uci of line.pvUci) {
    const move = parseUci(uci);
    assert(move && pos.isLegal(move));
    pos.play(move);
  }
};
const cases = castles.cases.map((row, index) => {
  const expected = context.cases[index];
  assert.equal(row.id, expected.id);
  assert.equal(row.fen, expected.fen);
  assert.deepEqual(row.sourceUci, [expected.rookUci]);
  for (const line of [...row.engineLines, row.sourceEngine]) legal(row.fen, line);
  return { ...expected, engineLines: row.engineLines, castleLine: row.sourceEngine };
});
const rareIds = new Set(["lichess:ZVq1J", "lichess:snAK4", "lichess:4Ds65"]);
const expectedRare = new Map();
for (const row of rareSource.cases.filter((row) => rareIds.has(row.id))) {
  expectedRare.set(`${row.id}:root`, { fen: row.startFen, searchMove: row.bestLine[0] });
  const pos = Chess.fromSetup(parseFen(row.startFen).unwrap()).unwrap();
  const first = parseUci(row.bestLine[0]);
  assert(first && pos.isLegal(first));
  pos.play(first);
  for (const [from, destinations] of pos.allDests())
    for (const to of destinations) {
      const move = { from, to };
      expectedRare.set(`${row.id}:defence:${makeUci(move)}`, {
        fen: makeFen(pos.toSetup()),
        searchMove: makeUci(move),
      });
    }
  const reply = parseUci(row.bestLine[1]);
  assert(reply && pos.isLegal(reply));
  pos.play(reply);
  expectedRare.set(`${row.id}:reached-preparation`, {
    fen: makeFen(pos.toSetup()),
    searchMove: row.bestLine[2],
  });
}
assert.equal(expectedRare.size, 60);
assert.equal(new Set(rare.searches.map((row) => row.id)).size, 60);
const searches = rare.searches.map((row) => {
  assert(rareIds.has(row.id.split(":").slice(0, 2).join(":")));
  assert(rareSource.cases.some((c) => row.id.startsWith(c.id + ":")));
  assert.deepEqual({ fen: row.fen, searchMove: row.searchMove }, expectedRare.get(row.id));
  for (const line of row.lines) legal(row.fen, line);
  return { id: row.id, fen: row.fen, searchMove: row.searchMove, lines: row.lines };
});
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Public real-game castling options and complete immediate-defence audits for three unresolved rare motifs. Fresh Stockfish 18 depth 16; scores are root-side full-position evaluations, not local tactical bounds. Not a held-out accuracy estimate. No private course fields exported.",
      sourceSha256: context.sourceSha256,
      cases,
      rareSearches: searches,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log("Exported eighteen public castle contexts and sixty fixed rare-root searches.");
