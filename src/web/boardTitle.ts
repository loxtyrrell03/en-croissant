import type { WebColor, WebDatabase, WebGame } from "./model";

export function getWebBoardSourceTitle(game: WebGame, databases: WebDatabase[]) {
    const databaseName = databases.find((database) => database.id === game.databaseId)?.name;
    const sourceName = databaseName?.trim() || game.databaseName.trim();
    return sourceName || `${game.white} - ${game.black}`;
}

export type WebBoardPlayerLabel = {
    color: WebColor;
    name: string;
    rating: number | null;
};

export function getWebBoardPlayerLabels(
    game: Pick<WebGame, "white" | "black" | "whiteElo" | "blackElo">,
    orientation: WebColor,
) {
    const white: WebBoardPlayerLabel = {
        color: "white",
        name: game.white.trim() || "White",
        rating: game.whiteElo,
    };
    const black: WebBoardPlayerLabel = {
        color: "black",
        name: game.black.trim() || "Black",
        rating: game.blackElo,
    };

    return orientation === "black" ? { top: white, bottom: black } : { top: black, bottom: white };
}
