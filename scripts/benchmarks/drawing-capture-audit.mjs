import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { drawingCaptureCases } from "../../src/utils/tests/fixtures/drawingCapture.ts";

const args = process.argv.slice(2),
  output = args[args.indexOf("--report") + 1];
assert(
  args.includes("--online") && args.includes("--report") && output && !output.startsWith("--"),
);
assert(!existsSync(output), "Preserve earlier receipts");
const cases = [];
for (const row of drawingCaptureCases) {
  const before = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  const move = parseUci(row.move);
  assert(move && before.isLegal(move));
  const after = before.clone();
  after.play(move);
  const response = await fetch(
    `https://tablebase.lichess.org/standard?fen=${encodeURIComponent(row.fen)}`,
    { signal: AbortSignal.timeout(15000) },
  );
  assert(response.ok, `${row.id}: HTTP ${response.status}`);
  const result = await response.json();
  cases.push({ ...row, afterFen: makeFen(after.toSetup()), result });
  writeFileSync(
    output,
    JSON.stringify(
      {
        scope:
          "Constructed defensive/endgame controls; exact provider outcomes, not classifier labels. This is not an accuracy sample.",
        cases,
      },
      null,
      2,
    ),
    { flag: cases.length === 1 ? "wx" : "w" },
  );
  console.log(row.id, result.category, result.moves.map((m) => `${m.san}:${m.category}`).join(" "));
  await delay(250);
}
