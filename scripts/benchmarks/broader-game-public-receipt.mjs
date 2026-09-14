import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { broaderGameResponseProbes } from "./broader-game-response-probes.mjs";
import { mixedForkProbes } from "./mixed-fork-probes.mjs";
import { mixedForkSupplementProbes } from "./mixed-fork-supplement-probes.mjs";

const [initialPath, responsePath, tracePath, witnessPath, supplementPath, output] =
  process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const context = read("benchmarks/tactical-relevance/broader-game-context.json");
const judgementPath = "benchmarks/tactical-relevance/broader-game-initial-judgement.json";
const initial = read(initialPath),
  trace = read(tracePath);
assert.equal(initial.completed, 23);
assert.equal(initial.cases.length, context.cases.length);
assert.equal(initial.sourceSha256, context.sourceSha256);
const lines = (fen, rows, fixed) =>
  rows.map((line) => {
    assert.equal(line.depth, 16);
    assert.ok(line.pvUci.length);
    assert.equal(Number.isFinite(line.cp) !== Number.isFinite(line.mate), true);
    if (fixed) assert.equal(line.pvUci[0], fixed);
    const p = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    for (const uci of line.pvUci) {
      const move = parseUci(uci);
      assert.ok(move && p.isLegal(move));
      p.play(move);
    }
    return {
      depth: line.depth,
      multipv: line.multipv,
      cp: line.cp,
      mate: line.mate,
      pvUci: line.pvUci,
      pvSan: line.pvSan,
    };
  });
const cases = initial.cases.map((row, index) => {
  const expected = context.cases[index];
  for (const key of ["id", "fen", "previousFen", "previousMoveUci", "sourceUci", "sourceSan"])
    assert.deepEqual(row[key], expected[key]);
  return {
    ...expected,
    engineLines: lines(row.fen, row.engineLines),
    sourceEngine: lines(row.fen, [row.sourceEngine], row.sourceUci[0])[0],
  };
});
const sanitize = (path, probes) => {
  const report = read(path);
  assert.equal(report.requested, probes.length);
  assert.equal(report.completed, probes.length);
  assert.equal(report.searches.length, probes.length);
  return report.searches.map((row, index) => {
    const expected = probes[index];
    for (const key of ["id", "fen", "searchMove"]) assert.equal(row[key], expected[key]);
    return { ...expected, lines: lines(row.fen, row.lines, row.searchMove) };
  });
};
const responses = sanitize(responsePath, broaderGameResponseProbes(context));
const witnesses = sanitize(witnessPath, mixedForkProbes(trace));
const supplements = sanitize(supplementPath, mixedForkSupplementProbes());
const selected = witnesses.filter((row) => row.id.startsWith("mixed-fork:reply:"));
assert.equal(selected.length, 27);
assert.ok(selected.every((row) => row.lines[0].cp > 0));
const initialSearchCount =
  cases.length +
  cases.filter((r) => !r.engineLines.some((l) => l.pvUci[0] === r.sourceUci[0])).length;
const receipt = {
  scope:
    "Four fixed real-game contexts at opening, middlegame and ending plies, with all actual next-move replies. Output-blind root selection, not a representative population or accuracy score. Subsequent fork probes are diagnostic and output-dependent. Empty results and unproved controls are not correct negatives. Engine scores are whole-position side-to-move centipawns, not the local proof gain.",
  sourceSha256: context.sourceSha256,
  judgementSha256: createHash("sha256").update(readFileSync(judgementPath)).digest("hex"),
  engine: {
    name: "Stockfish 18",
    depth: 16,
    initialSearchCount,
    responseSearchCount: responses.length,
    diagnosticSearchCount: witnesses.length + supplements.length,
    totalSearchCount: initialSearchCount + responses.length + witnesses.length + supplements.length,
  },
  cases,
  responses,
  witnesses,
  supplements,
  proof: {
    fen: trace.fen,
    moveUci: "d2f3",
    localGain: trace.proof.gain,
    targets: trace.proof.targets,
    supportingPins: trace.proof.supportingPins,
    captureBranches: trace.proof.captureBranches,
    scope:
      "All 27 legal replies have selected named-target capture witnesses, with immediate friendly-piece liabilities and bounded counterplay checks. The 8192 leaf/mate allowance is divided among two target pairs and the full target set; it is not an exhaustive chess solution or a count of all nomination work.",
    traceSha256: createHash("sha256").update(readFileSync(tracePath)).digest("hex"),
  },
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(
  `Validated ${cases.length} roots, ${responses.length} after-move boards, and ${receipt.engine.totalSearchCount} engine searches.`,
);
