import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { promotionEndingProbes } from "./promotion-ending-probes.mjs";
import { promotionCounterplayBase } from "../../src/utils/tests/fixtures/promotionCounterplay.ts";

// Export only validated, allowlisted public-root evidence. The original reports
// also contain classifier results and private filesystem references; neither is
// copied. This diagnostic selection must not be presented as an accuracy score.
const [beforePath, afterPath, tracePath, enginePath, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const before = read(beforePath),
  after = read(afterPath),
  trace = read(tracePath),
  engine = read(enginePath);
const probes = promotionEndingProbes(before, after, trace);
assert.equal(probes.length, 70);
assert.equal(engine.requested, probes.length);
assert.equal(engine.completed, probes.length);
assert.equal(engine.searches.length, probes.length);
assert.deepEqual(trace.errors, []);
assert.equal(trace.proof.gain, 220);
assert.equal(trace.proof.replyCount, 21);
assert.ok(trace.proof.examinedMoves > 0 && trace.proof.examinedMoves <= 262144);

const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const root = position(promotionCounterplayBase);
root.play(parseUci("f4e4"));
const replies = [...root.allDests()].flatMap(([from, tos]) =>
  [...tos].map((to) => makeUci({ from, to })),
);
assert.deepEqual(trace.proof.branches.map((row) => row.replyUci).sort(), replies.sort());
assert.equal(Math.min(...trace.proof.branches.map((row) => row.gain)), trace.proof.gain);
for (const d of trace.proof.decisions) {
  const pos = position(d.fen),
    move = parseUci(d.moveUci);
  assert.ok(move && pos.isLegal(move), `Illegal recorded decision: ${d.moveUci}`);
}
const searches = engine.searches.map((search, index) => {
  const probe = probes[index];
  assert.equal(search.id, probe.id);
  assert.equal(search.fen, probe.fen);
  assert.equal(search.searchMove, probe.searchMove);
  assert.ok(search.lines.length > 0);
  const lines = search.lines.map((line) => {
    assert.equal(line.depth, 16);
    assert.ok(line.pvUci.length > 0);
    if (probe.searchMove) assert.equal(line.pvUci[0], probe.searchMove);
    assert.equal(Number.isFinite(line.cp) !== Number.isFinite(line.mate), true);
    const pos = position(probe.fen);
    for (const uci of line.pvUci) {
      const move = parseUci(uci);
      assert.ok(move && pos.isLegal(move), `Illegal PV in ${probe.id}: ${uci}`);
      pos.play(move);
    }
    return {
      depth: line.depth,
      multipv: line.multipv,
      cp: line.cp,
      mate: line.mate,
      pvUci: line.pvUci,
    };
  });
  if (probe.id.startsWith("MJZcU:"))
    assert.ok(lines[0].cp > 0 || lines[0].mate > 0, `Contrary selected real witness: ${probe.id}`);
  return { ...probe, lines };
});
const changes = after.cases.flatMap((row) => {
  const old = before.cases.find((item) => item.id === row.id);
  if (Boolean(old.proof) === Boolean(row.proof) && old.proof?.gain === row.proof?.gain) return [];
  return [
    {
      id: row.id,
      fen: row.fen,
      beforeLocalGain: old.proof?.gain ?? null,
      afterLocalGain: row.proof?.gain ?? null,
    },
  ];
});
const receipt = {
  scope:
    "Public MJZcU root, 116 fixed nearby perturbations and selected proof witnesses. Diagnostic, output-dependent selection; no representative accuracy score. Null means unproved, not a correct negative. Engine scores are side-to-move full-position estimates in centipawns; proof gains are local material units with pawn=100.",
  classifier: "site-55.adapter-97",
  engine: { name: "Stockfish 18", depth: 16, searches: searches.length },
  proof: {
    fen: promotionCounterplayBase,
    moveUci: "f4e4",
    localGain: trace.proof.gain,
    examinedMoves: trace.proof.examinedMoves,
    operationLimit: 262144,
    branches: trace.proof.branches,
    legalRecordedDecisions: trace.proof.decisions.length,
    traceSha256: createHash("sha256").update(readFileSync(tracePath)).digest("hex"),
    engineWitnessScope:
      "All 21 selected root-defence answers and twenty fixed hash-selected promotion leaves; not every continuation decision was engine searched.",
  },
  perturbations: { count: after.cases.length, changes },
  searches,
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(
  `Validated ${searches.length} searches, ${trace.proof.decisions.length} legal recorded decisions and all ${replies.length} root branches.`,
);
