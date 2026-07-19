import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const localAppData =
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || scriptDir, "AppData", "Local");
const installRoot = resolve(
  process.env.STOCKFISH_REMOTE_ROOT || join(localAppData, "Stockfish18Server"),
);
const configPath = resolve(
  process.env.STOCKFISH_REMOTE_CONFIG || join(installRoot, "config.json"),
);
const logPath = join(installRoot, "stockfish-remote-server.log");
const config = readJson(configPath);
const enginePath = resolve(
  process.env.STOCKFISH_REMOTE_ENGINE ||
    config.enginePath ||
    join(
      installRoot,
      "stockfish-bmi2",
      "stockfish",
      "stockfish-windows-x86-64-bmi2.exe",
    ),
);
const threads = positiveInteger(process.env.STOCKFISH_REMOTE_THREADS || config.threads, 16, 1, 1024);
const hashMb = positiveInteger(process.env.STOCKFISH_REMOTE_HASH_MB || config.hashMb, 2048, 1);
const httpHost = String(config.httpHost || "127.0.0.1");
const httpPort = positiveInteger(process.env.STOCKFISH_REMOTE_HTTP_PORT || config.httpPort, 38419, 1, 65535);
const uciHost = String(config.uciHost || "127.0.0.1");
const uciPort = positiveInteger(process.env.STOCKFISH_REMOTE_UCI_PORT || config.uciPort, 38418, 1, 65535);
const maxDepth = positiveInteger(config.maxDepth, 40, 1, 100);
const maxMultiPv = positiveInteger(config.maxMultiPv, 8, 1, 256);
const allowedOrigins = new Set(
  (Array.isArray(config.allowedOrigins) ? config.allowedOrigins : [])
    .map((value) => String(value).replace(/\/$/, ""))
    .filter(Boolean),
);

if (!existsSync(enginePath)) {
  throw new Error(`Stockfish executable not found: ${enginePath}`);
}

let httpEngine = null;
const startedAt = new Date().toISOString();

const httpServer = createHttpServer((request, response) => {
  void handleHttpRequest(request, response).catch((error) => {
    log(`HTTP request failed: ${error?.stack || error}`);
    if (!response.headersSent) {
      writeJson(response, 500, { error: publicError(error) });
    } else if (!response.writableEnded) {
      response.end(`${JSON.stringify({ type: "error", message: publicError(error) })}\n`);
    }
  });
});

const uciServer = createTcpServer((socket) => {
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30_000);
  const peer = `${socket.remoteAddress || "unknown"}:${socket.remotePort || 0}`;
  log(`UCI client connected: ${peer}`);

  const child = spawn(enginePath, [], {
    cwd: dirname(enginePath),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = createInterface({ input: child.stdout });
  child.stdin.write(`setoption name Threads value ${threads}\n`);
  child.stdin.write(`setoption name Hash value ${hashMb}\n`);
  child.stdin.write("setoption name UCI_ShowWDL value true\n");

  output.on("line", (line) => {
    if (socket.destroyed) return;
    socket.write(`${rewriteUciDefault(line)}\n`);
  });
  child.stderr.on("data", (chunk) => log(`Stockfish UCI stderr: ${String(chunk).trim()}`));
  socket.pipe(child.stdin);
  socket.on("error", (error) => log(`UCI client error (${peer}): ${error.message}`));
  child.on("error", (error) => {
    log(`Stockfish UCI process error (${peer}): ${error.message}`);
    socket.destroy(error);
  });
  child.on("exit", () => {
    output.close();
    if (!socket.destroyed) socket.end();
  });
  socket.on("close", () => {
    output.close();
    if (!child.killed) {
      child.stdin.write("quit\n", () => child.kill());
      setTimeout(() => child.kill(), 500).unref();
    }
    log(`UCI client disconnected: ${peer}`);
  });
});

httpServer.listen(httpPort, httpHost, () => {
  log(`HTTP analysis listening on http://${httpHost}:${httpPort}`);
});
uciServer.listen(uciPort, uciHost, () => {
  log(`UCI proxy listening on tcp://${uciHost}:${uciPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    httpEngine?.close();
    httpServer.close();
    uciServer.close();
  });
}

async function handleHttpRequest(request, response) {
  setCorsHeaders(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    return response.end();
  }

  const requestUrl = new URL(request.url || "/", `http://${httpHost}:${httpPort}`);
  if (request.method === "GET" && requestUrl.pathname === "/v1/health") {
    return writeJson(response, 200, {
      ok: true,
      service: "stockfish-18-remote",
      version: 18,
      build: "x86-64-bmi2",
      enginePath,
      threads,
      hashMb,
      http: { host: httpHost, port: httpPort },
      uci: { host: uciHost, port: uciPort },
      startedAt,
      processId: process.pid,
      engineReady: httpEngine.ready,
      queuedAnalyses: httpEngine.queued,
    });
  }

  if (request.method !== "POST" || requestUrl.pathname !== "/v1/analyze") {
    return writeJson(response, 404, { error: "Not found." });
  }

  const body = await readJsonBody(request, 32 * 1024);
  const fen = normalizeFen(body?.fen);
  const multipv = positiveInteger(body?.multipv, 3, 1, maxMultiPv);
  const depth = positiveInteger(body?.depth, 14, 1, maxDepth);
  if (!fen) return writeJson(response, 400, { error: "A valid FEN is required." });

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
  response.write(
    `${JSON.stringify({ type: "meta", engine: "Stockfish 18", build: "bmi2", threads, hashMb })}\n`,
  );

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", () => {
    if (!response.writableEnded) abort();
  });

  try {
    const bestmove = await httpEngine.analyze(
      { fen, multipv, depth },
      (line) => {
        if (!response.destroyed) response.write(`${JSON.stringify({ type: "uci", line })}\n`);
      },
      controller.signal,
    );
    if (!response.destroyed) {
      response.end(`${JSON.stringify({ type: "done", bestmove })}\n`);
    }
  } catch (error) {
    if (!response.destroyed) {
      response.end(`${JSON.stringify({ type: "error", message: publicError(error) })}\n`);
    }
  }
}

class PersistentStockfish {
  constructor(path, options) {
    this.path = path;
    this.options = options;
    this.child = null;
    this.reader = null;
    this.waiters = [];
    this.activeJob = null;
    this.startPromise = null;
    this.queueTail = Promise.resolve();
    this.ready = false;
    this.queued = 0;
  }

  async analyze(params, onInfo, signal) {
    this.queued += 1;
    let release;
    const previous = this.queueTail;
    this.queueTail = new Promise((resolvePromise) => {
      release = resolvePromise;
    });

    await previous;
    try {
      if (signal?.aborted) throw abortError();
      await this.start();
      await this.sendAndWaitReady(`setoption name MultiPV value ${params.multipv}`);
      if (signal?.aborted) throw abortError();
      this.send(`position fen ${params.fen}`);
      return await this.runSearch(`go depth ${params.depth}`, onInfo, signal);
    } finally {
      this.queued -= 1;
      release();
    }
  }

  async start() {
    this.startPromise ||= this.startProcess();
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  async startProcess() {
    const child = spawn(this.path, [], {
      cwd: dirname(this.path),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => log(`Stockfish HTTP stderr: ${String(chunk).trim()}`));
    child.on("error", (error) => this.handleExit(error));
    child.on("exit", (code) => this.handleExit(new Error(`Stockfish exited with code ${code}.`)));

    this.send("uci");
    await this.waitFor((line) => line === "uciok", 20_000, "uciok");
    this.send(`setoption name Threads value ${this.options.threads}`);
    this.send(`setoption name Hash value ${this.options.hashMb}`);
    this.send("setoption name UCI_ShowWDL value true");
    await this.sendAndWaitReady();
    this.ready = true;
    log(`Persistent Stockfish ready (${this.options.threads} threads, ${this.options.hashMb} MiB hash)`);
  }

  sendAndWaitReady(command) {
    if (command) this.send(command);
    this.send("isready");
    return this.waitFor((line) => line === "readyok", 30_000, "readyok");
  }

  runSearch(command, onInfo, signal) {
    if (this.activeJob) throw new Error("Stockfish already has an active search.");
    return new Promise((resolvePromise, rejectPromise) => {
      const timeoutId = setTimeout(() => {
        if (!this.activeJob) return;
        this.activeJob.abortReason = new Error("Stockfish analysis timed out.");
        this.send("stop");
      }, 180_000);
      timeoutId.unref();

      const onAbort = () => {
        if (!this.activeJob) return;
        this.activeJob.abortReason = abortError();
        this.send("stop");
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.activeJob = {
        onInfo,
        resolve: resolvePromise,
        reject: rejectPromise,
        abortReason: null,
        cleanup: () => {
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);
        },
      };
      this.send(command);
    });
  }

  waitFor(predicate, timeoutMs, label) {
    return new Promise((resolvePromise, rejectPromise) => {
      const waiter = { predicate, resolve: resolvePromise, reject: rejectPromise, timeoutId: null };
      waiter.timeoutId = setTimeout(() => {
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        rejectPromise(new Error(`Timed out waiting for Stockfish ${label}.`));
      }, timeoutMs);
      waiter.timeoutId.unref();
      this.waiters.push(waiter);
    });
  }

  handleLine(line) {
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(line)) continue;
      clearTimeout(waiter.timeoutId);
      this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
      waiter.resolve(line);
    }

    const job = this.activeJob;
    if (!job) return;
    if (line.startsWith("info ") && !job.abortReason) job.onInfo(line);
    if (!line.startsWith("bestmove")) return;
    this.activeJob = null;
    job.cleanup();
    if (job.abortReason) job.reject(job.abortReason);
    else job.resolve(line.split(/\s+/)[1] || "(none)");
  }

  handleExit(error) {
    this.ready = false;
    this.startPromise = null;
    this.child = null;
    this.reader?.close();
    this.reader = null;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(error);
    }
    if (this.activeJob) {
      const job = this.activeJob;
      this.activeJob = null;
      job.cleanup();
      job.reject(error);
    }
  }

  send(command) {
    if (!this.child?.stdin?.writable) throw new Error("Stockfish is not running.");
    this.child.stdin.write(`${command}\n`);
  }

  close() {
    if (!this.child) return;
    this.child.stdin.write("quit\n");
    this.child.kill();
  }
}

httpEngine = new PersistentStockfish(enginePath, { threads, hashMb });

function rewriteUciDefault(line) {
  if (line.startsWith("option name Threads type spin default ")) {
    return line.replace(/default \d+/, `default ${threads}`);
  }
  if (line.startsWith("option name Hash type spin default ")) {
    return line.replace(/default \d+/, `default ${hashMb}`);
  }
  return line;
}

function setCorsHeaders(request, response) {
  const origin = String(request.headers.origin || "").replace(/\/$/, "");
  if (!origin || allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin || "*");
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}

async function readJsonBody(request, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function writeJson(response, status, body) {
  const text = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

function normalizeFen(value) {
  const fen = String(value || "").trim();
  const fields = fen.split(/\s+/);
  if (fields.length < 4 || fields.length > 6 || fen.length > 160) return "";
  if (!/^[prnbqkPRNBQK1-8/]+$/.test(fields[0]) || !/^[wb]$/.test(fields[1])) return "";
  return fen;
}

function positiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function abortError() {
  const error = new Error("Stockfish analysis was cancelled.");
  error.name = "AbortError";
  return error;
}

function publicError(error) {
  return error instanceof Error ? error.message : "Stockfish request failed.";
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(logPath, line, "utf8");
  } catch {
    // Keep serving even when diagnostics cannot be written.
  }
}
