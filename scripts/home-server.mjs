import { spawn } from "node:child_process";
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localAppData =
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || tmpdir(), "AppData", "Local");
const roamingAppData =
  process.env.APPDATA || join(process.env.USERPROFILE || tmpdir(), "AppData", "Roaming");
const userProfile = process.env.USERPROFILE || dirname(localAppData);
const serverRoot = resolve(
  process.env.EN_CROISSANT_HOME_SERVER_ROOT || join(localAppData, "EnCroissantHomeServer"),
);
const siteRoot = resolve(process.env.EN_CROISSANT_HOME_SERVER_SITE || join(serverRoot, "site"));
const statePath = join(serverRoot, "state", "web-state.json");
const stateBackupRoot = join(serverRoot, "state", "backups");
const lichessCredentialPath = join(serverRoot, "credentials", "lichess.json");
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
const enPositionQueryBinary = join(
  repoRoot,
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "query_db_position.exe" : "query_db_position",
);
const maxStateBytes = 256 * 1024 * 1024;
const maxCredentialBytes = 4 * 1024;
const privateCredentialOrigins = new Set([
  "https://gaming-pc.tail89d19b.ts.net",
  "https://loxtyrrell03.github.io",
  "http://localhost:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

let outpostCatalog = null;
let outpostCatalogLoadedAt = 0;
let enCatalog = null;
let enCatalogLoadedAt = 0;
const enPositionCache = new Map();
let libraryRefreshTimer = null;
let libraryRefreshRunning = false;
let libraryRefreshQueued = false;
let lastLibraryRefresh = null;
let lastLibraryError = null;
let lastStateBackupAt = 0;
let sharedLichessCredential = null;

await mkdir(serverRoot, { recursive: true });
await mkdir(dirname(statePath), { recursive: true });
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
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

async function handleRequest(request, response) {
  const method = request.method || "GET";
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  setCorsHeaders(request, response, pathname === "/api/lichess-credential");
  if (method === "OPTIONS") {
    response.writeHead(204);
    return response.end();
  }

  if (pathname === "/v1" || pathname.startsWith("/v1/")) {
    return proxyStockfishRequest(request, response, requestUrl);
  }

  if (method === "GET" && pathname === "/api/health") {
    return writeJson(response, 200, {
      ok: true,
      service: "en-croissant-home-server",
      siteRoot,
      documentsRoot,
      enDatabaseRoots,
      outpostDatabase,
      enDatabases: enCatalog?.length ?? null,
      outpostCollections: outpostCatalog?.length ?? null,
      libraryRefreshRunning,
      lastLibraryRefresh,
      lastLibraryError,
      lichessConnected: Boolean(sharedLichessCredential),
      lichessUsername: sharedLichessCredential?.username ?? null,
    });
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

  if (method === "GET" && pathname === "/api/database-manifest") {
    return writeDatabaseManifest(requestUrl, response);
  }

  if (method === "GET" && pathname === "/api/database-position") {
    return writeDatabasePosition(requestUrl, response);
  }

  if (method === "GET" && pathname === "/web-library/manifest.json") {
    return writeLiveLibraryManifest(response);
  }

  if (method !== "GET" && method !== "HEAD") {
    return writeJson(response, 405, { error: "Method not allowed." });
  }

  return serveStatic(pathname, request, response, method === "HEAD");
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

async function writeLiveLibraryManifest(response) {
  const base = await readJsonFile(join(libraryRoot, "manifest.json"));
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
  const collection = await findOutpostCollection(hostedPath);
  const enDatabase = collection ? null : await findEnDatabase(hostedPath);
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
  const collection = await findOutpostCollection(hostedPath);
  if (!fen) return writeJson(response, 404, { error: "Live database not found." });

  if (!collection) {
    const enDatabase = await findEnDatabase(hostedPath);
    if (!enDatabase?.indexPath)
      return writeJson(response, 404, { error: "Live position index not found." });
    const cacheKey = `${enDatabase.indexPath}|${fen}`;
    let rows = enPositionCache.get(cacheKey);
    if (!rows) {
      const output = await runProcessOutput(enPositionQueryBinary, [
        "--index",
        enDatabase.indexPath,
        "--fen",
        fen,
      ]);
      rows = JSON.parse(output || "[]");
      enPositionCache.set(cacheKey, rows);
      if (enPositionCache.size > 256) enPositionCache.delete(enPositionCache.keys().next().value);
    }
    return writeJson(response, 200, rows, { "cache-control": "no-store" });
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
    return writeJson(response, 200, rows, { "cache-control": "no-store" });
  } finally {
    database.close();
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
  const catalog = await getOutpostCatalog();
  return catalog.find((collection) => collection.hostedPath === hostedPath) || null;
}

function openOutpostDatabase() {
  const database = new DatabaseSync(outpostDatabase, { readOnly: true });
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA query_only = ON");
  return database;
}

async function serveStatic(pathname, request, response, headOnly) {
  let relativePath = pathname.replace(/^\/+/, "") || "index.html";
  let filePath = resolve(siteRoot, relativePath);
  if (!isInside(filePath, siteRoot)) return writeJson(response, 403, { error: "Forbidden." });

  let fileStat = await stat(filePath).catch(() => null);
  if (fileStat?.isDirectory()) {
    filePath = join(filePath, "index.html");
    fileStat = await stat(filePath).catch(() => null);
  }
  if (!fileStat?.isFile() && !extname(relativePath)) {
    filePath = join(siteRoot, "index.html");
    fileStat = await stat(filePath).catch(() => null);
  }
  if (!fileStat?.isFile()) return writeJson(response, 404, { error: "Not found." });

  const mime = mimeType(filePath);
  const cacheControl =
    filePath.endsWith("index.html") || filePath.endsWith("manifest.json")
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
          outpostCatalog = null;
          outpostCatalogLoadedAt = 0;
        }
        continue;
      }
      if (/\.(pgn|pdf|db3|json)$/i.test(filename)) scheduleLibraryRefresh();
      if (/\.db3$/i.test(filename)) {
        enCatalog = null;
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

function setCorsHeaders(request, response, sensitive = false) {
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET, HEAD, PUT, OPTIONS");
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
