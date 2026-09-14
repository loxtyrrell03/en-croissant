import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci, makeUci } from "chessops/util";
import {
  promotionCounterplayBase,
  promotionCounterplayCases,
  skeweredPromotionLine,
} from "../../src/utils/tests/fixtures/promotionCounterplay.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function promotionEndingProbes(before, after, trace) {
  const expected = promotionCounterplayCases();
  assert.deepEqual(
    before.cases.map(({ id, fen }) => ({ id, fen })),
    expected,
  );
  assert.deepEqual(
    after.cases.map(({ id, fen }) => ({ id, fen })),
    expected,
  );
  const positionKey = (fen) => fen.split(" ").slice(0, 4).join(" ");
  const unique = [
    ...new Map(
      trace.proof.decisions.map((d) => [positionKey(d.fen) + ":" + d.moveUci, d]),
    ).values(),
  ];
  const probes = [{ id: "MJZcU:root", fen: promotionCounterplayBase, searchMove: "f4e4" }];
  for (const row of after.cases) {
    const old = before.cases.find((b) => b.id === row.id);
    if (Boolean(old.proof) !== Boolean(row.proof) || old.proof?.gain !== row.proof?.gain) {
      probes.push({ id: row.id + ":changed-root", fen: row.fen, searchMove: "f4e4" });
      probes.push({ id: row.id + ":best-choice", fen: row.fen });
    }
  }
  const root = Chess.fromSetup(parseFen(promotionCounterplayBase).unwrap()).unwrap();
  root.play(parseUci("f4e4"));
  for (const [from, tos] of root.allDests())
    for (const to of tos) {
      assert.notEqual(root.board.get(from)?.role === "pawn" && (to < 8 || to >= 56), true);
      const next = root.clone();
      next.play({ from, to });
      const fen = makeFen(next.toSetup());
      const selected = unique.find((d) => positionKey(d.fen) === positionKey(fen));
      assert.ok(selected);
      probes.push({
        id: "MJZcU:reply:" + makeUci({ from, to }),
        fen,
        searchMove: selected.moveUci,
      });
    }
  // A fixed hash slice of the newly required promotion leaves, not an accuracy
  // sample. The production proof covers all leaves; engine searches audit 20.
  const hash = (d) =>
    createHash("sha256")
      .update(positionKey(d.fen) + ":" + d.moveUci)
      .digest("hex");
  for (const leaf of unique
    .filter((d) => d.stage === "pawn-ending-promotion")
    .sort((a, b) => hash(a).localeCompare(hash(b)))
    .slice(0, 20))
    probes.push({
      id: "MJZcU:promotion-leaf:" + hash(leaf).slice(0, 12),
      fen: leaf.fen,
      searchMove: leaf.moveUci,
    });

  const counterqueen = expected.find((row) => row.id === "king-12");
  probes.push({ id: "king-12:counterqueen-root", fen: counterqueen.fen, searchMove: "f4e4" });
  probes.push({ id: "king-12:counterqueen-choice", fen: counterqueen.fen });
  const skewer = Chess.fromSetup(
    parseFen(expected.find((row) => row.id === "king-24").fen).unwrap(),
  ).unwrap();
  for (const [index, uci] of skeweredPromotionLine.entries()) {
    const move = parseUci(uci);
    assert.ok(move && skewer.isLegal(move));
    if (index === 8)
      probes.push({ id: "skewer:promotion", fen: makeFen(skewer.toSetup()), searchMove: uci });
    skewer.play(move);
  }
  probes.push({ id: "skewer:all-evasions", fen: makeFen(skewer.toSetup()) });
  return probes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [beforePath, afterPath, tracePath, output] = process.argv.slice(2);
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const probes = promotionEndingProbes(read(beforePath), read(afterPath), read(tracePath));
  writeFileSync(
    output,
    JSON.stringify(
      {
        samplePath: "benchmarks/tactical-relevance/rare-theme-development.json",
        scope:
          "Changed counterplay roots and best choices, every selected first defence witness, twenty hash-selected promotion leaves and concrete skewer/counterqueen controls. Diagnostic selection, not an output-blind accuracy sample.",
        probes,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(`Prepared ${probes.length} fixed searches.`);
}
