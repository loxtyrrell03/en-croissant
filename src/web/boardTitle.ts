import type { WebDatabase, WebGame } from "./model";

export function getWebBoardSourceTitle(game: WebGame, databases: WebDatabase[]) {
    const databaseName = databases.find((database) => database.id === game.databaseId)?.name;
    const sourceName = databaseName?.trim() || game.databaseName.trim();
    return sourceName || `${game.white} - ${game.black}`;
}
