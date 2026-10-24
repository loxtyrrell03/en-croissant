import { afterEach, expect, test, vi } from "vitest";
import { fetchWebOnlineGames } from "../onlineImport";

afterEach(() => vi.unstubAllGlobals());

test("phone import orders valid days ahead of impossible PGN dates", async () => {
  const games = [
    '[Event "Impossible"]\n[Date "2026.02.30"]\n\n1. e4 *',
    '[Event "Valid"]\n[UTCDate "2026.03.01"]\n[UTCTime "12:30:00"]\n\n1. d4 *',
    '[Event "Unknown time"]\n[UTCDate "2026.03.01"]\n[UTCTime "25:00:00"]\n\n1. c4 *',
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/archives")
    ? new Response(JSON.stringify({ archives: ["https://api.chess.com/pub/player/example/games/2026/03"] }))
    : new Response(games.join("\n\n"))));
  const result = await fetchWebOnlineGames({source: "chesscom", username: "example", mode: "count", count: 3, range: "all"});
  expect(result.map(game => game.playedAt)).toEqual([Date.UTC(2026, 2, 1, 12, 30), Date.UTC(2026, 2, 1), 0]);
  expect(result.map(game => game.pgn)).toEqual([games[1], games[2], games[0]]);
});
