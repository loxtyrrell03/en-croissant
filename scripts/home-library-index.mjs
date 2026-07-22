import { readFile, stat } from "node:fs/promises";

export class HostedLibraryIndexCache {
  constructor(manifestPath) {
    this.manifestPath = manifestPath;
    this.cachedSignature = null;
    this.cachedIndex = null;
    this.pending = null;
  }

  clear() {
    this.cachedSignature = null;
    this.cachedIndex = null;
  }

  async get() {
    const manifestStat = await stat(this.manifestPath).catch(() => null);
    if (!manifestStat?.isFile()) return buildHostedLibraryIndex(null);

    const signature = `${manifestStat.size}:${manifestStat.mtimeMs}`;
    if (this.cachedIndex && this.cachedSignature === signature) {
      return this.cachedIndex;
    }
    if (this.pending?.signature === signature) return this.pending.promise;

    const promise = readFile(this.manifestPath, "utf8")
      .then((text) => buildHostedLibraryIndex(JSON.parse(text)))
      .then((index) => {
        this.cachedSignature = signature;
        this.cachedIndex = index;
        return index;
      })
      .finally(() => {
        if (this.pending?.promise === promise) this.pending = null;
      });
    this.pending = { signature, promise };
    return promise;
  }
}

export function buildHostedLibraryIndex(value) {
  const manifest = normalizeManifest(value);
  const entriesByPath = new Map();
  const pinnedPaths = new Set(manifest.pinnedPaths);

  for (const file of manifest.files) {
    const parts = file.path.split("/").filter(Boolean);
    const filename = parts.pop();
    if (!filename) continue;

    const directParent = parts.join("/");
    getDirectoryEntries(entriesByPath, directParent).set(`file:${file.path}`, {
      ...file,
      pinned: Boolean(file.pinned) || pinnedPaths.has(file.path),
    });

    for (let index = 0; index < parts.length; index += 1) {
      const parentPath = parts.slice(0, index).join("/");
      const directoryPath = parts.slice(0, index + 1).join("/");
      const key = `directory:${directoryPath}`;
      const siblings = getDirectoryEntries(entriesByPath, parentPath);
      const existing = siblings.get(key);
      siblings.set(key, {
        type: "directory",
        name: parts[index],
        path: directoryPath,
        lastModified: Math.max(existing?.lastModified ?? 0, file.lastModified),
        sizeBytes: (existing?.sizeBytes ?? 0) + file.sizeBytes,
        pgnFileCount: (existing?.pgnFileCount ?? 0) + (file.extension === "pgn" ? 1 : 0),
        directPgnFileCount:
          (existing?.directPgnFileCount ?? 0) +
          (index === parts.length - 1 && file.extension === "pgn" ? 1 : 0),
        pinned: Boolean(existing?.pinned) || pinnedPaths.has(directoryPath),
      });
    }
  }

  const listings = new Map();
  for (const [path, entries] of entriesByPath) {
    listings.set(path, Array.from(entries.values()).sort(compareHostedEntries));
  }
  if (!listings.has("")) listings.set("", []);

  return { manifest, listings };
}

export function listHostedLibraryDirectory(index, path = "") {
  const normalizedPath = normalizeHostedPath(path);
  return {
    version: 1,
    generatedAt: index.manifest.generatedAt,
    sourceName: index.manifest.sourceName,
    path: normalizedPath,
    parentPath: getHostedParentPath(normalizedPath),
    entries: index.listings.get(normalizedPath) ?? [],
  };
}

export function getHostedLibraryScope(index, path = "") {
  const normalizedPath = normalizeHostedPath(path);
  const prefix = normalizedPath ? `${normalizedPath}/` : "";
  return {
    ...index.manifest,
    pinnedPaths: index.manifest.pinnedPaths.filter(
      (pinnedPath) =>
        !normalizedPath || pinnedPath === normalizedPath || pinnedPath.startsWith(prefix),
    ),
    files: index.manifest.files.filter(
      (file) => !normalizedPath || file.path === normalizedPath || file.path.startsWith(prefix),
    ),
  };
}

function normalizeManifest(value) {
  const manifest = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    generatedAt:
      typeof manifest.generatedAt === "string" ? manifest.generatedAt : new Date(0).toISOString(),
    sourceName: typeof manifest.sourceName === "string" ? manifest.sourceName : "Web library",
    pinnedPaths: Array.isArray(manifest.pinnedPaths)
      ? manifest.pinnedPaths
          .filter((path) => typeof path === "string")
          .map(normalizeHostedPath)
          .filter(Boolean)
      : [],
    files: Array.isArray(manifest.files)
      ? manifest.files.map(normalizeHostedFile).filter(Boolean)
      : [],
  };
}

function normalizeHostedFile(value) {
  if (
    !value ||
    value.type !== "file" ||
    typeof value.path !== "string" ||
    typeof value.url !== "string" ||
    typeof value.filename !== "string" ||
    (value.extension !== "pgn" && value.extension !== "pdf")
  ) {
    return null;
  }

  const path = normalizeHostedPath(value.path);
  if (!path) return null;
  return {
    type: "file",
    name:
      typeof value.name === "string" && value.name
        ? value.name
        : value.filename.replace(/\.(pgn|pdf)$/i, ""),
    filename: value.filename,
    extension: value.extension,
    path,
    url: value.url,
    lastModified: finiteNonNegativeNumber(value.lastModified),
    sizeBytes: finiteNonNegativeNumber(value.sizeBytes),
    ...(value.pinned ? { pinned: true } : {}),
  };
}

function getDirectoryEntries(entriesByPath, path) {
  let entries = entriesByPath.get(path);
  if (!entries) {
    entries = new Map();
    entriesByPath.set(path, entries);
  }
  return entries;
}

function compareHostedEntries(a, b) {
  const pinnedDifference = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pinnedDifference !== 0) return pinnedDifference;
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

function normalizeHostedPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function getHostedParentPath(path) {
  if (!path) return null;
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function finiteNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}
