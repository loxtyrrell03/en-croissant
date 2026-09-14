import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci } from "chessops/util";

const read = (name) => JSON.parse(readFileSync("benchmarks/tactical-relevance/" + name, "utf8"));
const broader = read("broader-game-stockfish-18.json"),
  cross = read("cross-phase-stockfish-18.json"),
  rare = read("rare-theme-development.json");
const ordinary = [
  "ordinary-games-stockfish-18.json",
  "ordinary-early-stockfish-18.json",
  "ordinary-adjacent-stockfish-18.json",
].flatMap(read);
const boards = [
  ...broader.cases,
  ...broader.responses,
  ...cross.cases,
  ...rare.cases.map((r) => ({ id: r.id, fen: r.startFen })),
  ...ordinary,
];
const candidates = new Map();
for (const row of boards) {
  const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  if (pos.isCheck() || pos.isEnd()) continue;
  for (const [from, tos] of pos.allDests())
    for (const to of tos) {
      if (pos.board.get(to)?.role !== "pawn") continue;
      const move = { from, to };
      if (!pos.isLegal(move)) continue;
      const next = pos.clone();
      next.play(move);
      if (!next.isCheck() || !next.ctx().checkers.has(to)) continue;
      const fen = makeFen(pos.toSetup()),
        uci = makeUci(move),
        key = fen.split(" ").slice(0, 4).join(" ") + ":" + uci;
      if (candidates.has(key)) continue;
      candidates.set(key, {
        id: "checking-pawn:" + createHash("sha256").update(key).digest("hex").slice(0, 12),
        sourceId: row.id,
        fen,
        searchMove: uci,
        hash: createHash("sha256")
          .update("checking-pawn-blind-v1:" + key)
          .digest("hex"),
      });
    }
}
const selected = [...candidates.values()].sort((a, b) => a.hash.localeCompare(b.hash)).slice(0, 30);
assert.ok(selected.length);
writeFileSync(
  process.argv[2],
  JSON.stringify(
    {
      scope:
        "First thirty hash-ordered legal direct checking pawn captures across frozen public opening, positional, tactical and endgame boards. Selection precedes new classifier/engine results. Excludes positions already in check and promotions, and is not representative game accuracy.",
      boardCount: boards.length,
      eligible: candidates.size,
      cases: selected,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  `Selected ${selected.length} of ${candidates.size} candidates from ${boards.length} public boards.`,
);
