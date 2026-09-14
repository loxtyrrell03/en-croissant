import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { privateReportPath } from "./private-pgn-sample.mjs";

const source = "benchmarks/tactical-relevance/black-context-development.json";
const judgements = "benchmarks/tactical-relevance/black-context-initial-judgement.json";
const context = JSON.parse(readFileSync(source, "utf8"));
const judgement = JSON.parse(readFileSync(judgements, "utf8"));
assert.equal(context.cases.length, 20);
assert.equal(context.games.length, 5);
assert.equal(context.omitted.length, 10);
assert.deepEqual(
  context.cases.map((r) => r.id),
  judgement.cases.map((r) => r.id),
);
for (const row of context.cases) {
  const game = context.games.find((g) => row.sourceGameUrl.endsWith(g.id));
  const pos = Chess.fromSetup(parseFen(game.startFen).unwrap()).unwrap();
  for (const [index, uci] of game.moves.entries()) {
    if (index === row.ply - 1) assert.equal(makeFen(pos.toSetup()), row.previousFen);
    if (index === row.ply) assert.equal(makeFen(pos.toSetup()), row.fen);
    const move = parseUci(uci);
    assert(move && pos.isLegal(move));
    pos.play(move);
  }
  assert.equal(row.fen.split(" ")[1], "b");
  assert.equal(game.moves[row.ply - 1], row.previousMoveUci);
  assert.deepEqual(game.moves.slice(row.ply, row.ply + 12), row.sourceUci);
}
const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
writeFileSync(
  privateReportPath(process.argv[2]),
  JSON.stringify(
    {
      sourceSha256: context.sourceSha256,
      contextSha256: hash(source),
      judgementSha256: hash(judgements),
      selection: context.scope,
      eligiblePositions: context.cases.length,
      cases: context.cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log("Verified twenty fixed Black-to-move boards and five complete legal games.");
