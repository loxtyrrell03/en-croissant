import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci, makeUci } from "chessops/util";
import {
  directMaterialPayoffCases,
  reflectPayoff,
} from "../../src/utils/tests/fixtures/directMaterialPayoff.ts";

const [output] = process.argv.slice(2);
assert(output, "Provide a new private output path");
const probes = [];
for (const row of [...directMaterialPayoffCases, ...directMaterialPayoffCases.map(reflectPayoff)]) {
  const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  for (const [index, uci] of row.pvUci.entries()) {
    const move = parseUci(uci);
    assert(move && pos.isLegal(move));
    probes.push({
      id: `payoff:${row.id}:ply${index + 1}`,
      fen: makeFen(pos.toSetup()),
      searchMove: uci,
    });
    pos.play(move);
  }
}
// Independently inspect every legal defence of the newly reviewed real
// discovery, not just the principal variation's king retreat.
const real = directMaterialPayoffCases[0];
const pos = Chess.fromSetup(parseFen(real.fen).unwrap()).unwrap();
pos.play(parseUci(real.pvUci[0]));
for (const [from, destinations] of pos.allDests())
  for (const to of destinations) {
    const move = { from, to };
    assert(pos.isLegal(move));
    probes.push({
      id: `payoff:real-defence:${makeUci(move)}`,
      fen: makeFen(pos.toSetup()),
      searchMove: makeUci(move),
    });
  }
writeFileSync(
  output,
  JSON.stringify(
    {
      samplePath: output,
      sourceSha256: createHash("sha256")
        .update(readFileSync("src/utils/tests/fixtures/directMaterialPayoff.ts"))
        .digest("hex"),
      scope:
        "Fixed public mechanism/actual capture probes and all legal defences of the real discovery. Whole-position engine scores are not the local material bound.",
      probes,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`${probes.length} legal fixed-move probes`);
