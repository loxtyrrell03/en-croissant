import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import {
  interferenceExamples,
  interferenceControls,
} from "../../src/utils/tests/fixtures/interferenceRelevance.ts";

export function interferenceControlProbes(trace) {
  const probes = [];
  const add = (id, fen, searchMove, note) => {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    if (searchMove && !pos.isLegal(parseUci(searchMove))) throw new Error(`Illegal probe ${id}`);
    probes.push({ id, fen, ...(searchMove ? { searchMove } : {}), note });
  };
  for (const row of interferenceControls) {
    add(
      `control:${row.id}:root`,
      row.fen,
      row.move,
      "Constructed counterfactual; a negative score is not itself the reason to reject the theme.",
    );
    const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    pos.play(parseUci(row.move));
    add(
      `control:${row.id}:reply`,
      makeFen(pos.toSetup()),
      row.reply,
      "Verify the concrete escape/countercapture rather than accepting a cooperative supplied line.",
    );
    if (row.id === "mating-counterplay") {
      add(
        "control:mate:discarded-king-flight",
        makeFen(pos.toSetup()),
        "d8c8",
        "The discarded escape permits immediate promotion mate; it is not a successful defensive control.",
      );
      add(
        "control:mate:actual-defence",
        makeFen(pos.toSetup()),
        "b7e7",
        "The engine's actual strongest root defence; local exchange gains are not full-position evaluations.",
      );
      pos.play(parseUci(row.reply));
      add(
        "control:mate:queen-capture",
        makeFen(pos.toSetup()),
        "h1h7",
        "The material payoff allows immediate mate.",
      );
      pos.play(parseUci("h1h7"));
      add(
        "control:mate:refutation",
        makeFen(pos.toSetup()),
        "b2b1",
        "The rook gives actual checkmate, not a material estimate.",
      );
    }
  }
  for (const row of interferenceExamples)
    add(
      `${row.id}:missed`,
      row.fen,
      row.id === "DBBd9" ? "d8e8" : "e7e5",
      "Legal missed opportunity; not a claim that every alternative is equally bad.",
    );
  const rare = trace.compensated;
  add(
    "dkEzJ:root",
    rare.fen,
    rare.pvUci[0],
    "An older real interference remains valid after deducting off-square pawn compensation.",
  );
  for (const branch of rare.proof.branches.filter((b) => b.gain === rare.proof.gain))
    add(
      `dkEzJ:minimum:${branch.replyUci}`,
      branch.fen,
      branch.answerUci,
      "Changed minimum local bound; compare with a separately searched full-position estimate.",
    );
  return probes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tracePath, output] = process.argv.slice(2);
  const probes = interferenceControlProbes(JSON.parse(readFileSync(tracePath, "utf8")));
  writeFileSync(
    output,
    JSON.stringify(
      { samplePath: "benchmarks/tactical-relevance/secondary-theme-development.json", probes },
      null,
      2,
    ),
    { flag: "wx" },
  );
  process.stdout.write(`Prepared ${probes.length} control and corrected-bound searches.\n`);
}
