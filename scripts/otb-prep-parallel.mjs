import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { buildWebOtbPrepDatabase } from "./generated/otb-prep-database.js";

const MAX_PREP_WORKERS = 4;
const MIN_GAMES_PER_WORKER = 64;
const MAX_PLAYER_NAMES = 80;

export async function buildWebOtbPrepDatabaseParallel({
  name,
  pgnGames,
  importedAt,
  workerCount = defaultWorkerCount(),
  onFallback = () => undefined,
  workerFactory = createPrepWorker,
}) {
  const normalizedGames = pgnGames.map((pgn) => String(pgn || "").trim()).filter(Boolean);
  const fullPgn = normalizedGames.join("\n\n");
  const normalizedWorkerCount = Number.isFinite(workerCount) ? Math.floor(workerCount) : 1;
  const boundedWorkers = Math.min(
    MAX_PREP_WORKERS,
    Math.max(1, normalizedWorkerCount),
    Math.ceil(normalizedGames.length / MIN_GAMES_PER_WORKER),
  );
  if (boundedWorkers < 2) return buildWebOtbPrepDatabase({ name, pgn: fullPgn, importedAt });

  const chunks = partitionContiguousPgns(normalizedGames, boundedWorkers);
  const workers = [];
  try {
    for (const [index, chunk] of chunks.entries()) {
      workers.push(startPrepWorker({ name, importedAt, chunk, index, workerFactory }));
    }
    const results = await Promise.all(workers.map(({ result }) => result));
    return mergeWebOtbPrepDatabaseChunks({ name, fullPgn, importedAt, chunks: results });
  } catch (error) {
    await Promise.allSettled(workers.map(({ worker }) => worker.terminate()));
    workers.length = 0;
    try {
      onFallback(error instanceof Error ? error.message : String(error));
    } catch {
      // Observability must never prevent the lossless single-thread fallback.
    }
    return buildWebOtbPrepDatabase({ name, pgn: fullPgn, importedAt });
  }
}

export function mergeWebOtbPrepDatabaseChunks({ name, fullPgn, importedAt, chunks }) {
  const ordered = [...chunks].sort((left, right) => left.offset - right.offset);
  const firstDatabase = ordered[0]?.result?.database;
  if (!firstDatabase) return buildWebOtbPrepDatabase({ name, pgn: fullPgn, importedAt });

  const games = [];
  const warnings = [];
  let parsedGameOffset = 0;
  for (const chunk of ordered) {
    for (const game of chunk.result.games) {
      const index = parsedGameOffset + game.index;
      games.push({ ...game, id: `${firstDatabase.id}:${index}`, index });
    }
    for (const warning of chunk.result.warnings) {
      warnings.push(offsetWebPgnWarning(warning, parsedGameOffset));
    }
    parsedGameOffset += chunk.parsedGameCount;
  }

  let latestDate = null;
  const players = new Map();
  for (const game of games) {
    latestDate = pickLatestDate(latestDate, game.date);
    countPlayer(players, game.white);
    countPlayer(players, game.black);
  }
  const playerNames = Array.from(players.entries())
    .sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0], undefined, { sensitivity: "base" }),
    )
    .slice(0, MAX_PLAYER_NAMES)
    .map(([player]) => player);

  return {
    database: {
      ...firstDatabase,
      gameCount: games.length,
      sizeBytes: Buffer.byteLength(fullPgn),
      latestDate,
      playerNames,
    },
    games,
    warnings,
  };
}

function startPrepWorker({ name, importedAt, chunk, index, workerFactory }) {
  const worker = workerFactory(new URL("./otb-prep-worker.mjs", import.meta.url), {
    name: `otb-prep-${index + 1}`,
    workerData: {
      name,
      importedAt,
      offset: chunk.offset,
      pgn: chunk.games.join("\n\n"),
    },
  });
  const result = new Promise((resolve, reject) => {
    let settled = false;
    worker.once("message", (message) => {
      settled = true;
      if (message?.ok) resolve(message);
      else reject(new Error(message?.error || "The OTB prep worker failed."));
    });
    worker.once("error", (error) => {
      settled = true;
      reject(error);
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0)
        reject(new Error(`The OTB prep worker exited with code ${code}.`));
      else if (!settled) reject(new Error("The OTB prep worker exited without a result."));
    });
  });
  return { worker, result };
}

function createPrepWorker(url, options) {
  return new Worker(url, options);
}

function partitionContiguousPgns(pgnGames, workerCount) {
  const chunks = [];
  let offset = 0;
  let remainingCharacters = pgnGames.reduce((sum, pgn) => sum + pgn.length, 0);
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const workersRemaining = workerCount - workerIndex;
    const gamesRemaining = pgnGames.length - offset;
    const targetCharacters = remainingCharacters / workersRemaining;
    const maximumGames = gamesRemaining - (workersRemaining - 1);
    const games = [];
    let characters = 0;
    while (games.length < maximumGames) {
      const pgn = pgnGames[offset + games.length];
      games.push(pgn);
      characters += pgn.length;
      if (characters >= targetCharacters) break;
    }
    chunks.push({ offset, games });
    offset += games.length;
    remainingCharacters -= characters;
  }
  return chunks;
}

function offsetWebPgnWarning(warning, offset) {
  return warning.replace(/^Game (\d+):/, (_, game) => `Game ${Number(game) + offset}:`);
}

function countPlayer(players, name) {
  const normalized = name.trim();
  if (!normalized || normalized === "?") return;
  players.set(normalized, (players.get(normalized) ?? 0) + 1);
}

function pickLatestDate(current, candidate) {
  const candidateKey = sortableDate(candidate);
  if (!candidateKey) return current;
  const currentKey = sortableDate(current ?? "");
  return !currentKey || candidateKey > currentKey ? candidate : current;
}

function sortableDate(value) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? Number(digits.padEnd(8, "0")) : 0;
}

function defaultWorkerCount() {
  const configured = Number.parseInt(process.env.EN_CROISSANT_OTB_PREP_WORKERS || "", 10);
  if (Number.isInteger(configured) && configured > 0) return configured;
  return Math.min(MAX_PREP_WORKERS, availableParallelism());
}
