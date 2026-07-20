import type { WebColor } from "./model";
import { getWebOnlineSourceLabel, type WebOnlineImportedGame } from "./onlineImport";

export type WebOnlineGameSummary = {
    white: string;
    black: string;
    result: string;
    event: string;
    opening: string;
};

export function getWebOnlineGameSummary(game: Pick<WebOnlineImportedGame, "pgn">) {
    return {
        white: getPgnHeader(game.pgn, "White") || "White",
        black: getPgnHeader(game.pgn, "Black") || "Black",
        result: getPgnHeader(game.pgn, "Result") || "*",
        event: getPgnHeader(game.pgn, "Event") || "Online game",
        opening:
            getPgnHeader(game.pgn, "Opening") ||
            getPgnHeader(game.pgn, "ECO") ||
            "Opening not listed",
    } satisfies WebOnlineGameSummary;
}

export function getWebOnlineAnalysisTitle(game: WebOnlineImportedGame) {
    const summary = getWebOnlineGameSummary(game);
    return `${summary.white} vs ${summary.black} · ${getWebOnlineSourceLabel(game.source)}`;
}

export function getWebOnlinePlayerColor(
    game: Pick<WebOnlineImportedGame, "pgn" | "username">,
): WebColor {
    const summary = getWebOnlineGameSummary(game);
    const username = normalizeOnlinePlayerName(game.username);
    if (username && normalizeOnlinePlayerName(summary.black) === username) return "black";
    return "white";
}

function getPgnHeader(pgn: string, name: string) {
    const match = pgn.match(new RegExp(`^\\[${name}\\s+"([^"]*)"\\]`, "m"));
    return match?.[1]?.trim() ?? "";
}

function normalizeOnlinePlayerName(value: string) {
    return value
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]/g, "");
}
