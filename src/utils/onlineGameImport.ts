import type { SetStateAction } from "react";
import { basename, resolve } from "@tauri-apps/api/path";
import { commands, events } from "@/bindings";
import type { DatabaseInfo } from "@/bindings";
import {
    downloadChessCom,
    getChessComAccountWithOptions,
    getChessComGameCount,
    getChessComLatestGameTimestamp,
} from "@/utils/chess.com/api";
import {
    downloadLichess,
    getLichessAccount,
    getLichessDownloadGameCount,
} from "@/utils/lichess/api";
import type {
    DatabaseConversionState,
    OnlineDatabaseUpdateAccount,
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

type ImportOnlineGameAccountsOptions = {
    accounts: (OnlineGameAccount & { token?: string })[];
    databaseDir: string;
    dbPath: string;
    title: string;
    description?: string | null;
    setConversionState: SetDatabaseConversionState;
};

export type OnlineGameAccount = Pick<OnlineDatabaseUpdateAccount, "source" | "username">;

export type OnlineGameAccountStatus = {
    gameCount: number | null;
    latestGameAt: number | null;
};

export type OnlineDatabaseLocalSnapshot = {
    gameCount: number | null | undefined;
    lastGameId: number | null | undefined;
};

export function getOnlineGameSourceLabel(source: OnlineGameSource) {
    return source === "lichess" ? "Lichess" : "Chess.com";
}

export function getOnlineDatabaseUpdateAccounts(
    record: OnlineDatabaseUpdateRecord,
): OnlineDatabaseUpdateAccount[] {
    if (record.accounts?.length) {
        return record.accounts;
    }

    return [
        {
            source: record.source,
            username: record.username,
            lastCheckedAt: record.lastCheckedAt,
            lastUpdatedAt: record.lastUpdatedAt,
            lastKnownGameCount: record.lastKnownGameCount,
            lastImportedAt: record.lastUpdatedAt,
        },
    ];
}

export function getOnlineDatabaseUpdateLabel(record: OnlineDatabaseUpdateRecord) {
    return getOnlineDatabaseUpdateAccounts(record)
        .map((account) => `${getOnlineGameSourceLabel(account.source)} ${account.username}`)
        .join(" + ");
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

export function getDefaultMergedOnlineGameDatabaseTitle(accounts: OnlineGameAccount[]) {
    const usernames = Array.from(
        new Set(accounts.map((account) => account.username.trim()).filter(Boolean)),
    );
    const name = usernames.length > 0 ? usernames.join(" + ") : "Merged";
    return `${name} Online Games`;
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
            accounts: record.accounts ?? previous?.accounts,
            lastCheckedAt: record.lastCheckedAt ?? previous?.lastCheckedAt ?? null,
            lastUpdatedAt: record.lastUpdatedAt ?? previous?.lastUpdatedAt ?? null,
            lastKnownGameCount: record.lastKnownGameCount ?? previous?.lastKnownGameCount ?? null,
        },
    };
}

export async function getOnlineGameAccountStatus(
    account: OnlineGameAccount,
    token?: string,
): Promise<OnlineGameAccountStatus> {
    if (account.source === "lichess") {
        const lichessAccount = await getLichessAccount({
            username: account.username,
            token,
            silent: true,
        });
        return {
            gameCount: lichessAccount ? getLichessDownloadGameCount(lichessAccount) : null,
            latestGameAt: null,
        };
    }

    const stats = await getChessComAccountWithOptions(account.username, { silent: true });
    return {
        gameCount: stats ? getChessComGameCount(stats) : null,
        latestGameAt: await getChessComLatestGameTimestamp(account.username),
    };
}

export async function createOnlineDatabaseUpdateAccount({
    source,
    username,
    token,
    importedAt = Date.now(),
}: OnlineGameAccount & {
    token?: string;
    importedAt?: number;
}): Promise<OnlineDatabaseUpdateAccount> {
    const status = await getOnlineGameAccountStatus({ source, username }, token);
    return {
        source,
        username,
        lastCheckedAt: importedAt,
        lastUpdatedAt: importedAt,
        lastKnownGameCount: status.gameCount,
        lastImportedAt: status.latestGameAt ?? importedAt,
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

export async function getLastOnlineDatabaseGameId(dbPath: string) {
    const games = await query_games(dbPath, {
        options: {
            page: 1,
            pageSize: 1,
            sort: "id",
            direction: "desc",
            skipCount: true,
        },
    });

    return games.data[0]?.id ?? null;
}

export function hasOnlineDatabaseNewLocalGames(
    before: OnlineDatabaseLocalSnapshot,
    after: OnlineDatabaseLocalSnapshot,
) {
    const beforeGameCount = before.gameCount ?? 0;
    const afterGameCount = after.gameCount ?? 0;
    if (afterGameCount > beforeGameCount) return true;

    const beforeLastGameId = typeof before.lastGameId === "number" ? before.lastGameId : null;
    const afterLastGameId = typeof after.lastGameId === "number" ? after.lastGameId : null;
    return (
        beforeLastGameId !== null && afterLastGameId !== null && afterLastGameId > beforeLastGameId
    );
}

export function getPgnImportTimestamp(since: number | null) {
    if (!since || !Number.isFinite(since)) return null;
    return Math.floor(since / 1000);
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
    const hasExpectedDownloadSize = remainingGames > 0;

    setConversionState((prev) => ({
        ...prev,
        inProgress: true,
        phase: "downloading",
        progress: hasExpectedDownloadSize ? 0 : null,
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
            getPgnImportTimestamp(since),
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

export async function importOnlineGameAccountsToDatabase({
    accounts,
    databaseDir,
    dbPath,
    title,
    description,
    setConversionState,
}: ImportOnlineGameAccountsOptions): Promise<OnlineDatabaseUpdateAccount[]> {
    const importedAccounts: OnlineDatabaseUpdateAccount[] = [];

    for (const account of accounts) {
        let status: OnlineGameAccountStatus | null = null;
        try {
            status = await getOnlineGameAccountStatus(account, account.token);
        } catch {
            status = null;
        }

        await importOnlineGamesToDatabase({
            source: account.source,
            username: account.username,
            databaseDir,
            dbPath,
            title,
            description,
            since: null,
            remainingGames: status?.gameCount ?? 0,
            token: account.token,
            setConversionState,
        });

        const importedAt = Date.now();
        importedAccounts.push({
            source: account.source,
            username: account.username,
            lastCheckedAt: importedAt,
            lastUpdatedAt: importedAt,
            lastKnownGameCount: status?.gameCount ?? null,
            lastImportedAt: status?.latestGameAt ?? importedAt,
        });
    }

    await commands.deleteDuplicatedGames(dbPath);
    await commands.deleteEmptyGames(dbPath);
    return importedAccounts;
}
