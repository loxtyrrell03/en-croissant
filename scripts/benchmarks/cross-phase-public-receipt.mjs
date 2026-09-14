import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { crossPhaseDefenceProbes } from "./cross-phase-defence-probes.mjs";
import { promotionClearanceProbes } from "./promotion-clearance-probes.mjs";
const [initialPath, defencePath, witnessPath, tracePath, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sample = read("benchmarks/tactical-relevance/cross-phase-development.json"),
  context = read("benchmarks/tactical-relevance/cross-phase-game-context.json");
const allowed = [
  ...sample.cases.map((r) => ({
    id: r.id,
    fen: r.startFen,
    previousFen: r.sourceFen,
    previousMoveUci: r.precedingMove,
    sourceUci: r.bestLine,
  })),
  ...context.cases,
];
const initial = read(initialPath),
  trace = read(tracePath);
assert.equal(initial.sourceSha256, sample.sourceSha256);
assert.equal(initial.completed, allowed.length);
assert.equal(initial.cases.length, allowed.length);
const legal = (fen, line) => {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  for (const uci of line) {
    const move = parseUci(uci);
    assert.ok(move && pos.isLegal(move), `Illegal public PV ${uci}`);
    pos.play(move);
  }
};
const cases = initial.cases.map((r, index) => {
  const expected = allowed[index];
  for (const key of ["id", "fen", "previousFen", "previousMoveUci", "sourceUci"])
    assert.deepEqual(r[key], expected[key]);
  for (const line of [...r.engineLines, r.sourceEngine]) {
    assert.equal(line.depth, 16);
    legal(r.fen, line.pvUci);
  }
  return {
    id: r.id,
    fen: r.fen,
    previousFen: r.previousFen,
    previousMoveUci: r.previousMoveUci,
    sourceUci: r.sourceUci,
    sourceSan: r.sourceSan,
    engineLines: r.engineLines,
    sourceEngine: r.sourceEngine,
    sourceResult: r.sourceResult,
    scan: r.scan,
  };
});
assert.equal(trace.fen, sample.cases.find((r) => r.id === "lichess:brn5j").startFen);
assert.deepEqual(trace.pvUci, sample.cases.find((r) => r.id === "lichess:brn5j").bestLine);
const sanitize = (path, requests) => {
  const report = read(path),
    ids = new Map(requests.map((r) => [r.id, r]));
  assert.equal(report.completed, ids.size);
  assert.equal(report.searches.length, ids.size);
  assert.equal(report.sourceSha256, sample.sourceSha256);
  assert.equal(new Set(report.searches.map((r) => r.id)).size, ids.size);
  return report.searches.map((r) => {
    const expected = ids.get(r.id);
    assert.ok(expected);
    assert.equal(r.fen, expected.fen);
    assert.equal(r.searchMove, expected.searchMove);
    for (const line of r.lines) {
      assert.equal(line.depth, 16);
      legal(r.fen, line.pvUci);
      if (r.searchMove) assert.equal(line.pvUci[0], r.searchMove);
    }
    return {
      id: r.id,
      fen: r.fen,
      ...(r.searchMove ? { searchMove: r.searchMove } : {}),
      lines: r.lines,
    };
  });
};
const receipt = {
  scope:
    "Output-blind development audit of twelve CC0 puzzle roots and eleven fixed source-game contexts. Initial adapter-94 classifications are retained, not replaced with current outputs. These are not representative accuracy measurements. Full-position engine values are side to move, not local material certificates. No paid inputs are exported.",
  sourceSha256: sample.sourceSha256,
  initialSearchCount:
    cases.length +
    cases.filter((r) => !r.engineLines.some((l) => l.pvUci[0] === r.sourceUci[0])).length,
  cases,
  defenceSearches: sanitize(defencePath, crossPhaseDefenceProbes(sample)),
  witnessSearches: sanitize(witnessPath, promotionClearanceProbes(trace)),
  promotionClearance: { fen: trace.fen, pvUci: trace.pvUci, proof: trace.proof },
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(
  `Exported ${cases.length} reviewed inputs and ${receipt.initialSearchCount + receipt.defenceSearches.length + receipt.witnessSearches.length} complete fresh searches.`,
);
