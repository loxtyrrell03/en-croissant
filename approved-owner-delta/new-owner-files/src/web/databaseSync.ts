import type { WebHostedDatabaseFolder, WebHostedFileEntry } from "./hostedFiles";
import type { WebCompanionState, WebDatabase, WebGame, WebImportResult } from "./model";

const HOSTED_SOURCE_REF_PREFIX = "hosted:";
const ID_SOURCE_REF_PREFIX = "id:";

export function mergeImportedWebDatabases(
  state: WebCompanionState,
  imported: WebImportResult[],
): WebCompanionState {
  const nextGames = { ...state.gamesByDatabase };
  const replacementIds = new Map<string, string>();
  const replacedIds = new Set<string>();

  for (const result of imported) {
    for (const database of state.databases) {
      const sameId = database.id === result.database.id;
      const sameHostedPath =
        Boolean(result.database.hostedPath) &&
        database.hostedPath === result.database.hostedPath;
      if (!sameId && !sameHostedPath) continue;

      replacedIds.add(database.id);
      replacementIds.set(database.id, result.database.id);
      delete nextGames[database.id];
    }

    nextGames[result.database.id] = result.games;
  }

  const importedDatabases = imported.map((result) => result.database);
  const remainingDatabases = state.databases.filter((database) => !replacedIds.has(database.id));

  return {
    ...state,
    databases: [...importedDatabases, ...remainingDatabases],
    gamesByDatabase: nextGames,
    prepWorkspaces: state.prepWorkspaces.map((prep) => ({
      ...prep,
      sourceIds: prep.sourceIds.map((id) => replacementIds.get(id) ?? id),
    })),
    board: {
      ...state.board,
      sourceDatabaseId: state.board.sourceDatabaseId
        ? replacementIds.get(state.board.sourceDatabaseId) ?? state.board.sourceDatabaseId
        : state.board.sourceDatabaseId,
    },
  };
}

export function needsHostedDatabaseRefresh({
  database,
  games,
  hostedFolder,
}: {
  database: WebDatabase | null | undefined;
  games: WebGame[] | null | undefined;
  hostedFolder: WebHostedDatabaseFolder | null | undefined;
}) {
  if (!database?.hostedPath || !hostedFolder) return false;
  if ((database.hostedUpdatedAt ?? 0) < hostedFolder.lastModified) return true;
  if (database.hostedLazy) return false;
  return database.gameCount > 0 && (games?.length ?? 0) === 0;
}

export function filterWebDatabasesByHostedAvailability({
  databases,
  hostedFolders,
  hostedLibraryReady,
}: {
  databases: WebDatabase[];
  hostedFolders: WebHostedDatabaseFolder[];
  hostedLibraryReady: boolean;
}) {
  if (!hostedLibraryReady) return databases;

  const hostedPaths = new Set(hostedFolders.map((folder) => normalizeHostedPath(folder.path)));
  return databases.filter((database) => {
    if (!database.hostedPath) return true;
    return hostedPaths.has(normalizeHostedPath(database.hostedPath));
  });
}

export function filterWebSourceDatabases(databases: WebDatabase[], extraSourceIds: string[] = []) {
  const extraIds = new Set(extraSourceIds);
  return databases.filter((database) => isWebSourceDatabase(database) || extraIds.has(database.id));
}

export function isWebSourceDatabase(database: WebDatabase) {
  if (database.sourceKind === "opened-file") return false;
  if (database.sourceKind === "source") return true;
  return Boolean(database.hostedPath);
}

export function getWebDatabaseSourceStorageValue(database: WebDatabase) {
  return database.hostedPath
    ? getWebDatabaseHostedSourceStorageValue(database.hostedPath)
    : `${ID_SOURCE_REF_PREFIX}${database.id}`;
}

export function getWebDatabaseHostedSourceStorageValue(hostedPath: string) {
  return `${HOSTED_SOURCE_REF_PREFIX}${normalizeHostedPath(hostedPath)}`;
}

export function getWebDatabaseHostedPathFromSourceStorageValue(
  storedValue: string | null | undefined,
) {
  const value = storedValue?.trim();
  if (!value?.startsWith(HOSTED_SOURCE_REF_PREFIX)) return null;
  return normalizeHostedPath(value.slice(HOSTED_SOURCE_REF_PREFIX.length));
}

export function resolveWebDatabaseSourceId(
  storedValue: string | null | undefined,
  databases: WebDatabase[],
) {
  const value = storedValue?.trim();
  if (!value) return null;

  if (value.startsWith(HOSTED_SOURCE_REF_PREFIX)) {
    const hostedPath = getWebDatabaseHostedPathFromSourceStorageValue(value);
    if (!hostedPath) return null;
    return databases.find((database) => normalizeHostedPath(database.hostedPath ?? "") === hostedPath)
      ?.id ?? null;
  }

  const id = value.startsWith(ID_SOURCE_REF_PREFIX)
    ? value.slice(ID_SOURCE_REF_PREFIX.length)
    : value;
  return databases.some((database) => database.id === id) ? id : null;
}

export function getReusableHostedDatabaseImport({
  state,
  hostedPath,
  files,
}: {
  state: WebCompanionState;
  hostedPath: string;
  files: WebHostedFileEntry[];
}): WebImportResult | null {
  const normalizedHostedPath = normalizeHostedPath(hostedPath);
  const hostedFolder = getHostedFolderSummary(normalizedHostedPath, files);
  if (!hostedFolder) return null;

  const existingDatabase =
    state.databases.find(
      (database) =>
        database.hostedPath === normalizedHostedPath &&
        (database.hostedUpdatedAt ?? 0) >= hostedFolder.lastModified,
    ) ?? null;
  const existingGames = existingDatabase ? state.gamesByDatabase[existingDatabase.id] ?? [] : [];

  if (
    !existingDatabase ||
    needsHostedDatabaseRefresh({
      database: existingDatabase,
      games: existingGames,
      hostedFolder,
    })
  ) {
    return null;
  }

  return {
    database: existingDatabase,
    games: existingGames,
    warnings: [],
  };
}

function getHostedFolderSummary(path: string, files: WebHostedFileEntry[]): WebHostedDatabaseFolder | null {
  if (files.length === 0) return null;
  return {
    path,
    name: getHostedPathLeafName(path),
    label: getHostedPathLeafName(path),
    fileCount: files.length,
    sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    lastModified: Math.max(...files.map((file) => file.lastModified), 0),
  };
}

function normalizeHostedPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function getHostedPathLeafName(path: string) {
  return normalizeHostedPath(path).split("/").filter(Boolean).at(-1) ?? "Hosted database";
}
