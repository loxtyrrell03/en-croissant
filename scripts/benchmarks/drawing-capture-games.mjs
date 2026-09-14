// Output-blind game sample: every final insufficient-material capture in one
// already-used public archive. No classifier/engine/result-strength filtering.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { PgnParser, startingPosition } from "chessops/pgn";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";

const [output] = process.argv.slice(2);
assert(output && !existsSync(output), "Provide a new private report path");
const source = "https://api.chess.com/pub/player/loxty/games/2026/08";
const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
assert(response.ok, `HTTP ${response.status}`);
const raw = await response.text(),
  archive = JSON.parse(raw),
  cases = [];
let standard = 0;
for (const item of archive.games) {
  if (item.rules !== "chess") continue;
  standard++;
  const parsed = [];
  new PgnParser((game, error) => {
    assert(!error, String(error));
    parsed.push(game);
  }).parse(item.pgn);
  assert.equal(parsed.length, 1);
  const game = parsed[0],
    pos = startingPosition(game.headers).unwrap(),
    history = [];
  for (const node of game.moves.mainline()) {
    const move = parseSan(pos, node.san);
    assert(move && "from" in move && pos.isLegal(move));
    const fen = makeFen(pos.toSetup()),
      capture = !!pos.board.get(move.to),
      ended = pos.isEnd();
    pos.play(move);
    if (!ended && capture && pos.isInsufficientMaterial())
      cases.push({
        id: `game:${item.url.split("/").at(-1)}:ply${history.length + 1}`,
        sourceGameUrl: item.url,
        fen,
        move: makeUci(move),
        preceding: history.slice(-2),
        afterFen: makeFen(pos.toSetup()),
        judgement:
          "Actual capture ends in insufficient material. Whether it was necessary to save a draw remains unjudged until all alternative outcomes are checked.",
      });
    history.push({ fen, move: makeUci(move) });
  }
}
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "Every actual final insufficient-material capture in the fixed public August archive, selected before classifier or engine output. Includes routine drawn endings; not representative all-chess accuracy data. Player headers, clocks and comments omitted.",
      source,
      sha256: createHash("sha256").update(raw).digest("hex"),
      games: archive.games.length,
      standard,
      cases,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(JSON.stringify({ games: archive.games.length, standard, cases }, null, 2));
