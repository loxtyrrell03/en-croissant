import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

export function broaderGameResponseProbes(context) {
  return context.cases.map((row) => {
    const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    const move = parseUci(row.sourceUci[0]);
    assert.ok(move && pos.isLegal(move));
    pos.play(move);
    return { id: row.id + ":reply", fen: makeFen(pos.toSetup()) };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const context = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/broader-game-context.json", "utf8"),
  );
  const probes = broaderGameResponseProbes(context);
  assert.equal(probes.length, 23);
  writeFileSync(
    process.argv[2],
    JSON.stringify(
      {
        samplePath: "benchmarks/tactical-relevance/broader-game-context.json",
        scope:
          "Every sampled source move's actual resulting board, not just moves selected for large engine losses. Complements the White-to-move root sample with Black's replies. Not a separate representative sample.",
        probes,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(`Prepared ${probes.length} fixed after-move searches.`);
}
