import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { constants as osConstants, setPriority } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createLocalLichessEvalStore } from "./lichess-local-eval-reader.mjs";
import { LC0_PROFILE_OPTIONS, selectLc0Network } from "./lc0-network-routing.mjs";
import {
  ENGINE_PERFORMANCE_PRESETS,
  enginePerformanceSettings,
  normalizeEnginePerformancePreset,
} from "./engine-performance-presets.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const localAppData =
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || scriptDir, "AppData", "Local");
const roamingAppData =
  process.env.APPDATA || join(process.env.USERPROFILE || scriptDir, "AppData", "Roaming");
const installRoot = resolve(
  process.env.STOCKFISH_REMOTE_ROOT || join(localAppData, "Stockfish18Server"),
);
const configPath = resolve(process.env.STOCKFISH_REMOTE_CONFIG || join(installRoot, "config.json"));
const logPath = join(installRoot, "stockfish-remote-server.log");
const config = readJson(configPath);
const enginePath = resolve(
  process.env.STOCKFISH_REMOTE_ENGINE ||
    config.enginePath ||
    join(installRoot, "stockfish-bmi2", "stockfish", "stockfish-windows-x86-64-bmi2.exe"),
);
const threads = positiveInteger(
  process.env.STOCKFISH_REMOTE_THREADS || config.threads,
  16,
  1,
  1024,
);
const hashMb = positiveInteger(process.env.STOCKFISH_REMOTE_HASH_MB || config.hashMb, 2048, 1);
const httpHost = String(config.httpHost || "127.0.0.1");
const httpPort = positiveInteger(
  process.env.STOCKFISH_REMOTE_HTTP_PORT || config.httpPort,
  38419,
  1,
  65535,
);
const uciHost = String(config.uciHost || "127.0.0.1");
const uciPort = positiveInteger(
  process.env.STOCKFISH_REMOTE_UCI_PORT || config.uciPort,
  38418,
  1,
  65535,
);
const maxDepth = positiveInteger(config.maxDepth, 999, 1, 999);
const maxMultiPv = positiveInteger(config.maxMultiPv, 8, 1, 256);
const engineIdleMs = positiveInteger(
  process.env.STOCKFISH_REMOTE_ENGINE_IDLE_MS || config.engineIdleMs,
  30_000,
  1_000,
  10 * 60_000,
);
const backendIdleMs = positiveInteger(
  process.env.STOCKFISH_REMOTE_BACKEND_IDLE_MS || config.backendIdleMs,
  30_000,
  1_000,
  10 * 60_000,
);
const localEvalPath = resolve(
  process.env.STOCKFISH_REMOTE_LOCAL_EVAL_PATH ||
    config.localEvalPath ||
    join(roamingAppData, "org.encroissant.app", "lichess-cloud-evals"),
);
const localEvalStore = createLocalLichessEvalStore(localEvalPath);
const lc0Root = join(localAppData, "ChessTrainer", "engines", "lc0-v0.32.1-fresh");
const lc0Path = resolve(
  process.env.EN_CROISSANT_LC0_ENGINE || config.lc0Path || join(lc0Root, "lc0.exe"),
);
const lc0ScPath = resolve(
  process.env.EN_CROISSANT_LC0_SC_ENGINE ||
    config.lc0SearchContemptPath ||
    join(lc0Root, "lc0_sc_cuda.exe"),
);
const lc0NetworkPaths = Object.freeze({
  bt4: resolve(
    process.env.EN_CROISSANT_LC0_BT4_WEIGHTS ||
      config.lc0Networks?.bt4 ||
      join(lc0Root, "BT4-it332.pb.gz"),
  ),
  t1: resolve(
    process.env.EN_CROISSANT_LC0_T1_WEIGHTS ||
      config.lc0Networks?.t1 ||
      join(lc0Root, "T1-odds.pb.gz"),
  ),
  lqo: resolve(
    process.env.EN_CROISSANT_LC0_LQO_WEIGHTS ||
      config.lc0Networks?.lqo ||
      join(lc0Root, "queen-odds", "lqo_v2.pb.gz"),
  ),
});
const lc0Tuning = Object.freeze({
  threads: positiveInteger(config.lc0Threads, 1, 0, 128),
  minibatchSize: positiveInteger(config.lc0MinibatchSize, 8, 0, 1024),
  nnCacheSize: positiveInteger(config.lc0NnCacheSize, 50_000, 0, 50_000_000),
  backend: String(config.lc0Backend || "cuda-fp16"),
});
const lc0EnginePaths = Object.freeze({ bt4: lc0Path, t1: lc0Path, lqo: lc0ScPath });
const lc0EngineArguments = Object.freeze({ bt4: [], t1: [], lqo: ["--show-hidden"] });
const lc0FamilyAvailable = Object.freeze(
  Object.fromEntries(
    Object.keys(lc0NetworkPaths).map((family) => [
      family,
      existsSync(lc0EnginePaths[family]) && existsSync(lc0NetworkPaths[family]),
    ]),
  ),
);
const lc0Available = lc0FamilyAvailable.bt4;
const allowedOrigins = new Set(
  (Array.isArray(config.allowedOrigins) ? config.allowedOrigins : [])
    .map((value) => String(value).replace(/\/$/, ""))
    .filter(Boolean),
);

if (!existsSync(enginePath)) {
  throw new Error(`Stockfish executable not found: ${enginePath}`);
}

let httpEngine = null;
let selectorEngine = null;
const lc0Engines = new Map();
const unavailableLc0Families = new Set();
const lc0SessionSelections = new Map();
let lc0ShutdownPending = false;
let stockfishShutdownPending = false;
let activeHttpRequests = 0;
let activeUciClients = 0;
let backendIdleTimer = null;
const startedAt = new Date().toISOString();

const httpServer = createHttpServer((request, response) => {
  beginBackendUse("http");
  let requestFinished = false;
  const finishRequest = () => {
    if (requestFinished) return;
    requestFinished = true;
    endBackendUse("http");
  };
  response.once("finish", finishRequest);
  response.once("close", finishRequest);
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
  beginBackendUse("uci");
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30_000);
  const peer = `${socket.remoteAddress || "unknown"}:${socket.remotePort || 0}`;
  log(`UCI client connected: ${peer}`);

  const child = spawn(enginePath, [], {
    cwd: dirname(enginePath),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  setEngineResponsivePriority(child, "UCI", "Stockfish");
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
    endBackendUse("uci");
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
    clearBackendIdleShutdown();
    httpEngine?.close();
    selectorEngine?.close();
    for (const engine of lc0Engines.values()) engine.close();
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
      engineIdleMs,
      backendIdleMs,
      performancePresets: ENGINE_PERFORMANCE_PRESETS,
      http: { host: httpHost, port: httpPort },
      uci: { host: uciHost, port: uciPort },
      startedAt,
      processId: process.pid,
      engineReady: httpEngine.ready,
      queuedAnalyses: httpEngine.queued,
      engines: {
        stockfish: {
          available: true,
          ready: httpEngine.ready,
          queuedAnalyses: httpEngine.queued,
          name: "Stockfish 18",
        },
        lc0: {
          available: lc0Available,
          shutdownPending: lc0ShutdownPending,
          ready:
            lc0Available &&
            lc0Engines.get("bt4")?.ready === true &&
            !unavailableLc0Families.has("bt4"),
          name: "LCZero 0.32.1",
          enginePath: lc0Path,
          searchContemptEnginePath: lc0ScPath,
          tuning: lc0Tuning,
          profiles: LC0_PROFILE_OPTIONS,
          networks: Object.fromEntries(
            Object.entries(lc0NetworkPaths).map(([family, path]) => [
              family,
              {
                path,
                enginePath: lc0EnginePaths[family],
                available: lc0FamilyAvailable[family] && !unavailableLc0Families.has(family),
                ready: lc0Engines.get(family)?.ready === true,
                queuedAnalyses: lc0Engines.get(family)?.queued || 0,
              },
            ]),
          ),
        },
      },
      localEvals: localEvalStore.status,
    });
  }

  if (request.method === "GET" && requestUrl.pathname === "/v1/cloud-eval") {
    const fen = normalizeFen(requestUrl.searchParams.get("fen"));
    const multipv = positiveInteger(requestUrl.searchParams.get("multipv"), 3, 1, maxMultiPv);
    if (!fen) return writeJson(response, 400, { error: "A valid FEN is required." });

    const status = localEvalStore.status;
    if (!status.available) {
      // An unbuilt or broken store is a service problem, not a missing position: 404 is
      // reserved for positions the store really does not contain so clients can tell a
      // genuine miss from a machine that cannot answer at all.
      return writeJson(response, 503, {
        error: status.error || "The stored Lichess cloud-eval database is unavailable.",
      });
    }
    const evaluation = await localEvalStore.lookup(fen, multipv);
    if (!evaluation) {
      return writeJson(response, 404, { error: "No stored cloud evaluation was found." });
    }
    return writeJson(response, 200, evaluation);
  }

  if (request.method === "POST" && requestUrl.pathname === "/v1/lc0/release") {
    const body = await readJsonBody(request, 4 * 1024);
    const sessionId = normalizeSessionId(body?.lc0SessionId, request.socket.remoteAddress);
    lc0SessionSelections.delete(sessionId);
    lc0ShutdownPending = true;
    const shutdown = shutdownIdleLc0Engines();
    return writeJson(response, 200, {
      ok: true,
      sessionId,
      ...shutdown,
    });
  }

  if (request.method === "POST" && requestUrl.pathname === "/v1/engine/release") {
    const body = await readJsonBody(request, 4 * 1024);
    const engineKind = String(body?.engineKind || "stockfish").toLowerCase();
    if (!new Set(["stockfish", "lc0"]).has(engineKind)) {
      return writeJson(response, 400, { error: "engineKind must be stockfish or lc0." });
    }
    if (engineKind === "lc0") {
      const sessionId = normalizeSessionId(body?.lc0SessionId, request.socket.remoteAddress);
      lc0SessionSelections.delete(sessionId);
      lc0ShutdownPending = true;
      return writeJson(response, 200, { ok: true, engineKind, sessionId, ...shutdownIdleLc0Engines() });
    }
    stockfishShutdownPending = true;
    return writeJson(response, 200, { ok: true, engineKind, ...shutdownIdleStockfishEngine() });
  }

  if (request.method !== "POST" || requestUrl.pathname !== "/v1/analyze") {
    return writeJson(response, 404, { error: "Not found." });
  }

  const body = await readJsonBody(request, 32 * 1024);
  const fen = normalizeFen(body?.fen);
  const multipv = positiveInteger(body?.multipv, 3, 1, maxMultiPv);
  const depth = positiveInteger(body?.depth, 70, 1, maxDepth);
  const infinite = body?.infinite === true;
  const engineKind = String(body?.engineKind || body?.engine || "stockfish").toLowerCase();
  const hasPerformancePreset = body?.performancePreset != null;
  const performancePreset = normalizeEnginePerformancePreset(body?.performancePreset);
  if (!fen) return writeJson(response, 400, { error: "A valid FEN is required." });
  if (!new Set(["stockfish", "lc0"]).has(engineKind)) {
    return writeJson(response, 400, { error: "engineKind must be stockfish or lc0." });
  }
  if (hasPerformancePreset && !performancePreset) {
    return writeJson(response, 400, {
      error: "performancePreset must be max, good, balanced, or eco.",
    });
  }

  const performanceSettings = performancePreset
    ? enginePerformanceSettings(engineKind, performancePreset)
    : engineKind === "lc0"
      ? {
          threads: lc0Tuning.threads,
          minibatchSize: lc0Tuning.minibatchSize,
          nnCacheSize: lc0Tuning.nnCacheSize,
        }
      : { threads, hashMb };

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.aborted || response.destroyed) abort();
  else {
    request.once("aborted", abort);
    response.once("close", () => {
      if (!response.writableEnded) abort();
    });
  }

  let selectedEngine = httpEngine;
  let selection = null;
  let dynamicOptions =
    engineKind === "lc0"
      ? {
          Threads: performanceSettings.threads,
          MinibatchSize: performanceSettings.minibatchSize,
          NNCacheSize: performanceSettings.nnCacheSize,
        }
      : { Threads: performanceSettings.threads, Hash: performanceSettings.hashMb };
  if (engineKind === "lc0") {
    if (!lc0Available) {
      return writeJson(response, 503, {
        error: "LCZero or one of its configured network files is unavailable on the gaming PC.",
      });
    }
    // A fresh LC0 request means at least one client still wants GPU analysis.
    // Cancel a pending idle shutdown before selecting/starting its lazy worker.
    lc0ShutdownPending = false;
    const autoNetwork = body?.lc0AutoNetwork === true;
    const sessionId = normalizeSessionId(body?.lc0SessionId, request.socket.remoteAddress);
    const previousSelection = lc0SessionSelections.get(sessionId);
    const preliminarySelection = selectLc0Network({
      fen,
      autoNetwork,
      manualMode: body?.lc0Network,
      previousSelection,
    });
    let objectiveScoreCp;
    if (autoNetwork && preliminarySelection.playerColor) {
      objectiveScoreCp = await evaluateObjectiveScore(
        fen,
        preliminarySelection.playerColor,
        controller.signal,
      );
    }
    selection = selectLc0Network({
      fen,
      autoNetwork,
      manualMode: body?.lc0Network,
      objectiveScoreCp,
      previousSelection,
    });

    if (
      selection.family !== "bt4" &&
      (!lc0Engines.has(selection.family) || unavailableLc0Families.has(selection.family))
    ) {
      if (!autoNetwork) {
        return writeJson(response, 503, {
          error: `LCZero ${selection.family} network is unavailable.`,
        });
      }
      selection = {
        mode: "none",
        family: "bt4",
        label: "Standard strength",
        playerColor: null,
        reason: "specialist_unavailable_cached",
        objectiveScoreCp,
      };
    }
    if (autoNetwork) lc0SessionSelections.set(sessionId, selection);
    selectedEngine = lc0Engines.get(selection.family);
    if (!selectedEngine || unavailableLc0Families.has(selection.family)) {
      return writeJson(response, 503, {
        error: `LCZero ${selection.family} network is unavailable.`,
      });
    }
    if (selection.family === "lqo") {
      const playsBlack = selection.playerColor === "black";
      dynamicOptions = {
        ...dynamicOptions,
        SwapColors: playsBlack,
        ScLimit: playsBlack ? 32 : 40,
        CPuct: 1.5,
        FpuValue: 0.4,
        DrawScore: playsBlack ? 0.6 : -0.4,
      };
    }
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
  response.flushHeaders?.();
  response.write(
    `${JSON.stringify({
      type: "meta",
      engine: engineKind === "lc0" ? "LCZero 0.32.1" : "Stockfish 18",
      engineKind,
      build: engineKind === "lc0" ? lc0Tuning.backend : "bmi2",
      performancePreset: performancePreset || "server",
      performanceLabel: performancePreset
        ? ENGINE_PERFORMANCE_PRESETS[performancePreset].label
        : "Server default",
      threads: performanceSettings.threads,
      hashMb: engineKind === "stockfish" ? performanceSettings.hashMb : undefined,
      minibatchSize: engineKind === "lc0" ? performanceSettings.minibatchSize : undefined,
      nnCacheSize: engineKind === "lc0" ? performanceSettings.nnCacheSize : undefined,
      networkMode: selection?.mode,
      networkFamily: selection?.family,
      networkName: selection?.label,
      networkReason: selection?.reason,
      networkObjectiveScoreCp: selection?.objectiveScoreCp,
      weights: selection ? basename(lc0NetworkPaths[selection.family]) : undefined,
    })}\n`,
  );

  try {
    const bestmove = await selectedEngine.analyze(
      { fen, multipv, depth, infinite },
      (line) => {
        if (!response.destroyed) response.write(`${JSON.stringify({ type: "uci", line })}\n`);
      },
      controller.signal,
      dynamicOptions,
    );
    if (!response.destroyed) {
      response.end(`${JSON.stringify({ type: "done", bestmove })}\n`);
    }
  } catch (error) {
    if (engineKind === "lc0" && selection?.family && selection.family !== "bt4") {
      unavailableLc0Families.add(selection.family);
      log(
        `LCZero ${selection.family} quarantined after analysis failure: ${error?.message || error}`,
      );
    }
    if (!response.destroyed) {
      response.end(`${JSON.stringify({ type: "error", message: publicError(error) })}\n`);
    }
  } finally {
    if (engineKind === "lc0" && lc0ShutdownPending) shutdownIdleLc0Engines();
    if (engineKind === "stockfish" && stockfishShutdownPending) shutdownIdleStockfishEngine();
  }
}

async function evaluateObjectiveScore(fen, playerColor, signal) {
  let sideToMoveScoreCp;
  try {
    await selectorEngine.analyze(
      { fen, multipv: 1, depth: 10, infinite: false },
      (line) => {
        if (/\bmultipv\s+(?!1\b)\d+/.test(line)) return;
        const match = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
        if (!match) return;
        sideToMoveScoreCp =
          match[1] === "mate" ? Math.sign(Number(match[2]) || 1) * 100_000 : Number(match[2]);
      },
      signal,
    );
  } catch (error) {
    log(`LCZero objective selector failed; retaining topology state: ${error?.message || error}`);
    return undefined;
  }
  if (!Number.isFinite(sideToMoveScoreCp)) return undefined;
  const sideToMove = fen.split(/\s+/)[1] === "b" ? "black" : "white";
  return sideToMove === playerColor ? sideToMoveScoreCp : -sideToMoveScoreCp;
}

function normalizeSessionId(value, fallback) {
  const normalized = String(value || fallback || "default")
    .trim()
    .slice(0, 128);
  return normalized || "default";
}

class PersistentUciEngine {
  constructor(
    path,
    {
      label,
      args = [],
      initialOptions = {},
      priorityRole = "HTTP",
      requiredOptions = [],
      idleCloseMs = engineIdleMs,
    },
  ) {
    this.path = path;
    this.args = args;
    this.label = label;
    this.initialOptions = initialOptions;
    this.priorityRole = priorityRole;
    this.child = null;
    this.reader = null;
    this.waiters = [];
    this.activeJob = null;
    this.startPromise = null;
    this.queueTail = Promise.resolve();
    this.ready = false;
    this.queued = 0;
    this.supportedOptions = new Set();
    this.optionValues = new Map();
    this.requiredOptions = requiredOptions;
    this.idleCloseMs = idleCloseMs;
    this.idleCloseTimer = null;
  }

  async analyze(params, onInfo, signal, dynamicOptions = {}) {
    this.clearIdleClose();
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
      this.setOptionIfChanged("MultiPV", params.multipv);
      for (const [name, value] of Object.entries(dynamicOptions)) {
        this.setOptionIfChanged(name, value);
      }
      await this.sendAndWaitReady();
      if (signal?.aborted) throw abortError();
      this.send(`position fen ${params.fen}`);
      return await this.runSearch(
        params.infinite ? "go infinite" : `go depth ${params.depth}`,
        onInfo,
        signal,
      );
    } finally {
      this.queued -= 1;
      release();
      this.scheduleIdleClose();
    }
  }

  async start() {
    if (!this.child || this.child.killed) this.startPromise = null;
    this.startPromise ||= this.startProcess();
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  async startProcess() {
    const child = spawn(this.path, this.args, {
      cwd: dirname(this.path),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    setEngineResponsivePriority(child, this.priorityRole, this.label);
    this.child = child;
    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => log(`${this.label} stderr: ${String(chunk).trim()}`));
    child.on("error", (error) => this.handleExit(error, child));
    child.on("exit", (code) =>
      this.handleExit(new Error(`${this.label} exited with code ${code}.`), child),
    );

    this.send("uci");
    await this.waitFor((line) => line === "uciok", 20_000, "uciok");
    const missingOptions = this.requiredOptions.filter(
      (option) => !this.supportedOptions.has(option),
    );
    if (missingOptions.length > 0) {
      throw new Error(
        `${this.label} is missing required UCI options: ${missingOptions.join(", ")}`,
      );
    }
    for (const [name, value] of Object.entries(this.initialOptions)) {
      this.setOptionIfChanged(name, value);
    }
    await this.sendAndWaitReady();
    this.ready = true;
    log(`Persistent ${this.label} ready`);
  }

  sendAndWaitReady(command) {
    if (command) this.send(command);
    this.send("isready");
    return this.waitFor((line) => line === "readyok", 30_000, "readyok");
  }

  runSearch(command, onInfo, signal) {
    if (this.activeJob) throw new Error(`${this.label} already has an active search.`);
    return new Promise((resolvePromise, rejectPromise) => {
      const timeoutId = setTimeout(() => {
        if (!this.activeJob) return;
        this.activeJob.abortReason = new Error(`${this.label} analysis timed out.`);
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
        rejectPromise(new Error(`Timed out waiting for ${this.label} ${label}.`));
      }, timeoutMs);
      waiter.timeoutId.unref();
      this.waiters.push(waiter);
    });
  }

  handleLine(line) {
    const optionMatch = line.match(/^option name (.+?) type /);
    if (optionMatch) this.supportedOptions.add(optionMatch[1]);
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

  handleExit(error, child) {
    if (child && this.child !== child) return;
    this.clearIdleClose();
    this.ready = false;
    this.startPromise = null;
    this.child = null;
    this.optionValues.clear();
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
    if (!this.child?.stdin?.writable) throw new Error(`${this.label} is not running.`);
    this.child.stdin.write(`${command}\n`);
  }

  setOptionIfChanged(name, value) {
    const formatted = formatUciOptionValue(value);
    if (this.optionValues.get(name) === formatted) return;
    this.send(`setoption name ${name} value ${formatted}`);
    this.optionValues.set(name, formatted);
  }

  clearIdleClose() {
    if (!this.idleCloseTimer) return;
    clearTimeout(this.idleCloseTimer);
    this.idleCloseTimer = null;
  }

  scheduleIdleClose() {
    this.clearIdleClose();
    if (!this.child || this.activeJob || this.queued > 0) return;
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      if (!this.child || this.activeJob || this.queued > 0) return;
      log(`${this.label} released after ${this.idleCloseMs} ms idle.`);
      this.close();
    }, this.idleCloseMs);
    this.idleCloseTimer.unref();
  }

  close() {
    this.clearIdleClose();
    if (!this.child) return;
    if (this.child.stdin.writable) this.child.stdin.write("quit\n");
    this.child.kill();
  }
}

httpEngine = new PersistentUciEngine(enginePath, {
  label: "Stockfish 18",
  initialOptions: {
    Threads: threads,
    Hash: hashMb,
    UCI_ShowWDL: true,
  },
});
selectorEngine = new PersistentUciEngine(enginePath, {
  label: "Stockfish 18 LC0 selector",
  priorityRole: "LC0 selector",
  initialOptions: {
    Threads: 2,
    Hash: 128,
    UCI_ShowWDL: false,
  },
});
log(`Chess engines configured for lazy start and ${engineIdleMs} ms idle shutdown.`);

if (lc0Available) {
  for (const [family, weightsPath] of Object.entries(lc0NetworkPaths)) {
    if (!lc0FamilyAvailable[family]) {
      unavailableLc0Families.add(family);
      continue;
    }
    const engine = new PersistentUciEngine(lc0EnginePaths[family], {
      label: `LCZero ${family.toUpperCase()}`,
      args: lc0EngineArguments[family],
      priorityRole: `HTTP ${family.toUpperCase()}`,
      requiredOptions: family === "lqo" ? ["SwapColors", "ScLimit"] : [],
      initialOptions: {
        WeightsFile: weightsPath,
        Backend: lc0Tuning.backend,
        Threads: lc0Tuning.threads,
        MinibatchSize: lc0Tuning.minibatchSize,
        NNCacheSize: lc0Tuning.nnCacheSize,
        UCI_ShowWDL: true,
        Contempt: 0,
        ContemptMode: "play",
      },
    });
    lc0Engines.set(family, engine);
  }
  // Keep CUDA/VRAM idle until a client actually asks for LC0 analysis. The
  // selected PersistentUciEngine starts lazily from the request path.
  log("LCZero networks configured for lazy start.");
} else {
  log(
    `LCZero BT4 is unavailable (engines=${JSON.stringify(lc0EnginePaths)}; networks=${JSON.stringify(lc0NetworkPaths)})`,
  );
}

scheduleBackendIdleShutdown();

function shutdownIdleLc0Engines() {
  let busy = 0;
  let stopped = 0;
  for (const [family, engine] of lc0Engines.entries()) {
    if (engine.activeJob || engine.queued > 0) {
      busy += 1;
      continue;
    }
    if (!engine.child) continue;
    engine.close();
    stopped += 1;
    log(`LCZero ${family} released after the client disabled analysis.`);
  }
  lc0ShutdownPending = busy > 0;
  return { pending: lc0ShutdownPending, busy, stopped };
}

function shutdownIdleStockfishEngine() {
  const busy = httpEngine?.activeJob || (httpEngine?.queued ?? 0) > 0 ? 1 : 0;
  if (busy > 0) {
    stockfishShutdownPending = true;
    return { pending: true, busy, stopped: 0 };
  }
  const stopped = httpEngine?.child ? 1 : 0;
  if (stopped) {
    httpEngine.close();
    log("Stockfish 18 released after the client disabled analysis.");
  }
  stockfishShutdownPending = false;
  return { pending: false, busy: 0, stopped };
}

function beginBackendUse(kind) {
  clearBackendIdleShutdown();
  if (kind === "uci") activeUciClients += 1;
  else activeHttpRequests += 1;
}

function endBackendUse(kind) {
  if (kind === "uci") activeUciClients = Math.max(0, activeUciClients - 1);
  else activeHttpRequests = Math.max(0, activeHttpRequests - 1);
  scheduleBackendIdleShutdown();
}

function clearBackendIdleShutdown() {
  if (!backendIdleTimer) return;
  clearTimeout(backendIdleTimer);
  backendIdleTimer = null;
}

function scheduleBackendIdleShutdown() {
  clearBackendIdleShutdown();
  if (activeHttpRequests > 0 || activeUciClients > 0) return;
  backendIdleTimer = setTimeout(() => {
    backendIdleTimer = null;
    if (activeHttpRequests > 0 || activeUciClients > 0) return;
    log(`Analysis backend exiting after ${backendIdleMs} ms without a client.`);
    httpEngine?.close();
    selectorEngine?.close();
    for (const engine of lc0Engines.values()) engine.close();
    httpServer.close();
    uciServer.close();
    setTimeout(() => process.exit(0), 500);
  }, backendIdleMs);
  backendIdleTimer.unref();
}

function formatUciOptionValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
}

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
  const error = new Error("Engine analysis was cancelled.");
  error.name = "AbortError";
  return error;
}

function setEngineResponsivePriority(child, role, engineLabel) {
  try {
    setPriority(child.pid, osConstants.priority.PRIORITY_ABOVE_NORMAL);
  } catch (error) {
    log(`Could not set ${role} ${engineLabel} responsive priority: ${error?.message || error}`);
  }
}

function publicError(error) {
  return error instanceof Error ? error.message : "Engine request failed.";
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
