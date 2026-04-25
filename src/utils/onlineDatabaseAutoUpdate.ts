import type { SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { warn } from "@tauri-apps/plugin-log";
import { useAtom, useAtomValue } from "jotai";
import type { DatabaseInfo } from "@/bindings";
import { commands } from "@/bindings";
import {
    databaseConversionStateAtom,
    type DatabaseConversionState,
    type OnlineDatabaseUpdateRecord,
    onlineDatabaseUpdatesAtom,
    type OnlineDatabaseUpdateRecords,
    sessionsAtom,
} from "@/state/atoms";
import {
    getChessComAccountWithOptions,
    getChessComGameCount,
    getChessComLatestGameTimestamp,
} from "@/utils/chess.com/api";
import { getDatabases, type SuccessDatabaseInfo } from "@/utils/db";
import { getDatabasesDir } from "@/utils/directories";
import { getLichessAccount, getLichessDownloadGameCount } from "@/utils/lichess/api";
import {
    getLastOnlineDatabaseGameDate,
    getOnlineDatabaseUpdateRecord,
    importOnlineGamesToDatabase,
    resetDatabaseConversionState,
    upsertOnlineDatabaseUpdateRecord,
} from "@/utils/onlineGameImport";
import type { Session } from "@/utils/session";

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
    record: OnlineDatabaseUpdateRecord,
    sessions: Session[],
): Promise<RemoteGameStatus> {
    if (record.source === "lichess") {
        const account = await getLichessAccount({
            username: record.username,
            token: getLichessToken(sessions, record.username),
            silent: true,
        });
        return {
            gameCount: account ? getLichessDownloadGameCount(account) : null,
            latestGameAt: null,
        };
    }

    const stats = await getChessComAccountWithOptions(record.username, { silent: true });
    return {
        gameCount: stats ? getChessComGameCount(stats) : null,
        latestGameAt: await getChessComLatestGameTimestamp(record.username),
    };
}

function markRecordChecked(
    setUpdateRecords: SetOnlineDatabaseUpdateRecords,
    record: OnlineDatabaseUpdateRecord,
    lastCheckedAt: number,
    lastKnownGameCount?: number | null,
) {
    setUpdateRecords((records) =>
        upsertOnlineDatabaseUpdateRecord(records, {
            ...record,
            lastCheckedAt,
            lastKnownGameCount: lastKnownGameCount ?? record.lastKnownGameCount,
        }),
    );
}

async function maybeUpdateCandidate({
    candidate,
    databaseDir,
    sessions,
    setConversionState,
    setUpdateRecords,
    isConversionInProgress,
}: {
    candidate: UpdateCandidate;
    databaseDir: string;
    sessions: Session[];
    setConversionState: SetDatabaseConversionState;
    setUpdateRecords: SetOnlineDatabaseUpdateRecords;
    isConversionInProgress: () => boolean;
}) {
    const { database, record } = candidate;
    const now = Date.now();

    if (record.lastCheckedAt && now - record.lastCheckedAt < ONLINE_DATABASE_CHECK_INTERVAL_MS) {
        return;
    }

    const lastGameDate = await getLastOnlineDatabaseGameDate(database.file);
    const remoteStatus = await getRemoteGameStatus(record, sessions);
    if (remoteStatus.gameCount === null && remoteStatus.latestGameAt === null) {
        markRecordChecked(setUpdateRecords, record, now);
        return;
    }

    const lastKnownRemoteCount = record.lastKnownGameCount ?? database.game_count;
    const hasNewGamesByCount =
        remoteStatus.gameCount !== null &&
        remoteStatus.gameCount > Math.max(database.game_count, lastKnownRemoteCount);
    const hasNewGamesByDate =
        remoteStatus.latestGameAt !== null &&
        (lastGameDate === null || remoteStatus.latestGameAt > lastGameDate);
    const hasNewGames = hasNewGamesByCount || hasNewGamesByDate;
    if (!hasNewGames) {
        markRecordChecked(setUpdateRecords, record, now, remoteStatus.gameCount);
        return;
    }

    markRecordChecked(setUpdateRecords, record, now);

    if (isConversionInProgress()) {
        return;
    }

    try {
        await importOnlineGamesToDatabase({
            source: record.source,
            username: record.username,
            databaseDir,
            dbPath: database.file,
            title: database.title,
            description: database.description,
            since: lastGameDate,
            remainingGames:
                remoteStatus.gameCount === null
                    ? 0
                    : Math.max(remoteStatus.gameCount - database.game_count, 0),
            token:
                record.source === "lichess"
                    ? getLichessToken(sessions, record.username)
                    : undefined,
            setConversionState,
        });
        await commands.clearGames();

        setUpdateRecords((records) =>
            upsertOnlineDatabaseUpdateRecord(records, {
                ...record,
                title: database.title,
                description: database.description,
                lastCheckedAt: Date.now(),
                lastUpdatedAt: Date.now(),
                lastKnownGameCount: remoteStatus.gameCount,
            }),
        );
    } finally {
        resetDatabaseConversionState(setConversionState);
    }
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
