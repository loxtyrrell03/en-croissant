import type { SetStateAction } from "react";
import { basename, resolve } from "@tauri-apps/api/path";
import { commands, events } from "@/bindings";
import type { DatabaseInfo } from "@/bindings";
import { downloadChessCom } from "@/utils/chess.com/api";
import { downloadLichess } from "@/utils/lichess/api";
import type {
    DatabaseConversionState,
    OnlineDatabaseUpdateRecord,
    OnlineDatabaseUpdateRecords,
} from "@/state/atoms";
import type { OnlineGameSource } from "@/utils/onlineGameSource";
import { query_games } from "@/utils/db";
import { unwrap } from "@/utils/unwrap";

export type { OnlineGameSource } from "@/utils/onlineGameSource";

type SetDatabaseConversionState = (value: SetStateAction<DatabaseConversionState>) => void;

type ImportOnlineGamesOptions = {
    source: OnlineGameSource;
    username: string;
    databaseDir: string;
    dbPath: string;
    title: string;
    description?: string | null;
    since: number | null;
    remainingGames?: number;
    token?: string;
    setProgress?: (progress: number) => void;
    setConversionState: SetDatabaseConversionState;
};

export function getOnlineGameSourceLabel(source: OnlineGameSource) {
    return source === "lichess" ? "Lichess" : "Chess.com";
}

export function getOnlineGameImportId(source: OnlineGameSource, username: string) {
    return `${source}_${username}`;
}

export function getOnlineGamePgnFilename(source: OnlineGameSource, username: string) {
    return `${username}_${source}.pgn`;
}

export function getOnlineGameDatabaseFilename(source: OnlineGameSource, username: string) {
    return `${username}_${source}.db3`;
}

export function getDefaultOnlineGameDatabaseTitle(source: OnlineGameSource, username: string) {
    return `${username} ${getOnlineGameSourceLabel(source)}`;
}

export function getOnlineGameIdentityFromFilename(filename: string) {
    const lower = filename.toLowerCase();
    const suffixes = [
        { source: "lichess" as const, suffix: "_lichess.db3" },
        { source: "chesscom" as const, suffix: "_chesscom.db3" },
    ];

    for (const { source, suffix } of suffixes) {
        if (lower.endsWith(suffix)) {
            return {
                source,
                username: filename.slice(0, filename.length - suffix.length),
            };
        }
    }

    return null;
}

export function getOnlineDatabaseUpdateRecord(
    database: DatabaseInfo,
    records: OnlineDatabaseUpdateRecords,
): OnlineDatabaseUpdateRecord | null {
    if (database.type !== "success") return null;

    const stored = records[database.file];
    if (stored) return stored;

    const inferred = getOnlineGameIdentityFromFilename(database.filename);
    if (!inferred) return null;

    return {
        ...inferred,
        dbPath: database.file,
        title: database.title,
        description: database.description,
        autoUpdate: false,
        lastCheckedAt: null,
        lastUpdatedAt: null,
        lastKnownGameCount: database.game_count,
    };
}

export function upsertOnlineDatabaseUpdateRecord(
    records: OnlineDatabaseUpdateRecords,
    record: Omit<
        OnlineDatabaseUpdateRecord,
        "lastCheckedAt" | "lastUpdatedAt" | "lastKnownGameCount"
    > &
        Partial<
            Pick<
                OnlineDatabaseUpdateRecord,
                "lastCheckedAt" | "lastUpdatedAt" | "lastKnownGameCount"
            >
        >,
): OnlineDatabaseUpdateRecords {
    const previous = records[record.dbPath];
    return {
        ...records,
        [record.dbPath]: {
            ...previous,
            ...record,
            lastCheckedAt: record.lastCheckedAt ?? previous?.lastCheckedAt ?? null,
            lastUpdatedAt: record.lastUpdatedAt ?? previous?.lastUpdatedAt ?? null,
            lastKnownGameCount: record.lastKnownGameCount ?? previous?.lastKnownGameCount ?? null,
        },
    };
}

export async function getLastOnlineDatabaseGameDate(dbPath: string) {
    const games = await query_games(dbPath, {
        options: {
            page: 1,
            pageSize: 1,
            sort: "date",
            direction: "desc",
            skipCount: false,
        },
    });

    if (games.count! > 0 && games.data[0].date && games.data[0].time) {
        const [year, month, day] = games.data[0].date.split(".").map(Number);
        const [hour, minute, second] = games.data[0].time.split(":").map(Number);
        return Date.UTC(year, month - 1, day, hour, minute, second);
    }

    return null;
}

export function resetDatabaseConversionState(setConversionState: SetDatabaseConversionState) {
    setConversionState((prev) => ({
        ...prev,
        inProgress: false,
        phase: null,
        progress: null,
        progressId: null,
        totalGames: 0,
        totalGamesExpected: null,
        elapsedSeconds: 0,
        targetDatabasePath: null,
        targetDatabaseTitle: null,
        sourceFileName: null,
    }));
}

export async function importOnlineGamesToDatabase({
    source,
    username,
    databaseDir,
    dbPath,
    title,
    description,
    since,
    remainingGames = 0,
    token,
    setProgress = () => {},
    setConversionState,
}: ImportOnlineGamesOptions) {
    const pgnPath = await resolve(databaseDir, getOnlineGamePgnFilename(source, username));
    const sourceFileName = await basename(pgnPath);
    const progressId = getOnlineGameImportId(source, username);

    setConversionState((prev) => ({
        ...prev,
        inProgress: true,
        phase: "downloading",
        progress: 0,
        progressId,
        totalGames: 0,
        totalGamesExpected: null,
        elapsedSeconds: 0,
        targetDatabasePath: dbPath,
        targetDatabaseTitle: title,
        sourceFileName,
    }));

    if (source === "lichess") {
        await downloadLichess(username, since, remainingGames, setProgress, token);
    } else {
        await downloadChessCom(username, since);
    }

    const totalGamesExpected = unwrap(await commands.countPgnGames(pgnPath));
    setConversionState((prev) => ({
        ...prev,
        phase: "converting",
        progress: totalGamesExpected > 0 ? 0 : null,
        progressId: null,
        totalGames: 0,
        totalGamesExpected,
        elapsedSeconds: 0,
    }));

    unwrap(
        await commands.convertPgn(
            pgnPath,
            dbPath,
            since ? since / 1000 : null,
            title,
            description ?? null,
        ),
    );
    await commands.deleteEmptyGames(dbPath);
    await events.progressEvent.emit({
        id: progressId,
        progress: 100,
        finished: true,
    });
}
