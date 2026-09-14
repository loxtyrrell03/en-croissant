import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const samplePath = "benchmarks/tactical-relevance/cross-phase-development.json";
export function crossPhaseDefenceProbes(sample) {
  const probes = [];
  for (const id of ["hGEvH", "brn5j", "SIVEv"]) {
    const row = sample.cases.find((r) => r.id === `lichess:${id}`),
      pos = Chess.fromSetup(parseFen(row.startFen).unwrap()).unwrap();
    pos.play(parseUci(row.bestLine[0]));
    for (const [from, tos] of pos.allDests())
      for (const to of tos) {
        const move = { from, to };
        if (pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56))
          throw new Error("Promotion enumeration requires all four choices");
        const next = pos.clone();
        next.play(move);
        probes.push({ id: `${id}:reply:${makeUci(move)}`, fen: makeFen(next.toSetup()) });
      }
  }
  for (const id of ["EKWHC", "W2tIf"]) {
    const row = sample.cases.find((r) => r.id === `lichess:${id}`),
      pos = Chess.fromSetup(parseFen(row.startFen).unwrap()).unwrap();
    pos.play(parseUci(row.bestLine[0]));
    probes.push({ id: `${id}:actual`, fen: makeFen(pos.toSetup()) });
    pos.turn = pos.turn === "white" ? "black" : "white";
    pos.epSquare = undefined;
    probes.push({ id: `${id}:pass`, fen: makeFen(pos.toSetup()) });
  }
  return probes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output] = process.argv.slice(2),
    probes = crossPhaseDefenceProbes(JSON.parse(readFileSync(samplePath, "utf8")));
  writeFileSync(output, JSON.stringify({ samplePath, probes }, null, 2), { flag: "wx" });
  console.log(`Prepared ${probes.length} independent defence and pass searches.`);
}
