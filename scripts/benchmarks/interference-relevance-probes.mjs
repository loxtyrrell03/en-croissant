import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

export function interferenceWitnessProbes(trace) {
  const probes = [];
  const add = (id, fen, searchMove, note) => {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    if (!pos.isLegal(parseUci(searchMove))) throw new Error(`Illegal witness ${id}`);
    probes.push({ id, fen, searchMove, note });
  };
  function branches(id, rows) {
    for (const row of rows) {
      const key = `${id}:${row.replyUci}`;
      add(
        key,
        row.fen,
        row.answerUci,
        "Selected all-defence witness; full-position scores are not local material certificates or optimal-move guarantees.",
      );
      if (row.recut) branches(`${key}:recut`, row.recut);
      for (const [index, leaf] of (row.continuation ?? []).entries())
        add(
          `${key}:recovery:${index}`,
          leaf.fen,
          leaf.moveUci,
          "Every selected guard-removal recovery leaf, including legal recaptures and material retention.",
        );
    }
  }
  for (const item of trace.cases) {
    if (!item.proof) throw new Error(`Incomplete candidate ${item.id}`);
    add(
      `${item.id}:root`,
      item.row.startFen,
      item.row.bestLine[0],
      "Root evaluation, not admission based on the source theme.",
    );
    branches(item.id, item.proof.branches);
  }
  return probes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  const probes = interferenceWitnessProbes(JSON.parse(readFileSync(input, "utf8")));
  writeFileSync(
    output,
    JSON.stringify(
      { samplePath: "benchmarks/tactical-relevance/secondary-theme-development.json", probes },
      null,
      2,
    ),
    { flag: "wx" },
  );
  process.stdout.write(`Prepared ${probes.length} independently searched witnesses.\n`);
}
