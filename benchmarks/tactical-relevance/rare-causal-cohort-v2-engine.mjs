// Opt-in, bounded corroboration only. Never a truth-label or automatic sampler.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { BackgroundEngine } from "../../scripts/generated/shared-review-service.js";

const output = process.env.RARE_CAUSAL_COHORT_V2_ENGINE_REPORT;
if (!output) throw Error("Set a fresh task-owned report path to opt into 20 small searches");
const path = "benchmarks/tactical-relevance/rare-causal-cohort-v2-inputs.json";
const bytes = readFileSync(path);
const inputs = JSON.parse(bytes);
const queries = inputs.puzzles.map((r) => ({ id: r.id, scope: "root", fen: r.startFen }));
for (const row of inputs.contexts) {
  queries.push({ id: row.id, scope: "root", fen: row.fen });
  const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  const move = parseUci(row.playedMoveUci);
  if (!move || !pos.isLegal(move)) throw Error(`Illegal frozen context ${row.id}`);
  pos.play(move);
  queries.push({ id: row.id, scope: "after-actual-move", fen: makeFen(pos.toSetup()) });
}
if (queries.length !== 20) throw Error("Frozen query count changed");
const enginePath = "C:/Users/Lox/AppData/Local/Programs/Stockfish/stockfish.exe";
const observations = [];
for (const query of queries) {
  // New low-priority one-thread instance keeps queries independent and exits per query.
  const engine = new BackgroundEngine(enginePath);
  const started = performance.now();
  try {
    observations.push({
      ...query,
      result: await engine.analyze(query.fen, 3),
      elapsedMs: performance.now() - started,
    });
  } catch (error) {
    observations.push({ ...query, error: String(error), elapsedMs: performance.now() - started });
  } finally {
    engine.close();
  }
  console.log(`${observations.length}/20 ${query.id} ${query.scope}`);
}
writeFileSync(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      scope:
        "Bounded depth-16 engine corroboration, not independent chess proof or source-label truth",
      limits: {
        threads: 1,
        hashMiB: 64,
        multiPv: 3,
        depth: 16,
        timeoutMsPerQuery: 30000,
        queries: 20,
      },
      enginePath,
      engineSha256: createHash("sha256").update(readFileSync(enginePath)).digest("hex"),
      inputsSha256: createHash("sha256").update(bytes).digest("hex"),
      observations,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
