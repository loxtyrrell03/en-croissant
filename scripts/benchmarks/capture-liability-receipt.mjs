import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { captureGainLiabilityCases, reflectCaptureLiability } from "../../src/utils/tests/fixtures/captureGainLiability.ts";

const [input, output] = process.argv.slice(2);
const bytes = readFileSync(input), report = JSON.parse(bytes);
assert.equal(report.completed,95); assert.equal(report.requested,95);
assert.equal(new Set(report.searches.map(row=>row.id)).size,95);
const allowed = new Set();
const position = fen => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const include = board => allowed.add(makeFen(board.toSetup()));
const play = (board,uci) => { const move=parseUci(uci); assert(move && board.isLegal(move));board.play(move);include(board); };
for (const row of [...captureGainLiabilityCases,...captureGainLiabilityCases.map(reflectCaptureLiability)]) include(position(row.fen));
const base="4r2k/5rp1/6qp/3PB3/4Q2n/3R4/6PP/4R1K1 b - - 0 1";
for (const fen of [base,base.replace("6qp","2b3qp").replace("3PB3","3NB3")]) {
  const board=position(fen);include(board);play(board,"e8e5");
  for (const [from,dests] of board.allDests()) for (const to of dests) {
    const next=board.clone(); assert(next.isLegal({from,to}));next.play({from,to});include(next);
  }
}
include(position(base.replace("3R4","3B4")));
for (const line of [["e8e5","e4h4","g6d3"],["e8e5","e4h4","g6d3","e1e5"],["e8e5","e4h4","g6d3","h4d8","h8h7","e1e5"]]) {
  const board=position(base); for (const uci of line) play(board,uci);
}
for (const [file,id] of [["secondary-theme-stockfish-18","lichess:R13Ct"],["cross-phase-stockfish-18","lichess:I5Waq"]]) {
  const row=JSON.parse(readFileSync(`benchmarks/tactical-relevance/${file}.json`,"utf8")).cases.find(row=>row.id===id);
  include(position(row.fen));
}
const searches=report.searches.map(row=>{
  assert(allowed.has(makeFen(position(row.fen).toSetup())),"Only public fixture boards may be published");
  for(const line of row.lines){const board=position(row.fen);for(const uci of line.pvUci){const move=parseUci(uci);assert(move&&board.isLegal(move));board.play(move)}}
  return {id:row.id,fen:row.fen,...(row.searchMove?{searchMove:row.searchMove}:{}),lines:row.lines};
});
writeFileSync(output,JSON.stringify({scope:"95 fresh depth-16 Stockfish 18 searches on allowlisted public controls and two real Lichess positions. Side-to-move full-position scores are not local material bounds or an accuracy rate. The losing queen-capture control is deliberately retained.",sourceSha256:createHash("sha256").update(bytes).digest("hex"),searches},null,2)+"\n",{flag:"wx"});
