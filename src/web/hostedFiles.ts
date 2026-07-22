export type WebHostedFileEntry = {
    type: "file";
    name: string;
    filename: string;
    extension: "pgn" | "pdf";
    path: string;
    url: string;
    lastModified: number;
    sizeBytes: number;
    pinned?: boolean;
};

export type WebHostedDirectoryEntry = {
    type: "directory";
    name: string;
    path: string;
    lastModified: number;
    sizeBytes: number;
    pgnFileCount: number;
    directPgnFileCount: number;
    pinned?: boolean;
};

export type WebHostedEntry = WebHostedDirectoryEntry | WebHostedFileEntry;

export type WebHostedLibraryManifest = {
    version: 1;
    generatedAt: string;
    sourceName: string;
    files: WebHostedFileEntry[];
    pinnedPaths?: string[];
};

export type WebHostedLibrary = {
    available: boolean;
    manifest: WebHostedLibraryManifest | null;
};

export type WebHostedFileListResponse = {
    version?: 1;
    generatedAt?: string;
    sourceName: string;
    path: string;
    parentPath: string | null;
    entries: WebHostedEntry[];
};

export type WebHostedPathLoadResult = {
    library: WebHostedLibrary;
    listing: WebHostedFileListResponse | null;
};

export type WebHostedPgnFileResponse = {
    path: string;
    filename: string;
    content: string;
};

export type WebHostedPgnFolderResponse = {
    path: string;
    name: string;
    filename: string;
    files: WebHostedFileEntry[];
    content: string;
};

export type WebHostedFolderReadProgress = {
    loaded: number;
    total: number;
    currentFile: string | null;
};

export type WebHostedDatabaseFolder = {
    path: string;
    name: string;
    label: string;
    fileCount: number;
    sizeBytes: number;
    lastModified: number;
};

const WEB_LIBRARY_BASE = `${import.meta.env.BASE_URL}web-library/`;
const HOSTED_DATABASE_ROOT = "Databases";
let hostedLibraryCache: WebHostedLibrary | null = null;
let hostedLibraryRequest: Promise<WebHostedLibrary> | null = null;
const hostedPathCache = new Map<string, WebHostedPathLoadResult>();
const hostedPathRequests = new Map<string, Promise<WebHostedPathLoadResult>>();
const hostedScopeCache = new Map<string, WebHostedLibrary>();
const hostedScopeRequests = new Map<string, Promise<WebHostedLibrary>>();

export async function getHostedWebLibrary(options?: {
    forceRefresh?: boolean;
}): Promise<WebHostedLibrary> {
    if (options?.forceRefresh) clearHostedWebLibraryCache();
    if (hostedLibraryCache) return hostedLibraryCache;
    if (hostedLibraryRequest) return hostedLibraryRequest;

    const request = fetchHostedJson(`${WEB_LIBRARY_BASE}manifest.json`).then((data) => {
        const library = data
            ? { available: true, manifest: normalizeManifest(data) }
            : { available: false, manifest: null };
        hostedLibraryCache = library;
        return library;
    });
    hostedLibraryRequest = request;
    try {
        return await request;
    } finally {
        if (hostedLibraryRequest === request) hostedLibraryRequest = null;
    }
}

export async function getHostedWebLibraryPath(
    path = "",
    options?: { forceRefresh?: boolean },
): Promise<WebHostedPathLoadResult> {
    const normalizedPath = normalizeHostedPath(path);
    if (options?.forceRefresh) clearHostedWebLibraryCache();
    const cached = hostedPathCache.get(normalizedPath);
    if (cached) return cached;
    const pending = hostedPathRequests.get(normalizedPath);
    if (pending) return pending;

    const url = new URL(`${WEB_LIBRARY_BASE}manifest.json`, window.location.href);
    url.searchParams.set("scope", "directory");
    url.searchParams.set("path", normalizedPath);
    const request = fetchHostedJson(url.toString())
        .then((data) => normalizeHostedPathResponse(data, normalizedPath))
        .then((result) => {
            hostedPathCache.set(normalizedPath, result);
            return result;
        })
        .finally(() => hostedPathRequests.delete(normalizedPath));
    hostedPathRequests.set(normalizedPath, request);
    return request;
}

export async function getHostedWebLibraryScope(
    path = "",
    options?: { forceRefresh?: boolean },
): Promise<WebHostedLibrary> {
    const normalizedPath = normalizeHostedPath(path);
    if (options?.forceRefresh) clearHostedWebLibraryCache();
    const cached = hostedScopeCache.get(normalizedPath);
    if (cached) return cached;
    const pending = hostedScopeRequests.get(normalizedPath);
    if (pending) return pending;

    const url = new URL(`${WEB_LIBRARY_BASE}manifest.json`, window.location.href);
    url.searchParams.set("scope", "recursive");
    url.searchParams.set("path", normalizedPath);
    const request = fetchHostedJson(url.toString())
        .then((data) => {
            if (!data) return { available: false, manifest: null } satisfies WebHostedLibrary;
            const fullLibrary = { available: true, manifest: normalizeManifest(data) };
            const library = scopeHostedLibrary(fullLibrary, normalizedPath);
            hostedScopeCache.set(normalizedPath, library);
            return library;
        })
        .finally(() => hostedScopeRequests.delete(normalizedPath));
    hostedScopeRequests.set(normalizedPath, request);
    return request;
}

export function clearHostedWebLibraryCache() {
    hostedLibraryCache = null;
    hostedLibraryRequest = null;
    hostedPathCache.clear();
    hostedPathRequests.clear();
    hostedScopeCache.clear();
    hostedScopeRequests.clear();
}

async function fetchHostedJson(url: string) {
    const response = await fetch(url);
    if (response.status === 404) return null;

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(data?.error ?? `Hosted library request failed: ${response.status}`);
    }
    return data;
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
    const pinnedPaths = new Set(library.manifest.pinnedPaths ?? []);

    for (const file of library.manifest.files) {
        if (normalizedPath && file.path !== normalizedPath && !file.path.startsWith(prefix))
            continue;

        const rest = normalizedPath ? file.path.slice(prefix.length) : file.path;
        if (!rest) continue;

        const [firstSegment, ...remaining] = rest.split("/");
        if (!firstSegment) continue;

        if (remaining.length > 0) {
            const directoryPath = normalizedPath
                ? `${normalizedPath}/${firstSegment}`
                : firstSegment;
            const existing = directories.get(directoryPath);
            directories.set(directoryPath, {
                type: "directory",
                name: firstSegment,
                path: directoryPath,
                lastModified: Math.max(existing?.lastModified ?? 0, file.lastModified),
                sizeBytes: (existing?.sizeBytes ?? 0) + file.sizeBytes,
                pgnFileCount: (existing?.pgnFileCount ?? 0) + (file.extension === "pgn" ? 1 : 0),
                directPgnFileCount:
                    (existing?.directPgnFileCount ?? 0) +
                    (remaining.length === 1 && file.extension === "pgn" ? 1 : 0),
                pinned: existing?.pinned || pinnedPaths.has(directoryPath),
            });
            continue;
        }

        files.push({
            ...file,
            pinned: file.pinned || pinnedPaths.has(file.path),
        });
    }

    return {
        sourceName: library.manifest.sourceName,
        path: normalizedPath,
        parentPath: getHostedParentPath(normalizedPath),
        entries: [...directories.values(), ...files].sort((a, b) => {
            const pinnedDifference = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
            if (pinnedDifference !== 0) return pinnedDifference;
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

export function getHostedPgnFilesInPath(library: WebHostedLibrary, path = "") {
    if (!library.manifest) return [];

    const normalizedPath = normalizeHostedPath(path);
    const prefix = normalizedPath ? `${normalizedPath}/` : "";

    return library.manifest.files
        .filter((file) => {
            if (file.extension !== "pgn") return false;
            if (!normalizedPath) return true;
            return file.path === normalizedPath || file.path.startsWith(prefix);
        })
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

export function getHostedDirectPgnFilesInPath(library: WebHostedLibrary, path = "") {
    if (!library.manifest) return [];

    const normalizedPath = normalizeHostedPath(path);
    return library.manifest.files
        .filter((file) => {
            if (file.extension !== "pgn") return false;
            return getHostedDirectoryPath(file.path) === normalizedPath;
        })
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

export function getHostedDatabaseFolders(library: WebHostedLibrary) {
    if (!library.manifest) return [];

    const folders = new Map<string, WebHostedDatabaseFolder>();
    for (const file of library.manifest.files) {
        if (file.extension !== "pgn") continue;
        const directoryPath = getHostedDirectoryPath(file.path);
        if (!directoryPath.startsWith(`${HOSTED_DATABASE_ROOT}/`)) continue;

        const existing = folders.get(directoryPath);
        folders.set(directoryPath, {
            path: directoryPath,
            name: getHostedFileName(directoryPath),
            label: getHostedDatabaseLabel(directoryPath),
            fileCount: (existing?.fileCount ?? 0) + 1,
            sizeBytes: (existing?.sizeBytes ?? 0) + file.sizeBytes,
            lastModified: Math.max(existing?.lastModified ?? 0, file.lastModified),
        });
    }

    return Array.from(folders.values()).sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }),
    );
}

export async function readHostedPgnFolder(
    library: WebHostedLibrary,
    path = "",
    onProgress?: (progress: WebHostedFolderReadProgress) => void,
): Promise<WebHostedPgnFolderResponse> {
    const normalizedPath = normalizeHostedPath(path);
    const files = getHostedPgnFilesInPath(library, normalizedPath);
    if (files.length === 0) {
        throw new Error("This hosted folder does not contain PGN files.");
    }

    const chunks: string[] = [];
    onProgress?.({ loaded: 0, total: files.length, currentFile: files[0]?.filename ?? null });
    for (const [index, file] of files.entries()) {
        const response = await readHostedPgnFile(file);
        chunks.push(response.content.trim());
        onProgress?.({
            loaded: index + 1,
            total: files.length,
            currentFile: files[index + 1]?.filename ?? null,
        });
    }

    const name =
        normalizedPath.split("/").filter(Boolean).at(-1) ??
        library.manifest?.sourceName ??
        "Hosted database";

    return {
        path: normalizedPath,
        name,
        filename: `${name}.pgn`,
        files,
        content: chunks.filter(Boolean).join("\n\n"),
    };
}

export function getHostedRawFileUrl(entry: WebHostedFileEntry) {
    // Content stamp busts the HTTP and service-worker caches when a hosted
    // file is re-pushed at the same path.
    const stamp = Number.isFinite(entry.lastModified) ? Math.round(entry.lastModified) : 0;
    return `${WEB_LIBRARY_BASE}${entry.url}${stamp ? `?v=${stamp}` : ""}`;
}

export function getHostedLibraryFileUrl(path: string) {
    return `${WEB_LIBRARY_BASE}files/${encodePath(normalizeHostedPath(path))}`;
}

function encodePath(path: string) {
    return path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
}

function normalizeManifest(data: unknown): WebHostedLibraryManifest {
    const manifest = data as Partial<WebHostedLibraryManifest>;
    const files = Array.isArray(manifest.files)
        ? manifest.files.filter(isHostedFileEntry).map((file) => ({
              ...file,
              path: normalizeHostedPath(file.path),
          }))
        : [];

    return {
        version: 1,
        generatedAt:
            typeof manifest.generatedAt === "string"
                ? manifest.generatedAt
                : new Date(0).toISOString(),
        sourceName: typeof manifest.sourceName === "string" ? manifest.sourceName : "Web library",
        pinnedPaths: Array.isArray(manifest.pinnedPaths)
            ? manifest.pinnedPaths
                  .filter((path): path is string => typeof path === "string")
                  .map(normalizeHostedPath)
            : [],
        files,
    };
}

function normalizeHostedPathResponse(data: unknown, path: string): WebHostedPathLoadResult {
    if (!data) {
        return { library: { available: false, manifest: null }, listing: null };
    }

    if (isHostedFileListResponse(data)) {
        const listing = normalizeHostedFileListResponse(data, path);
        return {
            library: {
                available: true,
                manifest: {
                    version: 1,
                    generatedAt: listing.generatedAt ?? new Date(0).toISOString(),
                    sourceName: listing.sourceName,
                    files: listing.entries.filter(isHostedFileEntry),
                },
            },
            listing,
        };
    }

    // GitHub Pages and older home-server builds return the complete static
    // manifest for a scoped query. Keep that as a compatibility fallback.
    const library = { available: true, manifest: normalizeManifest(data) };
    hostedLibraryCache = library;
    return { library, listing: listHostedLibraryPath(library, path) };
}

function normalizeHostedFileListResponse(
    value: WebHostedFileListResponse,
    fallbackPath: string,
): WebHostedFileListResponse {
    const path = normalizeHostedPath(typeof value.path === "string" ? value.path : fallbackPath);
    return {
        version: 1,
        generatedAt:
            typeof value.generatedAt === "string" ? value.generatedAt : new Date(0).toISOString(),
        sourceName: typeof value.sourceName === "string" ? value.sourceName : "Web library",
        path,
        parentPath:
            typeof value.parentPath === "string"
                ? normalizeHostedPath(value.parentPath)
                : value.parentPath === null
                  ? null
                  : getHostedParentPath(path),
        entries: value.entries.map(normalizeHostedEntry).filter((entry) => entry !== null),
    };
}

function normalizeHostedEntry(value: WebHostedEntry): WebHostedEntry | null {
    if (isHostedFileEntry(value)) {
        return {
            ...value,
            path: normalizeHostedPath(value.path),
            lastModified: finiteNonNegativeNumber(value.lastModified),
            sizeBytes: finiteNonNegativeNumber(value.sizeBytes),
        };
    }
    if (isHostedDirectoryEntry(value)) {
        return {
            type: "directory",
            name: value.name,
            path: normalizeHostedPath(value.path),
            lastModified: finiteNonNegativeNumber(value.lastModified),
            sizeBytes: finiteNonNegativeNumber(value.sizeBytes),
            pgnFileCount: finiteNonNegativeNumber(value.pgnFileCount),
            directPgnFileCount: finiteNonNegativeNumber(value.directPgnFileCount),
            pinned: Boolean(value.pinned),
        };
    }
    return null;
}

function isHostedFileListResponse(value: unknown): value is WebHostedFileListResponse {
    const response = value as Partial<WebHostedFileListResponse>;
    return Boolean(response && Array.isArray(response.entries) && typeof response.path === "string");
}

function isHostedDirectoryEntry(value: unknown): value is WebHostedDirectoryEntry {
    const entry = value as Partial<WebHostedDirectoryEntry>;
    return (
        entry?.type === "directory" &&
        typeof entry.path === "string" &&
        typeof entry.name === "string"
    );
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

function getHostedDirectoryPath(path: string) {
    const normalizedPath = normalizeHostedPath(path);
    const parts = normalizedPath.split("/");
    parts.pop();
    return parts.join("/");
}

function getHostedParentPath(path: string) {
    if (!path) return null;
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
}

function getHostedFileName(path: string) {
    return normalizeHostedPath(path).split("/").filter(Boolean).at(-1) ?? path;
}

function getHostedDatabaseLabel(path: string) {
    return normalizeHostedPath(path)
        .replace(/^Databases\//, "")
        .split("/")
        .filter(Boolean)
        .join(" / ");
}

function scopeHostedLibrary(library: WebHostedLibrary, path: string): WebHostedLibrary {
    if (!library.manifest || !path) return library;
    const prefix = `${path}/`;
    return {
        available: library.available,
        manifest: {
            ...library.manifest,
            pinnedPaths: library.manifest.pinnedPaths?.filter(
                (pinnedPath) => pinnedPath === path || pinnedPath.startsWith(prefix),
            ),
            files: library.manifest.files.filter(
                (file) => file.path === path || file.path.startsWith(prefix),
            ),
        },
    };
}

function finiteNonNegativeNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
}
