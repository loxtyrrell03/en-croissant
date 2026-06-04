import type { WebHostedDatabaseFolder, WebHostedFileEntry } from "./hostedFiles";
import type { WebCompanionState, WebDatabase, WebGame, WebImportResult } from "./model";

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
  return database.gameCount > 0 && (games?.length ?? 0) === 0;
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
