import type { SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { warn } from "@tauri-apps/plugin-log";
import { fetch } from "@tauri-apps/plugin-http";
import { useAtom } from "jotai";
import { commands } from "@/bindings";
import {
    databaseConversionStateAtom,
    databaseLinkedFoldersAtom,
    type DatabaseConversionState,
    type DatabaseLinkedFolderRecords,
    type LichessStudyDatabaseUpdateRecord,
    lichessStudyDatabaseUpdatesAtom,
    type LichessStudyDatabaseUpdateRecords,
    sessionsAtom,
} from "@/state/atoms";
import {
    getDatabaseLinkedFolderRecord,
    syncDatabaseLinkedFolder,
    upsertDatabaseLinkedFolderRecord,
} from "@/utils/databaseFileExport";
import { getDatabases, type SuccessDatabaseInfo } from "@/utils/db";
import { getDatabasesDir } from "@/utils/directories";
import {
    downloadLichessStudyPgnToDatabaseDir,
    getLichessStudyPgnFilename,
    hashText,
    normalizedGameToPgn,
    pushLichessStudyChapterPgn,
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
type SetDatabaseLinkedFolderRecords = (value: SetStateAction<DatabaseLinkedFolderRecords>) => void;

type StudyUpdateCandidate = {
    database: SuccessDatabaseInfo;
    record: LichessStudyDatabaseUpdateRecord;
};

export type LichessStudyDatabaseManualUpdateResult = {
    updated: boolean;
    pushed: boolean;
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
            pushed: false,
            checkedAt: record.lastCheckedAt,
            gameCount: record.lastKnownGameCount ?? database.game_count,
        };
    }

    if (isConversionInProgress()) {
        return {
            updated: false,
            pushed: false,
            checkedAt: record.lastCheckedAt ?? now,
            gameCount: record.lastKnownGameCount ?? database.game_count,
        };
    }

    const sourceFileName = getLichessStudyPgnFilename(record.studyId);
    const startedAt = Date.now();
    setConversionState((prev) => ({
        ...prev,
        inProgress: true,
        phase: "downloading",
        progress: null,
        progressId: null,
        sourceKind: "lichess-study",
        startedAt,
        updatedAt: startedAt,
        totalGames: 0,
        totalGamesExpected: null,
        elapsedSeconds: 0,
        targetDatabasePath: database.file,
        targetDatabaseTitle: database.title,
        sourceFileName,
    }));

    try {
        let download = await downloadLichessStudyPgnToDatabaseDir({
            databaseDir,
            link: record.studyUrl,
            token,
        });
        const checkedAt = Date.now();
        let pushed = false;
        let nextLocalPgnHash = record.localPgnHash ?? null;
        let nextChapterRefs = download.chapterRefs;

        if (record.twoWaySync) {
            if (!token) {
                throw new Error("Two-way Lichess study sync needs a linked Lichess account.");
            }

            const localSnapshot = await getLocalStudyPgnSnapshot(database);
            nextLocalPgnHash = localSnapshot.hash;
            const remoteChanged = !!record.pgnHash && download.pgnHash !== record.pgnHash;
            const localChanged = record.localPgnHash
                ? localSnapshot.hash !== record.localPgnHash
                : true;

            if (remoteChanged && localChanged) {
                throw new Error(
                    "Both the local database and Lichess study changed. Reload or resolve one side before automatic two-way sync pushes annotations.",
                );
            }

            if (localChanged) {
                setConversionState((prev) => ({
                    ...prev,
                    phase: "converting",
                    progress: null,
                    progressId: null,
                    updatedAt: Date.now(),
                    sourceFileName: `Pushing ${database.title} to Lichess`,
                }));
                nextChapterRefs = await pushLocalChaptersToLichessStudy({
                    studyId: record.studyId,
                    token,
                    chapters: localSnapshot.chapters,
                    chapterRefs: nextChapterRefs.length > 0 ? nextChapterRefs : record.chapterRefs,
                });
                pushed = true;
                const pushedDownload = await downloadLichessStudyPgnToDatabaseDir({
                    databaseDir,
                    link: record.studyUrl,
                    token,
                });
                download = pushedDownload;
                nextChapterRefs = pushedDownload.chapterRefs;
            }
        }

        if (!pushed && download.pgnHash === record.pgnHash) {
            setUpdateRecords((records) =>
                upsertLichessStudyDatabaseUpdateRecord(records, {
                    ...record,
                    title: database.title,
                    description: database.description,
                    lastCheckedAt: checkedAt,
                    lastKnownGameCount: database.game_count,
                    pgnHash: download.pgnHash,
                    localPgnHash: nextLocalPgnHash,
                    lastPushedAt: record.lastPushedAt,
                    chapterRefs: nextChapterRefs,
                }),
            );
            return {
                updated: false,
                pushed,
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
            updatedAt: Date.now(),
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
            localPgnHash: record.twoWaySync
                ? (await getLocalStudyPgnSnapshot(updatedDatabase)).hash
                : nextLocalPgnHash,
            lastPushedAt: pushed ? updatedAt : record.lastPushedAt,
            chapterRefs: nextChapterRefs,
            lastCheckedAt: updatedAt,
            lastUpdatedAt: updatedAt,
            lastKnownGameCount: updatedDatabase.game_count,
        };

        setUpdateRecords((records) => upsertLichessStudyDatabaseUpdateRecord(records, nextRecord));
        return {
            updated: true,
            pushed,
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
    linkedFolders,
    sessions,
    setConversionState,
    setUpdateRecords,
    setLinkedFolders,
    isConversionInProgress,
}: {
    records: LichessStudyDatabaseUpdateRecords;
    linkedFolders: DatabaseLinkedFolderRecords;
    sessions: Session[];
    setConversionState: SetDatabaseConversionState;
    setUpdateRecords: SetStudyDatabaseUpdateRecords;
    setLinkedFolders: SetDatabaseLinkedFolderRecords;
    isConversionInProgress: () => boolean;
}) {
    const databaseDir = await getDatabasesDir();
    const databases = successfulDatabases(await getDatabases());
    const candidates = collectStudyUpdateCandidates(databases, records);

    for (const candidate of candidates) {
        if (isConversionInProgress()) return;

        try {
            const result = await maybeUpdateStudyCandidate({
                candidate,
                databaseDir,
                token: getAnyLichessTokenFromSessions(sessions),
                setConversionState,
                setUpdateRecords,
                isConversionInProgress,
            });
            if (result.updated || result.pushed) {
                await syncLinkedFolderForUpdatedStudy(
                    candidate.database.file,
                    candidate.record.title,
                    linkedFolders,
                    setLinkedFolders,
                );
            }
        } catch (error) {
            warn(
                `Failed to auto-update Lichess study database ${candidate.record.title}: ${error}`,
            );
        }
    }
}

async function getLocalStudyPgnSnapshot(database: SuccessDatabaseInfo) {
    const response = unwrap(
        await commands.getGames(database.file, {
            options: {
                skipCount: true,
                pageSize: database.game_count,
                sort: "id",
                direction: "asc",
            },
        }),
    );
    const chapters = response.data.map((game) => ({
        game,
        pgn: normalizedGameToPgn(game),
    }));
    return {
        chapters,
        hash: await hashText(chapters.map((chapter) => chapter.pgn.trim()).join("\n\n")),
    };
}

async function pushLocalChaptersToLichessStudy({
    studyId,
    token,
    chapters,
    chapterRefs,
}: {
    studyId: string;
    token: string;
    chapters: Awaited<ReturnType<typeof getLocalStudyPgnSnapshot>>["chapters"];
    chapterRefs: LichessStudyDatabaseUpdateRecord["chapterRefs"];
}) {
    const nextRefs = [...(chapterRefs ?? [])];

    for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index];
        const existingRef = nextRefs[index];
        if (existingRef?.chapterId) {
            await pushLichessStudyChapterPgn({
                studyId,
                chapterId: existingRef.chapterId,
                pgn: chapter.pgn,
                token,
            });
            nextRefs[index] = {
                ...existingRef,
                chapterName: existingRef.chapterName ?? chapter.game.event,
                sourceSite: chapter.game.site || existingRef.sourceSite,
                localGameId: chapter.game.id,
            };
        } else {
            const created = await importLichessStudyChapter({
                studyId,
                token,
                pgn: chapter.pgn,
                name: chapter.game.event || `${chapter.game.white} - ${chapter.game.black}`,
            });
            nextRefs[index] = {
                chapterId: created.chapterId,
                chapterName: created.chapterName,
                chapterUrl: `https://lichess.org/study/${studyId}/${created.chapterId}`,
                sourceSite: chapter.game.site || null,
                localGameId: chapter.game.id,
            };
        }
    }

    return nextRefs.slice(0, chapters.length);
}

async function importLichessStudyChapter({
    studyId,
    token,
    pgn,
    name,
}: {
    studyId: string;
    token: string;
    pgn: string;
    name: string;
}) {
    const body = new URLSearchParams({ pgn, name: name.slice(0, 100) || "Imported chapter" });
    const response = await fetch(`https://lichess.org/api/study/${studyId}/import-pgn`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });
    if (!response.ok) {
        throw new Error(
            `Lichess study chapter import failed: ${response.status} ${response.statusText}`,
        );
    }
    const payload = (await response.json()) as {
        chapters?: Array<{ id?: string; name?: string | null }>;
    };
    const chapter = payload.chapters?.[0];
    if (!chapter?.id) {
        throw new Error("Lichess did not return the created study chapter id.");
    }
    return {
        chapterId: chapter.id,
        chapterName: chapter.name ?? name,
    };
}

export function useLichessStudyDatabaseAutoUpdater() {
    const [records, setRecords] = useAtom(lichessStudyDatabaseUpdatesAtom);
    const [linkedFolders, setLinkedFolders] = useAtom(databaseLinkedFoldersAtom);
    const [conversionState, setConversionState] = useAtom(databaseConversionStateAtom);
    const [sessions] = useAtom(sessionsAtom);
    const runningRef = useRef(false);
    const recordsRef = useRef(records);
    const linkedFoldersRef = useRef(linkedFolders);
    const conversionStateRef = useRef(conversionState);
    const sessionsRef = useRef(sessions);

    useEffect(() => {
        recordsRef.current = records;
    }, [records]);

    useEffect(() => {
        linkedFoldersRef.current = linkedFolders;
    }, [linkedFolders]);

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
                    linkedFolders: linkedFoldersRef.current,
                    sessions: sessionsRef.current,
                    setConversionState,
                    setUpdateRecords: setRecords,
                    setLinkedFolders,
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
    }, [setConversionState, setLinkedFolders, setRecords]);
}

async function syncLinkedFolderForUpdatedStudy(
    dbPath: string,
    studyTitle: string,
    linkedFolders: DatabaseLinkedFolderRecords,
    setLinkedFolders: SetDatabaseLinkedFolderRecords,
) {
    const record = getDatabaseLinkedFolderRecord(dbPath, linkedFolders);
    if (!record) return;

    const database = successfulDatabases(await getDatabases()).find(
        (candidate) => candidate.file === dbPath,
    );
    if (!database) return;

    try {
        const { record: syncedRecord } = await syncDatabaseLinkedFolder({
            sourcePath: database.file,
            title: database.title,
            gameCount: database.game_count,
            fileNamePrefix: studyTitle,
            record: {
                ...record,
                dbPath: database.file,
                title: database.title,
            },
        });
        setLinkedFolders((records) => upsertDatabaseLinkedFolderRecord(records, syncedRecord));
    } catch (error) {
        warn(`Failed to sync linked Files folder for ${database.title}: ${error}`);
    }
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
        sourceKind: null,
        startedAt: null,
        updatedAt: Date.now(),
        totalGames: 0,
        totalGamesExpected: null,
        elapsedSeconds: 0,
        targetDatabasePath: null,
        targetDatabaseTitle: null,
        sourceFileName: null,
    }));
}
