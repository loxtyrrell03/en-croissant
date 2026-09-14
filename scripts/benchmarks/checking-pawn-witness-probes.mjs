import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

// Audit every selected retention action, not merely the winning root score.
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const probes = [];
const seen = new Set();
const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
function play(pos, uci) {
  const move = parseUci(uci);
  assert.ok(move && pos.isLegal(move), `${makeFen(pos.toSetup())}: ${uci}`);
  pos.play(move);
}
function add(id, pos, searchMove) {
  const fen = makeFen(pos.toSetup());
  const key = `${fen}:${searchMove}`;
  if (seen.has(key)) return;
  seen.add(key);
  assert.ok(pos.isLegal(parseUci(searchMove)));
  probes.push({ id, fen, searchMove });
}
for (const row of report.cases.filter((r) => r.proof)) {
  const root = position(row.fen);
  play(root, row.searchMove);
  for (const branch of row.proof.branches) {
    const pos = root.clone();
    play(pos, branch.replyUci);
    add(`${row.id}:hold:${branch.replyUci}`, pos, branch.holdUci);
    for (const [i, resource] of branch.resources.entries()) {
      const next = position(resource.fen);
      play(next, resource.replyUci);
      add(`${row.id}:resource:${branch.replyUci}:${i}`, next, resource.answerUci);
    }
  }
}
writeFileSync(
  process.argv[3],
  JSON.stringify(
    { samplePath: "benchmarks/tactical-relevance/checking-pawn-development.json", probes },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`Prepared ${probes.length} distinct legal retention-action searches.`);
