import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { privateReportPath } from "./private-pgn-sample.mjs";

const fen = "1rr3k1/5ppp/2B1b3/5p2/6N1/1P6/P1P2PPP/R3R1K1 b - - 0 21";
const probes = [{ id: "capture-choice:root", fen }];
for (const uci of ["c8c6", "f5g4"]) {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const move = parseUci(uci);
  assert(move && pos.isLegal(move));
  probes.push({ id: `capture-choice:${uci}`, fen, searchMove: uci });
  pos.play(move);
  for (const [from, destinations] of pos.allDests())
    for (const to of destinations) {
      const reply = { from, to };
      assert(pos.isLegal(reply));
      // This middlegame has no pawn on the seventh rank. No promotion choices
      // or castling rights are silently lost by this case-specific audit.
      assert(!(pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)));
      probes.push({
        id: `capture-choice:${uci}:${makeUci(reply)}`,
        fen: makeFen(pos.toSetup()),
        searchMove: makeUci(reply),
      });
    }
}
writeFileSync(
  privateReportPath(process.argv[2]),
  JSON.stringify(
    {
      samplePath: "benchmarks/tactical-relevance/quiet-game-context-development.json",
      scope:
        "Unrestricted root, both captures, and every legal immediate defence after either capture. Full-position engine values are not guarantees of material retention or a proof of the reason for the score difference.",
      probes,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`${probes.length} exact root and defence searches.`);
