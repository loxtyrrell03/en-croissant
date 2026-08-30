import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { constants as priorityConstants, setPriority } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebOtbPrepDatabase } from "./generated/otb-prep-database.js";
import { buildWebOtbPrepDatabaseParallel } from "./otb-prep-parallel.mjs";

const CURRENT_YEAR = new Date().getFullYear();
const MAX_PLAYER_NAME_LENGTH = 120;
const MAX_ERROR_LENGTH = 12_000;

export class OtbImportService {
  constructor({
    root,
    binaryPath,
    onLog = () => undefined,
    spawnProcess = spawn,
    terminateProcessTree = terminateCollectorProcessTree,
  }) {
    this.root = root;
    this.binaryPath = binaryPath;
    this.onLog = onLog;
    this.spawnProcess = spawnProcess;
    this.terminateProcessTree = terminateProcessTree;
    this.jobs = new Map();
    this.processes = new Map();
    this.persistQueues = new Map();
    this.cacheRoot = join(root, "cache");
    this.outputRoot = join(root, "output");
    this.jobRoot = join(root, "jobs");
    this.artifactRoot = join(root, "artifacts");
  }

  async initialize() {
    await Promise.all([
      mkdir(this.cacheRoot, { recursive: true }),
      mkdir(this.outputRoot, { recursive: true }),
      mkdir(this.jobRoot, { recursive: true }),
      mkdir(this.artifactRoot, { recursive: true }),
    ]);
    const files = await readdir(this.jobRoot).catch(() => []);
    // Load sequentially so upgrading historical 100+ MB inline jobs cannot multiply
    // peak startup memory. Completed legacy jobs are migrated losslessly to one
    // immutable artifact plus a compact status record.
    for (const name of files.filter((candidate) => candidate.endsWith(".json"))) {
      try {
        const persisted = JSON.parse(await readFile(join(this.jobRoot, name), "utf8"));
        if (!persisted?.id) continue;

        if (
          persisted.status === "completed" &&
          Array.isArray(persisted.games) &&
          !persisted.prepDatabase
        ) {
          this.ensurePrepDatabase(persisted);
        }
        const legacyArtifact =
          persisted.status === "completed" ? extractOtbImportArtifact(persisted) : null;
        const staleCollectorProcess = normalizeCollectorProcess(
          persisted.collectorProcess,
          persisted.id,
        );
        let job = compactOtbImportJob(persisted);
        let artifactStat = await stat(this.getArtifactPath(job.id)).catch(() => null);
        if (legacyArtifact && !artifactStat) {
          const artifactBytes = await this.persistArtifact(job.id, legacyArtifact);
          artifactStat = { size: artifactBytes };
        }

        if (job.status === "running" || job.status === "queued") {
          if (staleCollectorProcess) {
            try {
              const stopped = await this.terminateProcessTree({
                ...staleCollectorProcess,
                binaryPath: this.binaryPath,
              });
              this.onLog(
                stopped === false
                  ? `Ignored reused stale OTB PID ${staleCollectorProcess.pid} for ${job.id}`
                  : `Stopped stale OTB collector ${staleCollectorProcess.pid} for ${job.id}`,
              );
            } catch (error) {
              const cleanupError = new Error(
                `Could not stop stale OTB collector ${staleCollectorProcess.pid} for ${job.id}.`,
                { cause: error },
              );
              cleanupError.code = "OTB_STALE_CLEANUP_FAILED";
              throw cleanupError;
            }
          }
          if (artifactStat && Number.isInteger(job.gameCount)) {
            job.status = "completed";
            job.error = null;
            job.completedAt = new Date().toISOString();
          } else {
            job.status = "failed";
            job.error = "The PC home server restarted during this import. Start it again.";
            job.completedAt = new Date().toISOString();
          }
          job.updatedAt = job.completedAt;
        }

        if (job.status === "completed") {
          if (artifactStat) {
            job.artifactAvailable = true;
            job.artifactBytes = artifactStat.size;
          } else {
            job.status = "failed";
            job.error = "The completed OTB result artifact is missing. Start the import again.";
            job.updatedAt = new Date().toISOString();
            job.completedAt = job.updatedAt;
            job.artifactAvailable = false;
            job.artifactBytes = null;
          }
        }

        this.jobs.set(job.id, job);
        await this.persist(job);
      } catch (error) {
        if (error?.code === "OTB_STALE_CLEANUP_FAILED") throw error;
        // A damaged historical status file must not prevent new imports.
      }
    }
  }

  async isAvailable() {
    return Boolean(await stat(this.binaryPath).catch(() => null));
  }

  getJob(id) {
    const job = this.jobs.get(id) ?? null;
    return job ? compactOtbImportJob(job) : null;
  }

  async getJobArtifact(id) {
    const job = this.jobs.get(id) ?? null;
    if (!job || job.status !== "completed" || !job.artifactAvailable) return null;
    const path = this.getArtifactPath(id);
    const artifactStat = await stat(path).catch(() => null);
    return artifactStat ? { path, size: artifactStat.size } : null;
  }

  async cancelJob(id) {
    const job = this.jobs.get(id) ?? null;
    if (!job) return null;
    if (job.status !== "queued" && job.status !== "running") return this.getJob(id);

    const child = this.processes.get(id);
    job.cancellationRequested = true;
    try {
      if (child) {
        await this.terminateProcessTree({
          child,
          pid: Number.isInteger(child.pid) ? child.pid : job.collectorProcess?.pid,
          jobId: job.id,
          binaryPath: this.binaryPath,
        });
      } else if (job.collectorProcess) {
        await this.terminateProcessTree({
          ...job.collectorProcess,
          binaryPath: this.binaryPath,
        });
      }
    } catch (error) {
      job.cancellationRequested = false;
      throw error;
    }
    this.processes.delete(id);
    job.collectorProcess = null;
    await this.finishFailed(job, "Search stopped.");
    return this.getJob(id);
  }

  async createJob(input) {
    if (!(await this.isAvailable())) {
      throw new Error("The PC OTB importer is not installed yet.");
    }
    const request = normalizeOtbImportPayload(input);
    const id = `otb-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const job = {
      id,
      status: "queued",
      request,
      progress: null,
      report: null,
      gameCount: 0,
      artifactAvailable: false,
      artifactBytes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    this.jobs.set(id, job);
    await this.persist(job);
    await this.start(job);
    return this.getJob(id);
  }

  async start(job) {
    const outputPath = join(this.outputRoot, `${job.id}.pgn`);
    const args = buildOtbImporterArgs(job, this.cacheRoot, outputPath);
    const child = this.spawnProcess(this.binaryPath, args, {
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.processes.set(job.id, child);
    job.collectorProcess = Number.isInteger(child.pid)
      ? {
          pid: child.pid,
          jobId: job.id,
          startedAt: new Date().toISOString(),
        }
      : null;
    job.status = "running";
    job.updatedAt = new Date().toISOString();

    try {
      if (child.pid) {
        setPriority(child.pid, priorityConstants.priority.PRIORITY_BELOW_NORMAL);
      }
    } catch {
      // Priority is a best-effort guard; import correctness does not depend on it.
    }

    let report = null;
    let stderr = "";
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      const event = parseOtbCollectorLine(line);
      if (!event) return;
      if (event.type === "progress") {
        job.progress = mergeOtbProgress(job.progress, event.value);
        job.updatedAt = new Date().toISOString();
        this.persistInBackground(job);
      } else {
        report = event.value;
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_ERROR_LENGTH);
    });
    child.on("error", (error) => this.finishFailedInBackground(job, error.message));
    child.on("exit", (code, signal) => {
      void (async () => {
        this.processes.delete(job.id);
        job.collectorProcess = null;
        if (code !== 0 || !report) {
          const detail = stderr.trim() || `collector exited with ${signal || `code ${code}`}`;
          return this.finishFailed(job, detail);
        }
        await this.finishCompleted(job, report, outputPath);
      })().catch((error) => this.finishFailedInBackground(job, error?.stack || String(error)));
    });
    // The job-bound PID must be durable before createJob returns so a server
    // restart can identify and stop the exact collector tree it launched.
    await this.persist(job);
  }

  async finishCompleted(job, report, outputPath) {
    if (job.status === "completed" || job.status === "failed" || job.cancellationRequested) return;
    if (report?.cancelled !== true && report?.coverageComplete !== true) {
      job.report = report;
      await this.finishFailed(job, incompleteOtbCoverageError(report));
      return;
    }
    const pgn = await readFile(outputPath, "utf8");
    if (job.status === "failed" || job.cancellationRequested) return;
    const games = parseOtbPgnGames(pgn, job.id);
    const preparedAt = new Date().toISOString();
    const importedAtCandidate = Date.parse(preparedAt);
    const importedAt = Number.isFinite(importedAtCandidate) ? importedAtCandidate : Date.now();
    const pgnGames = games.map((game) => String(game?.pgn || "").trim()).filter(Boolean);
    const prepDatabase = pgnGames.length
      ? await buildWebOtbPrepDatabaseParallel({
          name: getOtbPrepDatabaseName({
            ...job.request,
            playerName: report?.playerName || job.request?.playerName,
          }),
          pgnGames,
          importedAt,
          onFallback: (message) =>
            this.onLog(`Parallel OTB prep construction fell back to one thread: ${message}`),
        })
      : null;
    // Worker construction yields to cancellation; never publish an artifact
    // after the user has stopped the import in that interval.
    if (job.status === "failed") return;
    const artifact = { jobId: job.id, games, prepDatabase };

    job.report = report;
    job.gameCount = games.length;
    job.progress = mergeOtbProgress(job.progress, {
      jobId: job.id,
      source: "Complete",
      phase: "complete",
      current: 1,
      total: 1,
      gamesFound: games.length,
      message: `${games.length} verified OTB games ready on the PC.`,
    });
    job.updatedAt = preparedAt;
    // Persist the compact finishing state before the artifact. If the service
    // stops between these writes, initialize() can recognize the durable
    // artifact and finish the status instead of discarding the result.
    await this.persist(job);
    const artifactBytes = await this.persistArtifact(job.id, artifact);
    if (job.status === "failed") return;

    job.artifactAvailable = true;
    job.artifactBytes = artifactBytes;
    job.status = "completed";
    job.updatedAt = new Date().toISOString();
    // completedAt deliberately begins only after the complete game/prep artifact
    // has been atomically persisted.
    job.completedAt = job.updatedAt;
    await this.persist(job);
    this.onLog(`OTB import ${job.id} completed with ${games.length} games`);
  }

  async finishFailed(job, message) {
    if (job.status === "completed" || job.status === "failed") return;
    this.processes.delete(job.id);
    job.collectorProcess = null;
    job.status = "failed";
    job.error = publicOtbImportError(job.cancellationRequested ? "Search stopped." : message);
    job.cancellationRequested = false;
    job.updatedAt = new Date().toISOString();
    job.completedAt = job.updatedAt;
    await this.persist(job);
    this.onLog(`OTB import ${job.id} failed: ${job.error}`);
  }

  async persist(job) {
    const destination = join(this.jobRoot, `${job.id}.json`);
    const snapshot = JSON.stringify(persistedOtbImportJob(job));
    const previous = this.persistQueues.get(job.id) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(async () => {
        const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, snapshot);
        await rename(temporary, destination);
      });
    this.persistQueues.set(job.id, pending);
    try {
      await pending;
    } finally {
      if (this.persistQueues.get(job.id) === pending) this.persistQueues.delete(job.id);
    }
  }

  async persistArtifact(jobId, artifact) {
    const destination = this.getArtifactPath(jobId);
    const snapshot = JSON.stringify(artifact);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, snapshot);
    await rename(temporary, destination);
    return Buffer.byteLength(snapshot);
  }

  getArtifactPath(jobId) {
    return join(this.artifactRoot, `${jobId}.json`);
  }

  persistInBackground(job) {
    void this.persist(job).catch((error) => {
      this.onLog(`Could not save OTB import ${job.id}: ${error?.stack || String(error)}`);
    });
  }

  finishFailedInBackground(job, message) {
    void this.finishFailed(job, message).catch((error) => {
      this.onLog(`Could not finish OTB import ${job.id}: ${error?.stack || String(error)}`);
    });
  }

  ensurePrepDatabase(job) {
    if (
      job.prepDatabase ||
      (job.status !== "completed" && !job.completedAt) ||
      !Array.isArray(job.games)
    )
      return false;
    const pgn = job.games
      .map((game) => String(game?.pgn || "").trim())
      .filter(Boolean)
      .join("\n\n");
    if (!pgn) return false;

    const importedAtCandidate = Date.parse(job.completedAt || job.createdAt || "");
    const importedAt = Number.isFinite(importedAtCandidate) ? importedAtCandidate : Date.now();
    job.prepDatabase = buildWebOtbPrepDatabase({
      name: getOtbPrepDatabaseName({
        ...job.request,
        playerName: job.report?.playerName || job.request?.playerName,
      }),
      pgn,
      importedAt,
    });
    return true;
  }
}

export function compactOtbImportJob(job) {
  const status = { ...(job || {}) };
  const games = status.games;
  delete status.games;
  delete status.prepDatabase;
  delete status.collectorProcess;
  delete status.cancellationRequested;
  const gameCount = Number.isInteger(status.gameCount)
    ? status.gameCount
    : Array.isArray(games)
      ? games.length
      : Number.isInteger(status.report?.gamesFound)
        ? status.report.gamesFound
        : 0;
  return {
    ...status,
    gameCount,
    artifactAvailable: status.artifactAvailable === true,
    artifactBytes: Number.isFinite(status.artifactBytes) ? status.artifactBytes : null,
  };
}

export function persistedOtbImportJob(job) {
  const status = compactOtbImportJob(job);
  const collectorProcess = normalizeCollectorProcess(job?.collectorProcess, job?.id);
  return collectorProcess ? { ...status, collectorProcess } : status;
}

export async function terminateCollectorProcessTree({
  child = null,
  pid,
  jobId,
  binaryPath,
  platform = process.platform,
  runFile = runExecutable,
  killProcess = process.kill,
}) {
  const targetPid = Number(pid);
  if (!Number.isInteger(targetPid) || targetPid <= 0) {
    if (child && !child.killed) child.kill("SIGKILL");
    return;
  }

  if (platform === "win32") {
    const terminatorPath = fileURLToPath(
      new URL("./terminate-collector-process-tree.ps1", import.meta.url),
    );
    try {
      await runFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          terminatorPath,
          "-TargetProcessId",
          String(targetPid),
          "-ExpectedExecutable",
          String(binaryPath || ""),
          "-ExpectedJobId",
          String(jobId || ""),
        ],
        { windowsHide: true, timeout: 15_000 },
      );
      return true;
    } catch (error) {
      if (!child && (Number(error?.code) === 20 || Number(error?.code) === 21)) return false;
      throw error;
    }
  }

  try {
    killProcess(-targetPid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  return true;
}

function normalizeCollectorProcess(value, expectedJobId) {
  const pid = Number(value?.pid);
  const jobId = String(value?.jobId || "");
  if (!Number.isInteger(pid) || pid <= 0 || !jobId || jobId !== expectedJobId) return null;
  return {
    pid,
    jobId,
    startedAt: typeof value?.startedAt === "string" ? value.startedAt : null,
  };
}

function runExecutable(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export function extractOtbImportArtifact(job) {
  if (!job?.id || !Array.isArray(job.games)) return null;
  return {
    jobId: job.id,
    games: job.games,
    prepDatabase: job.prepDatabase ?? null,
  };
}

export function normalizeOtbImportPayload(input) {
  const playerName = String(input?.playerName || "")
    .trim()
    .replace(/\s+/g, " ");
  const fideId = String(input?.fideId || "").replace(/\D/g, "");
  const fromYear = Number(input?.fromYear);
  if (playerName.length < 3 || playerName.length > MAX_PLAYER_NAME_LENGTH) {
    throw new Error("Enter the player's full name.");
  }
  if (fideId && (fideId.length < 5 || fideId.length > 12)) {
    throw new Error("Enter a valid FIDE ID.");
  }
  if (!Number.isInteger(fromYear) || fromYear < 1900 || fromYear > CURRENT_YEAR) {
    throw new Error(`Choose a start year between 1900 and ${CURRENT_YEAR}.`);
  }

  const sources = {
    lichessBroadcasts: input?.sources?.lichessBroadcasts !== false,
    broadcastArchives: input?.sources?.broadcastArchives !== false,
    communityBroadcasts: input?.sources?.communityBroadcasts !== false,
    chessResults: input?.sources?.chessResults !== false,
    chessbaseNews: input?.sources?.chessbaseNews !== false,
    officialPgnIndexes: input?.sources?.officialPgnIndexes !== false,
    twic: input?.sources?.twic !== false,
  };
  if (!Object.values(sources).some(Boolean)) throw new Error("Select at least one OTB source.");
  return { playerName, fideId: fideId || null, fromYear, sources };
}

export function buildOtbImporterArgs(job, cacheRoot, outputPath) {
  const request = job.request;
  const args = [
    "--job-id",
    job.id,
    "--player",
    request.playerName,
    "--from-year",
    String(request.fromYear),
    "--cache-dir",
    cacheRoot,
    "--output",
    outputPath,
  ];
  if (request.fideId) args.push("--fide-id", request.fideId);
  if (!request.sources.lichessBroadcasts) args.push("--no-lichess-broadcasts");
  args.push(
    request.sources.broadcastArchives
      ? "--lichess-broadcast-archives"
      : "--no-lichess-broadcast-archives",
  );
  args.push(
    request.sources.communityBroadcasts
      ? "--lichess-community-broadcasts"
      : "--no-lichess-community-broadcasts",
  );
  if (!request.sources.chessResults) args.push("--no-chess-results");
  if (!request.sources.chessbaseNews) args.push("--no-chessbase-news");
  if (!request.sources.officialPgnIndexes) args.push("--no-official-pgn-indexes");
  if (!request.sources.twic) args.push("--no-twic");
  return args;
}

export function parseOtbCollectorLine(line) {
  const separator = line.indexOf("\t");
  if (separator < 0) return null;
  const kind = line.slice(0, separator);
  if (kind !== "PROGRESS" && kind !== "RESULT") return null;
  try {
    return {
      type: kind === "PROGRESS" ? "progress" : "result",
      value: JSON.parse(line.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

export function mergeOtbProgress(current, incoming) {
  if (!current || current.jobId !== incoming.jobId) return incoming;
  const overallTotal = Math.max(current.overallTotal || 0, incoming.overallTotal || 0);
  const overallCurrent = Math.min(
    overallTotal,
    Math.max(current.overallCurrent || 0, incoming.overallCurrent || 0),
  );
  return {
    ...incoming,
    gamesFound: Math.max(current.gamesFound || 0, incoming.gamesFound || 0),
    ...(overallTotal ? { overallCurrent, overallTotal } : {}),
  };
}

export function parseOtbPgnGames(pgn, jobId = "otb") {
  return splitOtbPgnGameBlocks(pgn)
    .map((game) => game.trim())
    .filter(Boolean)
    .map((game, index) => {
      const headers = parseOtbPgnHeaders(game);
      return {
        id: `${jobId}:${index + 1}`,
        pgn: game,
        event: headers.Event || "?",
        site: headers.Site || "",
        date: headers.Date || headers.UTCDate || "",
        white: headers.White || "?",
        black: headers.Black || "?",
        result: headers.Result || "*",
        whiteElo: numericHeader(headers.WhiteElo),
        blackElo: numericHeader(headers.BlackElo),
      };
    });
}

function splitOtbPgnGameBlocks(pgn) {
  const games = [];
  let gameStart = 0;
  let lineStart = 0;
  let braceDepth = 0;
  let hasGameContent = false;
  let inMovetext = false;

  while (lineStart < pgn.length) {
    const newline = pgn.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? pgn.length : newline;
    const nextLineStart = newline < 0 ? pgn.length : newline + 1;
    const line = pgn.slice(lineStart, lineEnd);
    const trimmed = line.trimStart();
    const atTopLevel = braceDepth === 0;
    const isHeader = atTopLevel && looksLikePgnHeaderLine(trimmed);
    const isEventCandidate = atTopLevel && /^\[Event(?=\s)/.test(trimmed);

    if (hasGameContent && inMovetext && (isHeader || isEventCandidate)) {
      games.push(pgn.slice(gameStart, lineStart));
      gameStart = lineStart;
      braceDepth = 0;
      hasGameContent = false;
      inMovetext = false;
    }

    if (trimmed.trim()) {
      hasGameContent = true;
      if (!isHeader) inMovetext = true;
    }
    braceDepth = updatePgnBraceDepth(line, braceDepth);
    lineStart = nextLineStart;
  }

  if (hasGameContent) games.push(pgn.slice(gameStart));
  return games;
}

function parseOtbPgnHeaders(game) {
  const headers = {};
  for (const line of game.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^\[([^\s]+)\s+"((?:\\.|[^"])*)"\]\s*$/);
    if (!match) break;
    headers[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return headers;
}

function looksLikePgnHeaderLine(line) {
  if (!line.startsWith("[")) return false;
  let index = 1;
  while (index < line.length && /[A-Za-z0-9_]/.test(line[index])) index += 1;
  return index > 1 && line.indexOf('"', index) >= 0;
}

function updatePgnBraceDepth(line, depth) {
  let nextDepth = depth;
  for (const character of line) {
    if (nextDepth === 0 && character === ";") break;
    if (character === "{") nextDepth += 1;
    if (character === "}" && nextDepth > 0) nextDepth -= 1;
  }
  return nextDepth;
}

export function getOtbPrepDatabaseName(request) {
  const player = String(request?.playerName || "OTB player").trim() || "OTB player";
  const fromYear = Number.isInteger(request?.fromYear) ? request.fromYear : CURRENT_YEAR;
  const range = fromYear < CURRENT_YEAR ? `${fromYear}-${CURRENT_YEAR}` : String(CURRENT_YEAR);
  return `${player} OTB games ${range}.pgn`;
}

function numericHeader(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function publicOtbImportError(message) {
  const text = String(message || "The PC OTB import failed.").trim();
  if (/player.*full name|fide id|start year|source/i.test(text)) return text.slice(0, 500);
  return `The PC OTB import failed. ${text.slice(0, 500)}`;
}

function incompleteOtbCoverageError(report) {
  const coverageGaps = Array.isArray(report?.coverageGaps)
    ? report.coverageGaps
        .filter((gap) => typeof gap === "string" && gap.trim())
        .map((gap) => gap.trim())
        .slice(0, 12)
    : [];
  return coverageGaps.length
    ? `Not every selected OTB source completed. Coverage gaps: ${coverageGaps.join(" | ")}`
    : "Not every selected OTB source completed. The collector did not prove complete coverage.";
}
