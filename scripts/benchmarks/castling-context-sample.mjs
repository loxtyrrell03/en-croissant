import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess, castlingSide } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { kingCastlesTo, makeUci, parseUci } from "chessops/util";
import { makeSan } from "chessops/san";

const [output] = process.argv.slice(2);
assert(output, "Provide a new public output path");
const inputs = [
  "cross-phase-game-context.json",
  "broader-game-context.json",
  "black-context-development.json",
].map((name) => `benchmarks/tactical-relevance/${name}`);
const games = inputs.flatMap((path) => JSON.parse(readFileSync(path, "utf8")).games);
assert.equal(new Set(games.map((game) => game.id)).size, games.length);
const candidates = [];
for (const game of games) {
  const pos = Chess.fromSetup(parseFen(game.startFen).unwrap()).unwrap();
  let previousFen, previousMoveUci;
  for (const [ply, actual] of game.moves.entries()) {
    const fen = makeFen(pos.toSetup());
    for (const [from, destinations] of pos.allDests())
      for (const to of destinations) {
        const move = { from, to },
          side = castlingSide(pos, move);
        if (!side) continue;
        assert(pos.isLegal(move));
        const landing = { from, to: kingCastlesTo(pos.turn, side) };
        assert.equal(castlingSide(pos, landing), side);
        assert(pos.isLegal(landing));
        const a = pos.clone(),
          b = pos.clone();
        a.play(move);
        b.play(landing);
        assert.equal(makeFen(a.toSetup()), makeFen(b.toSetup()));
        const id = `castle:${game.id}:${ply}:${side}`;
        candidates.push({
          id,
          game: game.id,
          sourceGameUrl: game.sourceGameUrl,
          ply,
          fen,
          previousFen,
          previousMoveUci,
          actualPlayedUci: actual,
          side: pos.turn,
          flank: side,
          rookUci: makeUci(move),
          kingUci: makeUci(landing),
          san: makeSan(pos, move),
          afterFen: makeFen(a.toSetup()),
          key: createHash("sha256").update(`castling-context-2026-09-14:${id}`).digest("hex"),
        });
      }
    const played = parseUci(actual);
    assert(played && pos.isLegal(played));
    pos.play(played);
    previousFen = fen;
    previousMoveUci = actual;
  }
}
const groups = ["white:a", "white:h", "black:a", "black:h"].map((group) => {
  const rows = candidates
    .filter((row) => `${row.side}:${row.flank}` === group)
    .sort((a, b) => a.key.localeCompare(b.key));
  return { group, eligible: rows.length, selected: rows.slice(0, 6) };
});
writeFileSync(
  output,
  JSON.stringify(
    {
      scope:
        "All legal castling options across twelve frozen public game histories, selected before fresh engine/classifier output. Up to six SHA-ordered cases per colour/flank, without replacement. Candidate options need not be the move actually played. These puzzle-source games are not representative all-chess accuracy data.",
      sourceSha256: createHash("sha256")
        .update(
          inputs
            .map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"))
            .join(":"),
        )
        .digest("hex"),
      sourceFiles: inputs,
      eligible: candidates.length,
      strata: groups.map(({ group, eligible, selected }) => ({
        group,
        eligible,
        selected: selected.length,
      })),
      cases: groups.flatMap((group) => group.selected),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    games: games.length,
    eligible: candidates.length,
    selected: groups.reduce((sum, group) => sum + group.selected.length, 0),
    strata: groups.map(({ group, eligible, selected }) => ({
      group,
      eligible,
      selected: selected.length,
    })),
  }),
);
