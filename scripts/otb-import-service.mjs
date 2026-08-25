import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { constants as priorityConstants, setPriority } from "node:os";
import { join } from "node:path";
import { buildWebOtbPrepDatabase } from "./generated/otb-prep-database.js";

const CURRENT_YEAR = new Date().getFullYear();
const MAX_PLAYER_NAME_LENGTH = 120;
const MAX_ERROR_LENGTH = 12_000;

export class OtbImportService {
  constructor({ root, binaryPath, onLog = () => undefined, spawnProcess = spawn }) {
    this.root = root;
    this.binaryPath = binaryPath;
    this.onLog = onLog;
    this.spawnProcess = spawnProcess;
    this.jobs = new Map();
    this.processes = new Map();
    this.persistQueues = new Map();
    this.cacheRoot = join(root, "cache");
    this.outputRoot = join(root, "output");
    this.jobRoot = join(root, "jobs");
  }

  async initialize() {
    await Promise.all([
      mkdir(this.cacheRoot, { recursive: true }),
      mkdir(this.outputRoot, { recursive: true }),
      mkdir(this.jobRoot, { recursive: true }),
    ]);
    const files = await readdir(this.jobRoot).catch(() => []);
    await Promise.all(
      files
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            const job = JSON.parse(await readFile(join(this.jobRoot, name), "utf8"));
            if (!job?.id) return;
            if (job.status === "running" || job.status === "queued") {
              job.status = "failed";
              job.error = "The PC home server restarted during this import. Start it again.";
              job.updatedAt = new Date().toISOString();
              await this.persist(job);
            }
            this.jobs.set(job.id, job);
          } catch {
            // A damaged historical status file must not prevent new imports.
          }
        }),
    );
  }

  async isAvailable() {
    return Boolean(await stat(this.binaryPath).catch(() => null));
  }

  getJob(id) {
    const job = this.jobs.get(id) ?? null;
    if (job && this.ensurePrepDatabase(job)) this.persistInBackground(job);
    return job;
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
      games: [],
      prepDatabase: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    this.jobs.set(id, job);
    await this.persist(job);
    this.start(job);
    return job;
  }

  start(job) {
    const outputPath = join(this.outputRoot, `${job.id}.pgn`);
    const args = buildOtbImporterArgs(job, this.cacheRoot, outputPath);
    const child = this.spawnProcess(this.binaryPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.processes.set(job.id, child);
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    this.persistInBackground(job);

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
        if (code !== 0 || !report) {
          const detail = stderr.trim() || `collector exited with ${signal || `code ${code}`}`;
          return this.finishFailed(job, detail);
        }
        const pgn = await readFile(outputPath, "utf8");
        job.games = parseOtbPgnGames(pgn, job.id);
        job.report = report;
        job.progress = mergeOtbProgress(job.progress, {
          jobId: job.id,
          source: "Complete",
          phase: "complete",
          current: 1,
          total: 1,
          gamesFound: job.games.length,
          message: `${job.games.length} verified OTB games ready on the PC.`,
        });
        job.updatedAt = new Date().toISOString();
        job.completedAt = job.updatedAt;
        this.ensurePrepDatabase(job);
        job.status = "completed";
        await this.persist(job);
        this.onLog(`OTB import ${job.id} completed with ${job.games.length} games`);
      })().catch((error) => this.finishFailedInBackground(job, error?.stack || String(error)));
    });
  }

  async finishFailed(job, message) {
    if (job.status === "completed" || job.status === "failed") return;
    this.processes.delete(job.id);
    job.status = "failed";
    job.error = publicOtbImportError(message);
    job.updatedAt = new Date().toISOString();
    job.completedAt = job.updatedAt;
    await this.persist(job);
    this.onLog(`OTB import ${job.id} failed: ${job.error}`);
  }

  async persist(job) {
    const destination = join(this.jobRoot, `${job.id}.json`);
    const snapshot = JSON.stringify(job);
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
  if (request.sources.broadcastArchives) args.push("--lichess-broadcast-archives");
  if (request.sources.communityBroadcasts) args.push("--lichess-community-broadcasts");
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
  return { ...incoming, gamesFound: Math.max(current.gamesFound || 0, incoming.gamesFound || 0) };
}

export function parseOtbPgnGames(pgn, jobId = "otb") {
  return pgn
    .split(/\r?\n(?=\[Event\s)/g)
    .map((game) => game.trim())
    .filter(Boolean)
    .map((game, index) => {
      const headers = Object.fromEntries(
        Array.from(game.matchAll(/^\[([^\s]+)\s+"((?:\\.|[^"])*)"\]\s*$/gm), (match) => [
          match[1],
          match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
        ]),
      );
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
