import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import {
  matingMechanismExamples,
  matingMechanismControls,
} from "../../src/utils/tests/fixtures/matingMechanismRelevance.ts";

export function matingMechanismProbes() {
  const probes = [];
  const position = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const play = (pos, uci) => {
    const move = parseUci(uci);
    assert.ok(move && pos.isLegal(move));
    const next = pos.clone();
    next.play(move);
    return next;
  };
  const add = (id, pos, searchMove) =>
    probes.push({ id, fen: makeFen(pos.toSetup()), ...(searchMove ? { searchMove } : {}) });
  for (const row of matingMechanismExamples) {
    const root = position(row.fen);
    add(`${row.id}:root`, root, row.pvUci[0]);
    const after = play(root, row.pvUci[0]);
    for (const [from, tos] of after.allDests())
      for (const to of tos) {
        assert.notEqual(
          after.board.get(from)?.role,
          "pawn",
          "Add full promotion enumeration before expanding this input",
        );
        const reply = makeUci({ from, to }),
          next = play(after, reply);
        add(`${row.id}:defence:${reply}`, next);
        const answer =
          row.id === "49h84"
            ? "e7g7"
            : row.id === "qY3NM"
              ? reply === "e6f6"
                ? "e1e8"
                : "f6g7"
              : reply === "f8f7"
                ? "d1d8"
                : "f7f8";
        add(`${row.id}:witness:${reply}`, next, answer);
        const reached = play(next, answer);
        if (reached.isCheckmate()) continue;
        assert.ok(["qY3NM", "kO37k"].includes(row.id));
        for (const [a, ds] of reached.allDests())
          for (const d of ds) {
            const evasion = makeUci({ from: a, to: d }),
              leaf = play(reached, evasion);
            add(`${row.id}:last-defence:${evasion}`, leaf);
            add(`${row.id}:last-witness:${evasion}`, leaf, row.pvUci[4]);
          }
      }
    add(
      `${row.id}:missed`,
      root,
      row.id === "49h84" ? "e1e3" : row.id === "qY3NM" ? "f3d3" : "d7a7",
    );
  }
  for (const control of matingMechanismControls) {
    const root = position(control.fen),
      row = matingMechanismExamples[control.theme === "selfInterference" ? 0 : 1];
    add(`control:${control.id}:root`, root, row.pvUci[0]);
    add(`control:${control.id}:after-acceptance`, play(play(root, row.pvUci[0]), row.pvUci[1]));
  }
  // Retain the contrary initial pin proposal: its g3 pawn blocks the added
  // g1 rook. It must not become the final pinned-guard negative fixture.
  add(
    "contrary:pawn-blocks-pinning-rook",
    position("8/4R1p1/p4k2/1b1p1p1p/1P4r1/2P3P1/3K4/4R1R1 w - - 2 49"),
    "e1e6",
  );
  assert.equal(new Set(probes.map((p) => p.id)).size, probes.length);
  return probes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output] = process.argv.slice(2);
  const sample = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/cross-phase-development.json", "utf8"),
  );
  for (const row of matingMechanismExamples) {
    const source = sample.cases.find((s) => s.id === `lichess:${row.id}`);
    assert.equal(row.fen, source.startFen);
    assert.deepEqual(row.pvUci, source.bestLine);
  }
  const probes = matingMechanismProbes();
  writeFileSync(
    output,
    JSON.stringify(
      { samplePath: "benchmarks/tactical-relevance/cross-phase-development.json", probes },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(`Prepared ${probes.length} fresh secondary-mechanism searches.`);
}
