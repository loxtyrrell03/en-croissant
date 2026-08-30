import { parentPort, workerData } from "node:worker_threads";
import { buildWebOtbPrepDatabase } from "./generated/otb-prep-database.js";

if (!parentPort) throw new Error("The OTB prep worker requires a parent thread.");

try {
  const result = buildWebOtbPrepDatabase({
    name: workerData.name,
    pgn: workerData.pgn,
    importedAt: workerData.importedAt,
  });
  parentPort.postMessage({
    ok: true,
    offset: workerData.offset,
    parsedGameCount: getParsedGameCount(result),
    result,
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
  });
}

function getParsedGameCount(result) {
  // The builder emits every parsed index either as a game or as a numbered
  // starting-position warning, so this retains skipped trailing games too.
  let count = 0;
  for (const game of result.games) count = Math.max(count, game.index || 0);
  for (const warning of result.warnings) {
    const match = warning.match(/^Game (\d+):/);
    if (match) count = Math.max(count, Number(match[1]));
  }
  return count;
}
