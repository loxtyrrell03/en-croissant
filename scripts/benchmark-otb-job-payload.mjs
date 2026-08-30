import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { compactOtbImportJob, extractOtbImportArtifact } from "./otb-import-service.mjs";

const args = process.argv.slice(2);
const jobPath = positionalArgument(args);
const pollCount = positiveIntegerArgument(args, "--polls", 20);
const job = jobPath
  ? JSON.parse(await readFile(resolve(jobPath), "utf8"))
  : buildSyntheticCompletedJob();
const artifact = extractOtbImportArtifact(job);
if (!artifact) {
  throw new Error("Benchmark input must be a completed inline OTB job with a games array.");
}

const artifactJson = JSON.stringify(artifact);
const status = compactOtbImportJob({
  ...job,
  artifactAvailable: true,
  artifactBytes: Buffer.byteLength(artifactJson),
});
const legacy = measureSerialization(job, pollCount);
const compact = measureSerialization(status, pollCount);
const oneTimeArtifact = measureSerialization(artifact, 1);
const legacyContentHash = contentHash({
  games: job.games,
  prepDatabase: job.prepDatabase ?? null,
});
const artifactContentHash = contentHash({
  games: artifact.games,
  prepDatabase: artifact.prepDatabase,
});
const legacyTransferBytes = legacy.bytes;
const compactTransferBytes = compact.bytes + oneTimeArtifact.bytes;
const reductionPercent =
  legacyTransferBytes > 0
    ? ((legacyTransferBytes - compactTransferBytes) / legacyTransferBytes) * 100
    : 0;

const result = {
  input: jobPath ? resolve(jobPath) : "synthetic-completed-job",
  polls: pollCount,
  games: artifact.games.length,
  statusBytes: compact.bytes / pollCount,
  artifactBytes: oneTimeArtifact.bytes,
  legacyTransferBytes,
  compactTransferBytes,
  transferReductionPercent: Number(reductionPercent.toFixed(3)),
  legacySerializationMs: Number(legacy.elapsedMs.toFixed(3)),
  compactStatusSerializationMs: Number(compact.elapsedMs.toFixed(3)),
  oneTimeArtifactSerializationMs: Number(oneTimeArtifact.elapsedMs.toFixed(3)),
  contentHashMatch: legacyContentHash === artifactContentHash,
  contentHash: artifactContentHash,
};

console.log(JSON.stringify(result, null, 2));
if (!result.contentHashMatch) process.exitCode = 1;

function measureSerialization(value, iterations) {
  const startedAt = performance.now();
  let bytes = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    bytes += Buffer.byteLength(JSON.stringify(value));
  }
  return { bytes, elapsedMs: performance.now() - startedAt };
}

function contentHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function positionalArgument(values) {
  return values.find((value, index) => index === 0 && !value.startsWith("--")) || null;
}

function positiveIntegerArgument(values, name, fallback) {
  const index = values.indexOf(name);
  const parsed = index >= 0 ? Number.parseInt(values[index + 1], 10) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new Error(`${name} must be an integer between 1 and 1000.`);
  }
  return parsed;
}

function buildSyntheticCompletedJob() {
  const repeatedPgn =
    '[Event "Open"]\n[White "Target"]\n[Black "Opponent"]\n\n1. e4 e5 1-0\n'.repeat(100);
  const games = Array.from({ length: 1_000 }, (_, index) => ({
    id: `otb-benchmark:${index + 1}`,
    pgn: repeatedPgn,
    event: "Open",
    white: "Target",
    black: "Opponent",
    result: "1-0",
  }));
  return {
    id: "otb-benchmark",
    status: "completed",
    request: { playerName: "Target", fideId: null, fromYear: 1900, sources: {} },
    progress: null,
    report: { playerName: "Target", gamesFound: games.length, duplicatesRemoved: 0 },
    games,
    prepDatabase: {
      database: { id: "otb-benchmark-db", name: "Target OTB prep" },
      games: games.map((game) => ({
        id: game.id,
        moves: [{ san: "e4" }, { san: "e5" }],
      })),
    },
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:05.000Z",
    completedAt: "2026-08-29T00:00:05.000Z",
    error: null,
  };
}
