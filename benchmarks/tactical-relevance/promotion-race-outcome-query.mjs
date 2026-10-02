import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci, makeUci } from "chessops/util";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork.ts";

// Explicit public-fixture audit only. Never called by an ordinary app scan.
// The two queen-ending outcomes were observed before this expanded audit;
// the original race root and first push are new outcome questions here.
const output = process.argv[2];
assert.ok(output && !existsSync(output), "Supply a new output path");
const sourcePath = "benchmarks/tactical-relevance/secondary-theme-development.json";
const sourceBytes = readFileSync(sourcePath);
const row = JSON.parse(sourceBytes).cases.find(row => row.id === "lichess:i2SLh");
assert.ok(row);
const requests = [];
for (const reflected of [false, true]) {
  const flip = move => reflected ? reflectMixedForkMove(move) : move;
  const board = Chess.fromSetup(parseFen(reflected ? reflectMixedForkFen(row.startFen) : row.startFen).unwrap()).unwrap();
  const record = stage => requests.push({ stage, reflected, fen: makeFen(board.toSetup()) });
  record("race-root");
  for (const [index, uci] of row.bestLine.entries()) {
    const move = parseUci(flip(uci));
    assert.ok(move && board.isLegal(move), `Illegal source move ${uci}`);
    board.play(move);
    if (index === 0) record("after-first-push");
  }
  record("before-opponent-promotion");
  const promotion = parseUci(flip("d2d1q"));
  assert.ok(board.isLegal(promotion));
  board.play(promotion);
  record("after-opponent-promotion");
}
const receipt = {
  schemaVersion: 1, provider: "lichess-syzygy", sourceId: row.id,
  sourceGameUrl: row.sourceGameUrl,
  sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  scope: "Eight requested positions from one retained public puzzle, paired by colour; not eight independent puzzles. Provider outcomes are not local material-retention certificates or tactical labels. Move outcomes refer to the child side to move.",
  priorObservation: "The two unreflected queen-ending positions were probed before this expanded receipt; this is not output-blind sampling.",
  hypotheses: [
    "Does the first pawn push change the attainable game outcome relative to legal alternatives?",
    "Does the later opponent promotion save a draw or win, or only continue a lost ending?",
    "Exact win/loss does not establish the classifier's finite local material gain or a motif mechanism by itself.",
  ],
  requests, queries: [],
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
for (const request of requests) {
  const board = Chess.fromSetup(parseFen(request.fen).unwrap()).unwrap();
  assert.equal(board.board.occupied.size(), 6);
  const legal = [...board.allDests()].flatMap(([from, tos]) => [...tos].flatMap(to =>
    board.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
      ? ["queen", "rook", "bishop", "knight"].map(promotion => makeUci({ from, to, promotion }))
      : [makeUci({ from, to })]));
  const url = `https://tablebase.lichess.org/standard?fen=${encodeURIComponent(request.fen)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), credentials: "omit" });
  assert.equal(response.status, 200, "Do not turn provider failure into a negative");
  const body = await response.text();
  assert.ok(Buffer.byteLength(body) <= 128000);
  const result = JSON.parse(body);
  assert.deepEqual(result.moves.map(move => move.uci).sort(), legal.sort());
  receipt.queries.push({ ...request, url, checkedAt: new Date().toISOString(), result });
  writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ stage: request.stage, reflected: request.reflected,
    category: result.category, legalMoves: legal.length,
    outcomes: result.moves.map(move => `${move.uci}:${move.category}`) }));
}
