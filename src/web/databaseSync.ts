import type { WebHostedDatabaseFolder } from "./hostedFiles";
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
