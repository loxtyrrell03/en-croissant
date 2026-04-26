import type { SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { warn } from "@tauri-apps/plugin-log";
import { useAtomValue, useSetAtom } from "jotai";
import { commands } from "@/bindings";
import {
    type MistakeReviewAutoUpdateState,
    type OnlineDatabaseUpdateRecord,
    type OnlineDatabaseUpdateRecords,
    mistakeReviewAutoUpdateStateAtom,
    onlineDatabaseUpdatesAtom,
} from "@/state/atoms";
import {
    createMistakeReviewPosition,
    listMistakeReviewDecks,
    mergeMistakeReviewPositions,
    mistakeReviewPositionKey,
    mistakeReviewRequestFromSettings,
    type MistakeReviewAutoUpdateConfig,
    type MistakeReviewDeck,
    readMistakeReviewDeck,
    writeMistakeReviewDeck,
} from "@/utils/mistakeReview";
import { getDocumentDir } from "@/utils/directories";

type AutoUpdateJob = {
    path: string;
    deck: MistakeReviewDeck;
    config: MistakeReviewAutoUpdateConfig;
    record: OnlineDatabaseUpdateRecord;
};

type SetMistakeReviewAutoUpdateState = (
    value: SetStateAction<MistakeReviewAutoUpdateState>,
) => void;

export function useMistakeReviewDeckAutoUpdater() {
    const records = useAtomValue(onlineDatabaseUpdatesAtom);
    const setState = useSetAtom(mistakeReviewAutoUpdateStateAtom);
    const runningRef = useRef(false);
    const recordsKeyRef = useRef("");
    const disposedRef = useRef(false);

    useEffect(
        () => () => {
            disposedRef.current = true;
        },
        [],
    );

    useEffect(() => {
        const recordsKey = getOnlineRecordsUpdateKey(records);
        if (recordsKey === recordsKeyRef.current) return;
        if (runningRef.current) return;
        recordsKeyRef.current = recordsKey;

        runningRef.current = true;
        void runMistakeReviewAutoUpdates(records, setState, () => disposedRef.current)
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                warn(`Mistake Review auto-update failed: ${message}`);
                setState((current) => ({
                    ...current,
                    running: false,
                    completedAt: Date.now(),
                    phase: "Stopped",
                    error: message,
                    revision: current.revision + 1,
                }));
            })
            .finally(() => {
                runningRef.current = false;
            });
    }, [records, setState]);
}

export async function runMistakeReviewAutoUpdates(
    records: OnlineDatabaseUpdateRecords,
    setState: SetMistakeReviewAutoUpdateState,
    isDisposed: () => boolean = () => false,
) {
    const jobs = await collectMistakeReviewAutoUpdateJobs(records);
    if (jobs.length === 0 || isDisposed()) return;

    let added = 0;
    let updatedDecks = 0;
    const updatedDeckPaths: string[] = [];
    const startedAt = Date.now();

    setState((current) => ({
        ...current,
        running: true,
        phase: "Preparing",
        progress: 0,
        deckName: jobs[0]?.deck.name ?? null,
        deckPath: jobs[0]?.path ?? null,
        databaseTitle: jobs[0]?.record.title ?? null,
        startedAt,
        completedAt: null,
        added: 0,
        checkedDecks: 0,
        updatedDecks: 0,
        error: null,
        updatedDeckPaths: [],
    }));

    for (let index = 0; index < jobs.length; index += 1) {
        if (isDisposed()) return;
        const job = jobs[index]!;

        setState((current) => ({
            ...current,
            phase: "Scanning new games",
            progress: (index / jobs.length) * 100,
            deckName: job.deck.name,
            deckPath: job.path,
            databaseTitle: job.record.title,
            checkedDecks: index,
        }));

        try {
            const result = await updateMistakeReviewDeckFromOnlineDatabase(job);
            added += result.added;
            updatedDecks += 1;
            updatedDeckPaths.push(job.path);
            setState((current) => ({
                ...current,
                added,
                updatedDecks,
                updatedDeckPaths: [...updatedDeckPaths],
                progress: ((index + 1) / jobs.length) * 100,
                checkedDecks: index + 1,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warn(`Mistake Review auto-update failed for ${job.deck.name}: ${message}`);
            await writeAutoUpdateError(job, message).catch((writeError) => {
                warn(`Could not save Mistake Review auto-update error: ${writeError}`);
            });
            setState((current) => ({
                ...current,
                error: message,
                checkedDecks: index + 1,
                progress: ((index + 1) / jobs.length) * 100,
            }));
        }
    }

    setState((current) => ({
        ...current,
        running: false,
        phase: "Done",
        progress: 100,
        completedAt: Date.now(),
        added,
        checkedDecks: jobs.length,
        updatedDecks,
        updatedDeckPaths,
        revision: current.revision + 1,
    }));
}

async function collectMistakeReviewAutoUpdateJobs(
    records: OnlineDatabaseUpdateRecords,
): Promise<AutoUpdateJob[]> {
    const documentDir = await getDocumentDir();
    const summaries = await listMistakeReviewDecks(documentDir);
    const jobs: AutoUpdateJob[] = [];

    for (const summary of summaries) {
        const deck = await readMistakeReviewDeck(summary.path).catch(() => null);
        if (!deck?.autoUpdate?.enabled) continue;

        const config = deck.autoUpdate;
        const record = records[config.playerDb];
        if (!record) continue;

        const recordGameCount = record.lastKnownGameCount ?? 0;
        const deckSawGameCount = config.lastKnownGameCount ?? 0;
        if (recordGameCount <= deckSawGameCount) continue;

        jobs.push({ path: summary.path, deck, config, record });
    }

    return jobs;
}

async function updateMistakeReviewDeckFromOnlineDatabase(job: AutoUpdateJob) {
    const { config, deck, path, record } = job;
    const now = Date.now();
    const result = await commands.scanMistakeReview(
        mistakeReviewRequestFromSettings(config, {
            requestId: `mistake-review-auto-${now}`,
            sinceGameId: config.lastAnalyzedGameId ?? null,
        }),
    );

    if (result.status === "error") {
        throw new Error(result.error);
    }

    const positions = result.data.mistakes.map((mistake) =>
        createMistakeReviewPosition(mistake, config),
    );
    const existingKeys = new Set(deck.positions.map(mistakeReviewPositionKey));
    const merged = mergeMistakeReviewPositions(deck, positions);
    const added = positions.filter((position) => !existingKeys.has(mistakeReviewPositionKey(position))).length;

    await writeMistakeReviewDeck(path, {
        ...merged,
        autoUpdate: {
            ...config,
            lastRunAt: now,
            lastUpdatedDatabaseAt: record.lastUpdatedAt,
            lastKnownGameCount: record.lastKnownGameCount,
            lastAnalyzedGameId: result.data.lastAnalyzedGameId ?? config.lastAnalyzedGameId ?? null,
            lastAdded: added,
            lastError: null,
            updatedAt: now,
        },
    });

    return { added, total: positions.length };
}

async function writeAutoUpdateError(job: AutoUpdateJob, message: string) {
    await writeMistakeReviewDeck(job.path, {
        ...job.deck,
        autoUpdate: {
            ...job.config,
            lastRunAt: Date.now(),
            lastError: message,
        },
    });
}

function getOnlineRecordsUpdateKey(records: OnlineDatabaseUpdateRecords) {
    return Object.values(records)
        .map(
            (record) =>
                `${record.dbPath}:${record.lastUpdatedAt ?? 0}:${record.lastKnownGameCount ?? 0}`,
        )
        .sort()
        .join("|");
}
