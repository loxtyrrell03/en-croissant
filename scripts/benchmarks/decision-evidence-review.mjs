import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PgnParser } from "chessops/pgn";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { privateReportPath } from "./private-pgn-sample.mjs";
import { assertFrozenFiles, selectFrozenValidation } from "./decision-evidence-freeze.mjs";

const [samplePath, courseRoot, engineRoot, destination, freezePath] = process.argv.slice(2);
if (!destination)
  throw new Error("Provide sample, courses, engine evidence and private review output");
const sampleBytes = readFileSync(samplePath);
const sample = JSON.parse(sampleBytes);
const partition = freezePath ? "validation" : "development";
let selected = sample.cases.filter((row) => row.split === partition);
if (freezePath) {
  const freeze = JSON.parse(readFileSync(freezePath, "utf8"));
  assertFrozenFiles(process.cwd(), freeze);
  selected = selectFrozenValidation(sampleBytes, "course", freeze);
}
const sources = new Map();
const packet = [];
/** Visit only alternatives anchored on the legal source mainline. Some
 * downloaded exercises contain malformed side lines; preserve honest limits. */
function legalAlternatives(game, fen) {
  const board = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const prefix = [],
    variations = [];
  let node = game.moves;
  for (let ply = 0; ply < 8 && node.children.length; ply++) {
    for (const first of node.children.slice(1, 4)) {
      const side = board.clone();
      const san = [];
      let next = first;
      while (next && san.length < 8) {
        const move = parseSan(side, next.data.san);
        if (!move || !side.isLegal(move)) break;
        san.push(makeSan(side, move));
        side.play(move);
        next = next.children[0];
      }
      if (san.length) variations.push({ after: [...prefix], san, complete: next === undefined });
      if (variations.length >= 6) return variations;
    }
    node = node.children[0];
    const move = parseSan(board, node.data.san);
    if (!move || !board.isLegal(move)) break;
    prefix.push(makeSan(board, move));
    board.play(move);
  }
  return variations;
}
for (const row of selected) {
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
    legalSourceAlternatives: legalAlternatives(game, row.fen),
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
console.log(JSON.stringify({ reviewPacketCases: packet.length, partition, private: true }));
