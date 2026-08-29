import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { buildWebOtbPrepDatabase } from "./generated/otb-prep-database.js";
import {
  compactOtbImportJob,
  getOtbPrepDatabaseName,
  parseOtbPgnGames,
} from "./otb-import-service.mjs";
import { buildWebOtbPrepDatabaseParallel } from "./otb-prep-parallel.mjs";

const args = process.argv.slice(2);
const [jobArgument, pgnArgument] = args.filter((argument) => !argument.startsWith("--"));
if (!jobArgument || !pgnArgument) {
  throw new Error(
    "Usage: node scripts/benchmark-otb-prep-artifact.mjs <job.json> <output.pgn> [--parallel] [--workers=N]",
  );
}

const jobPath = resolve(jobArgument);
const pgnPath = resolve(pgnArgument);
const job = JSON.parse(await readFile(jobPath, "utf8"));
const pgn = await readFile(pgnPath, "utf8");
const timings = {};
const parallel = args.includes("--parallel");
const workersArgument = args.find((argument) => argument.startsWith("--workers="));
const workerCount = workersArgument ? Number.parseInt(workersArgument.split("=")[1], 10) : 4;
const baselineGameHash = hashJson(job.games);
const baselinePrepHash = hashJson(job.prepDatabase);
const baselinePrepDatabase = job.prepDatabase;

const games = measure(timings, "parseGamesMs", () => parseOtbPgnGames(pgn, job.id));
const pgnGames = measure(timings, "preparePgnGamesMs", () =>
  games.map((game) => String(game?.pgn || "").trim()).filter(Boolean),
);
const joinedPgn = parallel ? null : measure(timings, "joinGamesMs", () => pgnGames.join("\n\n"));
const importedAt = Date.parse(job.completedAt || job.createdAt || "");
const name = getOtbPrepDatabaseName({
  ...job.request,
  playerName: job.report?.playerName || job.request?.playerName,
});
const prepDatabase = parallel
  ? await measureAsync(timings, "buildPrepDatabaseMs", () =>
      buildWebOtbPrepDatabaseParallel({
        name,
        pgnGames,
        importedAt,
        workerCount,
      }),
    )
  : measure(timings, "buildPrepDatabaseMs", () =>
      buildWebOtbPrepDatabase({
        name,
        pgn: joinedPgn,
        importedAt,
      }),
    );
const artifact = { jobId: job.id, games, prepDatabase };
const benchmarkRoot = join(tmpdir(), `${job.id}-${process.pid}-benchmark`);
const finishingStatusJson = measure(timings, "serializeFinishingStatusMs", () =>
  JSON.stringify(
    compactOtbImportJob({
      ...job,
      status: "running",
      gameCount: games.length,
      artifactAvailable: false,
      artifactBytes: null,
      completedAt: null,
    }),
  ),
);
await measureAsync(timings, "writeFinishingStatusMs", () =>
  atomicWrite(`${benchmarkRoot}-finishing.json`, finishingStatusJson),
);
const artifactJson = measure(timings, "serializeArtifactMs", () => JSON.stringify(artifact));
const artifactPath = `${benchmarkRoot}-artifact.json`;
await measureAsync(timings, "writeArtifactMs", () => atomicWrite(artifactPath, artifactJson));
const artifactBytes = measure(timings, "artifactByteLengthMs", () =>
  Buffer.byteLength(artifactJson),
);
const completedStatusJson = measure(timings, "serializeCompletedStatusMs", () =>
  JSON.stringify(
    compactOtbImportJob({
      ...job,
      status: "completed",
      gameCount: games.length,
      artifactAvailable: true,
      artifactBytes,
    }),
  ),
);
await measureAsync(timings, "writeCompletedStatusMs", () =>
  atomicWrite(`${benchmarkRoot}-completed.json`, completedStatusJson),
);
await Promise.all([
  rm(`${benchmarkRoot}-finishing.json`, { force: true }),
  rm(artifactPath, { force: true }),
  rm(`${benchmarkRoot}-completed.json`, { force: true }),
]);

const gameHash = hashJson(games);
const prepHash = hashJson(prepDatabase);
const sourceReadyMs = Date.parse(job.completedAt) - Date.parse(job.createdAt);
const completionConstructionMs = Object.values(timings).reduce((sum, value) => sum + value, 0);
const result = {
  mode: parallel ? "parallel" : "sequential",
  workers: parallel ? workerCount : 1,
  jobPath,
  pgnPath,
  games: games.length,
  artifactBytes,
  statusBytes: Buffer.byteLength(completedStatusJson),
  ...timings,
  completionConstructionMs: Number(completionConstructionMs.toFixed(3)),
  sourceJobReadyMs: sourceReadyMs,
  projectedSourcePlusDurableArtifactMs: Number(
    (sourceReadyMs + completionConstructionMs).toFixed(3),
  ),
  gameHash,
  baselineGameHash,
  gamesMatch: gameHash === baselineGameHash,
  prepHash,
  baselinePrepHash,
  prepMatches: prepHash === baselinePrepHash,
  ...(prepHash === baselinePrepHash
    ? {}
    : { firstPrepDifference: findFirstPrepDifference(baselinePrepDatabase, prepDatabase) }),
};

console.log(JSON.stringify(result, null, 2));
if (!result.gamesMatch || !result.prepMatches) process.exitCode = 1;

function measure(record, name, operation) {
  const startedAt = performance.now();
  const value = operation();
  record[name] = Number((performance.now() - startedAt).toFixed(3));
  return value;
}

async function measureAsync(record, name, operation) {
  const startedAt = performance.now();
  const value = await operation();
  record[name] = Number((performance.now() - startedAt).toFixed(3));
  return value;
}

async function atomicWrite(destination, contents) {
  const temporaryPath = `${destination}.tmp`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, destination);
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function findFirstPrepDifference(expected, actual) {
  const databaseDifference = findFirstDifference(expected?.database, actual?.database, "database");
  if (databaseDifference) return databaseDifference;
  const warningDifference = findFirstDifference(expected?.warnings, actual?.warnings, "warnings");
  if (warningDifference) return warningDifference;
  if (expected?.games?.length !== actual?.games?.length) {
    return {
      path: "games.length",
      expected: expected?.games?.length,
      actual: actual?.games?.length,
    };
  }
  for (let index = 0; index < (expected?.games?.length ?? 0); index += 1) {
    if (JSON.stringify(expected.games[index]) === JSON.stringify(actual.games[index])) continue;
    return findFirstDifference(expected.games[index], actual.games[index], `games[${index}]`);
  }
  return { path: "unknown", expected: "same canonical fields", actual: "different JSON hash" };
}

function findFirstDifference(expected, actual, path) {
  if (Object.is(expected, actual)) return null;
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return { path, expected, actual };
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const difference = findFirstDifference(expected[key], actual[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}
