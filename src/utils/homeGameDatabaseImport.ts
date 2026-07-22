import { getDefaultOnlineGameDatabaseTitle } from "@/utils/onlineGameImport";

export type HomeGameDatabaseImportSource = "chesscom" | "lichess" | "otb";

export const HOME_GAME_DATABASE_IMPORT_SOURCES = [
    {
        value: "chesscom" as const,
        shortLabel: "C",
        label: "Chess.com",
        detail: "Public account archive",
    },
    {
        value: "lichess" as const,
        shortLabel: "L",
        label: "Lichess",
        detail: "Public account games",
    },
    {
        value: "otb" as const,
        shortLabel: "OTB",
        label: "Over the board",
        detail: "Broadcast and event PGNs",
    },
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
