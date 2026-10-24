// Fixed ten-query public corroboration, never a proof or gold label.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { position, play } from "./ltbye-intermediate-audit.mjs";
import { BackgroundEngine } from "../../scripts/generated/shared-review-service.js";
const output = process.env.QUIET_TRAP_ENGINE_REPORT;
if (!output) throw Error("An explicit fresh report path is required");
const input = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/quiet-trap-adversarial-selection.json", "utf8"),
).cases.find((row) => row.id === "lichess:9YfbQ");
const lines = [
  [],
  ["d8d2"],
  ["d1c1", "h1c1"],
  ["d1c1", "h1c1", "d8d1"],
  ["d8d2", "c1a1"],
  ["d8d2", "h6h7"],
  ["d8d2", "f4f7"],
  input.bestLine,
  ["d1c1", "f4c1"],
  ["d1c1", "f4c1", "d8d1"],
];
const enginePath = "C:/Users/Lox/AppData/Local/Programs/Stockfish/stockfish.exe";
const observations = [];
for (const line of lines) {
  let board = position(input.startFen);
  for (const move of line) board = play(board, move);
  const fen = makeFen(board.toSetup()),
    engine = new BackgroundEngine(enginePath);
  try {
    observations.push({ line, fen, result: await engine.analyze(fen, 3) });
  } catch (error) {
    observations.push({ line, fen, error: String(error) });
  } finally {
    engine.close();
  }
  console.log(`${observations.length}/10`);
}
writeFileSync(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      scope:
        "Ten fixed public depth16 corroborations; not proof, accuracy or source-label truth. ImmediateQxc1 Rxc1 is a cooperative contrast; the final two queries use the correct Qf4xc1 defence.",
      limits: { threads: 1, hashMiB: 64, depth: 16, multiPv: 3, timeoutMs: 30000 },
      engineSha256: createHash("sha256").update(readFileSync(enginePath)).digest("hex"),
      observations,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
