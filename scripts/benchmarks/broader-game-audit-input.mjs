import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { privateReportPath } from "./private-pgn-sample.mjs";

const [output] = process.argv.slice(2);
const sourcePath = "benchmarks/tactical-relevance/broader-game-context.json";
const judgementPath = "benchmarks/tactical-relevance/broader-game-initial-judgement.json";
const context = JSON.parse(readFileSync(sourcePath, "utf8"));
const judgement = JSON.parse(readFileSync(judgementPath, "utf8"));
assert.equal(context.cases.length, 23);
assert.equal(context.games.length, 4);
assert.equal(context.omitted.length, 1);
assert.deepEqual(
  context.cases.map((r) => r.id),
  judgement.cases.map((r) => r.id),
);
for (const row of context.cases) {
  const game = context.games.find((g) => row.sourceGameUrl.endsWith(g.id));
  assert.ok(game);
  const pos = Chess.fromSetup(parseFen(game.startFen).unwrap()).unwrap();
  for (const [index, uci] of game.moves.entries()) {
    if (index === row.ply - 1) assert.equal(makeFen(pos.toSetup()), row.previousFen);
    if (index === row.ply) assert.equal(makeFen(pos.toSetup()), row.fen);
    const move = parseUci(uci);
    assert.ok(move && pos.isLegal(move));
    pos.play(move);
  }
  assert.equal(game.moves[row.ply - 1], row.previousMoveUci);
  assert.deepEqual(game.moves.slice(row.ply, row.ply + 12), row.sourceUci);
}
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
writeFileSync(
  privateReportPath(output),
  JSON.stringify(
    {
      sourceSha256: context.sourceSha256,
      contextSha256: hash(sourcePath),
      judgementSha256: hash(judgementPath),
      selection: context.scope,
      eligiblePositions: context.cases.length,
      cases: context.cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log("Verified 23 fixed reached boards and all four complete game move sequences.");
