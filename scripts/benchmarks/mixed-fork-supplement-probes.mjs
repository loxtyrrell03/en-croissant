import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { mixedForkFen, mixedForkControls } from "../../src/utils/tests/fixtures/mixedTargetFork.ts";

export function mixedForkSupplementProbes() {
  const after = (fen, moves) => {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    for (const uci of moves) {
      const move = parseUci(uci);
      assert.ok(move && pos.isLegal(move));
      pos.play(move);
    }
    return makeFen(pos.toSetup());
  };
  const queen = mixedForkControls.find((r) => r.id === "off-square-queen-liability").fen;
  return [
    { id: "mixed-fork:missed-refutation", fen: after(mixedForkFen, ["c6c7"]), searchMove: "c2d2" },
    {
      id: "mixed-fork:queen-control:intermediate-check",
      fen: after(queen, ["d2f3", "e1e2"]),
      searchMove: "f3d4",
    },
    {
      id: "mixed-fork:queen-control:rook-recovery",
      fen: after(queen, ["d2f3", "e1e2", "f3d4", "c2d2"]),
      searchMove: "d4e2",
    },
  ];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  writeFileSync(
    process.argv[2],
    JSON.stringify(
      {
        samplePath: "benchmarks/tactical-relevance/broader-game-context.json",
        probes: mixedForkSupplementProbes(),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
