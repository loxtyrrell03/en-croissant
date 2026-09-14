import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { privateReportPath } from "./private-pgn-sample.mjs";

const samplePath = "benchmarks/tactical-relevance/black-context-development.json";
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
const probes = [],
  terminal = [];
for (const row of sample.cases) {
  const position = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  const move = parseUci(row.sourceUci[0]);
  assert(move && position.isLegal(move));
  position.play(move);
  const target = { id: row.id + ":reply", fen: makeFen(position.toSetup()) };
  (position.isEnd() ? terminal : probes).push(target);
}
assert.equal(probes.length, 19);
assert.equal(terminal.length, 1);
writeFileSync(
  privateReportPath(process.argv[2]),
  JSON.stringify(
    {
      samplePath,
      scope:
        "Every actual after-move board, without selecting moves by evaluation loss. One dead-material ending is recorded and requires no engine search. These are paired observations, not independent games.",
      probes,
      terminal,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log("Prepared nineteen after-move searches and retained one terminal draw.");
