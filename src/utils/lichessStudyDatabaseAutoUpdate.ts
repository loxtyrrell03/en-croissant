import type { SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { warn } from "@tauri-apps/plugin-log";
import { useAtom } from "jotai";
import { commands } from "@/bindings";
import {
    databaseConversionStateAtom,
    type DatabaseConversionState,
    type LichessStudyDatabaseUpdateRecord,
    lichessStudyDatabaseUpdatesAtom,
    type LichessStudyDatabaseUpdateRecords,
    sessionsAtom,
} from "@/state/atoms";
import { getDatabases, type SuccessDatabaseInfo } from "@/utils/db";
import { getDatabasesDir } from "@/utils/directories";
import {
    downloadLichessStudyPgnToDatabaseDir,
    getLichessStudyPgnFilename,
    upsertLichessStudyDatabaseUpdateRecord,
} from "@/utils/lichess/study";
import type { Session } from "@/utils/session";
import { unwrap } from "@/utils/unwrap";

const STUDY_DATABASE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const STUDY_DATABASE_INITIAL_CHECK_DELAY_MS = 25 * 1000;

type SetDatabaseConversionState = (value: SetStateAction<DatabaseConversionState>) => void;
type SetStudyDatabaseUpdateRecords = (
    value: SetStateAction<LichessStudyDatabaseUpdateRecords>,
) => void;

type StudyUpdateCandidate = {
    database: SuccessDatabaseInfo;
    record: LichessStudyDatabaseUpdateRecord;
};

export type LichessStudyDatabaseManualUpdateResult = {
    updated: boolean;
    checkedAt: number;
    gameCount: number | null;
};

function successfulDatabases(databases: Awaited<ReturnType<typeof getDatabases>>) {
    return databases.filter(
        (database): database is SuccessDatabaseInfo => database.type === "success",
    );
}

function collectStudyUpdateCandidates(
    databases: SuccessDatabaseInfo[],
    records: LichessStudyDatabaseUpdateRecords,
): StudyUpdateCandidate[] {
    const databasesByPath = new Map(databases.map((database) => [database.file, database]));
    return Object.values(records)
        .filter((record) => record.autoUpdate)
        .map((record) => {
            const database = databasesByPath.get(record.dbPath);
            return database ? { database, record } : null;
        })
        .filter((candidate): candidate is StudyUpdateCandidate => candidate !== null);
}

async function maybeUpdateStudyCandidate({
    candidate,
    databaseDir,
    token,
    setConversionState,
    setUpdateRecords,
    isConversionInProgress,
    skipRecentCheck = false,
}: {
    candidate: StudyUpdateCandidate;
    databaseDir: string;
    token?: string;
    setConversionState: SetDatabaseConversionState;
    setUpdateRecords: SetStudyDatabaseUpdateRecords;
    isConversionInProgress: () => boolean;
    skipRecentCheck?: boolean;
}): Promise<LichessStudyDatabaseManualUpdateResult> {
    const { database, record } = candidate;
    const now = Date.now();

    if (
        !skipRecentCheck &&
        record.lastCheckedAt &&
        now - record.lastCheckedAt < STUDY_DATABASE_CHECK_INTERVAL_MS
    ) {
        return {
            updated: false,
            checkedAt: record.lastCheckedAt,
            gameCount: record.lastKnownGameCount ?? database.game_count,
        };
    }

    if (isConversionInProgress()) {
        return {
            updated: false,
            checkedAt: record.lastCheckedAt ?? now,
            gameCount: record.lastKnownGameCount ?? database.game_count,
        };
    }

    const sourceFileName = getLichessStudyPgnFilename(record.studyId);
    setConversionState((prev) => ({
        ...prev,
        inProgress: true,
        phase: "downloading",
        progress: null,
        progressId: null,
        totalGames: 0,
        totalGamesExpected: null,
        elapsedSeconds: 0,
        targetDatabasePath: database.file,
        targetDatabaseTitle: database.title,
        sourceFileName,
    }));

    try {
        const download = await downloadLichessStudyPgnToDatabaseDir({
            databaseDir,
            link: record.studyUrl,
            token,
        });
        const checkedAt = Date.now();

        if (download.pgnHash === record.pgnHash) {
            setUpdateRecords((records) =>
                upsertLichessStudyDatabaseUpdateRecord(records, {
                    ...record,
                    title: database.title,
                    description: database.description,
                    lastCheckedAt: checkedAt,
                    lastKnownGameCount: database.game_count,
                }),
            );
            return {
                updated: false,
                checkedAt,
                gameCount: database.game_count,
            };
        }

        const totalGamesExpected = unwrap(await commands.countPgnGames(download.path));
        if (totalGamesExpected === 0) {
            throw new Error("That study did not contain any PGN chapters.");
        }

        setConversionState((prev) => ({
            ...prev,
            phase: "converting",
            progress: totalGamesExpected > 0 ? 0 : null,
            progressId: null,
            totalGames: 0,
            totalGamesExpected,
            elapsedSeconds: 0,
            sourceFileName,
        }));

        unwrap(
            await commands.replaceDatabaseFromPgn(
                download.path,
                database.file,
                database.title,
                database.description,
            ),
        );
        await commands.clearGames();

        const updatedDatabase =
            successfulDatabases(await getDatabases()).find(
                (nextDatabase) => nextDatabase.file === database.file,
            ) ?? database;
        const updatedAt = Date.now();
        const nextRecord: LichessStudyDatabaseUpdateRecord = {
            ...record,
            title: updatedDatabase.title,
            description: updatedDatabase.description,
            studyId: download.reference.studyId,
            chapterId: download.reference.chapterId,
            studyUrl: download.reference.canonicalUrl,
            pgnUrl: download.reference.pgnUrl,
            pgnHash: download.pgnHash,
            lastCheckedAt: updatedAt,
            lastUpdatedAt: updatedAt,
            lastKnownGameCount: updatedDatabase.game_count,
        };

        setUpdateRecords((records) => upsertLichessStudyDatabaseUpdateRecord(records, nextRecord));
        return {
            updated: true,
            checkedAt: updatedAt,
            gameCount: updatedDatabase.game_count,
        };
    } finally {
        resetStudyDatabaseConversionState(setConversionState);
    }
}

export async function updateLichessStudyDatabaseNow({
    database,
    record,
    databaseDir,
    token,
    setConversionState,
    setUpdateRecords,
    isConversionInProgress,
}: {
    database: SuccessDatabaseInfo;
    record: LichessStudyDatabaseUpdateRecord;
    databaseDir: string;
    token?: string;
    setConversionState: SetDatabaseConversionState;
    setUpdateRecords: SetStudyDatabaseUpdateRecords;
    isConversionInProgress: () => boolean;
}) {
    if (isConversionInProgress()) {
        throw new Error("Another database update is already running.");
    }

    return maybeUpdateStudyCandidate({
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
        token,
        setConversionState,
        setUpdateRecords,
        isConversionInProgress,
        skipRecentCheck: true,
    });
}

async function checkStudyDatabases({
    records,
    sessions,
    setConversionState,
    setUpdateRecords,
    isConversionInProgress,
}: {
    records: LichessStudyDatabaseUpdateRecords;
    sessions: Session[];
    setConversionState: SetDatabaseConversionState;
    setUpdateRecords: SetStudyDatabaseUpdateRecords;
    isConversionInProgress: () => boolean;
}) {
    const databaseDir = await getDatabasesDir();
    const databases = successfulDatabases(await getDatabases());
    const candidates = collectStudyUpdateCandidates(databases, records);

    for (const candidate of candidates) {
        if (isConversionInProgress()) return;

        try {
            await maybeUpdateStudyCandidate({
                candidate,
                databaseDir,
                token: getAnyLichessTokenFromSessions(sessions),
                setConversionState,
                setUpdateRecords,
                isConversionInProgress,
            });
        } catch (error) {
            warn(
                `Failed to auto-update Lichess study database ${candidate.record.title}: ${error}`,
            );
        }
    }
}

export function useLichessStudyDatabaseAutoUpdater() {
    const [records, setRecords] = useAtom(lichessStudyDatabaseUpdatesAtom);
    const [conversionState, setConversionState] = useAtom(databaseConversionStateAtom);
    const [sessions] = useAtom(sessionsAtom);
    const runningRef = useRef(false);
    const recordsRef = useRef(records);
    const conversionStateRef = useRef(conversionState);
    const sessionsRef = useRef(sessions);

    useEffect(() => {
        recordsRef.current = records;
    }, [records]);

    useEffect(() => {
        conversionStateRef.current = conversionState;
    }, [conversionState]);

    useEffect(() => {
        sessionsRef.current = sessions;
    }, [sessions]);

    useEffect(() => {
        let disposed = false;

        const run = async () => {
            if (disposed || runningRef.current || conversionStateRef.current.inProgress) {
                return;
            }

            runningRef.current = true;
            try {
                await checkStudyDatabases({
                    records: recordsRef.current,
                    sessions: sessionsRef.current,
                    setConversionState,
                    setUpdateRecords: setRecords,
                    isConversionInProgress: () => conversionStateRef.current.inProgress,
                });
            } catch (error) {
                warn(`Failed to auto-update Lichess study databases: ${error}`);
            } finally {
                runningRef.current = false;
            }
        };

        const initialTimer = window.setTimeout(
            () => void run(),
            STUDY_DATABASE_INITIAL_CHECK_DELAY_MS,
        );
        const interval = window.setInterval(() => void run(), STUDY_DATABASE_CHECK_INTERVAL_MS);

        return () => {
            disposed = true;
            window.clearTimeout(initialTimer);
            window.clearInterval(interval);
        };
    }, [setConversionState, setRecords]);
}

function getAnyLichessTokenFromSessions(sessions: Session[]) {
    return sessions.find((session) => session.lichess?.accessToken)?.lichess?.accessToken;
}

function resetStudyDatabaseConversionState(setConversionState: SetDatabaseConversionState) {
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
