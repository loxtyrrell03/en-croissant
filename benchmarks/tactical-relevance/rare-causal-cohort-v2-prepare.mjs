// Legal replay and exactly two frozen public game exports. No classifier.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { PgnParser, startingPosition } from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
const selection = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/rare-causal-cohort-v2-selection.json", "utf8"),
);
const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const puzzles = selection.cases.map((row) => {
  const pos = position(row.startFen),
    before = position(row.sourceFen);
  const preceding = parseUci(row.precedingMove);
  if (!preceding || !before.isLegal(preceding)) throw Error(`Illegal preceding move ${row.id}`);
  before.play(preceding);
  if (makeFen(before.toSetup()) !== row.startFen) throw Error(`Mismatched source root ${row.id}`);
  const replay = [];
  for (const uci of row.bestLine) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) throw Error(`Illegal source line ${row.id}: ${uci}`);
    const san = makeSan(pos, move),
      fen = makeFen(pos.toSetup());
    pos.play(move);
    replay.push({
      fen,
      uci,
      san,
      afterFen: makeFen(pos.toSetup()),
      legalReplyCount: [...pos.allDests()].reduce((n, [, tos]) => n + tos.size(), 0),
    });
  }
  return { ...row, replay };
});
const games = [],
  contexts = [];
for (const nominated of selection.controlGames) {
  const gameId = nominated.sourceGroup.slice(5);
  if (!/^[a-zA-Z0-9]{8}$/.test(gameId)) throw Error("Unexpected frozen public game identity");
  const url = `https://lichess.org/game/export/${gameId}?clocks=false&evals=false&opening=false&literate=false`;
  try {
    let response = await fetch(url, {
      headers: { Accept: "application/x-chess-pgn" },
      signal: AbortSignal.timeout(20000),
    });
    if ([429, 503].includes(response.status)) {
      const seconds = Math.max(2, Number(response.headers.get("retry-after") ?? 2));
      if (seconds <= 5) {
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        response = await fetch(url, {
          headers: { Accept: "application/x-chess-pgn" },
          signal: AbortSignal.timeout(20000),
        });
      }
    }
    if (!response.ok) throw Error(`Public export HTTP ${response.status}`);
    const raw = await response.text();
    if (raw.length > 131072) throw Error("Single-game export exceeds compact limit");
    const parsed = [];
    new PgnParser((game, error) => {
      if (error) throw error;
      parsed.push(game);
    }).parse(raw);
    if (parsed.length !== 1) throw Error("Expected one public game");
    const pos = startingPosition(parsed[0].headers).unwrap(),
      startFen = makeFen(pos.toSetup());
    const moves = [],
      sans = [],
      fens = [startFen];
    for (const node of parsed[0].moves.mainline()) {
      if (moves.length >= 600) throw Error("Game exceeds bounded 600-ply profile");
      const move = parseSan(pos, node.san);
      if (!move || !pos.isLegal(move)) throw Error("Illegal exported public move");
      moves.push(makeUci(move));
      sans.push(makeSan(pos, move));
      pos.play(move);
      fens.push(makeFen(pos.toSetup()));
    }
    const game = {
      gameId,
      sourceGameUrl: `https://lichess.org/${gameId}`,
      exportUrl: url,
      sourceSha256: createHash("sha256").update(raw).digest("hex"),
      startFen,
      moves,
      scope: "Public legal moves only; player headers, comments and clocks omitted",
      retainedPlies: moves.length,
    };
    games.push(game);
    for (const ply of selection.controlReachedPlies) {
      if (ply >= moves.length) {
        contexts.push({
          id: `context:${gameId}:ply${ply}`,
          gameId,
          ply,
          status: "unavailable",
          reason: "Game ended before a move at the frozen reached ply",
        });
        continue;
      }
      contexts.push({
        id: `context:${gameId}:ply${ply}`,
        gameId,
        ply,
        sourceGameUrl: game.sourceGameUrl,
        fen: fens[ply],
        previousFen: fens[ply - 1],
        previousMoveUci: moves[ply - 1],
        playedMoveUci: moves[ply],
        playedSan: sans[ply],
        actualContinuation: moves.slice(ply, ply + 8),
        status: "unadjudicated ordinary game context",
      });
    }
  } catch (error) {
    games.push({ gameId, exportUrl: url, status: "unavailable", reason: String(error) });
    for (const ply of selection.controlReachedPlies)
      contexts.push({
        id: `context:${gameId}:ply${ply}`,
        gameId,
        ply,
        status: "unavailable",
        reason: "Frozen public export unavailable; not replaced",
      });
  }
}
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      scope:
        "Legality and public-game provenance only; prepared before classifier or fresh engine output",
      puzzles,
      games,
      contexts,
    },
    null,
    2,
  ),
);
