import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PgnParser, startingPosition } from "chessops/pgn";
import { makeFen, parseFen } from "chessops/fen";
import { Chess } from "chessops/chess";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";

const [samplePath, output, profile = "initial"] = process.argv.slice(2);
if (!samplePath || !output || existsSync(output))
  throw new Error("Provide sample and new output path");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
assert.equal(sample.profile, "cross-phase");
const profiles = {
  initial: {
    start: 0, end: 3, plies: [8, 24, 48, 80],
    scope: "Fixed plies 8, 24, 48, 80 from the first three output-blind cross-phase source games. No result, evaluation, player or classifier filtering. These puzzle-game contexts are not a representative ordinary-game sample. Player headers, comments and clocks are omitted.",
  },
  broader: {
    start: 3, end: 7, plies: [6, 16, 30, 50, 70, 90],
    scope: "Fixed plies 6, 16, 30, 50, 70, 90 from the next four frozen cross-phase source games (indices 3 through 6). Selection precedes engine and classifier output, without result, evaluation, player or move-quality filtering. These puzzle-game contexts are not representative ordinary games. Player headers, comments and clocks are omitted; unavailable fixed plies are recorded rather than replaced.",
  },
};
const config = profiles[profile];
assert.ok(config, "Unknown context profile");
const games = [],
  cases = [],
  omitted = [];
// Fixed before fetching games or seeing any evaluation/classifier output.
// These are contexts of puzzle-selected games, not a population sample.
for (const row of sample.cases.slice(config.start, config.end)) {
  const source = new URL(row.sourceGameUrl);
  assert.equal(source.origin, "https://lichess.org");
  const gameId = source.pathname.split("/")[1];
  assert.match(gameId, /^[A-Za-z0-9]{8}$/);
  const url = `https://lichess.org/game/export/${gameId}?clocks=false&evals=false&opening=false&literate=false`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok)
    throw new Error(`Game export ${response.status}: ${gameId}; do not replace this selected game`);
  const raw = await response.text(),
    parsed = [],
    errors = [];
  new PgnParser((game, error) => {
    parsed.push(game);
    if (error) errors.push(String(error));
  }).parse(raw);
  assert.deepEqual(errors, []);
  assert.equal(parsed.length, 1);
  const game = parsed[0],
    pos = startingPosition(game.headers).unwrap();
  assert.equal(pos.rules, "chess");
  const fens = [makeFen(pos.toSetup())],
    moves = [],
    sans = [];
  for (const node of game.moves.mainline()) {
    const move = parseSan(pos, node.san);
    assert.ok(move && pos.isLegal(move), `Illegal game move ${node.san}`);
    moves.push(makeUci(move));
    sans.push(makeSan(pos, move));
    pos.play(move);
    fens.push(makeFen(pos.toSetup()));
  }
  assert.ok(moves.length > 0);
  const sourceFen = makeFen(Chess.fromSetup(parseFen(row.sourceFen).unwrap()).unwrap().toSetup());
  const sourcePly = fens.indexOf(sourceFen);
  assert.ok(sourcePly >= 0, "The selected puzzle position must occur in the exported game");
  assert.equal(moves[sourcePly], row.precedingMove);
  games.push({
    id: gameId,
    sourceGameUrl: source.origin + "/" + gameId,
    exportUrl: url,
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    startFen: fens[0],
    moves,
  });
  for (const ply of config.plies) {
    const id = `context:${gameId}:ply${ply}`;
    if (ply >= moves.length) {
      omitted.push({ id, reason: "Game ended before this fixed sample" });
      continue;
    }
    cases.push({
      id,
      sourceGameUrl: source.origin + "/" + gameId,
      ply,
      fen: fens[ply],
      previousFen: fens[ply - 1],
      previousMoveUci: moves[ply - 1],
      sourceUci: moves.slice(ply, ply + 12),
      sourceSan: sans.slice(ply, ply + 12),
    });
  }
}
const result = {
  scope: config.scope,
  sourceSha256: sample.sourceSha256,
  games,
  cases,
  omitted,
};
writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ selected: cases, omitted }, null, 2));
