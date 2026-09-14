import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

const [rootPath, responsePath, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const context = read("benchmarks/tactical-relevance/black-context-development.json");
const roots = read(rootPath),
  replies = read(responsePath);
assert.equal(roots.sourceSha256, context.sourceSha256);
assert.equal(roots.completed, 20);
assert.equal(replies.completed, 19);
const legal = (fen, line) => {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  for (const uci of line) {
    const move = parseUci(uci);
    assert(move && pos.isLegal(move));
    pos.play(move);
  }
};
const cases = roots.cases.map((row, index) => {
  const expected = context.cases[index];
  for (const key of ["id", "fen", "sourceUci", "sourceSan", "previousFen", "previousMoveUci"])
    assert.deepEqual(row[key], expected[key]);
  for (const line of [...row.engineLines, row.sourceEngine]) {
    assert.equal(line.depth, 16);
    legal(row.fen, line.pvUci);
  }
  return {
    ...expected,
    engineLines: row.engineLines,
    sourceEngine: row.sourceEngine,
    sourceResult: row.sourceResult,
    scan: row.scan,
  };
});
const used = new Set();
const responses = cases.map((row) => {
  const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  pos.play(parseUci(row.sourceUci[0]));
  const fen = makeFen(pos.toSetup()),
    id = row.id + ":reply";
  if (pos.isEnd()) return { id, fen, terminal: true, lines: [] };
  const found = replies.searches.filter((reply) => reply.id === id);
  assert.equal(found.length, 1);
  const reply = found[0];
  assert.equal(reply.fen, fen);
  assert(!reply.searchMove);
  used.add(id);
  for (const line of reply.lines) {
    assert.equal(line.depth, 16);
    legal(fen, line.pvUci);
  }
  return { id, fen, terminal: false, lines: reply.lines };
});
assert.equal(used.size, replies.searches.length);
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Frozen fresh Stockfish 18 development receipt for twenty fixed Black-to-move game contexts and nineteen actual responses; the terminal bare-kings draw is not engine-searched. Engine scores use each root side to move, not White, and are not local material proof values. No private game or identifying header is exported. These are paired puzzle-game contexts, not a representative accuracy test.",
      sourceSha256: context.sourceSha256,
      searches:
        cases.length +
        cases.filter((row) => !row.engineLines.some((line) => line.pvUci[0] === row.sourceUci[0]))
          .length +
        used.size,
      cases,
      responses,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`Exported twenty public roots and ${used.size} independently searched responses.`);
