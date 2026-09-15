// Freeze whole games before looking at engine/classifier output. Preserve every
// legal position, including quiet moves and the opponent's opportunities.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { PgnParser, startingPosition } from "chessops/pgn";
import { makeFen } from "chessops/fen";
import { parseSan, makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { pathToFileURL } from "node:url";
import { privateReportPath } from "./private-pgn-sample.mjs";
export function prepareChesscomRecallSample(raw, source, count = 3) {
  const match = source.match(
    /^https:\/\/api\.chess\.com\/pub\/player\/([a-zA-Z0-9_-]+)\/games\/\d{4}\/\d{2}$/,
  );
  assert(match, "Use a fixed monthly Chess.com archive");
  assert(Number.isInteger(count) && count > 0 && count <= 10);
  const owner = match[1].toLowerCase(),
    archive = JSON.parse(raw);
  assert(Array.isArray(archive.games));
  const selected = archive.games
    .filter((g) => g.rules === "chess")
    .sort((a, b) => b.end_time - a.end_time || a.url.localeCompare(b.url))
    .slice(0, count);
  assert(
    selected.length && new Set(selected.map((g) => g.url)).size === selected.length,
    "Empty or duplicate sample",
  );
  const games = [],
    cases = [];
  for (const item of selected) {
    const white = item.white?.username?.toLowerCase() === owner,
      black = item.black?.username?.toLowerCase() === owner;
    assert(white !== black, "Owner must match exactly one side");
    const parsed = [];
    new PgnParser((game, error) => {
      assert(!error, String(error));
      parsed.push(game);
    }).parse(item.pgn);
    assert.equal(parsed.length, 1);
    const game = parsed[0],
      pos = startingPosition(game.headers).unwrap(),
      id = item.url.split("/").at(-1),
      moves = [],
      sans = [],
      fens = [];
    for (const node of game.moves.mainline()) {
      const move = parseSan(pos, node.san);
      assert(move && pos.isLegal(move));
      fens.push(makeFen(pos.toSetup()));
      moves.push(makeUci(move));
      sans.push(makeSan(pos, move));
      pos.play(move);
    }
    fens.push(makeFen(pos.toSetup()));
    assert(moves.length, "Empty source game");
    games.push({
      id,
      sourceGameUrl: item.url,
      startFen: fens[0],
      moves,
      sans,
      ownerSide: white ? "white" : "black",
    });
    for (let ply = 0; ply < moves.length; ply++)
      cases.push({
        id: `recall:${id}:ply${ply}`,
        game: id,
        ply,
        fen: fens[ply],
        playedMoveUci: moves[ply],
        playedSan: sans[ply],
        afterFen: fens[ply + 1],
        previousFen: fens[ply - 1],
        previousMoveUci: moves[ply - 1],
        sourceUci: moves.slice(ply, ply + 12),
      });
  }
  return {
    scope: `Latest ${count} standard games in the fixed archive, by end time, before any engine/classifier output; all plies retained. No outcome, rating or tactical filter. A development sample, not an accuracy estimate. Headers and clocks omitted.`,
    source,
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    archiveGames: archive.games.length,
    games,
    cases,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, output, countText = "3"] = process.argv.slice(2);
  assert(output, "Supply a new private output file");
  const target = privateReportPath(output);
  assert(!existsSync(target), "Do not overwrite the frozen sample");
  assert(
    /^https:\/\/api\.chess\.com\/pub\/player\/[a-zA-Z0-9_-]+\/games\/\d{4}\/\d{2}$/.test(source),
  );
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Archive HTTP ${response.status}`);
  const sample = prepareChesscomRecallSample(await response.text(), source, Number(countText));
  writeFileSync(target, JSON.stringify(sample, null, 2), { flag: "wx" });
  console.log(
    JSON.stringify({
      archiveGames: sample.archiveGames,
      games: sample.games.length,
      positions: sample.cases.length,
    }),
  );
}
