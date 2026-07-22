import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import * as os from "node:os";

const HIDDEN_REPORT_ARTIFACT_DIRECTORIES = new Set([
  "report-render",
  "report-render-pdf",
  "report-print-pages",
  "source-pgns",
]);

const sourceRoot = resolve(
  process.env.EN_CROISSANT_WEB_FILES_DIR ||
    getCliValue("--source") ||
    join(os.homedir(), "Documents", "EnCroissant"),
);
const outputRoot = resolve(getCliValue("--output") || "public/web-library");
const filesRoot = join(outputRoot, "files");
const previousManifest = await readPreviousManifest(join(outputRoot, "manifest.json"));
const repoRoot = resolve(".");
const tauriConfig = await readJsonFile(join(repoRoot, "src-tauri", "tauri.conf.json"));

await removeGeneratedDirectory(outputRoot);
await mkdir(filesRoot, { recursive: true });

const files = [];
await collectFiles(sourceRoot);
await collectDatabaseExports();
const sortedFiles = files.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
const pinnedPaths = await getPinnedHostedPaths();
const sourceName = basename(sourceRoot);

const manifest = {
  version: 1,
  generatedAt:
    previousManifest &&
    previousManifest.sourceName === sourceName &&
    areFileManifestsEqual(previousManifest.files, sortedFiles) &&
    areStringArraysEqual(previousManifest.pinnedPaths, pinnedPaths)
      ? previousManifest.generatedAt
      : new Date().toISOString(),
  sourceName,
  pinnedPaths,
  files: sortedFiles,
};

await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Published ${manifest.files.length} web library files from ${sourceRoot}`);
console.log(`Output: ${outputRoot}`);

async function removeGeneratedDirectory(path) {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 100,
  });
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory() && HIDDEN_REPORT_ARTIFACT_DIRECTORIES.has(entry.name.toLowerCase())) {
      continue;
    }

    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolutePath);
      continue;
    }

    if (!entry.isFile()) continue;

    const lowerName = entry.name.toLowerCase();
    const extension = lowerName.endsWith(".pgn") ? "pgn" : lowerName.endsWith(".pdf") ? "pdf" : null;
    if (!extension) continue;

    const relativePath = normalizePath(relative(sourceRoot, absolutePath));
    const outputPath = join(filesRoot, ...relativePath.split("/"));
    const fileStat = await stat(absolutePath);

    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(absolutePath, outputPath);

    files.push({
      type: "file",
      name: entry.name.replace(/\.(pgn|pdf)$/i, ""),
      filename: entry.name,
      extension,
      path: relativePath,
      url: `files/${encodePath(relativePath)}`,
      lastModified: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
    });
  }
}

async function collectDatabaseExports() {
  if (process.env.EN_CROISSANT_WEB_EXPORT_DATABASES === "0") {
    return;
  }

  const databaseRoots = getDatabaseRoots();
  if (databaseRoots.length === 0) return;

  const databases = [];
  for (const root of databaseRoots) {
    await collectDatabaseFiles(root, root, getDatabaseRootLabel(root), databases);
  }

  if (databases.length === 0) return;

  const exporter = ensureDatabaseExporter();
  if (!exporter) return;

  const maxDatabaseBytes = parseMegabytes("EN_CROISSANT_WEB_DB_MAX_MB", 200) * 1024 * 1024;
  const chunkMegabytes = parseMegabytes("EN_CROISSANT_WEB_DB_CHUNK_MB", 25);
  const positionIndexMaxPly = parsePositiveInteger("EN_CROISSANT_WEB_DB_INDEX_MAX_PLY", 80);
  const cacheRoot = resolve(
    process.env.EN_CROISSANT_WEB_DB_EXPORT_CACHE ||
      join(getLocalAppDataDir(), "EnCroissantWebSync", "db-exports"),
  );

  for (const database of databases.sort(compareDatabasesForExport)) {
    const sourceStat = await stat(database.absolutePath).catch(() => null);
    if (!sourceStat || sourceStat.size <= 0) continue;

    if (sourceStat.size > maxDatabaseBytes) {
      console.warn(
        `Skipping ${database.absolutePath}: ${formatMegabytes(sourceStat.size)} exceeds EN_CROISSANT_WEB_DB_MAX_MB (${formatMegabytes(maxDatabaseBytes)}).`,
      );
      continue;
    }

    const cacheDir = join(cacheRoot, database.cacheKey);
    const metadataPath = join(cacheDir, "manifest.json");
    const metadata = {
      version: 1,
      exporter: "export_db_to_pgn",
      sourcePath: database.absolutePath,
      sizeBytes: sourceStat.size,
      lastModified: sourceStat.mtimeMs,
      chunkMegabytes,
      positionIndexVersion: 1,
      positionIndexMaxPly,
    };

    const cached = await readJsonFile(metadataPath);
    if (!isDatabaseCacheFresh(cached, metadata)) {
      await removeGeneratedDirectory(cacheDir);
      await mkdir(cacheDir, { recursive: true });
      const result = spawnSync(
        exporter,
        [
          "--source",
          database.absolutePath,
          "--dest-dir",
          cacheDir,
          "--chunk-mb",
          String(chunkMegabytes),
          "--index-max-ply",
          String(positionIndexMaxPly),
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );

      if (result.status !== 0) {
        const message = `${result.stderr || result.stdout || "database export failed"}`.trim();
        console.warn(`Skipping ${database.absolutePath}: ${message}`);
        await removeGeneratedDirectory(cacheDir);
        continue;
      }

      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    }

    const outputDir = join(filesRoot, ...database.virtualPath.split("/"));
    await copyDirectory(cacheDir, outputDir);
    await collectGeneratedPgnFiles(outputDir, database.virtualPath, sourceStat.mtimeMs);
  }
}

async function collectDatabaseFiles(root, directory, label, databases) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      await collectDatabaseFiles(root, absolutePath, label, databases);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".db3")) continue;
    if (entry.name.startsWith(".") || entry.name.toLowerCase().includes(".tmp.")) continue;

    const relativePath = normalizePath(relative(root, absolutePath));
    const withoutExtension = relativePath.replace(/\.db3$/i, "");
    const virtualPath = ["Databases", label, ...withoutExtension.split("/").map(sanitizePathSegment)]
      .filter(Boolean)
      .join("/");

    databases.push({
      absolutePath,
      label,
      virtualPath,
      cacheKey: `${hashString(`${label}:${absolutePath.toLowerCase()}`)}-${sanitizePathSegment(
        basename(withoutExtension),
      )}`,
    });
  }
}

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }
    if (entry.isFile()) {
      if (entry.name === "manifest.json") continue;
      await mkdir(dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
    }
  }
}

async function collectGeneratedPgnFiles(directory, virtualPath, lastModified) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const entryVirtualPath = `${virtualPath}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectGeneratedPgnFiles(absolutePath, entryVirtualPath, lastModified);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pgn")) continue;

    const fileStat = await stat(absolutePath);
    files.push({
      type: "file",
      name: entry.name.replace(/\.pgn$/i, ""),
      filename: entry.name,
      extension: "pgn",
      path: normalizePath(entryVirtualPath),
      url: `files/${encodePath(normalizePath(entryVirtualPath))}`,
      lastModified,
      sizeBytes: fileStat.size,
    });
  }
}

async function getPinnedHostedPaths() {
  const pinnedFiles = await getPinnedFileEntries();
  const mapped = pinnedFiles
    .map((path) => getHostedPathForPinnedEntry(path))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return Array.from(new Set(mapped));
}

async function getPinnedFileEntries() {
  const explicitPath = process.env.EN_CROISSANT_WEB_PINNED_FILES;
  const appIds = [
    getAppIdentifier(),
    "org.encroissant.fork",
    "org.encroissant.app",
  ].filter(Boolean);
  const candidates = [
    explicitPath,
    ...appIds.map((id) => join(getRoamingAppDataDir(), id, "web-pinned-file-entries.json")),
    ...appIds.map((id) => join(getLocalAppDataDir(), id, "web-pinned-file-entries.json")),
    join(sourceRoot, ".en-croissant-web-pins.json"),
  ].filter(Boolean);

  const entries = [];
  const seenFiles = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seenFiles.has(key)) continue;
    seenFiles.add(key);

    const data = await readJsonFile(candidate);
    const pinnedPaths = Array.isArray(data)
      ? data
      : Array.isArray(data?.pinnedPaths)
        ? data.pinnedPaths
        : [];
    for (const path of pinnedPaths) {
      if (typeof path === "string" && path.trim()) {
        entries.push(path);
      }
    }
  }

  return entries;
}

function getHostedPathForPinnedEntry(path) {
  const normalizedPath = normalizeAbsolutePath(path);
  const normalizedSourceRoot = normalizeAbsolutePath(sourceRoot);

  if (isSameOrDescendantAbsolutePath(normalizedPath, normalizedSourceRoot)) {
    const relativePath = normalizePath(relative(sourceRoot, path));
    return relativePath && relativePath !== "." ? relativePath : null;
  }

  return null;
}

function ensureDatabaseExporter() {
  const extension = process.platform === "win32" ? ".exe" : "";
  const exporterPath = join(repoRoot, "src-tauri", "target", "debug", `export_db_to_pgn${extension}`);
  const result = spawnSync(
    "cargo",
    ["build", "--manifest-path", join(repoRoot, "src-tauri", "Cargo.toml"), "--bin", "export_db_to_pgn", "--quiet"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (result.status !== 0) {
    const message = `${result.stderr || result.stdout || "cargo build failed"}`.trim();
    console.warn(`Database export disabled: ${message}`);
    return null;
  }

  return exporterPath;
}

function getDatabaseRoots() {
  const raw = process.env.EN_CROISSANT_WEB_DATABASE_DIRS;
  const singleRoot = process.env.EN_CROISSANT_WEB_DATABASE_DIR;
  const roots = raw
    ? raw.split(delimiter)
    : [singleRoot || getDesktopAppDatabaseRoot()];
  const seen = new Set();
  return roots
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => resolve(root))
    .filter((root) => {
      const key = root.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getAppIdentifier() {
  return typeof tauriConfig?.identifier === "string" ? tauriConfig.identifier : null;
}

function getDesktopAppDatabaseRoot() {
  const identifier = getAppIdentifier() || "org.encroissant.app";
  return join(getRoamingAppDataDir(), identifier, "db");
}

function getDatabaseRootLabel(root) {
  const lower = root.toLowerCase();
  if (lower.includes("org.encroissant.fork")) return "Fork";
  if (lower.includes("org.encroissant.app")) return "Desktop";
  return sanitizePathSegment(basename(root)) || "Local";
}

function compareDatabasesForExport(a, b) {
  const labelOrder = databaseLabelRank(a.label) - databaseLabelRank(b.label);
  if (labelOrder !== 0) return labelOrder;
  return a.virtualPath.localeCompare(b.virtualPath, undefined, { sensitivity: "base" });
}

function databaseLabelRank(label) {
  if (label === "Fork") return 0;
  if (label === "Desktop") return 1;
  return 2;
}

function isDatabaseCacheFresh(cached, metadata) {
  return (
    cached?.version === metadata.version &&
    cached?.exporter === metadata.exporter &&
    cached?.sourcePath === metadata.sourcePath &&
    Number(cached?.sizeBytes) === Number(metadata.sizeBytes) &&
    Number(cached?.lastModified) === Number(metadata.lastModified) &&
    Number(cached?.chunkMegabytes) === Number(metadata.chunkMegabytes) &&
    Number(cached?.positionIndexVersion) === Number(metadata.positionIndexVersion) &&
    Number(cached?.positionIndexMaxPly) === Number(metadata.positionIndexMaxPly)
  );
}

function parseMegabytes(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getRoamingAppDataDir() {
  return process.env.APPDATA || join(os.homedir(), "AppData", "Roaming");
}

function getLocalAppDataDir() {
  return process.env.LOCALAPPDATA || join(os.homedir(), "AppData", "Local");
}

function sanitizePathSegment(value) {
  return value
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
}

function hashString(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getCliValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function normalizeAbsolutePath(path) {
  return resolve(path).replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function isSameOrDescendantAbsolutePath(path, parent) {
  return path === parent || path.startsWith(`${parent}/`);
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readPreviousManifest(path) {
  const manifest = await readJsonFile(path);
  if (!manifest || !Array.isArray(manifest.files) || typeof manifest.generatedAt !== "string") {
    return null;
  }
  return manifest;
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function areFileManifestsEqual(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left?.type !== right?.type ||
      left?.name !== right?.name ||
      left?.filename !== right?.filename ||
      left?.extension !== right?.extension ||
      left?.path !== right?.path ||
      left?.url !== right?.url ||
      Number(left?.lastModified) !== Number(right?.lastModified) ||
      Number(left?.sizeBytes) !== Number(right?.sizeBytes)
    ) {
      return false;
    }
  }
  return true;
}

function areStringArraysEqual(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
