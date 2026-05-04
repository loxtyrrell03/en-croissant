import type { SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { warn } from "@tauri-apps/plugin-log";
import { useAtom, useAtomValue } from "jotai";
import type { DatabaseInfo } from "@/bindings";
import { commands } from "@/bindings";
import {
    databaseConversionStateAtom,
    type DatabaseConversionState,
    type OnlineDatabaseUpdateAccount,
    type OnlineDatabaseUpdateRecord,
    onlineDatabaseUpdatesAtom,
    type OnlineDatabaseUpdateRecords,
    sessionsAtom,
} from "@/state/atoms";
import { getDatabases, type SuccessDatabaseInfo } from "@/utils/db";
import { getDatabasesDir } from "@/utils/directories";
import {
    getLastOnlineDatabaseGameDate,
    getLastOnlineDatabaseGameId,
    ONLINE_DATABASE_CLOCK_REFRESH_VERSION,
    getOnlineDatabaseUpdateAccounts,
    getOnlineDatabaseUpdateRecord,
    getOnlineGameAccountStatus,
    hasOnlineDatabaseNewLocalGames,
    importOnlineGamesToDatabase,
    resetDatabaseConversionState,
    upsertOnlineDatabaseUpdateRecord,
} from "@/utils/onlineGameImport";
import type { Session } from "@/utils/session";
import { unwrap } from "@/utils/unwrap";

const ONLINE_DATABASE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const ONLINE_DATABASE_INITIAL_CHECK_DELAY_MS = 20 * 1000;

type SetDatabaseConversionState = (value: SetStateAction<DatabaseConversionState>) => void;
type SetOnlineDatabaseUpdateRecords = (value: SetStateAction<OnlineDatabaseUpdateRecords>) => void;

type UpdateCandidate = {
    database: SuccessDatabaseInfo;
    record: OnlineDatabaseUpdateRecord;
};

type RemoteGameStatus = {
    gameCount: number | null;
    latestGameAt: number | null;
};

type ClockRefreshPlan = {
    needsImport: boolean;
    markCurrent: boolean;
};

export type OnlineDatabaseManualUpdateResult = {
    updated: boolean;
    checkedAt: number;
    remoteGameCount: number | null;
    latestGameAt: number | null;
};

function successfulDatabases(databases: DatabaseInfo[]): SuccessDatabaseInfo[] {
    return databases.filter(
        (database): database is SuccessDatabaseInfo => database.type === "success",
    );
}

function collectUpdateCandidates(
    databases: SuccessDatabaseInfo[],
    records: OnlineDatabaseUpdateRecords,
): UpdateCandidate[] {
    const databasesByPath = new Map(databases.map((database) => [database.file, database]));
    const handledPaths = new Set(Object.values(records).map((record) => record.dbPath));
    const candidates: UpdateCandidate[] = [];

    for (const record of Object.values(records)) {
        if (!record.autoUpdate) continue;

        const database = databasesByPath.get(record.dbPath);
        if (database) {
            candidates.push({ database, record });
        }
    }

    for (const database of databases) {
        if (handledPaths.has(database.file)) continue;

        const record = getOnlineDatabaseUpdateRecord(database, records);
        if (record?.autoUpdate) {
            candidates.push({ database, record });
        }
    }

    return candidates;
}

function getLichessToken(sessions: Session[], username: string) {
    return sessions.find(
        (session) =>
            session.lichess?.username.toLowerCase() === username.toLowerCase() &&
            session.lichess.accessToken,
    )?.lichess?.accessToken;
}

async function getRemoteGameStatus(
    account: OnlineDatabaseUpdateAccount,
    sessions: Session[],
): Promise<RemoteGameStatus> {
    return getOnlineGameAccountStatus(
        account,
        account.source === "lichess" ? getLichessToken(sessions, account.username) : undefined,
    );
}

function getRecordWithAccount(
    record: OnlineDatabaseUpdateRecord,
    account: OnlineDatabaseUpdateAccount,
    updates: Partial<OnlineDatabaseUpdateAccount>,
) {
    const accounts = getOnlineDatabaseUpdateAccounts(record).map((candidate) =>
        candidate.source === account.source &&
        candidate.username.toLowerCase() === account.username.toLowerCase()
            ? { ...candidate, ...updates }
            : candidate,
    );
    const checkedTimes = accounts
        .map((candidate) => candidate.lastCheckedAt ?? null)
        .filter((value): value is number => typeof value === "number");
    const updatedTimes = accounts
        .map((candidate) => candidate.lastUpdatedAt ?? null)
        .filter((value): value is number => typeof value === "number");
    const clockRefreshTimes = accounts
        .map((candidate) => candidate.clockDataRefreshedAt ?? null)
        .filter((value): value is number => typeof value === "number");
    const clockRefreshVersions = accounts
        .map((candidate) => candidate.clockDataRefreshVersion ?? null)
        .filter((value): value is number => typeof value === "number");

    return {
        ...record,
        accounts,
        source: accounts[0]?.source ?? record.source,
        username: accounts[0]?.username ?? record.username,
        lastCheckedAt: checkedTimes.length > 0 ? Math.max(...checkedTimes) : record.lastCheckedAt,
        lastUpdatedAt: updatedTimes.length > 0 ? Math.max(...updatedTimes) : record.lastUpdatedAt,
        clockDataRefreshedAt:
            clockRefreshTimes.length > 0
                ? Math.max(...clockRefreshTimes)
                : (record.clockDataRefreshedAt ?? null),
        clockDataRefreshVersion:
            clockRefreshVersions.length > 0
                ? Math.min(...clockRefreshVersions)
                : (record.clockDataRefreshVersion ?? null),
    };
}

function markAccountChecked(
    setUpdateRecords: SetOnlineDatabaseUpdateRecords,
    record: OnlineDatabaseUpdateRecord,
    account: OnlineDatabaseUpdateAccount,
    lastCheckedAt: number,
    lastKnownGameCount?: number | null,
    extraUpdates: Partial<OnlineDatabaseUpdateAccount> = {},
) {
    const nextRecord = getRecordWithAccount(record, account, {
        lastCheckedAt,
        lastKnownGameCount:
            lastKnownGameCount ?? account.lastKnownGameCount ?? record.lastKnownGameCount,
        ...extraUpdates,
    });
    setUpdateRecords((records) => upsertOnlineDatabaseUpdateRecord(records, nextRecord));
    return nextRecord;
}

function clockRefreshFields(refreshedAt: number): Partial<OnlineDatabaseUpdateAccount> {
    return {
        clockDataRefreshedAt: refreshedAt,
        clockDataRefreshVersion: ONLINE_DATABASE_CLOCK_REFRESH_VERSION,
    };
}

function hasCurrentClockRefresh(
    record: OnlineDatabaseUpdateRecord,
    account: OnlineDatabaseUpdateAccount,
) {
    const refreshedAt = account.clockDataRefreshedAt ?? record.clockDataRefreshedAt;
    const version = account.clockDataRefreshVersion ?? record.clockDataRefreshVersion ?? 0;
    return (
        typeof refreshedAt === "number" &&
        Number.isFinite(refreshedAt) &&
        version >= ONLINE_DATABASE_CLOCK_REFRESH_VERSION
    );
}

async function getClockRefreshPlan(
    dbPath: string,
    record: OnlineDatabaseUpdateRecord,
    account: OnlineDatabaseUpdateAccount,
): Promise<ClockRefreshPlan> {
    if (hasCurrentClockRefresh(record, account)) {
        return { needsImport: false, markCurrent: false };
    }

    const coverage = unwrap(await commands.getDatabaseClockCoverage(dbPath));
    if (coverage.gameCount === 0 || coverage.gamesWithTiming >= coverage.gameCount) {
        return { needsImport: false, markCurrent: true };
    }

    return { needsImport: true, markCurrent: false };
}

async function maybeUpdateCandidate({
    candidate,
    databaseDir,
    sessions,
    setConversionState,
    setUpdateRecords,
    isConversionInProgress,
    skipRecentCheck = false,
}: {
    candidate: UpdateCandidate;
    databaseDir: string;
    sessions: Session[];
    setConversionState: SetDatabaseConversionState;
    setUpdateRecords: SetOnlineDatabaseUpdateRecords;
    isConversionInProgress: () => boolean;
    skipRecentCheck?: boolean;
}): Promise<OnlineDatabaseManualUpdateResult> {
    const { database, record } = candidate;
    const now = Date.now();
    const lastGameDate = await getLastOnlineDatabaseGameDate(database.file);
    let currentRecord = record;
    const accounts = getOnlineDatabaseUpdateAccounts(currentRecord);
    let updated = false;
    let latestCheckedAt = currentRecord.lastCheckedAt ?? now;
    let remoteGameCount: number | null = null;
    let latestGameAt: number | null = null;

    try {
        for (const account of accounts) {
            const accountLastCheckedAt = account.lastCheckedAt ?? currentRecord.lastCheckedAt;
            if (
                !skipRecentCheck &&
                accountLastCheckedAt &&
                now - accountLastCheckedAt < ONLINE_DATABASE_CHECK_INTERVAL_MS
            ) {
                latestCheckedAt = Math.max(latestCheckedAt, accountLastCheckedAt);
                continue;
            }

            const remoteStatus = await getRemoteGameStatus(account, sessions);
            if (remoteStatus.gameCount !== null) {
                remoteGameCount = (remoteGameCount ?? 0) + remoteStatus.gameCount;
            }
            if (remoteStatus.latestGameAt !== null) {
                latestGameAt =
                    latestGameAt === null
                        ? remoteStatus.latestGameAt
                        : Math.max(latestGameAt, remoteStatus.latestGameAt);
            }

            if (remoteStatus.gameCount === null && remoteStatus.latestGameAt === null) {
                currentRecord = markAccountChecked(setUpdateRecords, currentRecord, account, now);
                latestCheckedAt = now;
                continue;
            }

            const isLegacySingleAccount = !currentRecord.accounts?.length && accounts.length === 1;
            const lastKnownRemoteCount =
                account.lastKnownGameCount ??
                (isLegacySingleAccount
                    ? (currentRecord.lastKnownGameCount ?? database.game_count)
                    : null);
            const hasNewGamesByCount =
                remoteStatus.gameCount !== null &&
                lastKnownRemoteCount !== null &&
                remoteStatus.gameCount > lastKnownRemoteCount;
            const sourceLastImportedAt =
                account.lastImportedAt ??
                (isLegacySingleAccount ? lastGameDate : (account.lastUpdatedAt ?? null));
            const hasNewGamesByDate =
                remoteStatus.latestGameAt !== null &&
                (sourceLastImportedAt === null || remoteStatus.latestGameAt > sourceLastImportedAt);
            const hasNewGames = hasNewGamesByCount || hasNewGamesByDate;
            const clockRefreshPlan = await getClockRefreshPlan(
                database.file,
                currentRecord,
                account,
            );

            if (!hasNewGames && !clockRefreshPlan.needsImport) {
                currentRecord = markAccountChecked(
                    setUpdateRecords,
                    currentRecord,
                    account,
                    now,
                    remoteStatus.gameCount,
                    clockRefreshPlan.markCurrent ? clockRefreshFields(now) : {},
                );
                latestCheckedAt = now;
                continue;
            }

            currentRecord = markAccountChecked(setUpdateRecords, currentRecord, account, now);
            latestCheckedAt = now;

            if (isConversionInProgress()) {
                continue;
            }

            const beforeUpdate = successfulDatabases(await getDatabases()).find(
                (nextDatabase) => nextDatabase.file === database.file,
            );
            const beforeGameCount = beforeUpdate?.game_count ?? database.game_count;
            const beforeLastGameId = await getLastOnlineDatabaseGameId(database.file).catch(
                () => null,
            );

            await importOnlineGamesToDatabase({
                source: account.source,
                username: account.username,
                databaseDir,
                dbPath: database.file,
                title: database.title,
                description: database.description,
                since: clockRefreshPlan.needsImport ? null : sourceLastImportedAt,
                remainingGames: clockRefreshPlan.needsImport
                    ? (remoteStatus.gameCount ?? 0)
                    : remoteStatus.gameCount === null || lastKnownRemoteCount === null
                      ? 0
                      : Math.max(remoteStatus.gameCount - lastKnownRemoteCount, 0),
                token:
                    account.source === "lichess"
                        ? getLichessToken(sessions, account.username)
                        : undefined,
                setConversionState,
            });
            const cleanup = unwrap(await commands.deleteDuplicatedGames(database.file));
            await commands.clearGames();
            const updatedDatabase = successfulDatabases(await getDatabases()).find(
                (nextDatabase) => nextDatabase.file === database.file,
            );
            const updatedGameCount = updatedDatabase?.game_count ?? beforeGameCount;
            const updatedLastGameId = await getLastOnlineDatabaseGameId(database.file).catch(
                () => beforeLastGameId,
            );
            const importedNewGames = hasOnlineDatabaseNewLocalGames(
                { gameCount: beforeGameCount, lastGameId: beforeLastGameId },
                { gameCount: updatedGameCount, lastGameId: updatedLastGameId },
            );
            const enrichedExistingGames = cleanup.enrichedGames > 0;
            const changedDatabase = importedNewGames || enrichedExistingGames;
            const updatedAt = Date.now();

            const nextRecord = {
                ...getRecordWithAccount(currentRecord, account, {
                    lastCheckedAt: updatedAt,
                    lastUpdatedAt: changedDatabase
                        ? updatedAt
                        : (account.lastUpdatedAt ?? currentRecord.lastUpdatedAt),
                    lastKnownGameCount: remoteStatus.gameCount ?? lastKnownRemoteCount,
                    lastImportedAt:
                        remoteStatus.latestGameAt ??
                        (importedNewGames ? updatedAt : (sourceLastImportedAt ?? updatedAt)),
                    ...(clockRefreshPlan.needsImport ? clockRefreshFields(updatedAt) : {}),
                }),
                title: updatedDatabase?.title ?? database.title,
                description: updatedDatabase?.description ?? database.description,
                lastKnownGameCount: updatedGameCount,
                lastUpdatedAt: changedDatabase ? updatedAt : currentRecord.lastUpdatedAt,
            };

            setUpdateRecords((records) => upsertOnlineDatabaseUpdateRecord(records, nextRecord));
            currentRecord = nextRecord;
            updated = updated || changedDatabase;
        }

        const latestDatabase = successfulDatabases(await getDatabases()).find(
            (nextDatabase) => nextDatabase.file === database.file,
        );
        return {
            updated,
            checkedAt: latestCheckedAt,
            remoteGameCount: latestDatabase?.game_count ?? remoteGameCount,
            latestGameAt,
        };
    } finally {
        resetDatabaseConversionState(setConversionState);
    }
}

export async function updateOnlineDatabaseNow({
    database,
    record,
    databaseDir,
    sessions,
    setConversionState,
    setUpdateRecords,
    isConversionInProgress,
}: {
    database: SuccessDatabaseInfo;
    record: OnlineDatabaseUpdateRecord;
    databaseDir: string;
    sessions: Session[];
    setConversionState: SetDatabaseConversionState;
    setUpdateRecords: SetOnlineDatabaseUpdateRecords;
    isConversionInProgress: () => boolean;
}) {
    if (isConversionInProgress()) {
        throw new Error("Another database update is already running.");
    }

    return maybeUpdateCandidate({
        candidate: {
            database,
            record: {
                ...record,
                dbPath: database.file,
                title: database.title,
                description: database.description,
            },
        },
        databaseDir,
        sessions,
        setConversionState,
        setUpdateRecords,
        isConversionInProgress,
        skipRecentCheck: true,
    });
}

async function checkOnlineDatabases({
    sessions,
    records,
    setConversionState,
    setUpdateRecords,
    isConversionInProgress,
}: {
    sessions: Session[];
    records: OnlineDatabaseUpdateRecords;
    setConversionState: SetDatabaseConversionState;
    setUpdateRecords: SetOnlineDatabaseUpdateRecords;
    isConversionInProgress: () => boolean;
}) {
    const databaseDir = await getDatabasesDir();
    const databases = successfulDatabases(await getDatabases());
    const candidates = collectUpdateCandidates(databases, records);

    for (const candidate of candidates) {
        if (isConversionInProgress()) {
            return;
        }

        try {
            await maybeUpdateCandidate({
                candidate,
                databaseDir,
                sessions,
                setConversionState,
                setUpdateRecords,
                isConversionInProgress,
            });
        } catch (e) {
            warn(
                `Failed to auto-update ${candidate.record.source} database for ${candidate.record.username}: ${e}`,
            );
        }
    }
}

export function useOnlineDatabaseAutoUpdater() {
    const sessions = useAtomValue(sessionsAtom);
    const [records, setRecords] = useAtom(onlineDatabaseUpdatesAtom);
    const [conversionState, setConversionState] = useAtom(databaseConversionStateAtom);
    const runningRef = useRef(false);
    const recordsRef = useRef(records);
    const sessionsRef = useRef(sessions);
    const conversionStateRef = useRef(conversionState);

    useEffect(() => {
        recordsRef.current = records;
    }, [records]);

    useEffect(() => {
        sessionsRef.current = sessions;
    }, [sessions]);

    useEffect(() => {
        conversionStateRef.current = conversionState;
    }, [conversionState]);

    useEffect(() => {
        let disposed = false;

        const run = async () => {
            if (disposed || runningRef.current || conversionStateRef.current.inProgress) {
                return;
            }

            runningRef.current = true;
            try {
                await checkOnlineDatabases({
                    sessions: sessionsRef.current,
                    records: recordsRef.current,
                    setConversionState,
                    setUpdateRecords: setRecords,
                    isConversionInProgress: () => conversionStateRef.current.inProgress,
                });
            } catch (e) {
                warn(`Failed to auto-update online databases: ${e}`);
            } finally {
                runningRef.current = false;
            }
        };

        const initialTimer = window.setTimeout(
            () => void run(),
            ONLINE_DATABASE_INITIAL_CHECK_DELAY_MS,
        );
        const interval = window.setInterval(() => void run(), ONLINE_DATABASE_CHECK_INTERVAL_MS);

        return () => {
            disposed = true;
            window.clearTimeout(initialTimer);
            window.clearInterval(interval);
        };
    }, [setConversionState, setRecords]);
}
