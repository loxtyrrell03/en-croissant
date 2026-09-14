import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const folder = process.argv[2];
const candidates = read("benchmarks/tactical-relevance/checking-pawn-development.json").cases;
const groups = ["", "-choices", "-sample", "-witness"].map((suffix) => {
  const inputName = suffix === "-sample" ? "-sample-engine-input" : `${suffix}-input`;
  const input = read(join(folder, `adapter99-checking-pawn${inputName}.json`));
  const output = read(join(folder, `adapter99-checking-pawn${suffix}-engine.json`));
  assert.equal(output.searches.length, input.probes.length);
  const searches = input.probes.map((probe) => {
    const row = output.searches.find((s) => s.id === probe.id);
    assert.ok(row);
    assert.equal(row.fen, probe.fen);
    assert.equal(row.searchMove, probe.searchMove);
    for (const line of row.lines) {
      const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
      if (row.searchMove) assert.equal(line.pvUci[0], row.searchMove);
      for (const uci of line.pvUci) {
        const move = parseUci(uci);
        assert.ok(move && pos.isLegal(move), `${row.id}: ${uci}`);
        pos.play(move);
      }
    }
    // Explicit public fields only: no private paths or unrelated course data.
    return {
      id: row.id,
      fen: row.fen,
      ...(row.searchMove ? { searchMove: row.searchMove } : {}),
      lines: row.lines,
    };
  });
  return { id: suffix.slice(1) || "move-order", searches };
});
const draft = read(join(folder, "adapter99-checking-pawn-sample-draft.json"));
const rejectedDraft = candidates.map((candidate) => {
  const row = draft.cases.find((c) => c.id === candidate.id);
  assert.ok(row && row.fen === candidate.fen && row.searchMove === candidate.searchMove);
  return { id: candidate.id, proof: row.proof, errors: row.errors };
});
const receipt = {
  scope:
    "105 fresh Stockfish 18 depth-16 searches on public real-game positions and selected local-proof witnesses. Scores are side-to-move centipawns, not proof bounds or an accuracy percentage. The rejected draft is NOT enabled in production; it contains a known losing witness.",
  groups,
  rejectedDraft,
};
assert.equal(
  groups.reduce((n, g) => n + g.searches.length, 0),
  105,
);
writeFileSync(process.argv[3], JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(
  "Exported 105 legally replayed public searches and the rejected draft's exact receipts.",
);
