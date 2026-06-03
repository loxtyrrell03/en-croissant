export type WebHostedFileEntry = {
  type: "file";
  name: string;
  filename: string;
  extension: "pgn" | "pdf";
  path: string;
  url: string;
  lastModified: number;
  sizeBytes: number;
};

export type WebHostedDirectoryEntry = {
  type: "directory";
  name: string;
  path: string;
  lastModified: number;
  sizeBytes: number;
};

export type WebHostedEntry = WebHostedDirectoryEntry | WebHostedFileEntry;

export type WebHostedLibraryManifest = {
  version: 1;
  generatedAt: string;
  sourceName: string;
  files: WebHostedFileEntry[];
};

export type WebHostedLibrary = {
  available: boolean;
  manifest: WebHostedLibraryManifest | null;
};

export type WebHostedFileListResponse = {
  sourceName: string;
  path: string;
  parentPath: string | null;
  entries: WebHostedEntry[];
};

export type WebHostedPgnFileResponse = {
  path: string;
  filename: string;
  content: string;
};

const WEB_LIBRARY_BASE = `${import.meta.env.BASE_URL}web-library/`;

export async function getHostedWebLibrary(): Promise<WebHostedLibrary> {
  const response = await fetch(`${WEB_LIBRARY_BASE}manifest.json`);
  if (response.status === 404) {
    return { available: false, manifest: null };
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `Hosted library request failed: ${response.status}`);
  }

  return {
    available: true,
    manifest: normalizeManifest(data),
  };
}

export function listHostedLibraryPath(
  library: WebHostedLibrary,
  path = "",
): WebHostedFileListResponse | null {
  if (!library.manifest) return null;

  const normalizedPath = normalizeHostedPath(path);
  const prefix = normalizedPath ? `${normalizedPath}/` : "";
  const directories = new Map<string, WebHostedDirectoryEntry>();
  const files: WebHostedFileEntry[] = [];

  for (const file of library.manifest.files) {
    if (normalizedPath && file.path !== normalizedPath && !file.path.startsWith(prefix)) continue;

    const rest = normalizedPath ? file.path.slice(prefix.length) : file.path;
    if (!rest) continue;

    const [firstSegment, ...remaining] = rest.split("/");
    if (!firstSegment) continue;

    if (remaining.length > 0) {
      const directoryPath = normalizedPath ? `${normalizedPath}/${firstSegment}` : firstSegment;
      const existing = directories.get(directoryPath);
      directories.set(directoryPath, {
        type: "directory",
        name: firstSegment,
        path: directoryPath,
        lastModified: Math.max(existing?.lastModified ?? 0, file.lastModified),
        sizeBytes: (existing?.sizeBytes ?? 0) + file.sizeBytes,
      });
      continue;
    }

    files.push(file);
  }

  return {
    sourceName: library.manifest.sourceName,
    path: normalizedPath,
    parentPath: getHostedParentPath(normalizedPath),
    entries: [...directories.values(), ...files].sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }),
  };
}

export async function readHostedPgnFile(
  entry: WebHostedFileEntry,
): Promise<WebHostedPgnFileResponse> {
  const response = await fetch(getHostedRawFileUrl(entry));
  if (!response.ok) {
    throw new Error(`Hosted file request failed: ${response.status}`);
  }

  return {
    path: entry.path,
    filename: entry.filename,
    content: await response.text(),
  };
}

export function getHostedRawFileUrl(entry: WebHostedFileEntry) {
  return `${WEB_LIBRARY_BASE}${entry.url}`;
}

function normalizeManifest(data: unknown): WebHostedLibraryManifest {
  const manifest = data as Partial<WebHostedLibraryManifest>;
  const files = Array.isArray(manifest.files)
    ? manifest.files
        .filter(isHostedFileEntry)
        .map((file) => ({
          ...file,
          path: normalizeHostedPath(file.path),
        }))
    : [];

  return {
    version: 1,
    generatedAt:
      typeof manifest.generatedAt === "string" ? manifest.generatedAt : new Date(0).toISOString(),
    sourceName: typeof manifest.sourceName === "string" ? manifest.sourceName : "Web library",
    files,
  };
}

function isHostedFileEntry(value: unknown): value is WebHostedFileEntry {
  const entry = value as Partial<WebHostedFileEntry>;
  return (
    entry?.type === "file" &&
    typeof entry.path === "string" &&
    typeof entry.url === "string" &&
    typeof entry.filename === "string" &&
    (entry.extension === "pgn" || entry.extension === "pdf")
  );
}

function normalizeHostedPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function getHostedParentPath(path: string) {
  if (!path) return null;
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}
