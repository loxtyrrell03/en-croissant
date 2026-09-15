import test from "node:test";
import assert from "node:assert/strict";
import { prepareChesscomRecallSample } from "../benchmarks/chesscom-recall-sample.mjs";
const source = "https://api.chess.com/pub/player/example/games/2026/09";
const game = (id, end = id, extra = {}) => ({
  url: `https://www.chess.com/game/live/${id}`,
  end_time: end,
  rules: "chess",
  white: { username: "Example" },
  black: { username: "Opponent" },
  pgn: '[White "Example"]\n[Black "Opponent"]\n\n1. e4 {[%clk 0:03:00] private comment} e5 2. Nf3 *',
  ...extra,
});
const sample = (games, count = 3) =>
  prepareChesscomRecallSample(JSON.stringify({ games }), source, count);
test("fixed latest standard games and deterministic ties, not result filtering", () => {
  const result = sample(
    [game(3, 20), game(1, 20), game(2, 10), game(4, 30, { rules: "chess960" })],
    2,
  );
  assert.deepEqual(
    result.games.map((r) => r.id),
    ["1", "3"],
  );
  assert.equal(result.cases.length, 6);
  assert.equal(result.sourceSha256.length, 64);
});
test("all actual plies retain matching history without headers or comments", () => {
  const result = sample([game(1)]),
    rows = result.cases;
  assert.deepEqual(
    rows.map((r) => r.playedSan),
    ["e4", "e5", "Nf3"],
  );
  assert.equal(rows[0].previousFen, undefined);
  assert.equal(rows[1].previousFen, rows[0].fen);
  assert.equal(rows[1].fen, rows[0].afterFen);
  assert.equal(rows[1].previousMoveUci, "e2e4");
  assert(!JSON.stringify(result).includes("private comment"));
  assert(!JSON.stringify(result).includes("Opponent"));
});
test("Black ownership uses the actual turn in a custom-start game", () => {
  const result = sample([
    game(1, 1, {
      white: { username: "Other" },
      black: { username: "EXAMPLE" },
      pgn: '[SetUp "1"]\n[FEN "4k3/7p/8/8/8/8/P7/4K3 b - - 0 1"]\n\n1... h5 2. a4 *',
    }),
  ]);
  assert.equal(result.games[0].ownerSide, "black");
  assert.equal(result.cases[0].playedMoveUci, "h7h5");
});
test("duplicates, mismatched owners, illegal moves and empty archives fail", () => {
  for (const games of [
    [game(1), game(1)],
    [game(1, 1, { white: { username: "Other" } })],
    [game(1, 1, { pgn: "1. e5 *" })],
    [],
  ])
    assert.throws(() => sample(games));
});
test("counts must be bounded integers and URLs must select a fixed archive", () => {
  for (const count of [0, -1, 1.5, 11, NaN]) assert.throws(() => sample([game(1)], count));
  assert.throws(() =>
    prepareChesscomRecallSample(JSON.stringify({ games: [game(1)] }), "https://example.com/"),
  );
});
