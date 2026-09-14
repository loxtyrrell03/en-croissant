import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { privateReportPath } from "./private-pgn-sample.mjs";

const [samplePath, judgementPath, output] = process.argv.slice(2);
const source = readFileSync(samplePath),
  judgement = readFileSync(judgementPath);
const sample = JSON.parse(source);
assert(sample.cases.length && sample.games.length);
const probes = sample.cases.flatMap((row) => {
  assert(judgement.toString().includes(row.sourceGameUrl.split("/").at(-1)));
  const previous = Chess.fromSetup(parseFen(row.previousFen).unwrap()).unwrap();
  const preceding = parseUci(row.previousMoveUci);
  assert(preceding && previous.isLegal(preceding));
  previous.play(preceding);
  assert.equal(makeFen(previous.toSetup()), row.fen);
  const move = parseUci(row.sourceUci[0]);
  assert(move && previous.isLegal(move));
  previous.play(move);
  return [
    { id: `${row.id}:best`, fen: row.fen },
    { id: `${row.id}:played`, fen: row.fen, searchMove: row.sourceUci[0] },
    { id: `${row.id}:reply`, fen: makeFen(previous.toSetup()) },
  ];
});
writeFileSync(
  privateReportPath(output),
  JSON.stringify(
    {
      samplePath,
      scope:
        "Every fixed board: best move, actual move held fixed, and the actual resulting board. No selection on evaluation loss. Scores are side-to-move whole-position estimates, not local tactical proof values.",
      contextSha256: createHash("sha256").update(source).digest("hex"),
      judgementSha256: createHash("sha256").update(judgement).digest("hex"),
      probes,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`${sample.cases.length} fixed boards, ${probes.length} searches.`);
