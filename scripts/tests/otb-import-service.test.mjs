import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOtbImporterArgs,
  mergeOtbProgress,
  normalizeOtbImportPayload,
  parseOtbCollectorLine,
  parseOtbPgnGames,
} from "../otb-import-service.mjs";

test("normalizes a phone request with fast PC defaults", () => {
  const request = normalizeOtbImportPayload({
    playerName: "  Kodukula,   Sameera ",
    fideId: "FIDE 343413994",
    fromYear: 2024,
  });

  assert.deepEqual(request, {
    playerName: "Kodukula, Sameera",
    fideId: "343413994",
    fromYear: 2024,
    sources: {
      lichessBroadcasts: true,
      broadcastArchives: false,
      communityBroadcasts: false,
      chessResults: true,
      chessbaseNews: true,
      officialPgnIndexes: true,
      twic: true,
    },
  });
});

test("builds native collector arguments on the PC", () => {
  const request = normalizeOtbImportPayload({
    playerName: "Player, Example",
    fideId: "12345678",
    fromYear: 2025,
    sources: { broadcastArchives: true, communityBroadcasts: true, twic: false },
  });
  const args = buildOtbImporterArgs({ id: "otb-test", request }, "C:/cache", "C:/out.pgn");

  assert.ok(args.includes("--lichess-broadcast-archives"));
  assert.ok(args.includes("--lichess-community-broadcasts"));
  assert.ok(args.includes("--no-twic"));
  assert.equal(args[args.indexOf("--player") + 1], "Player, Example");
});

test("parses collector events and keeps result counts monotonic", () => {
  const first = parseOtbCollectorLine('PROGRESS\t{"jobId":"x","source":"TWIC","gamesFound":14}');
  assert.equal(first.type, "progress");
  assert.equal(
    mergeOtbProgress(first.value, { ...first.value, source: "ChessBase", gamesFound: 2 })
      .gamesFound,
    14,
  );
  assert.equal(parseOtbCollectorLine("diagnostic output"), null);
});

test("splits and summarizes verified PGNs on the PC", () => {
  const games = parseOtbPgnGames(
    `[Event "Congress"]\n[Date "2026.08.01"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n\n[Event "Open"]\n[Date "2026.08.02"]\n[White "B"]\n[Black "C"]\n[Result "1/2-1/2"]\n\n1. d4 d5 1/2-1/2`,
    "job",
  );

  assert.equal(games.length, 2);
  assert.deepEqual(
    games.map(({ id, event, white, black, result }) => ({ id, event, white, black, result })),
    [
      { id: "job:1", event: "Congress", white: "A", black: "B", result: "1-0" },
      { id: "job:2", event: "Open", white: "B", black: "C", result: "1/2-1/2" },
    ],
  );
});
