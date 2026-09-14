import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { privateReportPath } from "./private-pgn-sample.mjs";
const [output] = process.argv.slice(2);
const read = (name) =>
  JSON.parse(readFileSync(`benchmarks/tactical-relevance/${name}.json`, "utf8"));
const sample = read("cross-phase-development"),
  context = read("cross-phase-game-context"),
  judgements = read("cross-phase-initial-judgement");
const cases = [
  ...sample.cases.map((r) => ({
    id: r.id,
    fen: r.startFen,
    previousFen: r.sourceFen,
    previousMoveUci: r.precedingMove,
    sourceUci: r.bestLine,
  })),
  ...context.cases,
];
assert.equal(cases.length, 23);
assert.deepEqual(
  cases.map((r) => r.id),
  judgements.cases.map((r) => r.id),
);
for (const row of cases) {
  const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  const prior = Chess.fromSetup(parseFen(row.previousFen).unwrap()).unwrap();
  const previous = parseUci(row.previousMoveUci);
  assert.ok(prior.isLegal(previous));
  prior.play(previous);
  assert.equal(makeFen(pos.toSetup()), makeFen(prior.toSetup()));
  row.sourceSan = row.sourceUci.map((uci) => {
    const move = parseUci(uci);
    assert.ok(pos.isLegal(move));
    const san = makeSan(pos, move);
    pos.play(move);
    return san;
  });
}
writeFileSync(
  privateReportPath(output),
  JSON.stringify(
    {
      sourceSha256: sample.sourceSha256,
      selection:
        "Frozen twelve cross-phase puzzles plus eleven fixed game-context boards; initial chess judgements precede analysis.",
      eligiblePositions: 23,
      cases,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
process.stdout.write(`Prepared ${cases.length} legal source and engine audit inputs.\n`);
