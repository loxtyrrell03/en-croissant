import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PgnParser } from "chessops/pgn";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { privateReportPath } from "./private-pgn-sample.mjs";

const [samplePath, courseRoot, engineRoot, destination] = process.argv.slice(2);
if (!destination)
  throw new Error("Provide sample, courses, engine evidence and private review output");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
const sources = new Map();
const packet = [];
for (const row of sample.cases.filter((row) => row.split === "development")) {
  const directory = readdirSync(courseRoot).find((name) =>
    name.startsWith(row.category === "tactical-course" ? "08 -" : "09 -"),
  );
  const path = join(courseRoot, directory, row.chapter);
  if (!sources.has(path)) {
    const games = [];
    new PgnParser((game, error) => {
      if (error) throw error;
      games.push(game);
    }).parse(readFileSync(path, "utf8"));
    sources.set(path, games);
  }
  const game = sources.get(path)[row.sourceGame - 1];
  const engine = JSON.parse(readFileSync(join(engineRoot, `${row.id}.json`), "utf8"));
  const lines = engine.deep.map((line) => {
    const position = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    const san = [];
    for (const uci of line.pvUci) {
      const move = parseUci(uci);
      if (!move || !position.isLegal(move)) throw new Error("Illegal cached engine line");
      san.push(makeSan(position, move));
      position.play(move);
    }
    return { cp: line.cp, mate: line.mate, depth: line.depth, san };
  });
  packet.push({
    id: row.id,
    source: row.category,
    exercise: row.exercise,
    fen: row.fen,
    sourceMoves: row.sourceSan,
    annotations: [
      game.comments ?? [],
      ...Array.from(game.moves.mainline(), (node) => node.comments ?? []),
    ].flat(),
    engineLines: lines,
    reference: {
      position: null,
      move: null,
      mistake: null,
      motifs: null,
      note: "Review independently of classifier outputs. Source categories and illustrative replies are not ground truth.",
    },
  });
}
writeFileSync(privateReportPath(destination), JSON.stringify(packet, null, 2), { flag: "wx" });
console.log(
  JSON.stringify({ reviewedPacketCases: packet.length, partition: "development", private: true }),
);
