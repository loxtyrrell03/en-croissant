import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  watch,
  writeFile,
} from "node:fs/promises";
import { createServer, request as createHttpRequest } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  getHostedLibraryScope,
  HostedLibraryIndexCache,
  listHostedLibraryDirectory,
} from "./home-library-index.mjs";
import { OtbImportService } from "./otb-import-service.mjs";
import { FidePlayerSearchService } from "./fide-player-search.mjs";
import { compareStatsEntryQuality } from "./stats-entry-quality.mjs";
import { getOpeningIdentificationBook, publicDerivedEvidence } from "./chess-coach-derived.mjs";
import {
  buildCodexCoachInvocation,
  buildAgyCoachInvocation,
  buildAgyPromptSchema,
  buildCategorySpecialistPrompt,
  buildCoachPositionRecords,
  buildGeminiQualitativePassPrompt,
  buildLibraryPlannerPrompt,
  buildPcCoachAnalysisResult,
  buildStatsReportPrompt,
  buildStructuredPhoneCoachPrompt,
  codexExitIndicatesSignedOut,
  codexUsageLimitFromOutput,
  collectPcCoachPositionEvaluations,
  COACH_CATEGORY_DRAFT_SCHEMA,
  COACH_LIBRARY_PLAN_SCHEMA,
  COACH_MODEL_OPTIONS,
  COACH_REVIEW_SCHEMA,
  COACH_QUALITATIVE_PASS_SCHEMA,
  DEFAULT_COACH_MODEL_SELECTION,
  findExactOpeningBookMatches,
  findPawnStructureBookMatches,
  getChessBookLibraryInventory,
  normalizeCloudCoachEvaluation,
  normalizeCategorySpecialistDraft,
  normalizeGeminiQualitativePass,
  normalizeLibraryPlan,
  normalizeChessCoachRequestPayload,
  normalizeSavedWebCoachReview,
  normalizeStatsReport,
  normalizeStatsReportRequestPayload,
  normalizeStructuredCoachReview,
  normalizeWebCoachReviewStore,
  parseStockfishCoachInfo,
  parseAgyCoachOutput,
  preserveConfirmedCodexAuthentication,
  probeCodexAuthentication,
  probeAgyAuthentication,
  publicChessCoachFailure,
  retrievePlannedBookPassages,
  searchChessBookCorpus,
  STATS_REPORT_SCHEMA,
  structuredCoachReviewToMarkdown,
  writeProcessStdinSafely,
} from "./chess-coach-service.mjs";

const repoRoot = resolve(
  process.env.EN_CROISSANT_REPO_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const localAppData =
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || tmpdir(), "AppData", "Local");
const roamingAppData =
  process.env.APPDATA || join(process.env.USERPROFILE || tmpdir(), "AppData", "Roaming");
const userProfile = process.env.USERPROFILE || dirname(localAppData);
const serverRoot = resolve(
  process.env.EN_CROISSANT_HOME_SERVER_ROOT || join(localAppData, "EnCroissantHomeServer"),
);
const siteRoot = resolve(process.env.EN_CROISSANT_HOME_SERVER_SITE || join(serverRoot, "site"));
const appReleasesRoot = join(serverRoot, "app-releases");
const activeAppPath = join(serverRoot, "active-app.json");
const statePath = join(serverRoot, "state", "web-state.json");
const stateBackupRoot = join(serverRoot, "state", "backups");
const coachReviewStorePath = join(serverRoot, "state", "chess-coach-reviews.json");
const lichessCredentialPath = join(serverRoot, "credentials", "lichess.json");
const lichessExplorerCacheRoot = join(serverRoot, "cache", "lichess-explorer");
const logPath = join(serverRoot, "home-server.log");
const port = positiveInteger(process.env.EN_CROISSANT_HOME_SERVER_PORT, 8787);
const host = "127.0.0.1";
const stockfishBackendUrl = new URL(
  process.env.EN_CROISSANT_STOCKFISH_BACKEND_URL || "http://127.0.0.1:38419",
);
const documentsRoot = resolve(
  process.env.EN_CROISSANT_HOME_FILES_DIR || join(userProfile, "Documents", "EnCroissant"),
);
const enDatabaseRoots = [join(roamingAppData, "org.encroissant.app", "db")].filter(uniquePath);
const outpostDatabase = resolve(
  process.env.OUTPOST_HOME_DATABASE || join(roamingAppData, "app.outpost.chess", "library.sqlite"),
);
const libraryRoot = join(siteRoot, "web-library");
const chessBookLibraryRoot = resolve(
  process.env.EN_CROISSANT_CHESS_BOOK_LIBRARY ||
    join(userProfile, "Documents", "EnCroissant", "AI Chess Coach Library"),
);
const chessBookCorpusPath = resolve(
  process.env.EN_CROISSANT_CHESS_BOOK_CORPUS ||
    join(chessBookLibraryRoot, "00 AI Corpus", "chess-books.sqlite3"),
);
const coachCommandPath = resolve(
  process.env.EN_CROISSANT_COACH_COMMAND ||
    join(
      localAppData,
      "Programs",
      "OpenAI",
      "Codex",
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    ),
);
const coachModel = DEFAULT_COACH_MODEL_SELECTION.model;
const agyCommandPath = resolve(
  process.env.EN_CROISSANT_AGY_COMMAND ||
    join(localAppData, "agy", "bin", process.platform === "win32" ? "agy.exe" : "agy"),
);
const coachWorkRoot = join(serverRoot, "coach-work");
const coachLibraryPlanSchemaPath = join(coachWorkRoot, "library-plan.schema.json");
const coachReviewSchemaPath = join(coachWorkRoot, "coach-review.schema.json");
const coachQualitativePassSchemaPath = join(coachWorkRoot, "qualitative-pass.schema.json");
const coachCategoryDraftSchemaPath = join(coachWorkRoot, "category-draft.schema.json");
const statsReportSchemaPath = join(coachWorkRoot, "stats-report.schema.json");
const statsSyncRoot = join(serverRoot, "analysis");
const otbImportRoot = join(serverRoot, "otb-import");
const otbImportBinaryPath = join(
  serverRoot,
  "runtime",
  process.platform === "win32" ? "collect_otb_games.exe" : "collect_otb_games",
);
const statsSyncConfigPath = join(statsSyncRoot, "config.json");
const statsSyncGamesPath = join(statsSyncRoot, "games.json");
const statsSyncEntriesPath = join(statsSyncRoot, "entries.json");
const statsSyncStatusPath = join(statsSyncRoot, "status.json");
const statsSyncWorkerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "stats-background-worker.js",
);
const statsSyncIntervalMs = positiveInteger(
  process.env.EN_CROISSANT_STATS_SYNC_INTERVAL_MS,
  5 * 60 * 1000,
);
const coachSweepDepth = positiveInteger(process.env.EN_CROISSANT_COACH_SWEEP_DEPTH, 16);
const coachBoundaryTimeoutMs = positiveInteger(
  process.env.EN_CROISSANT_COACH_BOUNDARY_TIMEOUT_MS,
  8000,
);
const coachProcessEnv = {
  ...process.env,
  CODEX_HOME: process.env.CODEX_HOME || join(userProfile, ".codex"),
};
const hostedLibraryIndex = new HostedLibraryIndexCache(join(libraryRoot, "manifest.json"));
const enPositionQueryBinary = join(
  repoRoot,
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "query_db_position.exe" : "query_db_position",
);
const maxStateBytes = 256 * 1024 * 1024;
const maxCredentialBytes = 4 * 1024;
const maxCoachRequestBytes = 512 * 1024;
const maxCoachReviewBytes = 2 * 1024 * 1024;
const maxOtbImportRequestBytes = 32 * 1024;
const lichessExplorerFreshMs = 30 * 60 * 1000;
const lichessPlayerExplorerFreshMs = 5 * 60 * 1000;
const lichessMastersExplorerFreshMs = 24 * 60 * 60 * 1000;
const lichessExplorerStaleMs = 14 * 24 * 60 * 60 * 1000;
const maxExplorerMemoryEntries = 1024;
const configuredPrivateCredentialOrigins = String(process.env.EN_CROISSANT_PRIVATE_ORIGINS || "")
  .split(/[,\r\n;]/)
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter((origin) => {
    try {
      const parsed = new URL(origin);
      return (
        (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === origin
      );
    } catch {
      return false;
    }
  });
const privateCredentialOrigins = new Set([
  "https://lox-pc.tail89d19b.ts.net",
  "http://localhost:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
  ...configuredPrivateCredentialOrigins,
]);

let outpostCatalog = null;
let outpostCatalogLoadedAt = 0;
let enCatalog = null;
let enCatalogLoadedAt = 0;
const databasePositionCache = new Map();
const lichessExplorerMemoryCache = new Map();
const lichessExplorerRequests = new Map();
let lichessExplorerCacheHits = 0;
let lichessExplorerCacheMisses = 0;
let lichessExplorerUpstreamRequests = 0;
let libraryRefreshTimer = null;
let libraryRefreshRunning = false;
let libraryRefreshQueued = false;
let lastLibraryRefresh = null;
let lastLibraryError = null;
let lastStateBackupAt = 0;
let sharedLichessCredential = null;
let activeAppCache = null;
let chessBookDatabase = null;
let phoneCoachQueue = Promise.resolve();
let coachReviewWriteQueue = Promise.resolve();
const phoneCoachProgress = new Map();
const phoneCoachProgressExpiry = new Map();
const phoneCoachJobs = new Map();
const phoneCoachJobsByReviewKey = new Map();
let coachAuthenticationCache = { checkedAt: 0, status: "unknown" };
let agyAuthenticationCache = { checkedAt: 0, status: "unknown" };
let coachUsageLimitCache = null;
let coachAuthenticationProbe = null;
let agyAuthenticationProbe = null;
let statsSyncChild = null;
let statsSyncTimer = null;
const otbImportService = new OtbImportService({
  root: otbImportRoot,
  binaryPath: otbImportBinaryPath,
  onLog: (message) => void appendLog(message),
});
const fidePlayerSearch = new FidePlayerSearchService();

await mkdir(serverRoot, { recursive: true });
await mkdir(dirname(statePath), { recursive: true });
await mkdir(coachWorkRoot, { recursive: true });
await mkdir(statsSyncRoot, { recursive: true });
await otbImportService.initialize();
await Promise.all([
  writeFile(coachLibraryPlanSchemaPath, JSON.stringify(COACH_LIBRARY_PLAN_SCHEMA, null, 2)),
  writeFile(coachReviewSchemaPath, JSON.stringify(COACH_REVIEW_SCHEMA, null, 2)),
  writeFile(coachQualitativePassSchemaPath, JSON.stringify(COACH_QUALITATIVE_PASS_SCHEMA, null, 2)),
  writeFile(coachCategoryDraftSchemaPath, JSON.stringify(COACH_CATEGORY_DRAFT_SCHEMA, null, 2)),
  writeFile(statsReportSchemaPath, JSON.stringify(STATS_REPORT_SCHEMA, null, 2)),
]);
sharedLichessCredential = normalizeLichessCredential(await readJsonFile(lichessCredentialPath));

const server = createServer((request, response) => {
  void handleRequest(request, response).catch(async (error) => {
    await appendLog(`request failed: ${error?.stack || error}`);
    if (!response.headersSent) writeJson(response, 500, { error: "Home server request failed." });
    else response.destroy();
  });
});

server.listen(port, host, async () => {
  await appendLog(`listening on http://${host}:${port}; site=${siteRoot}`);
  installWatchers();
  void hostedLibraryIndex
    .get()
    .catch((error) => appendLog(`hosted library index warm-up failed: ${error}`));
  scheduleStatsSync(1500);
  statsSyncTimer = setInterval(() => void runStatsSync(), statsSyncIntervalMs);
  statsSyncTimer.unref?.();
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function handleRequest(request, response) {
  const method = request.method || "GET";
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const sensitiveApi =
    pathname === "/api/lichess-credential" ||
    pathname.startsWith("/api/chess-coach") ||
    pathname.startsWith("/api/chess-books") ||
    pathname.startsWith("/api/stats-sync") ||
    pathname.startsWith("/api/otb-import") ||
    pathname === "/v1" ||
    pathname.startsWith("/v1/");
  setCorsHeaders(request, response, sensitiveApi);
  if (method === "OPTIONS") {
    response.writeHead(204);
    return response.end();
  }

  if (pathname === "/v1" || pathname.startsWith("/v1/")) {
    return proxyStockfishRequest(request, response, requestUrl);
  }

  if (method === "GET" && pathname === "/api/health") {
    const activeApp = await getActiveAppState();
    return writeJson(response, 200, {
      ok: true,
      service: "en-croissant-home-server",
      pid: process.pid,
      siteRoot,
      activeAppRoot: activeApp.root,
      deployment: activeApp.deployment
        ? {
            sourceCommit: activeApp.deployment.sourceCommit ?? null,
            sourceBranch: activeApp.deployment.sourceBranch ?? null,
            builtAt: activeApp.deployment.builtAt ?? null,
            appShellSha256: activeApp.deployment.appShellSha256 ?? null,
          }
        : null,
      documentsRoot,
      enDatabaseRoots,
      outpostDatabase,
      enDatabases: enCatalog?.length ?? null,
      outpostCollections: outpostCatalog?.length ?? null,
      databasePositionCacheEntries: databasePositionCache.size,
      libraryRefreshRunning,
      lastLibraryRefresh,
      lastLibraryError,
      lichessConnected: Boolean(sharedLichessCredential),
      lichessUsername: sharedLichessCredential?.username ?? null,
      lichessExplorerCacheEntries: lichessExplorerMemoryCache.size,
      lichessExplorerCacheHits,
      lichessExplorerCacheMisses,
      lichessExplorerRequests: lichessExplorerRequests.size,
      lichessExplorerUpstreamRequests,
      chessBookCorpusAvailable: Boolean(await stat(chessBookCorpusPath).catch(() => null)),
      coachModel,
      coachCommandAvailable: Boolean(await stat(coachCommandPath).catch(() => null)),
      agyCommandAvailable: Boolean(await stat(agyCommandPath).catch(() => null)),
      statsSync: await getStatsSyncSummary(),
      otbImporterAvailable: await otbImportService.isAvailable(),
      otbImportJobs: otbImportService.jobs.size,
    });
  }

  if (pathname === "/api/otb-import/jobs") {
    if (method !== "POST") return writeJson(response, 405, { error: "Method not allowed." });
    try {
      const payload = await readJsonBody(request, maxOtbImportRequestBytes);
      const job = await otbImportService.createJob(payload);
      return writeJson(response, 202, job, { "cache-control": "no-store" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /not installed/i.test(message) ? 503 : 400;
      return writeJson(response, status, { error: message }, { "cache-control": "no-store" });
    }
  }

  if (pathname === "/api/otb-import/players") {
    if (method !== "GET") return writeJson(response, 405, { error: "Method not allowed." });
    const query = String(requestUrl.searchParams.get("q") || "").trim();
    const minimum = /^\d+$/.test(query) ? 4 : 3;
    if (query.length < minimum) {
      return writeJson(response, 400, { error: "Enter more of the player name or FIDE ID." });
    }
    try {
      return writeJson(
        response,
        200,
        { players: await fidePlayerSearch.search(query) },
        { "cache-control": "private, max-age=300" },
      );
    } catch (error) {
      return writeJson(response, 502, {
        error: error instanceof Error ? error.message : "FIDE player search failed.",
      });
    }
  }

  const otbJobMatch = pathname.match(/^\/api\/otb-import\/jobs\/([A-Za-z0-9_-]+)$/);
  if (otbJobMatch) {
    if (method !== "GET") return writeJson(response, 405, { error: "Method not allowed." });
    const job = otbImportService.getJob(otbJobMatch[1]);
    return job
      ? writeJson(response, 200, job, { "cache-control": "no-store" })
      : writeJson(response, 404, { error: "OTB import job not found." });
  }

  if (pathname === "/api/stats-sync/status") {
    if (method !== "GET") return writeJson(response, 405, { error: "Method not allowed." });
    return writeJson(response, 200, await getStatsSyncSummary(), { "cache-control": "no-store" });
  }

  if (pathname === "/api/stats-sync/config") {
    if (method === "GET") return readStatsSyncConfig(response);
    if (method === "PUT") return writeStatsSyncConfig(request, response);
    return writeJson(response, 405, { error: "Method not allowed." });
  }

  if (pathname === "/api/stats-sync/run") {
    if (method !== "POST") return writeJson(response, 405, { error: "Method not allowed." });
    const result = await runStatsSync({ force: true });
    return writeJson(response, result.started ? 202 : 200, result, { "cache-control": "no-store" });
  }

  if (pathname === "/api/stats-sync/entries") {
    if (method === "GET") return readStatsSyncEntries(response);
    if (method === "PUT") return mergeStatsSyncEntries(request, response);
    return writeJson(response, 405, { error: "Method not allowed." });
  }

  if (pathname === "/api/stats-sync/games") {
    if (method !== "GET") return writeJson(response, 405, { error: "Method not allowed." });
    return readStatsSyncGames(requestUrl, response);
  }

  if (pathname === "/api/stats-sync/accuracies") {
    if (method !== "GET") return writeJson(response, 405, { error: "Method not allowed." });
    return readStatsSyncAccuracies(response);
  }

  if (pathname === "/api/chess-coach/health") {
    if (method !== "GET") return writeJson(response, 405, { error: "Method not allowed." });
    return writeChessCoachHealth(response);
  }

  if (pathname === "/api/chess-coach/progress") {
    if (method !== "GET") return writeJson(response, 405, { error: "Method not allowed." });
    return writeChessCoachProgress(requestUrl, response);
  }

  if (pathname === "/api/chess-coach/review") {
    if (method !== "POST") return writeJson(response, 405, { error: "Method not allowed." });
    return handleSavedChessCoachReview(request, response);
  }

  if (pathname === "/api/chess-books/search") {
    if (method !== "GET") return writeJson(response, 405, { error: "Method not allowed." });
    return writeChessBookSearch(requestUrl, response);
  }

  if (pathname === "/api/chess-books/pdf") {
    if (method !== "GET" && method !== "HEAD") {
      return writeJson(response, 405, { error: "Method not allowed." });
    }
    return serveChessBookPdf(requestUrl, request, response, method === "HEAD");
  }

  if (pathname === "/api/chess-coach/analyze-game") {
    if (method !== "POST") return writeJson(response, 405, { error: "Method not allowed." });
    return writeChessCoachAnalysisResponse(request, response);
  }

  if (pathname === "/api/chess-coach/stats-report") {
    if (method !== "POST") return writeJson(response, 405, { error: "Method not allowed." });
    return writeStatsAiReportResponse(request, response);
  }

  if (pathname === "/api/chess-coach") {
    if (method !== "POST") return writeJson(response, 405, { error: "Method not allowed." });
    return writeChessCoachResponse(request, response);
  }

  if (pathname === "/api/web-state") {
    if (method === "GET") return readWebState(response);
    if (method === "PUT") return writeWebState(request, response);
    return writeJson(response, 405, { error: "Method not allowed." });
  }

  if (pathname === "/api/lichess-credential") {
    if (method === "GET") return readLichessCredential(response);
    if (method === "PUT") return writeLichessCredential(request, response);
    return writeJson(response, 405, { error: "Method not allowed." });
  }

  if (pathname === "/api/lichess-explorer") {
    if (method === "GET") return writeLichessExplorer(requestUrl, response);
    return writeJson(response, 405, { error: "Method not allowed." });
  }

  if (method === "GET" && pathname === "/api/database-manifest") {
    return writeDatabaseManifest(requestUrl, response);
  }

  if (method === "GET" && pathname === "/api/database-position") {
    return writeDatabasePosition(requestUrl, response);
  }

  if (method === "GET" && pathname === "/web-library/manifest.json") {
    return writeLiveLibraryManifest(requestUrl, response);
  }

  if (method !== "GET" && method !== "HEAD") {
    return writeJson(response, 405, { error: "Method not allowed." });
  }

  const activeApp = await getActiveAppState();
  const staticRoot =
    pathname === "/web-library" || pathname.startsWith("/web-library/") ? siteRoot : activeApp.root;
  return serveStatic(pathname, request, response, method === "HEAD", staticRoot);
}

function proxyStockfishRequest(request, response, requestUrl) {
  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    let clientClosed = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolveRequest();
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      rejectRequest(error);
    };
    const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, stockfishBackendUrl);
    const headers = { ...request.headers };
    delete headers.host;
    delete headers.origin;
    delete headers.connection;

    const upstream = createHttpRequest(
      upstreamUrl,
      {
        method: request.method,
        headers,
      },
      (upstreamResponse) => {
        if (clientClosed) {
          upstreamResponse.destroy();
          resolveOnce();
          return;
        }
        const responseHeaders = { ...upstreamResponse.headers };
        delete responseHeaders.connection;
        delete responseHeaders["access-control-allow-origin"];
        delete responseHeaders["access-control-allow-headers"];
        delete responseHeaders["access-control-allow-methods"];
        delete responseHeaders.vary;
        response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
        response.flushHeaders?.();
        upstreamResponse.pipe(response);
        upstreamResponse.once("end", resolveOnce);
        upstreamResponse.once("error", (error) => {
          if (clientClosed) resolveOnce();
          else rejectOnce(error);
        });
      },
    );

    upstream.once("socket", (socket) => socket.setNoDelay(true));
    upstream.once("error", (error) => {
      if (clientClosed) resolveOnce();
      else rejectOnce(error);
    });
    const closeUpstream = () => {
      clientClosed = true;
      upstream.destroy();
      resolveOnce();
    };
    request.once("aborted", closeUpstream);
    response.once("close", () => {
      if (!response.writableEnded) closeUpstream();
    });
    request.pipe(upstream);
  });
}

function scheduleStatsSync(delayMs = 0) {
  const timer = setTimeout(() => void runStatsSync(), Math.max(0, delayMs));
  timer.unref?.();
}

async function runStatsSync({ force = false } = {}) {
  if (statsSyncChild && statsSyncChild.exitCode === null) {
    return { ok: true, started: false, running: true, pid: statsSyncChild.pid };
  }
  const externalStatus = await readJsonFile(statsSyncStatusPath);
  const externalPid = Number(externalStatus?.pid);
  if (externalStatus?.state === "analyzing" && isProcessAlive(externalPid)) {
    return { ok: true, started: false, running: true, pid: externalPid, external: true };
  }
  const config = normalizeStatsSyncConfig(await readJsonFile(statsSyncConfigPath));
  if (!config.accounts.chesscom && !config.accounts.lichess) {
    return { ok: true, started: false, running: false, needsAccount: true };
  }
  const workerAvailable = Boolean(await stat(statsSyncWorkerPath).catch(() => null));
  if (!workerAvailable) {
    return { ok: false, started: false, running: false, error: "Stats worker is not installed." };
  }
  if (!force) {
    const status = await readJsonFile(statsSyncStatusPath);
    const finishedAt = Number(status?.finishedAt) || 0;
    if (finishedAt && Date.now() - finishedAt < statsSyncIntervalMs) {
      return { ok: true, started: false, running: false, fresh: true };
    }
  }

  const child = spawn(
    process.execPath,
    [
      statsSyncWorkerPath,
      "--config",
      statsSyncConfigPath,
      "--games",
      statsSyncGamesPath,
      "--entries",
      statsSyncEntriesPath,
      "--status",
      statsSyncStatusPath,
      "--backend",
      stockfishBackendUrl.origin,
    ],
    {
      cwd: dirname(statsSyncWorkerPath),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  statsSyncChild = child;
  child.stdout?.on("data", (chunk) => void appendLog(`stats worker: ${String(chunk).trim()}`));
  child.stderr?.on(
    "data",
    (chunk) => void appendLog(`stats worker stderr: ${String(chunk).trim()}`),
  );
  child.once("error", (error) => void appendLog(`stats worker failed: ${error?.stack || error}`));
  child.once("exit", (code, signal) => {
    if (statsSyncChild === child) statsSyncChild = null;
    void appendLog(`stats worker exited: code=${code ?? "null"}; signal=${signal ?? "none"}`);
  });
  return { ok: true, started: true, running: true, pid: child.pid };
}

async function getStatsSyncSummary() {
  const [config, status, games, entries] = await Promise.all([
    readJsonFile(statsSyncConfigPath),
    readJsonFile(statsSyncStatusPath),
    readJsonFile(statsSyncGamesPath),
    readJsonFile(statsSyncEntriesPath),
  ]);
  const normalized = normalizeStatsSyncConfig(config);
  const statusPid = Number(status?.pid);
  return {
    ok: true,
    running:
      Boolean(statsSyncChild && statsSyncChild.exitCode === null) ||
      (status?.state === "analyzing" && isProcessAlive(statusPid)),
    workerInstalled: Boolean(await stat(statsSyncWorkerPath).catch(() => null)),
    accounts: normalized.accounts,
    historyDays: normalized.historyDays,
    depth: normalized.depth,
    nodesPerPosition: normalized.nodesPerPosition,
    games: Array.isArray(games?.games) ? games.games.length : 0,
    analyzedGames: Array.isArray(entries?.entries) ? entries.entries.length : 0,
    gamesUpdatedAt: Math.max(0, Number(games?.updatedAt) || 0),
    entriesUpdatedAt: Math.max(0, Number(entries?.updatedAt) || 0),
    status: status || { state: "idle" },
  };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readStatsSyncConfig(response) {
  return readJsonFile(statsSyncConfigPath).then((config) =>
    writeJson(response, 200, normalizeStatsSyncConfig(config), { "cache-control": "no-store" }),
  );
}

async function writeStatsSyncConfig(request, response) {
  const payload = await readJsonBody(request, 32 * 1024);
  const current = normalizeStatsSyncConfig(await readJsonFile(statsSyncConfigPath));
  const requestedAccounts = payload?.accounts || {};
  const config = normalizeStatsSyncConfig({
    ...current,
    ...payload,
    // Older cached phone bundles used depth 16. Never let one of those clients
    // silently downgrade an intentional deep batch already configured on the PC.
    depth: Math.max(current.depth, Number(payload?.depth) || current.depth),
    nodesPerPosition: Math.max(
      current.nodesPerPosition,
      Number(payload?.nodesPerPosition) || current.nodesPerPosition,
    ),
    accounts: {
      chesscom: String(requestedAccounts.chesscom || "").trim() || current.accounts.chesscom,
      lichess: String(requestedAccounts.lichess || "").trim() || current.accounts.lichess,
    },
  });
  await writeAtomicJson(statsSyncConfigPath, config);
  const sync = await runStatsSync({ force: true });
  return writeJson(response, 200, { ok: true, config, sync }, { "cache-control": "no-store" });
}

async function readStatsSyncEntries(response) {
  const stored = await readJsonFile(statsSyncEntriesPath);
  const entries = Array.isArray(stored?.entries) ? stored.entries : [];
  return writeJson(
    response,
    200,
    { v: 1, updatedAt: stored?.updatedAt || 0, entries },
    {
      "cache-control": "no-store",
    },
  );
}

async function mergeStatsSyncEntries(request, response) {
  const payload = await readJsonBody(request, 16 * 1024 * 1024);
  const incoming = Array.isArray(payload?.entries) ? payload.entries : [];
  const stored = await readJsonFile(statsSyncEntriesPath);
  const byKey = new Map();
  for (const entry of [...(Array.isArray(stored?.entries) ? stored.entries : []), ...incoming]) {
    if (!isStatsSyncEntry(entry)) continue;
    const existing = byKey.get(entry.key);
    if (!existing || compareStatsEntryQuality(entry, existing) >= 0) {
      byKey.set(entry.key, entry);
    }
  }
  const entries = Array.from(byKey.values()).sort((a, b) => Number(b.end) - Number(a.end));
  await writeAtomicJson(statsSyncEntriesPath, { v: 1, updatedAt: Date.now(), entries });
  return writeJson(
    response,
    200,
    { ok: true, entries: entries.length },
    { "cache-control": "no-store" },
  );
}

async function readStatsSyncGames(requestUrl, response) {
  const stored = await readJsonFile(statsSyncGamesPath);
  const source = requestUrl.searchParams.get("source");
  let games = Array.isArray(stored?.games) ? stored.games : [];
  if (source === "chesscom" || source === "lichess") {
    games = games.filter((game) => game?.source === source);
  }
  return writeJson(
    response,
    200,
    { v: 1, updatedAt: stored?.updatedAt || 0, games },
    {
      "cache-control": "no-store",
    },
  );
}

async function readStatsSyncAccuracies(response) {
  const stored = await readJsonFile(statsSyncGamesPath);
  const accuracies = [];
  for (const game of Array.isArray(stored?.games) ? stored.games : []) {
    const accuracy = game?.providerQuality?.accuracy;
    if (!game?.url || !Number.isFinite(accuracy)) continue;
    accuracies.push({ url: game.url, accuracy, source: game.source });
  }
  return writeJson(
    response,
    200,
    { v: 1, updatedAt: stored?.updatedAt || 0, accuracies },
    {
      "cache-control": "no-store",
    },
  );
}

function normalizeStatsSyncConfig(value) {
  return {
    accounts: {
      chesscom: String(value?.accounts?.chesscom || "")
        .trim()
        .slice(0, 64),
      lichess: String(value?.accounts?.lichess || "")
        .trim()
        .slice(0, 64),
    },
    historyDays: Math.max(1, Math.min(3650, positiveInteger(value?.historyDays, 365))),
    depth: Math.max(8, Math.min(30, positiveInteger(value?.depth, 16))),
    nodesPerPosition: Math.max(
      0,
      Math.min(2_000_000_000, Math.round(Number(value?.nodesPerPosition ?? 1_000_000) || 0)),
    ),
  };
}

function isStatsSyncEntry(value) {
  return (
    value &&
    typeof value === "object" &&
    value.v === 2 &&
    typeof value.key === "string" &&
    value.key.length > 0 &&
    Number.isFinite(value.ts) &&
    Number.isFinite(value.end) &&
    value.stats &&
    typeof value.stats === "object"
  );
}

async function writeAtomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
  await renameReplacing(temporaryPath, path);
}

function shutdown() {
  if (statsSyncTimer) clearInterval(statsSyncTimer);
  if (statsSyncChild && statsSyncChild.exitCode === null) statsSyncChild.kill();
  server.close(() => process.exit(0));
}

async function readWebState(response) {
  const text = await readFile(statePath, "utf8").catch(() => null);
  if (!text) return writeJson(response, 404, { error: "No server workspace has been saved yet." });
  const state = JSON.parse(text);
  return writeJson(response, 200, { state }, { "cache-control": "no-store" });
}

async function writeWebState(request, response) {
  const payload = await readJsonBody(request, maxStateBytes);
  const state = payload?.state ?? payload;
  if (!isValidWebState(state)) return writeJson(response, 400, { error: "Invalid web workspace." });

  await mkdir(dirname(statePath), { recursive: true });
  const existing = await readFile(statePath).catch(() => null);
  if (existing && Date.now() - lastStateBackupAt >= 15 * 60 * 1000) {
    await mkdir(stateBackupRoot, { recursive: true });
    const backupPath = join(stateBackupRoot, `web-state-${safeTimestamp()}.json`);
    await copyFile(statePath, backupPath);
    lastStateBackupAt = Date.now();
    void pruneStateBackups();
  }

  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, "utf8");
  await renameReplacing(temporaryPath, statePath);
  return writeJson(response, 200, { ok: true, savedAt: new Date().toISOString() });
}

async function handleSavedChessCoachReview(request, response) {
  const payload = await readJsonBody(request, maxCoachReviewBytes);
  const action = String(payload?.action || "").trim();
  const storageKey = String(payload?.storageKey || "");
  if (!storageKey || storageKey.length > 256 * 1024) {
    return writeJson(response, 400, { error: "A valid coach game key is required." });
  }
  const recordKey = createHash("sha256").update(storageKey, "utf8").digest("hex");

  if (action === "read") {
    const store = await readCoachReviewStore();
    const entry = store.records[recordKey];
    const pendingJob = getPendingPhoneCoachJob(recordKey);
    if (!entry || entry.storageKey !== storageKey) {
      if (pendingJob) {
        return writeJson(
          response,
          200,
          {
            review: null,
            pending: true,
            requestId: pendingJob.requestId,
            progress: phoneCoachProgress.get(pendingJob.requestId) ?? null,
          },
          { "cache-control": "no-store" },
        );
      }
      return writeJson(response, 404, { review: null }, { "cache-control": "no-store" });
    }
    const review = normalizeSavedWebCoachReview(entry.review);
    if (!review) return writeJson(response, 404, { review: null }, { "cache-control": "no-store" });
    return writeJson(
      response,
      200,
      {
        review,
        pending: Boolean(pendingJob),
        ...(pendingJob
          ? {
              requestId: pendingJob.requestId,
              progress: phoneCoachProgress.get(pendingJob.requestId) ?? null,
            }
          : {}),
      },
      { "cache-control": "no-store" },
    );
  }

  if (action === "write") {
    const review = normalizeSavedWebCoachReview(payload.review);
    if (!review) return writeJson(response, 400, { error: "The coach review is invalid." });
    await saveCoachReviewRecord(storageKey, review);
    return writeJson(response, 200, { ok: true, savedAt: review.savedAt });
  }

  if (action === "delete") {
    await queueCoachReviewStoreWrite(async () => {
      const store = await readCoachReviewStore();
      delete store.records[recordKey];
      await writeCoachReviewStore(store);
    });
    return writeJson(response, 200, { ok: true });
  }

  return writeJson(response, 400, { error: "Unknown coach review action." });
}

function getCoachReviewRecordKey(storageKey) {
  return createHash("sha256").update(storageKey, "utf8").digest("hex");
}

function getPendingPhoneCoachJob(recordKey) {
  const jobs = phoneCoachJobsByReviewKey.get(recordKey);
  if (!jobs?.size) return null;
  return [...jobs].at(-1) ?? null;
}

async function saveCoachReviewRecord(storageKey, review) {
  const normalized = normalizeSavedWebCoachReview(review);
  if (!normalized) throw new Error("The coach review is invalid.");
  const recordKey = getCoachReviewRecordKey(storageKey);
  await queueCoachReviewStoreWrite(async () => {
    const store = await readCoachReviewStore();
    store.records[recordKey] = { storageKey, review: normalized };
    await writeCoachReviewStore(store);
  });
}

function queueCoachReviewStoreWrite(operation) {
  const queued = coachReviewWriteQueue.catch(() => {}).then(operation);
  coachReviewWriteQueue = queued.catch(() => {});
  return queued;
}

async function readCoachReviewStore() {
  const primary = await readJsonFile(coachReviewStorePath);
  if (primary) return normalizeWebCoachReviewStore(primary);
  const recovery = await readJsonFile(`${coachReviewStorePath}.previous`);
  return normalizeWebCoachReviewStore(recovery);
}

async function writeCoachReviewStore(store) {
  await mkdir(dirname(coachReviewStorePath), { recursive: true });
  const temporaryPath = `${coachReviewStorePath}.${process.pid}.${Date.now()}.tmp`;
  const previousPath = `${coachReviewStorePath}.previous`;
  await writeFile(temporaryPath, `${JSON.stringify(store)}\n`, "utf8");
  await rm(previousPath, { force: true });
  const hadExisting = Boolean(await stat(coachReviewStorePath).catch(() => null));
  if (hadExisting) await rename(coachReviewStorePath, previousPath);
  try {
    await rename(temporaryPath, coachReviewStorePath);
    await rm(previousPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    if (hadExisting && !(await stat(coachReviewStorePath).catch(() => null))) {
      await rename(previousPath, coachReviewStorePath).catch(() => {});
    }
    throw error;
  }
}

function readLichessCredential(response) {
  if (!sharedLichessCredential) {
    return writeJson(response, 404, { connected: false });
  }
  return writeJson(response, 200, {
    connected: true,
    ...sharedLichessCredential,
  });
}

async function writeLichessCredential(request, response) {
  const payload = await readJsonBody(request, maxCredentialBytes);
  const token = String(payload?.token || "").trim();
  if (!/^[A-Za-z0-9_-]{20,512}$/.test(token)) {
    return writeJson(response, 400, { error: "A valid Lichess access token is required." });
  }

  const accountResponse = await fetch("https://lichess.org/api/account", {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!accountResponse.ok) {
    return writeJson(response, 401, { error: "Lichess rejected this access token." });
  }
  const account = await accountResponse.json();
  const username = String(account?.username || "").trim();
  if (!username) {
    return writeJson(response, 502, { error: "Lichess returned an invalid account." });
  }

  const credential = {
    token,
    username,
    updatedAt: Date.now(),
  };
  await mkdir(dirname(lichessCredentialPath), { recursive: true });
  const temporaryPath = `${lichessCredentialPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(credential)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await renameReplacing(temporaryPath, lichessCredentialPath);
  sharedLichessCredential = credential;
  await appendLog(`updated shared Lichess credential for ${username}`);
  return writeJson(response, 200, { connected: true, ...credential });
}

async function writeLichessExplorer(requestUrl, response) {
  if (!sharedLichessCredential) {
    return writeJson(response, 503, { error: "The shared Lichess account is unavailable." });
  }

  const upstreamUrl = buildLichessExplorerUrl(requestUrl);
  if (!upstreamUrl) {
    return writeJson(response, 400, { error: "Invalid Lichess explorer request." });
  }

  const cacheKey = upstreamUrl.toString();
  const now = Date.now();
  const freshMs = getLichessExplorerFreshMs(upstreamUrl);
  const cached = await readLichessExplorerCache(cacheKey);
  const ageMs = cached ? Math.max(0, now - cached.fetchedAt) : Number.POSITIVE_INFINITY;

  if (cached && ageMs <= freshMs) {
    lichessExplorerCacheHits += 1;
    return writeJson(response, 200, cached.data, explorerResponseHeaders("hit", ageMs));
  }

  if (cached && ageMs <= lichessExplorerStaleMs) {
    lichessExplorerCacheHits += 1;
    void refreshLichessExplorer(cacheKey, upstreamUrl).catch((error) =>
      appendLog(`Lichess explorer background refresh failed: ${error}`),
    );
    return writeJson(response, 200, cached.data, explorerResponseHeaders("stale", ageMs));
  }

  lichessExplorerCacheMisses += 1;
  try {
    const startedAt = Date.now();
    const record = await refreshLichessExplorer(cacheKey, upstreamUrl);
    return writeJson(response, 200, record.data, {
      ...explorerResponseHeaders("miss", 0),
      "server-timing": `lichess;dur=${Math.max(0, Date.now() - startedAt)}`,
    });
  } catch (error) {
    const status = Number(error?.statusCode) || 502;
    return writeJson(response, status, {
      error: error instanceof Error ? error.message : "Lichess explorer request failed.",
    });
  }
}

function buildLichessExplorerUrl(requestUrl) {
  const source = requestUrl.searchParams.get("source");
  if (source !== "lichess-all" && source !== "lichess-masters") return null;

  const fen = String(requestUrl.searchParams.get("fen") || "").trim();
  if (!fen || fen.length > 120) return null;

  const player = normalizeLichessPlayer(requestUrl.searchParams.get("player"));
  const endpoint = source === "lichess-masters" ? "masters" : player ? "player" : "lichess";
  const upstreamUrl = new URL(`https://explorer.lichess.org/${endpoint}`);
  upstreamUrl.searchParams.set("fen", fen);
  upstreamUrl.searchParams.set(
    "moves",
    String(Math.max(1, Math.min(30, positiveInteger(requestUrl.searchParams.get("moves"), 12)))),
  );

  if (source === "lichess-all") {
    upstreamUrl.searchParams.set("variant", "standard");
    if (player) {
      upstreamUrl.searchParams.set("player", player);
      upstreamUrl.searchParams.set(
        "color",
        requestUrl.searchParams.get("color") === "black" ? "black" : "white",
      );
    }
    appendAllowedCsvParam(upstreamUrl, requestUrl, "speeds", [
      "ultraBullet",
      "bullet",
      "blitz",
      "rapid",
      "classical",
      "correspondence",
    ]);
    appendAllowedCsvParam(upstreamUrl, requestUrl, "ratings", [
      "0",
      "1000",
      "1200",
      "1400",
      "1600",
      "1800",
      "2000",
      "2200",
      "2500",
    ]);
    appendMatchingParam(upstreamUrl, requestUrl, "since", /^\d{4}-\d{2}$/);
    appendMatchingParam(upstreamUrl, requestUrl, "until", /^\d{4}-\d{2}$/);
  } else {
    appendMatchingParam(upstreamUrl, requestUrl, "since", /^\d{4}$/);
    appendMatchingParam(upstreamUrl, requestUrl, "until", /^\d{4}$/);
  }

  return upstreamUrl;
}

function normalizeLichessPlayer(value) {
  const player = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,30}$/.test(player) ? player : "";
}

function appendAllowedCsvParam(upstreamUrl, requestUrl, key, allowed) {
  const values = String(requestUrl.searchParams.get(key) || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => allowed.includes(value));
  if (values.length > 0) upstreamUrl.searchParams.set(key, [...new Set(values)].join(","));
}

function appendMatchingParam(upstreamUrl, requestUrl, key, pattern) {
  const value = String(requestUrl.searchParams.get(key) || "").trim();
  if (pattern.test(value)) upstreamUrl.searchParams.set(key, value);
}

function getLichessExplorerFreshMs(upstreamUrl) {
  if (upstreamUrl.pathname.endsWith("/masters")) return lichessMastersExplorerFreshMs;
  if (upstreamUrl.pathname.endsWith("/player")) return lichessPlayerExplorerFreshMs;
  return lichessExplorerFreshMs;
}

async function readLichessExplorerCache(cacheKey) {
  const memoryRecord = lichessExplorerMemoryCache.get(cacheKey);
  if (memoryRecord) {
    touchMapEntry(lichessExplorerMemoryCache, cacheKey, memoryRecord);
    return memoryRecord;
  }

  const record = normalizeLichessExplorerCacheRecord(
    await readJsonFile(getLichessExplorerCachePath(cacheKey)),
    cacheKey,
  );
  if (record) rememberLichessExplorerCache(cacheKey, record);
  return record;
}

function refreshLichessExplorer(cacheKey, upstreamUrl) {
  const pending = lichessExplorerRequests.get(cacheKey);
  if (pending) return pending;

  const request = fetchLichessExplorer(upstreamUrl)
    .then(async (data) => {
      const record = { cacheKey, fetchedAt: Date.now(), data };
      rememberLichessExplorerCache(cacheKey, record);
      await mkdir(lichessExplorerCacheRoot, { recursive: true });
      const cachePath = getLichessExplorerCachePath(cacheKey);
      const temporaryPath = `${cachePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, "utf8");
      await renameReplacing(temporaryPath, cachePath);
      return record;
    })
    .finally(() => lichessExplorerRequests.delete(cacheKey));
  lichessExplorerRequests.set(cacheKey, request);
  return request;
}

async function fetchLichessExplorer(upstreamUrl) {
  lichessExplorerUpstreamRequests += 1;
  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      accept: "application/json, application/x-ndjson",
      authorization: `Bearer ${sharedLichessCredential.token}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstreamResponse.ok) {
    const error = new Error(`Lichess explorer returned HTTP ${upstreamResponse.status}.`);
    error.statusCode = upstreamResponse.status;
    throw error;
  }

  const text = await upstreamResponse.text();
  const lastLine = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastLine) throw new Error("Lichess explorer returned an empty response.");
  const data = JSON.parse(lastLine);
  if (!data || typeof data !== "object" || !Array.isArray(data.moves)) {
    throw new Error("Lichess explorer returned an invalid response.");
  }
  return data;
}

function normalizeLichessExplorerCacheRecord(value, cacheKey) {
  if (
    !value ||
    typeof value !== "object" ||
    value.cacheKey !== cacheKey ||
    !Number.isFinite(value.fetchedAt) ||
    !value.data ||
    typeof value.data !== "object" ||
    !Array.isArray(value.data.moves)
  ) {
    return null;
  }
  return { cacheKey, fetchedAt: Number(value.fetchedAt), data: value.data };
}

function getLichessExplorerCachePath(cacheKey) {
  const hash = createHash("sha256").update(cacheKey).digest("hex");
  return join(lichessExplorerCacheRoot, `${hash}.json`);
}

function rememberLichessExplorerCache(cacheKey, record) {
  touchMapEntry(lichessExplorerMemoryCache, cacheKey, record);
  while (lichessExplorerMemoryCache.size > maxExplorerMemoryEntries) {
    lichessExplorerMemoryCache.delete(lichessExplorerMemoryCache.keys().next().value);
  }
}

function touchMapEntry(map, key, value) {
  map.delete(key);
  map.set(key, value);
}

function explorerResponseHeaders(cache, ageMs) {
  return {
    "cache-control": "private, no-store",
    "x-en-croissant-cache": cache,
    "x-en-croissant-cache-age": String(Math.round(Math.max(0, ageMs))),
  };
}

async function writeLiveLibraryManifest(requestUrl, response) {
  const scope = requestUrl.searchParams.get("scope");
  if (scope === "directory") {
    const index = await hostedLibraryIndex.get();
    const listing = listHostedLibraryDirectory(index, requestUrl.searchParams.get("path") || "");
    return writeJson(
      response,
      200,
      { ...listing, sourceName: "Gaming PC live library" },
      { "cache-control": "private, max-age=0, must-revalidate" },
    );
  }
  if (scope === "recursive") {
    const index = await hostedLibraryIndex.get();
    const manifest = getHostedLibraryScope(index, requestUrl.searchParams.get("path") || "");
    return writeJson(
      response,
      200,
      { ...manifest, sourceName: "Gaming PC live library" },
      { "cache-control": "private, max-age=0, must-revalidate" },
    );
  }

  const base = (await hostedLibraryIndex.get()).manifest;
  const [en, outpost] = await Promise.all([getEnCatalog(), getOutpostCatalog()]);
  const manifest = {
    version: 1,
    generatedAt: base?.generatedAt || new Date().toISOString(),
    sourceName: "Gaming PC live library",
    pinnedPaths: base?.pinnedPaths || [],
    files: base?.files || [],
    databases: [...en, ...outpost].map((collection) => ({
      type: "database",
      path: collection.hostedPath,
      name: collection.name,
      label: collection.label,
      gameCount: collection.gameCount,
      sizeBytes: collection.sizeBytes || 0,
      lastModified: collection.lastModified,
      latestDate: collection.latestDate,
    })),
  };
  return writeJson(response, 200, manifest, { "cache-control": "no-store" });
}

async function writeDatabaseManifest(requestUrl, response) {
  const hostedPath = normalizeHostedPath(requestUrl.searchParams.get("hostedPath") || "");
  const collection = hostedPath.startsWith("Databases/Outpost/")
    ? await findOutpostCollection(hostedPath)
    : null;
  const enDatabase = hostedPath.startsWith("Databases/Desktop/")
    ? await findEnDatabase(hostedPath)
    : null;
  if (!collection && !enDatabase)
    return writeJson(response, 404, { error: "Live database not found." });
  const database = collection || enDatabase;
  return writeJson(
    response,
    200,
    {
      version: 1,
      maxPly: collection || enDatabase.indexPath ? 1000 : 0,
      gameCount: database.gameCount,
      positionCount: 0,
      latestDate: database.latestDate,
      shards: [],
    },
    { "cache-control": "no-store" },
  );
}

async function writeDatabasePosition(requestUrl, response) {
  const hostedPath = normalizeHostedPath(requestUrl.searchParams.get("hostedPath") || "");
  const fen = normalizeFen(requestUrl.searchParams.get("fen") || "");
  const collection = hostedPath.startsWith("Databases/Outpost/")
    ? await findOutpostCollection(hostedPath)
    : null;
  if (!fen) return writeJson(response, 404, { error: "Live database not found." });

  if (!collection) {
    const enDatabase = await findEnDatabase(hostedPath);
    if (!enDatabase?.indexPath)
      return writeJson(response, 404, { error: "Live position index not found." });
    const cacheKey = `en|${enDatabase.indexPath}|${enDatabase.lastModified}|${fen}`;
    let rows = databasePositionCache.get(cacheKey);
    if (!rows) {
      const output = await runProcessOutput(enPositionQueryBinary, [
        "--index",
        enDatabase.indexPath,
        "--fen",
        fen,
      ]);
      rows = JSON.parse(output || "[]");
      rememberDatabasePosition(cacheKey, rows);
    }
    return writeJson(response, 200, rows, { "cache-control": "no-store" });
  }

  const cacheKey = `outpost|${collection.id}|${collection.lastModified}|${fen}`;
  const cachedRows = databasePositionCache.get(cacheKey);
  if (cachedRows) {
    touchMapEntry(databasePositionCache, cacheKey, cachedRows);
    return writeJson(response, 200, cachedRows, { "cache-control": "no-store" });
  }

  const database = openOutpostDatabase();
  try {
    const rows = database
      .prepare(
        `
          SELECT
            ph.next_san AS move,
            SUM(CASE WHEN ph.result = '1-0' THEN 1 ELSE 0 END) AS white,
            SUM(CASE WHEN ph.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draw,
            SUM(CASE WHEN ph.result = '0-1' THEN 1 ELSE 0 END) AS black,
            MAX(g.game_date) AS lastPlayed
          FROM position_hit AS ph
          INNER JOIN game_record AS g ON g.id = ph.game_id
          WHERE ph.position_key = ? AND g.collection_id = ? AND ph.next_san IS NOT NULL
          GROUP BY ph.next_san
          ORDER BY COUNT(*) DESC, ph.next_san ASC
          LIMIT 100
        `,
      )
      .all(fen, collection.id)
      .map((row) => ({
        move: String(row.move || ""),
        uci: null,
        white: Number(row.white || 0),
        draw: Number(row.draw || 0),
        black: Number(row.black || 0),
        lastPlayed: row.lastPlayed ? String(row.lastPlayed) : null,
      }));
    rememberDatabasePosition(cacheKey, rows);
    return writeJson(response, 200, rows, { "cache-control": "no-store" });
  } finally {
    database.close();
  }
}

function rememberDatabasePosition(cacheKey, rows) {
  touchMapEntry(databasePositionCache, cacheKey, rows);
  while (databasePositionCache.size > 512) {
    databasePositionCache.delete(databasePositionCache.keys().next().value);
  }
}

async function getOutpostCatalog() {
  if (outpostCatalog && Date.now() - outpostCatalogLoadedAt < 60_000) return outpostCatalog;
  const database = openOutpostDatabase();
  try {
    const rows = database
      .prepare(
        `
          SELECT
            c.id,
            c.name,
            c.folder,
            COUNT(g.id) AS gameCount,
            MAX(g.game_date) AS latestDate,
            MAX(COALESCE(g.updated_at, g.created_at, c.created_at)) AS lastChanged
          FROM collection AS c
          LEFT JOIN game_record AS g ON g.collection_id = c.id
          GROUP BY c.id, c.name, c.folder
          ORDER BY COALESCE(c.folder, ''), c.name
        `,
      )
      .all();
    outpostCatalog = rows.map((row) => {
      const name = String(row.name || `Collection ${row.id}`);
      const folder = String(row.folder || "");
      const pathParts = folder
        .split(/[\\/]+/)
        .map(sanitizePathSegment)
        .filter(Boolean);
      const hostedPath = ["Databases", "Outpost", ...pathParts, sanitizePathSegment(name)]
        .filter(Boolean)
        .join("/");
      return {
        id: Number(row.id),
        name,
        label: [...pathParts, name].join(" / "),
        hostedPath,
        gameCount: Number(row.gameCount || 0),
        latestDate: row.latestDate ? String(row.latestDate) : null,
        lastModified: parseSqliteTimestamp(row.lastChanged),
      };
    });
    outpostCatalogLoadedAt = Date.now();
    return outpostCatalog;
  } finally {
    database.close();
  }
}

async function getEnCatalog() {
  if (enCatalog && Date.now() - enCatalogLoadedAt < 60_000) return enCatalog;

  const databaseFiles = [];
  for (const root of enDatabaseRoots) await collectEnDatabaseFiles(root, root, databaseFiles);

  const catalog = [];
  for (const entry of databaseFiles) {
    const fileStat = await stat(entry.absolutePath).catch(() => null);
    if (!fileStat?.isFile()) continue;

    let gameCount = 0;
    let latestDate = null;
    try {
      const database = new DatabaseSync(entry.absolutePath, { readOnly: true });
      database.exec("PRAGMA busy_timeout = 5000");
      database.exec("PRAGMA query_only = ON");
      try {
        const info = database.prepare("SELECT Name, Value FROM Info").all();
        const values = new Map(info.map((row) => [String(row.Name), String(row.Value || "")]));
        gameCount = Number(values.get("GameCount") || 0);
      } catch {}
      try {
        latestDate = database
          .prepare("SELECT MAX(Date) AS latestDate FROM Games")
          .get()?.latestDate;
      } catch {}
      database.close();
    } catch (error) {
      await appendLog(`could not read En Croissant database ${entry.absolutePath}: ${error}`);
    }

    const pathWithoutExtension = entry.relativePath.replace(/\.db3$/i, "");
    const pathParts = pathWithoutExtension.split("/").map(sanitizePathSegment).filter(Boolean);
    const name = sanitizePathSegment(basename(pathWithoutExtension));
    catalog.push({
      name,
      label: pathParts.join(" / "),
      hostedPath: ["Databases", "Desktop", ...pathParts].join("/"),
      gameCount: Number.isFinite(gameCount) ? gameCount : 0,
      sizeBytes: fileStat.size,
      lastModified: fileStat.mtimeMs,
      latestDate: latestDate ? String(latestDate) : null,
      absolutePath: entry.absolutePath,
      indexPath: await findEnSearchIndex(entry.absolutePath, fileStat),
    });
  }

  enCatalog = catalog.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  enCatalogLoadedAt = Date.now();
  return enCatalog;
}

async function collectEnDatabaseFiles(root, directory, output) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectEnDatabaseFiles(root, absolutePath, output);
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".db3") &&
      !entry.name.toLowerCase().includes(".tmp.")
    ) {
      output.push({
        absolutePath,
        relativePath: relative(root, absolutePath).replace(/\\/g, "/"),
      });
    }
  }
}

async function findEnDatabase(hostedPath) {
  const cached = enCatalog?.find((database) => database.hostedPath === hostedPath);
  if (cached) return cached;
  const catalog = await getEnCatalog();
  return catalog.find((database) => database.hostedPath === hostedPath) || null;
}

async function findEnSearchIndex(databasePath, databaseStat) {
  const direct = databasePath.replace(/\.db3$/i, ".ecsi");
  const directStat = await stat(direct).catch(() => null);
  if (directStat?.isFile() && directStat.mtimeMs >= databaseStat.mtimeMs) return direct;

  const rootDatabase = join(enDatabaseRoots[0], basename(databasePath));
  const rootIndex = rootDatabase.replace(/\.db3$/i, ".ecsi");
  const [rootDatabaseStat, rootIndexStat] = await Promise.all([
    stat(rootDatabase).catch(() => null),
    stat(rootIndex).catch(() => null),
  ]);
  if (
    rootDatabaseStat?.isFile() &&
    rootDatabaseStat.size === databaseStat.size &&
    rootIndexStat?.isFile() &&
    rootIndexStat.mtimeMs >= rootDatabaseStat.mtimeMs
  ) {
    return rootIndex;
  }
  return null;
}

async function findOutpostCollection(hostedPath) {
  const cached = outpostCatalog?.find((collection) => collection.hostedPath === hostedPath);
  if (cached) return cached;
  const catalog = await getOutpostCatalog();
  return catalog.find((collection) => collection.hostedPath === hostedPath) || null;
}

function openOutpostDatabase() {
  const database = new DatabaseSync(outpostDatabase, { readOnly: true });
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA query_only = ON");
  return database;
}

async function getActiveAppState() {
  const pointerStat = await stat(activeAppPath).catch(() => null);
  if (!pointerStat?.isFile()) {
    if (activeAppCache?.legacy) return activeAppCache;
    const deployment = await readJsonFile(join(siteRoot, "app-version.json"));
    activeAppCache = { root: siteRoot, deployment, legacy: true };
    return activeAppCache;
  }

  if (
    activeAppCache &&
    !activeAppCache.legacy &&
    activeAppCache.pointerMtimeMs === pointerStat.mtimeMs &&
    activeAppCache.pointerSize === pointerStat.size
  ) {
    return activeAppCache;
  }

  const pointer = await readJsonFile(activeAppPath);
  const releaseId = String(pointer?.releaseId || "");
  if (!releaseId || releaseId.includes("/") || releaseId.includes("\\")) {
    throw new Error("The active phone app release pointer is invalid.");
  }
  const releaseRoot = resolve(appReleasesRoot, releaseId);
  if (!isInside(releaseRoot, appReleasesRoot)) {
    throw new Error("The active phone app release escapes the release directory.");
  }
  const [indexStat, deployment] = await Promise.all([
    stat(join(releaseRoot, "index.html")).catch(() => null),
    readJsonFile(join(releaseRoot, "app-version.json")),
  ]);
  if (!indexStat?.isFile() || !deployment?.sourceCommit) {
    throw new Error(`The active phone app release ${releaseId} is incomplete.`);
  }
  if (
    pointer.sourceCommit !== deployment.sourceCommit ||
    pointer.appShellSha256 !== deployment.appShellSha256
  ) {
    throw new Error(`The active phone app release ${releaseId} failed its identity check.`);
  }

  activeAppCache = {
    root: releaseRoot,
    deployment,
    legacy: false,
    pointerMtimeMs: pointerStat.mtimeMs,
    pointerSize: pointerStat.size,
  };
  return activeAppCache;
}

function getChessBookDatabase() {
  if (!chessBookDatabase) {
    chessBookDatabase = new DatabaseSync(chessBookCorpusPath, { readOnly: true });
  }
  return chessBookDatabase;
}

async function writeChessCoachHealth(response) {
  const corpusStat = await stat(chessBookCorpusPath).catch(() => null);
  const [commandStat, agyCommandStat] = await Promise.all([
    stat(coachCommandPath).catch(() => null),
    stat(agyCommandPath).catch(() => null),
  ]);
  const openaiInstalled = Boolean(commandStat?.isFile());
  const geminiInstalled = Boolean(agyCommandStat?.isFile());
  const [authentication, agyAuthentication] = await Promise.all([
    openaiInstalled ? getCoachModelAuthentication() : { status: "unavailable" },
    geminiInstalled ? getAgyModelAuthentication() : { status: "unavailable" },
  ]);
  const usageLimit = getActiveCoachUsageLimit();
  const openaiAvailable =
    openaiInstalled && authentication.status === "authenticated" && !usageLimit;
  const geminiAvailable = geminiInstalled && agyAuthentication.status === "authenticated";
  const modelInstalled = openaiInstalled || geminiInstalled;
  const modelAvailable = openaiAvailable || geminiAvailable;
  const modelAvailability = usageLimit
    ? openaiAvailable || geminiAvailable
      ? "available"
      : "usage-limited"
    : modelAvailable
      ? "available"
      : "unavailable";
  const modelMessage = usageLimit
    ? publicChessCoachFailure({
        code: "MODEL_USAGE_LIMIT",
        retryLabel: usageLimit.retryLabel,
      }).error
    : undefined;
  const providers = {
    openai: {
      installed: openaiInstalled,
      available: openaiAvailable,
      status: authentication.status,
      availability: usageLimit ? "usage-limited" : openaiAvailable ? "available" : "unavailable",
      ...(modelMessage ? { message: modelMessage } : {}),
    },
    gemini: {
      installed: geminiInstalled,
      available: geminiAvailable,
      status: agyAuthentication.status,
      availability: geminiAvailable ? "available" : "unavailable",
      ...(!geminiInstalled
        ? { message: "The PC needs the Antigravity CLI installed for Gemini models." }
        : agyAuthentication.status === "signed-out"
          ? { message: "Antigravity needs its one-time Google sign-in." }
          : agyAuthentication.status === "unavailable"
            ? { message: "The PC could not verify the Antigravity sign-in." }
            : {}),
    },
  };
  const modelOptions = COACH_MODEL_OPTIONS.map(
    ({ provider, model, label, reasoningEfforts, defaultReasoningEffort }) => ({
      provider,
      model,
      label,
      reasoningEfforts,
      defaultReasoningEffort,
    }),
  );
  let bookCount = 0;
  let chunkCount = 0;
  if (corpusStat?.isFile()) {
    try {
      const database = getChessBookDatabase();
      bookCount = Number(database.prepare("SELECT COUNT(*) AS count FROM books").get()?.count) || 0;
      chunkCount =
        Number(database.prepare("SELECT COUNT(*) AS count FROM chunks").get()?.count) || 0;
    } catch (error) {
      await appendLog(`chess coach corpus health failed: ${error?.stack || error}`);
      return writeJson(response, 503, {
        ok: false,
        corpusAvailable: false,
        modelInstalled,
        modelAvailable,
        modelStatus: authentication.status,
        modelAvailability,
        ...(modelMessage ? { modelMessage } : {}),
        model: coachModel,
        providers,
        modelOptions,
        error: "The chess-book corpus could not be opened.",
      });
    }
  }
  return writeJson(response, 200, {
    ok: Boolean(corpusStat?.isFile() && modelAvailable),
    corpusAvailable: Boolean(corpusStat?.isFile()),
    modelInstalled,
    modelAvailable,
    modelStatus: authentication.status,
    modelAvailability,
    ...(modelMessage ? { modelMessage } : {}),
    model: coachModel,
    providers,
    modelOptions,
    bookCount,
    chunkCount,
  });
}

function writeChessCoachProgress(requestUrl, response) {
  const requestId = String(requestUrl.searchParams.get("requestId") || "").trim();
  if (!/^[a-z0-9_-]{8,100}$/i.test(requestId)) {
    return writeJson(response, 400, { error: "A valid coach request id is required." });
  }
  const progress = phoneCoachProgress.get(requestId);
  if (!progress) {
    return writeJson(response, 404, { error: "Coach review progress was not found." });
  }
  return writeJson(response, 200, progress);
}

function updatePhoneCoachProgress(requestId, phase, label, completed = 0, total = 0) {
  if (!requestId) return;
  phoneCoachProgress.set(requestId, {
    requestId,
    phase,
    label,
    completed: Math.max(0, Number(completed) || 0),
    total: Math.max(0, Number(total) || 0),
    updatedAt: new Date().toISOString(),
  });
  if (["complete", "error", "cancelled"].includes(phase)) {
    clearTimeout(phoneCoachProgressExpiry.get(requestId));
    const expiry = setTimeout(
      () => {
        phoneCoachProgress.delete(requestId);
        phoneCoachProgressExpiry.delete(requestId);
      },
      15 * 60 * 1000,
    );
    expiry.unref?.();
    phoneCoachProgressExpiry.set(requestId, expiry);
  }
}

async function writeChessBookSearch(requestUrl, response) {
  const query = String(requestUrl.searchParams.get("q") || "")
    .trim()
    .slice(0, 500);
  if (!query) return writeJson(response, 400, { error: "A search query is required." });
  if (!(await stat(chessBookCorpusPath).catch(() => null))) {
    return writeJson(response, 503, { error: "Chess-book corpus is unavailable." });
  }
  const passages = publicBookPassages(
    searchChessBookCorpus(getChessBookDatabase(), {
      question: query,
      scope: requestUrl.searchParams.get("scope") === "position" ? "position" : "whole-game",
      moves: [],
    }),
  );
  return writeJson(response, 200, { query, passages });
}

async function serveChessBookPdf(requestUrl, request, response, headOnly) {
  const bookId = String(requestUrl.searchParams.get("bookId") || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/i.test(bookId)) {
    return writeJson(response, 400, { error: "A valid book id is required." });
  }
  if (!(await stat(chessBookCorpusPath).catch(() => null))) {
    return writeJson(response, 503, { error: "Chess-book corpus is unavailable." });
  }
  const row = getChessBookDatabase()
    .prepare("SELECT local_path FROM books WHERE book_id = ?")
    .get(bookId);
  const filePath = resolve(String(row?.local_path || ""));
  if (!row?.local_path || !isInside(filePath, chessBookLibraryRoot)) {
    return writeJson(response, 404, { error: "Book PDF not found." });
  }
  return serveFilePath(filePath, request, response, headOnly, "private, max-age=300");
}

async function writeChessCoachResponse(request, response) {
  const payload = await readNormalizedChessCoachRequest(request, response);
  if (!payload) return;
  const corpusStat = await stat(chessBookCorpusPath).catch(() => null);
  if (!corpusStat?.isFile()) {
    return writeJson(response, 503, {
      code: "CORPUS_UNAVAILABLE",
      error: "The PC chess-book corpus is unavailable.",
    });
  }
  const job = startPhoneCoachJob(payload);
  try {
    const result = await job.promise;
    return writeJsonIfConnected(response, 200, result);
  } catch (error) {
    const publicFailure = publicChessCoachFailure(error);
    return writeJsonIfConnected(response, publicFailure.status, {
      code: publicFailure.code,
      error: publicFailure.error,
    });
  }
}

function startPhoneCoachJob(payload) {
  const existing = phoneCoachJobs.get(payload.requestId);
  if (existing) return existing;

  const controller = new AbortController();
  const reviewRecordKey = payload.persistence
    ? getCoachReviewRecordKey(payload.persistence.storageKey)
    : null;
  updatePhoneCoachProgress(payload.requestId, "queued", "Waiting for the PC coach", 0, 0);
  const queued = phoneCoachQueue
    .catch(() => {})
    .then(async () => {
      try {
        const result = await runPhoneCoachReview(payload, controller.signal);
        if (payload.persistence) {
          const review = normalizeSavedWebCoachReview({
            version: 1,
            contextKey: payload.persistence.contextKey,
            lineContextKey: payload.persistence.lineContextKey,
            scope: payload.scope,
            playerColor: payload.playerColor,
            question: payload.question,
            response: result,
            savedAt: Date.now(),
          });
          if (!review) throw new Error("The completed coach review could not be persisted.");
          await saveCoachReviewRecord(payload.persistence.storageKey, review);
        }
        updatePhoneCoachProgress(payload.requestId, "complete", "Review saved on the PC", 1, 1);
        return result;
      } catch (error) {
        updatePhoneCoachProgress(payload.requestId, "error", "Review failed", 0, 0);
        await appendLog(`phone coach failed: ${error?.stack || error}`);
        throw error;
      }
    });
  const job = {
    requestId: payload.requestId,
    reviewRecordKey,
    controller,
    promise: queued,
  };
  phoneCoachQueue = queued.catch(() => {});
  phoneCoachJobs.set(payload.requestId, job);
  if (reviewRecordKey) {
    const jobs = phoneCoachJobsByReviewKey.get(reviewRecordKey) ?? new Set();
    jobs.add(job);
    phoneCoachJobsByReviewKey.set(reviewRecordKey, jobs);
  }
  void queued
    .finally(() => {
      if (phoneCoachJobs.get(payload.requestId) === job) {
        phoneCoachJobs.delete(payload.requestId);
      }
      if (reviewRecordKey) {
        const jobs = phoneCoachJobsByReviewKey.get(reviewRecordKey);
        jobs?.delete(job);
        if (!jobs?.size) phoneCoachJobsByReviewKey.delete(reviewRecordKey);
      }
    })
    .catch(() => {});
  return job;
}

async function readNormalizedChessCoachRequest(request, response) {
  try {
    return normalizeChessCoachRequestPayload(await readJsonBody(request, maxCoachRequestBytes));
  } catch (error) {
    const message = error?.message || "Invalid coach request.";
    const status = /too large/i.test(message) ? 413 : 400;
    writeJson(response, status, { code: "INVALID_COACH_REQUEST", error: message });
    return null;
  }
}

async function writeChessCoachAnalysisResponse(request, response) {
  const payload = await readNormalizedChessCoachRequest(request, response);
  if (!payload) return;
  const controller = new AbortController();
  const abortAnalysis = () => controller.abort();
  request.once("aborted", abortAnalysis);
  response.once("close", () => {
    if (!response.writableEnded) abortAnalysis();
  });
  updatePhoneCoachProgress(payload.requestId, "queued", "Waiting for PC analysis", 0, 0);
  try {
    const queued = phoneCoachQueue
      .catch(() => {})
      .then(() => runPcCoachGameAnalysis(payload, controller.signal));
    phoneCoachQueue = queued.catch(() => {});
    const result = await queued;
    updatePhoneCoachProgress(payload.requestId, "complete", "PC analysis ready", 1, 1);
    if (controller.signal.aborted) return;
    return writeJson(response, 200, {
      requestId: payload.requestId,
      playerColor: payload.playerColor,
      scope: payload.scope,
      moveAnalysis: result.moveAnalysis,
      criticalMoments: result.criticalMoments,
      analysisCoverage: result.analysisCoverage,
      storedEvaluationsUsed: result.analysisCoverage.cloudHits,
      derived: publicDerivedEvidence(result.derived),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      updatePhoneCoachProgress(payload.requestId, "cancelled", "PC analysis cancelled", 0, 0);
      return;
    }
    updatePhoneCoachProgress(payload.requestId, "error", "PC analysis failed", 0, 0);
    await appendLog(`coach analysis failed: ${error?.stack || error}`);
    const publicFailure = publicChessCoachFailure(error, { analysisOnly: true });
    return writeJson(response, publicFailure.status, {
      code: publicFailure.code,
      error: publicFailure.error,
    });
  } finally {
    request.off("aborted", abortAnalysis);
  }
}

async function writeStatsAiReportResponse(request, response) {
  let payload;
  try {
    payload = normalizeStatsReportRequestPayload(await readJsonBody(request, maxCoachRequestBytes));
  } catch (error) {
    const message = error?.message || "Invalid stats-report request.";
    const status = /too large/i.test(message) ? 413 : 400;
    return writeJson(response, status, { code: "INVALID_STATS_REPORT_REQUEST", error: message });
  }
  const controller = new AbortController();
  const abortReport = () => controller.abort();
  request.once("aborted", abortReport);
  response.once("close", () => {
    if (!response.writableEnded) abortReport();
  });
  updatePhoneCoachProgress(payload.requestId, "queued", "Waiting for the PC coach", 0, 0);
  try {
    const queued = phoneCoachQueue
      .catch(() => {})
      .then(() => runStatsAiReport(payload, controller.signal));
    phoneCoachQueue = queued.catch(() => {});
    const report = await queued;
    updatePhoneCoachProgress(payload.requestId, "complete", "Stats report ready", 1, 1);
    if (controller.signal.aborted) return;
    return writeJson(response, 200, {
      requestId: payload.requestId,
      model: coachModel,
      report,
      generatedAt: Date.now(),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      updatePhoneCoachProgress(payload.requestId, "cancelled", "Stats report cancelled", 0, 0);
      return;
    }
    updatePhoneCoachProgress(payload.requestId, "error", "Stats report failed", 0, 0);
    await appendLog(`stats report failed: ${error?.stack || error}`);
    const publicFailure = publicChessCoachFailure(error);
    return writeJson(response, publicFailure.status, {
      code: publicFailure.code,
      error: publicFailure.error,
    });
  } finally {
    request.off("aborted", abortReport);
  }
}

async function runStatsAiReport(payload, signal) {
  throwIfAborted(signal);
  updatePhoneCoachProgress(
    payload.requestId,
    "answer-writing",
    "Writing the stats coaching report",
    0,
    0,
  );
  const raw = await runPhoneCoachModel(buildStatsReportPrompt(payload), {
    outputSchemaPath: statsReportSchemaPath,
    signal,
    timeoutMs: 240000,
  });
  return normalizeStatsReport(raw);
}

async function runPcCoachGameAnalysis(payload, signal) {
  throwIfAborted(signal);
  const requestedPositions = buildCoachPositionRecords(payload);
  if (requestedPositions.length === 0) {
    const error = new Error("No valid chess positions were supplied for PC analysis.");
    error.code = "PC_ANALYSIS_FAILED";
    throw error;
  }

  updatePhoneCoachProgress(
    payload.requestId,
    "cloud-evaluations",
    payload.scope === "whole-game"
      ? "Checking the opening cache until its first gap"
      : "Checking the current position cache",
    0,
    requestedPositions.length,
  );
  let sweep;
  try {
    sweep = await collectPcCoachPositionEvaluations({
      positions: requestedPositions,
      queryCloud: queryStoredCoachEvaluation,
      queryLive: queryLiveCoachEvaluation,
      signal,
      liveAttempts: 1,
      stopAfterFirstCloudMiss: payload.scope === "whole-game",
      allowLiveFailure: payload.scope === "whole-game",
      onProgress: ({ phase, completed, total }) => {
        const live = phase === "live";
        updatePhoneCoachProgress(
          payload.requestId,
          live ? "live-evaluations" : "cloud-evaluations",
          live
            ? `Analyzing the opening boundary on the PC (${completed}/${total})`
            : payload.scope === "whole-game"
              ? `Checking the opening cache (${completed} position${completed === 1 ? "" : "s"})`
              : `Checking the current position cache (${completed}/${total})`,
          completed,
          total,
        );
      },
    });
  } catch (error) {
    if (!signal.aborted) error.code = "PC_ANALYSIS_FAILED";
    throw error;
  }
  const {
    evaluations,
    evaluatedPositions,
    cloudHits,
    liveAnalyses,
    liveFailures,
    skippedPositions,
    stoppedAtCloudBoundary,
    boundaryPly,
  } = sweep;
  if (evaluations.size === 0) {
    const error = new Error("The PC could not produce a usable opening-boundary evaluation.");
    error.code = "PC_ANALYSIS_FAILED";
    throw error;
  }
  if (liveFailures > 0) {
    await appendLog(
      `coach opening-boundary live evaluation was skipped after at most ${coachBoundaryTimeoutMs} ms; continuing with ${cloudHits} cached position(s)`,
    );
  }
  const result = buildPcCoachAnalysisResult({
    ...payload,
    positions: evaluatedPositions,
    evaluations,
    cloudHits,
    liveAnalyses,
    liveDepth: coachSweepDepth,
    totalPositions: payload.scope === "position" ? 1 : Math.max(1, payload.moves.length + 1),
    skippedPositions,
    stoppedAtCloudBoundary,
    boundaryPly,
    openingBook: getOpeningIdentificationBook(join(repoRoot, "src-tauri", "data")),
  });
  if (result.analysisCoverage.failed > 0) {
    const error = new Error(
      `PC analysis was incomplete (${result.analysisCoverage.failed} unique position(s) missing).`,
    );
    error.code = "PC_ANALYSIS_FAILED";
    throw error;
  }
  if (payload.scope === "whole-game" && result.moveAnalysis.length === 0) {
    const error = new Error(
      "The cached opening prefix did not contain one fully verified move, and its boundary evaluation was unavailable.",
    );
    error.code = "PC_ANALYSIS_FAILED";
    throw error;
  }
  return result;
}

const qualitativeCoachSelection = Object.freeze({
  provider: "gemini",
  model: "gemini-3.1-pro",
  reasoningEffort: "high",
});
const categorySpecialistSelection = Object.freeze({
  provider: "gemini",
  model: "gemini-3.6-flash",
  reasoningEffort: "high",
});

async function runPhoneCoachCategorySpecialists({
  payload,
  libraryPlan,
  qualitativePass,
  bookPassages,
  categoryPassageIds,
  moveAnalysis,
  derivedEvidence,
  signal,
}) {
  const passageById = new Map(bookPassages.map((passage) => [passage.chunkId, passage]));
  let completed = 0;
  updatePhoneCoachProgress(
    payload.requestId,
    "specialist-writing",
    `Gemini 3.6 Flash specialists drafting 0/${libraryPlan.categories.length} sections`,
    0,
    libraryPlan.categories.length,
  );
  const settled = await Promise.allSettled(
    libraryPlan.categories.map(async (category) => {
      const permittedChunkIds = categoryPassageIds[category.id] || [];
      const passages = permittedChunkIds.flatMap((chunkId) => {
        const passage = passageById.get(chunkId);
        return passage ? [passage] : [];
      });
      try {
        const rawDraft = await runPhoneCoachModel(
          buildCategorySpecialistPrompt({
            ...payload,
            category,
            qualitativePass,
            passages,
            moveAnalysis,
            derivedEvidence,
          }),
          {
            outputSchemaPath: coachCategoryDraftSchemaPath,
            modelSelection: categorySpecialistSelection,
            signal,
            timeoutMs: 190000,
          },
        );
        return normalizeCategorySpecialistDraft(rawDraft, {
          category,
          permittedChunkIds,
          moves: payload.moves,
        });
      } finally {
        completed += 1;
        updatePhoneCoachProgress(
          payload.requestId,
          "specialist-writing",
          `Gemini 3.6 Flash specialists drafting ${completed}/${libraryPlan.categories.length} sections`,
          completed,
          libraryPlan.categories.length,
        );
      }
    }),
  );
  const drafts = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failures = settled.filter((result) => result.status === "rejected");
  for (const failure of failures) {
    await appendLog(`coach category specialist failed: ${failure.reason?.stack || failure.reason}`);
  }
  if (drafts.length === 0) {
    const error = new Error("The Gemini category specialists could not produce a usable draft.");
    error.code = "MODEL_UNAVAILABLE";
    error.provider = "gemini";
    throw error;
  }
  return { drafts, failureCount: failures.length };
}

async function runPhoneCoachReview(payload, signal) {
  throwIfAborted(signal);
  const database = getChessBookDatabase();
  let qualitativePass = null;
  if (payload.scope === "whole-game") {
    updatePhoneCoachProgress(
      payload.requestId,
      "qualitative-pass",
      "Gemini 3.1 Pro reading the PGN without an engine",
      0,
      0,
    );
    const rawQualitativePass = await runPhoneCoachModel(buildGeminiQualitativePassPrompt(payload), {
      outputSchemaPath: coachQualitativePassSchemaPath,
      modelSelection: qualitativeCoachSelection,
      signal,
      timeoutMs: 240000,
    });
    qualitativePass = normalizeGeminiQualitativePass(rawQualitativePass, payload.moves);
  }
  const pcAnalysis = await runPcCoachGameAnalysis(payload, signal);
  const { moveAnalysis, criticalMoments, analysisCoverage } = pcAnalysis;
  const exactOpeningMatches = findExactOpeningBookMatches(database, payload.moves);
  const structureMatches = findPawnStructureBookMatches(database, payload.moves, {
    currentFen: payload.currentFen,
  });

  const inventory = getChessBookLibraryInventory(database);
  updatePhoneCoachProgress(
    payload.requestId,
    "library-planning",
    "AI choosing the relevant books and chapters",
    0,
    0,
  );
  const rawPlan = await runPhoneCoachModel(
    buildLibraryPlannerPrompt({
      ...payload,
      moveAnalysis,
      inventory,
      exactOpeningMatches,
      structureMatches,
      derivedEvidence: pcAnalysis.derived,
      qualitativePass,
    }),
    {
      outputSchemaPath: coachLibraryPlanSchemaPath,
      modelSelection: payload,
      signal,
      timeoutMs: 190000,
    },
  );
  const libraryPlan = normalizeLibraryPlan(rawPlan, inventory, payload.moves);

  updatePhoneCoachProgress(
    payload.requestId,
    "passage-retrieval",
    "Opening the AI-selected chapters",
    0,
    0,
  );
  const { passages: bookPassages, categoryPassageIds } = retrievePlannedBookPassages(
    database,
    libraryPlan,
    { exactOpeningMatches, structureMatches },
  );
  if (bookPassages.length === 0) {
    throw new Error("The AI-selected chapters did not contain any accessible source passages.");
  }

  const specialistResult =
    payload.scope === "whole-game"
      ? await runPhoneCoachCategorySpecialists({
          payload,
          libraryPlan,
          qualitativePass,
          bookPassages,
          categoryPassageIds,
          moveAnalysis,
          derivedEvidence: pcAnalysis.derived,
          signal,
        })
      : { drafts: [], failureCount: 0 };

  updatePhoneCoachProgress(payload.requestId, "answer-writing", "Building the coaching tabs", 0, 0);
  const finalPrompt = buildStructuredPhoneCoachPrompt({
    ...payload,
    moveAnalysis,
    analysisCoverage,
    libraryPlan,
    bookPassages,
    categoryPassageIds,
    derivedEvidence: pcAnalysis.derived,
    exactOpeningMatches,
    structureMatches,
    qualitativePass,
    specialistDrafts: specialistResult.drafts,
  });
  let rawReview = await runPhoneCoachModel(finalPrompt, {
    outputSchemaPath: coachReviewSchemaPath,
    modelSelection: payload,
    signal,
    timeoutMs: 240000,
  });
  let review;
  for (let repairAttempt = 0; repairAttempt <= 2; repairAttempt += 1) {
    try {
      review = normalizeStructuredCoachReview(rawReview, {
        libraryPlan,
        bookPassages,
        moves: payload.moves,
        currentFen: payload.currentFen,
        categoryPassageIds,
      });
      break;
    } catch (validationError) {
      if (repairAttempt >= 2) throw validationError;
      const rejectedResponse =
        typeof rawReview === "string" ? rawReview : JSON.stringify(rawReview, null, 2);
      updatePhoneCoachProgress(
        payload.requestId,
        "move-verification",
        `Gemini 3.6 Flash repairing board links (${repairAttempt + 1}/2)`,
        repairAttempt,
        2,
      );
      rawReview = await runPhoneCoachModel(
        `${finalPrompt}

MOVE-VERIFICATION REPAIR:
The previous structured response was rejected for every reason listed here:
${validationError?.message || validationError}

Previous rejected structured response:
${rejectedResponse}

Return the complete corrected response. Preserve its sound prose and citations, but repair every listed numbered game reference and verifiedLines entry. Do not mention a numbered move outside Allowed game moves. A verifiedLines sequence must be legal when replayed from the exact position after startPly.`,
        {
          outputSchemaPath: coachReviewSchemaPath,
          modelSelection: categorySpecialistSelection,
          signal,
          timeoutMs: 190000,
        },
      );
    }
  }
  if (!review) {
    throw new Error("The move-verification pass did not return a usable coach review.");
  }
  return {
    answer: structuredCoachReviewToMarkdown(review, bookPassages),
    overview: review.overview,
    categories: review.categories,
    priorities: review.priorities,
    model: payload.model,
    reasoningEffort: payload.reasoningEffort,
    playerColor: payload.playerColor,
    criticalMoments,
    bookPassages: publicBookPassages(bookPassages),
    storedEvaluationsUsed: analysisCoverage.cloudHits,
    analysisCoverage,
    coachTeam: {
      qualitativeModel: qualitativePass ? qualitativeCoachSelection.model : null,
      specialistModel:
        specialistResult.drafts.length > 0 ? categorySpecialistSelection.model : null,
      specialistCount: specialistResult.drafts.length,
      specialistFailures: specialistResult.failureCount,
      finalModel: payload.model,
      moveVerification: "chessops",
    },
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("The coach review was cancelled.");
  error.name = "AbortError";
  throw error;
}

function createLinkedAbortController(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
    },
  };
}

async function queryStoredCoachEvaluation(fen, signal) {
  const linked = createLinkedAbortController(signal, 2000);
  const url = new URL("/v1/cloud-eval", stockfishBackendUrl);
  url.searchParams.set("fen", fen);
  url.searchParams.set("multipv", "1");
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: linked.signal,
    });
    if (!response.ok) return null;
    return normalizeCloudCoachEvaluation(await response.json(), fen);
  } catch {
    if (signal?.aborted) throwIfAborted(signal);
    return null;
  } finally {
    linked.cleanup();
  }
}

async function queryLiveCoachEvaluation(fen, signal) {
  const linked = createLinkedAbortController(signal, coachBoundaryTimeoutMs);
  try {
    const url = new URL("/v1/analyze", stockfishBackendUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/x-ndjson", "content-type": "application/json" },
      body: JSON.stringify({ fen, multipv: 1, depth: coachSweepDepth, infinite: false }),
      signal: linked.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Stockfish analysis returned HTTP ${response.status}.`);
    }
    const decoder = new TextDecoder();
    let pending = "";
    let best = null;
    let finished = false;
    let bestmove = "";
    const consumeLine = (line) => {
      if (!line.trim()) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.type === "error") {
        throw new Error(String(message.message || "Stockfish analysis failed."));
      }
      if (message.type === "done") {
        finished = true;
        bestmove = String(message.bestmove || "");
        return;
      }
      if (message.type !== "uci") return;
      const candidate = parseStockfishCoachInfo(message.line, fen);
      if (candidate && (!best || candidate.depth >= best.depth)) best = candidate;
    };
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) consumeLine(line);
    }
    pending += decoder.decode();
    if (pending.trim()) consumeLine(pending);
    if (best) return best;
    if (finished && /^(?:\(none\)|0000)?$/i.test(bestmove)) {
      return {
        fen,
        source: "pc-live",
        depth: 0,
        nodes: 0,
        nps: null,
        whiteCp: null,
        whiteMate: null,
        pvUci: [],
        terminal: true,
      };
    }
    throw new Error("Stockfish completed without an evaluation.");
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    throw error;
  } finally {
    linked.cleanup();
  }
}

async function runPhoneCoachModel(
  prompt,
  {
    outputSchemaPath = "",
    modelSelection = DEFAULT_COACH_MODEL_SELECTION,
    signal = null,
    timeoutMs = 190000,
  } = {},
) {
  throwIfAborted(signal);
  const selection = {
    provider: modelSelection.provider || DEFAULT_COACH_MODEL_SELECTION.provider,
    model: modelSelection.model || DEFAULT_COACH_MODEL_SELECTION.model,
    reasoningEffort:
      modelSelection.reasoningEffort || DEFAULT_COACH_MODEL_SELECTION.reasoningEffort,
  };
  const isGemini = selection.provider === "gemini";
  const commandPath = isGemini ? agyCommandPath : coachCommandPath;
  const providerLabel = isGemini ? "Antigravity" : "OpenAI Codex";
  const commandStat = await stat(commandPath).catch(() => null);
  if (!commandStat?.isFile()) {
    const error = new Error(
      isGemini
        ? "The PC coach needs the Antigravity CLI installed for Gemini models."
        : "The PC coach needs the OpenAI Codex app or CLI installed.",
    );
    error.code = "MODEL_UNAVAILABLE";
    error.provider = selection.provider;
    throw error;
  }
  const authentication = isGemini
    ? await getAgyModelAuthentication()
    : await getCoachModelAuthentication();
  if (authentication.status === "signed-out") {
    const error = new Error(
      isGemini
        ? "Antigravity is installed but not signed in. Open Antigravity once and sign in."
        : "OpenAI Codex is installed but not signed in. Run `codex login` on the PC.",
    );
    error.code = "MODEL_UNAVAILABLE";
    error.provider = selection.provider;
    throw error;
  }
  if (authentication.status !== "authenticated") {
    const error = new Error(
      `The PC could not verify the ${providerLabel} sign-in. Please try Check PC again.`,
    );
    error.code = "MODEL_UNAVAILABLE";
    error.provider = selection.provider;
    throw error;
  }
  if (!isGemini) {
    const activeUsageLimit = getActiveCoachUsageLimit();
    if (activeUsageLimit) throw makeCoachUsageLimitError(activeUsageLimit);
  }
  throwIfAborted(signal);

  let agySchemaPath = "";
  let unwrapAgyAnswer = false;
  let invocation;
  if (isGemini) {
    const baseSchema = outputSchemaPath
      ? JSON.parse(await readFile(outputSchemaPath, "utf8"))
      : null;
    const promptSchema = buildAgyPromptSchema(prompt, baseSchema);
    unwrapAgyAnswer = promptSchema.unwrapAnswer;
    agySchemaPath = join(coachWorkRoot, `agy-coach-${randomUUID()}.schema.json`);
    await writeFile(agySchemaPath, JSON.stringify(promptSchema.schema));
    invocation = buildAgyCoachInvocation({
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      outputSchemaPath: agySchemaPath,
      timeoutMs,
    });
  } else {
    invocation = buildCodexCoachInvocation(prompt, {
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      outputSchemaPath,
    });
  }

  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(commandPath, invocation.args, {
        cwd: coachWorkRoot,
        env: coachProcessEnv,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let stdinFailure = null;
      let closeModelInput = () => {};
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", abortModel);
        callback(value);
      };
      const abortModel = () => {
        closeModelInput();
        child.kill();
        const error = new Error("The coach review was cancelled.");
        error.name = "AbortError";
        finish(rejectPromise, error);
      };
      const timeoutId = setTimeout(() => {
        closeModelInput();
        child.kill();
        finish(
          rejectPromise,
          new Error(`The PC coach model timed out after ${Math.round(timeoutMs / 1000)} seconds.`),
        );
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.length > 4 * 1024 * 1024) child.kill();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.length > 1024 * 1024) child.kill();
      });
      child.once("error", (error) => {
        closeModelInput();
        finish(rejectPromise, error);
      });
      child.once("exit", (code) => {
        const combinedOutput = `${stdout}\n${stderr}`;
        const signedOut = isGemini
          ? code !== 0 &&
            /not logged|not signed|authenticate|authentication|oauth/i.test(combinedOutput)
          : codexExitIndicatesSignedOut(code, stderr);
        if (signedOut) {
          const nextAuthentication = {
            checkedAt: Date.now(),
            status: "signed-out",
            detail: stderr.replace(/\s+/g, " ").trim().slice(0, 1000),
          };
          if (isGemini) agyAuthenticationCache = nextAuthentication;
          else coachAuthenticationCache = nextAuthentication;
          const error = new Error(
            isGemini
              ? "Antigravity is installed but not signed in. Open Antigravity once and sign in."
              : "OpenAI Codex is installed but not signed in. Run `codex login` on the PC.",
          );
          error.code = "MODEL_UNAVAILABLE";
          error.provider = selection.provider;
          return finish(rejectPromise, error);
        }
        const usageLimit =
          isGemini || code === 0 ? null : codexUsageLimitFromOutput(combinedOutput);
        if (usageLimit) {
          coachUsageLimitCache = {
            detectedAt: Date.now(),
            expiresAt: Date.now() + 5 * 60_000,
            retryLabel: usageLimit.retryLabel,
          };
          return finish(rejectPromise, makeCoachUsageLimitError(coachUsageLimitCache));
        }
        if (code !== 0) {
          return finish(
            rejectPromise,
            new Error(
              `The PC coach model exited with code ${code}: ${stderr.slice(-1200)}${stdinFailure ? ` (stdin: ${stdinFailure.message})` : ""}`,
            ),
          );
        }
        let answer;
        try {
          answer = isGemini
            ? parseAgyCoachOutput(stdout, { unwrapAnswer: unwrapAgyAnswer })
            : stdout
                .split(/\r?\n/)
                .filter((line) => !line.trim().startsWith("Warning: 256-color support"))
                .join("\n")
                .trim();
        } catch (error) {
          return finish(rejectPromise, error);
        }
        if (!answer)
          return finish(rejectPromise, new Error("The PC coach returned an empty answer."));
        if (!isGemini) coachUsageLimitCache = null;
        finish(resolvePromise, answer);
      });
      const handleStdinFailure = (error) => {
        stdinFailure = error;
        if (settled || /^(?:EPIPE|EOF|ERR_STREAM_DESTROYED)$/i.test(String(error?.code || ""))) {
          return;
        }
        child.kill();
        finish(
          rejectPromise,
          new Error(`The PC coach model could not receive its prompt: ${error?.message || error}`),
        );
      };
      signal?.addEventListener("abort", abortModel, { once: true });
      if (signal?.aborted) {
        abortModel();
      } else {
        closeModelInput = writeProcessStdinSafely(
          child.stdin,
          invocation.stdin,
          handleStdinFailure,
        );
      }
    });
  } finally {
    if (agySchemaPath) await rm(agySchemaPath, { force: true }).catch(() => {});
  }
}

function getActiveCoachUsageLimit() {
  if (!coachUsageLimitCache) return null;
  if (coachUsageLimitCache.expiresAt <= Date.now()) {
    coachUsageLimitCache = null;
    return null;
  }
  return coachUsageLimitCache;
}

function makeCoachUsageLimitError(usageLimit) {
  const error = new Error("OpenAI Codex has reached its usage limit.");
  error.code = "MODEL_USAGE_LIMIT";
  error.retryLabel = usageLimit?.retryLabel || null;
  return error;
}

async function getCoachModelAuthentication() {
  const now = Date.now();
  const cacheLifetime = coachAuthenticationCache.status === "unavailable" ? 5000 : 30000;
  if (now - coachAuthenticationCache.checkedAt < cacheLifetime) {
    return coachAuthenticationCache;
  }
  if (coachAuthenticationProbe) return coachAuthenticationProbe;

  const previous = coachAuthenticationCache;
  coachAuthenticationProbe = probeCodexAuthentication({
    spawnProcess: spawn,
    commandPath: coachCommandPath,
    cwd: coachWorkRoot,
    env: coachProcessEnv,
    timeoutMs: 15000,
  })
    .then(async (result) => {
      const authentication = preserveConfirmedCodexAuthentication(previous, result);
      coachAuthenticationCache = { ...authentication, checkedAt: Date.now() };
      if (result.status === "unavailable") {
        await appendLog(`Codex authentication probe was inconclusive: ${result.detail}`);
      }
      return coachAuthenticationCache;
    })
    .finally(() => {
      coachAuthenticationProbe = null;
    });
  return coachAuthenticationProbe;
}

async function getAgyModelAuthentication() {
  const now = Date.now();
  const cacheLifetime = agyAuthenticationCache.status === "unavailable" ? 5000 : 30000;
  if (now - agyAuthenticationCache.checkedAt < cacheLifetime) {
    return agyAuthenticationCache;
  }
  if (agyAuthenticationProbe) return agyAuthenticationProbe;

  const previous = agyAuthenticationCache;
  agyAuthenticationProbe = probeAgyAuthentication({
    spawnProcess: spawn,
    commandPath: agyCommandPath,
    cwd: coachWorkRoot,
    env: coachProcessEnv,
    timeoutMs: 25000,
  })
    .then(async (result) => {
      const authentication = preserveConfirmedCodexAuthentication(previous, result);
      agyAuthenticationCache = { ...authentication, checkedAt: Date.now() };
      if (result.status === "unavailable") {
        await appendLog(`Antigravity authentication probe was inconclusive: ${result.detail}`);
      }
      return agyAuthenticationCache;
    })
    .finally(() => {
      agyAuthenticationProbe = null;
    });
  return agyAuthenticationProbe;
}

function publicBookPassages(passages) {
  return passages.map(({ localPath: _localPath, ...passage }) => ({
    ...passage,
    sourceUrl:
      passage.sourceUrl ||
      (_localPath ? `/api/chess-books/pdf?bookId=${encodeURIComponent(passage.bookId)}` : ""),
  }));
}

async function serveFilePath(filePath, request, response, headOnly, cacheControl) {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) return writeJson(response, 404, { error: "Not found." });
  const range = parseRange(request.headers.range, fileStat.size);
  const headers = {
    "accept-ranges": "bytes",
    "cache-control": cacheControl,
    "content-type": mimeType(filePath),
    "content-disposition": `inline; filename="${basename(filePath).replace(/["\r\n]/g, "")}"`,
    "x-content-type-options": "nosniff",
  };
  if (range) {
    response.writeHead(206, {
      ...headers,
      "content-length": range.end - range.start + 1,
      "content-range": `bytes ${range.start}-${range.end}/${fileStat.size}`,
    });
    if (headOnly) return response.end();
    return createReadStream(filePath, { start: range.start, end: range.end }).pipe(response);
  }
  response.writeHead(200, { ...headers, "content-length": fileStat.size });
  if (headOnly) return response.end();
  return createReadStream(filePath).pipe(response);
}

async function serveStatic(pathname, request, response, headOnly, staticRoot) {
  let relativePath = pathname.replace(/^\/+/, "") || "index.html";
  let filePath = resolve(staticRoot, relativePath);
  if (!isInside(filePath, staticRoot)) return writeJson(response, 403, { error: "Forbidden." });

  let fileStat = await stat(filePath).catch(() => null);
  if (fileStat?.isDirectory()) {
    filePath = join(filePath, "index.html");
    fileStat = await stat(filePath).catch(() => null);
  }
  if (!fileStat?.isFile() && !extname(relativePath)) {
    filePath = join(staticRoot, "index.html");
    fileStat = await stat(filePath).catch(() => null);
  }
  if (!fileStat?.isFile()) return writeJson(response, 404, { error: "Not found." });

  const mime = mimeType(filePath);
  const fileName = basename(filePath);
  const cacheControl =
    fileName === "web-sw.js" || fileName === "app-version.json"
      ? "no-store, max-age=0"
      : fileName === "index.html" || fileName === "manifest.json"
        ? "no-cache"
        : filePath.includes(`${sep}assets${sep}`)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=60";
  const range = parseRange(request.headers.range, fileStat.size);
  const headers = {
    "accept-ranges": "bytes",
    "cache-control": cacheControl,
    "content-type": mime,
    "x-content-type-options": "nosniff",
  };

  if (range) {
    response.writeHead(206, {
      ...headers,
      "content-length": range.end - range.start + 1,
      "content-range": `bytes ${range.start}-${range.end}/${fileStat.size}`,
    });
    if (headOnly) return response.end();
    return createReadStream(filePath, { start: range.start, end: range.end }).pipe(response);
  }

  response.writeHead(200, { ...headers, "content-length": fileStat.size });
  if (headOnly) return response.end();
  return createReadStream(filePath).pipe(response);
}

function installWatchers() {
  for (const root of [documentsRoot, ...enDatabaseRoots]) {
    void watchRoot(root, false);
  }
  void watchRoot(dirname(outpostDatabase), true);
}

async function watchRoot(root, outpostOnly) {
  if (!(await stat(root).catch(() => null))) return;
  try {
    const watcher = watch(root, { recursive: true });
    for await (const event of watcher) {
      const filename = String(event.filename || "").toLowerCase();
      if (outpostOnly) {
        if (filename.includes("library.sqlite")) {
          outpostCatalogLoadedAt = 0;
        }
        continue;
      }
      if (/\.(pgn|pdf|db3|json)$/i.test(filename)) scheduleLibraryRefresh();
      if (/\.db3$/i.test(filename)) {
        enCatalogLoadedAt = 0;
      }
    }
  } catch (error) {
    await appendLog(`watch failed for ${root}: ${error}`);
  }
}

function scheduleLibraryRefresh() {
  if (libraryRefreshTimer) clearTimeout(libraryRefreshTimer);
  libraryRefreshTimer = setTimeout(() => {
    libraryRefreshTimer = null;
    void refreshLibrary();
  }, 15_000);
}

async function refreshLibrary() {
  if (libraryRefreshRunning) {
    libraryRefreshQueued = true;
    return;
  }
  libraryRefreshRunning = true;
  libraryRefreshQueued = false;
  lastLibraryError = null;
  const stagingRoot = join(serverRoot, `web-library-staging-${process.pid}`);
  await rm(stagingRoot, { recursive: true, force: true });
  await appendLog("refreshing En Croissant files and database exports");

  try {
    await runProcess(
      process.execPath,
      [join(repoRoot, "scripts", "build-web-library.mjs"), "--output", stagingRoot],
      {
        EN_CROISSANT_WEB_FILES_DIR: documentsRoot,
        EN_CROISSANT_WEB_DATABASE_DIRS: enDatabaseRoots.join(";"),
        EN_CROISSANT_WEB_DB_MAX_MB: "1024",
        EN_CROISSANT_WEB_DB_EXPORT_CACHE: join(serverRoot, "db-exports"),
      },
    );
    const previousRoot = `${libraryRoot}.previous`;
    await rm(previousRoot, { recursive: true, force: true });
    if (await stat(libraryRoot).catch(() => null)) await rename(libraryRoot, previousRoot);
    await rename(stagingRoot, libraryRoot);
    await rm(previousRoot, { recursive: true, force: true });
    hostedLibraryIndex.clear();
    void hostedLibraryIndex
      .get()
      .catch((error) => appendLog(`hosted library index refresh failed: ${error}`));
    lastLibraryRefresh = new Date().toISOString();
    await appendLog(`library refresh complete at ${lastLibraryRefresh}`);
  } catch (error) {
    lastLibraryError = String(error?.message || error);
    await appendLog(`library refresh failed: ${lastLibraryError}`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    libraryRefreshRunning = false;
    if (libraryRefreshQueued) scheduleLibraryRefresh();
  }
}

function runProcess(command, args, extraEnvironment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnvironment },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with ${code}: ${output.slice(-4000)}`));
    });
  });
}

function runProcessOutput(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`${command} exited with ${code}: ${stderr.slice(-4000)}`));
    });
  });
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

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function renameReplacing(source, destination) {
  await rm(destination, { force: true });
  await rename(source, destination);
}

async function pruneStateBackups() {
  const entries = await import("node:fs/promises").then(({ readdir }) =>
    readdir(stateBackupRoot, { withFileTypes: true }).catch(() => []),
  );
  const backups = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of backups.slice(48)) await rm(join(stateBackupRoot, name), { force: true });
}

async function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await mkdir(dirname(logPath), { recursive: true });
  const handle = await open(logPath, "a");
  try {
    await handle.write(line);
  } finally {
    await handle.close();
  }
}

function writeJson(response, status, body, extraHeaders = {}) {
  const text = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(text);
}

function writeJsonIfConnected(response, status, body, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  return writeJson(response, status, body, extraHeaders);
}

function setCorsHeaders(request, response, sensitive = false) {
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET, HEAD, POST, PUT, OPTIONS");
  const origin = String(request.headers.origin || "").replace(/\/$/, "");
  if (!sensitive) {
    response.setHeader("access-control-allow-origin", "*");
  } else if (privateCredentialOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-expose-headers", "content-length, content-range");
}

function normalizeLichessCredential(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.token !== "string" ||
    !/^[A-Za-z0-9_-]{20,512}$/.test(value.token) ||
    typeof value.username !== "string" ||
    !value.username.trim()
  ) {
    return null;
  }
  return {
    token: value.token,
    username: value.username.trim(),
    updatedAt: positiveInteger(value.updatedAt, Date.now()),
  };
}

function isValidWebState(state) {
  return Boolean(
    state &&
    typeof state === "object" &&
    state.version === 1 &&
    Array.isArray(state.databases) &&
    state.gamesByDatabase &&
    typeof state.gamesByDatabase === "object" &&
    Array.isArray(state.prepWorkspaces) &&
    state.board &&
    typeof state.board === "object",
  );
}

function normalizeFen(fen) {
  return String(fen).trim().split(/\s+/).slice(0, 4).join(" ");
}

function normalizeHostedPath(path) {
  return String(path)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function sanitizePathSegment(value) {
  return String(value)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
}

function parseSqliteTimestamp(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function uniquePath(value, index, values) {
  return values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isInside(path, parent) {
  const normalizedParent = normalize(resolve(parent) + sep).toLowerCase();
  const normalizedPath = normalize(resolve(path)).toLowerCase();
  return (
    normalizedPath.startsWith(normalizedParent) ||
    normalizedPath === normalize(resolve(parent)).toLowerCase()
  );
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || ""));
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}

function mimeType(path) {
  const extension = extname(path).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".pdf": "application/pdf",
      ".pgn": "application/x-chess-pgn; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".wasm": "application/wasm",
      ".webmanifest": "application/manifest+json",
    }[extension] || "application/octet-stream"
  );
}
