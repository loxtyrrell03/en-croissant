import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci, makeUci } from "chessops/util";

const [output] = process.argv.slice(2);
assert(output, "Provide a new private output path");
const samplePath = "benchmarks/tactical-relevance/rare-theme-development.json";
const cases = JSON.parse(readFileSync(samplePath, "utf8")).cases.filter((row) =>
  ["lichess:ZVq1J", "lichess:snAK4", "lichess:4Ds65"].includes(row.id),
);
const probes = [];
for (const row of cases) {
  probes.push({ id: `${row.id}:root`, fen: row.startFen, searchMove: row.bestLine[0] });
  const pos = Chess.fromSetup(parseFen(row.startFen).unwrap()).unwrap();
  const rootMove = parseUci(row.bestLine[0]);
  assert(rootMove && pos.isLegal(rootMove));
  pos.play(rootMove);
  for (const [from, destinations] of pos.allDests())
    for (const to of destinations) {
      const move = { from, to };
      assert(pos.isLegal(move));
      probes.push({
        id: `${row.id}:defence:${makeUci(move)}`,
        fen: makeFen(pos.toSetup()),
        searchMove: makeUci(move),
      });
    }
  for (const uci of row.bestLine.slice(1, 2)) {
    const move = parseUci(uci);
    assert(move && pos.isLegal(move));
    pos.play(move);
  }
  probes.push({
    id: `${row.id}:reached-preparation`,
    fen: makeFen(pos.toSetup()),
    searchMove: row.bestLine[2],
  });
}
writeFileSync(
  output,
  JSON.stringify(
    {
      samplePath,
      scope:
        "All legal immediate defences and selected root/reached preparations for three previously unresolved public motifs. No post-output filtering or expected primary labels.",
      probes,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`${probes.length} fixed legal root/defence/preparation searches.`);
