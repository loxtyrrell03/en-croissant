export const ARCHIVED_DATABASE_ENTRIES_STORAGE_KEY = "archived-database-entries";
export const ARCHIVED_DATABASE_FOLDERS_STORAGE_KEY = "archived-database-folders";

export type DatabaseArchiveState = {
    databasePaths: string[];
    folderPaths: string[];
};

type ArchivableDatabase = {
    file: string;
    folder?: string | null;
};

const EMPTY_DATABASE_ARCHIVE_STATE: DatabaseArchiveState = {
    databasePaths: [],
    folderPaths: [],
};

function pathKey(path: string) {
    return path.replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase();
}

export function normalizeArchivedDatabaseFolder(folder: string) {
    return folder
        .trim()
        .split(/[\\/]+/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join("/");
}

export function isSameOrDescendantDatabaseFolder(folder: string, ancestor: string) {
    const folderKey = pathKey(normalizeArchivedDatabaseFolder(folder));
    const ancestorKey = pathKey(normalizeArchivedDatabaseFolder(ancestor));
    return !!ancestorKey && (folderKey === ancestorKey || folderKey.startsWith(`${ancestorKey}/`));
}

export function getArchivedDatabaseFolderAncestor(folder: string, archivedFolders: string[]) {
    return (
        archivedFolders.find((candidate) => isSameOrDescendantDatabaseFolder(folder, candidate)) ??
        null
    );
}

export function isDatabasePathDirectlyArchived(file: string, archivedDatabasePaths: string[]) {
    const fileKey = pathKey(file);
    return archivedDatabasePaths.some((candidate) => pathKey(candidate) === fileKey);
}

export function isDatabaseArchived(
    database: ArchivableDatabase,
    archiveState: DatabaseArchiveState,
) {
    return (
        isDatabasePathDirectlyArchived(database.file, archiveState.databasePaths) ||
        !!getArchivedDatabaseFolderAncestor(database.folder ?? "", archiveState.folderPaths)
    );
}

export function setDatabasePathArchived(paths: string[], file: string, archived: boolean) {
    const fileKey = pathKey(file);
    const withoutFile = paths.filter((candidate) => pathKey(candidate) !== fileKey);
    return archived ? [...withoutFile, file] : withoutFile;
}

export function setDatabaseFolderArchived(paths: string[], folder: string, archived: boolean) {
    const normalizedFolder = normalizeArchivedDatabaseFolder(folder);
    const withoutFolderTree = paths.filter(
        (candidate) => !isSameOrDescendantDatabaseFolder(candidate, normalizedFolder),
    );
    return archived ? [...withoutFolderTree, normalizedFolder] : withoutFolderTree;
}

export function replaceArchivedDatabasePath(
    paths: string[],
    previousPath: string,
    nextPath: string,
) {
    if (!isDatabasePathDirectlyArchived(previousPath, paths)) return paths;
    return setDatabasePathArchived(
        setDatabasePathArchived(paths, previousPath, false),
        nextPath,
        true,
    );
}

export function replaceArchivedDatabaseFolderPrefix(
    paths: string[],
    previousFolder: string,
    nextFolder: string,
) {
    const previous = normalizeArchivedDatabaseFolder(previousFolder);
    const next = normalizeArchivedDatabaseFolder(nextFolder);
    return paths.map((folder) => {
        if (!isSameOrDescendantDatabaseFolder(folder, previous)) return folder;
        const trailing = normalizeArchivedDatabaseFolder(folder).slice(previous.length);
        return `${next}${trailing}`;
    });
}

function readStoredStringArray(key: string): string[] {
    if (typeof localStorage === "undefined") return [];
    try {
        const value = JSON.parse(localStorage.getItem(key) ?? "[]");
        return Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : [];
    } catch {
        return [];
    }
}

export function getStoredDatabaseArchiveState(): DatabaseArchiveState {
    if (typeof localStorage === "undefined") return EMPTY_DATABASE_ARCHIVE_STATE;
    return {
        databasePaths: readStoredStringArray(ARCHIVED_DATABASE_ENTRIES_STORAGE_KEY),
        folderPaths: readStoredStringArray(ARCHIVED_DATABASE_FOLDERS_STORAGE_KEY),
    };
}
