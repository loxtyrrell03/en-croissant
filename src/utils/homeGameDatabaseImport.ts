import { getDefaultOnlineGameDatabaseTitle } from "@/utils/onlineGameImport";

export type HomeGameDatabaseImportSource = "chesscom" | "lichess" | "otb";

export const HOME_GAME_DATABASE_IMPORT_SOURCES = [
    { value: "chesscom" as const, label: "Chess.com" },
    { value: "lichess" as const, label: "Lichess" },
    { value: "otb" as const, label: "Over the board" },
];

export function getHomeGameDatabaseImportTitle(
    source: Exclude<HomeGameDatabaseImportSource, "otb">,
    username: string,
    requestedTitle: string,
) {
    return requestedTitle.trim() || getDefaultOnlineGameDatabaseTitle(source, username.trim());
}

export function validateHomeOnlineDatabaseImport({
    username,
    title,
    existingTitles,
}: {
    username: string;
    title: string;
    existingTitles: string[];
}) {
    if (!username.trim()) return "Enter the account username.";
    if (!title.trim()) return "Enter a database name.";
    if (
        existingTitles.some((candidate) => candidate.trim().toLowerCase() === title.toLowerCase())
    ) {
        return "A database with this name already exists.";
    }
    return null;
}
