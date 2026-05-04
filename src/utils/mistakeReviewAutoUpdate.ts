import type { SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { warn } from "@tauri-apps/plugin-log";
import { useAtomValue, useSetAtom } from "jotai";
import { commands, type Player } from "@/bindings";
import type { Position } from "@/components/files/opening";
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
import { query_players } from "@/utils/db";
import { getDocumentDir } from "@/utils/directories";
import { getOnlineDatabaseUpdateAccounts } from "@/utils/onlineGameImport";

const MISTAKE_REVIEW_AUTO_UPDATE_INITIAL_DELAY_MS = 30 * 1000;

type AutoUpdateJob = {
    path: string;
    deck: MistakeReviewDeck;
    config: MistakeReviewAutoUpdateConfig;
    record: OnlineDatabaseUpdateRecord;
};

type SetMistakeReviewAutoUpdateState = (
    value: SetStateAction<MistakeReviewAutoUpdateState>,
) => void;

export type MistakeReviewScanTarget = {
    playerId: number;
    playerName?: string | null;
};

export function useMistakeReviewDeckAutoUpdater() {
    const records = useAtomValue(onlineDatabaseUpdatesAtom);
    const setState = useSetAtom(mistakeReviewAutoUpdateStateAtom);
    const runningRef = useRef(false);
    const recordsKeyRef = useRef("");
    const recordsRef = useRef(records);
    const disposedRef = useRef(false);
    const initialDelayDoneRef = useRef(false);
    const initialTimerRef = useRef<number | null>(null);

    useEffect(
        () => () => {
            disposedRef.current = true;
            if (initialTimerRef.current !== null) {
                window.clearTimeout(initialTimerRef.current);
            }
        },
        [],
    );

    useEffect(() => {
        recordsRef.current = records;
    }, [records]);

    useEffect(() => {
        if (runningRef.current) return;

        const runLatest = () => {
            if (disposedRef.current || runningRef.current) return;

            const latestRecords = recordsRef.current;
            const recordsKey = getOnlineRecordsUpdateKey(latestRecords);
            if (recordsKey === recordsKeyRef.current) return;
            recordsKeyRef.current = recordsKey;
            runningRef.current = true;

            void runMistakeReviewAutoUpdates(latestRecords, setState, () => disposedRef.current)
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
                    runLatest();
                });
        };

        if (!initialDelayDoneRef.current) {
            if (initialTimerRef.current === null) {
                initialTimerRef.current = window.setTimeout(() => {
                    initialDelayDoneRef.current = true;
                    initialTimerRef.current = null;
                    runLatest();
                }, MISTAKE_REVIEW_AUTO_UPDATE_INITIAL_DELAY_MS);
            }
            return;
        }

        runLatest();
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

        const recordUpdatedAt = record.lastUpdatedAt ?? 0;
        const recordGameCount = record.lastKnownGameCount ?? 0;
        const deckSawGameCount = config.lastKnownGameCount ?? 0;
        const deckSawDatabaseUpdate = config.lastUpdatedDatabaseAt ?? 0;
        const hasMoreGames = recordGameCount > deckSawGameCount;
        const hasNewDatabaseUpdate = recordUpdatedAt > deckSawDatabaseUpdate;
        if (!recordUpdatedAt || (!hasMoreGames && !hasNewDatabaseUpdate)) continue;

        jobs.push({ path: summary.path, deck, config, record });
    }

    return jobs;
}

async function updateMistakeReviewDeckFromOnlineDatabase(job: AutoUpdateJob) {
    const { config, deck, path, record } = job;
    const now = Date.now();
    const targets = await getMistakeReviewAutoUpdateScanTargets(config, record);
    const positions: Position[] = [];
    let lastAnalyzedGameId = config.lastAnalyzedGameId ?? null;

    for (const [index, target] of targets.entries()) {
        const scanSettings = {
            ...config,
            playerId: target.playerId,
            playerName: target.playerName ?? config.playerName,
        };
        const result = await commands.scanMistakeReview(
            mistakeReviewRequestFromSettings(scanSettings, {
                requestId: `mistake-review-auto-${now}-${index}`,
                sinceGameId: config.lastAnalyzedGameId ?? null,
            }),
        );

        if (result.status === "error") {
            throw new Error(result.error);
        }

        positions.push(
            ...result.data.mistakes.map((mistake) =>
                createMistakeReviewPosition(mistake, scanSettings),
            ),
        );
        if (result.data.lastAnalyzedGameId !== null) {
            lastAnalyzedGameId =
                lastAnalyzedGameId === null
                    ? result.data.lastAnalyzedGameId
                    : Math.max(lastAnalyzedGameId, result.data.lastAnalyzedGameId);
        }
    }

    const existingKeys = new Set(deck.positions.map(mistakeReviewPositionKey));
    const merged = mergeMistakeReviewPositions(deck, positions);
    const added = positions.filter(
        (position) => !existingKeys.has(mistakeReviewPositionKey(position)),
    ).length;

    await writeMistakeReviewDeck(path, {
        ...merged,
        autoUpdate: {
            ...config,
            lastRunAt: now,
            lastUpdatedDatabaseAt: record.lastUpdatedAt,
            lastKnownGameCount: record.lastKnownGameCount,
            lastAnalyzedGameId,
            lastAdded: added,
            lastError: null,
            updatedAt: now,
        },
    });

    return { added, total: positions.length };
}

async function getMistakeReviewAutoUpdateScanTargets(
    config: MistakeReviewAutoUpdateConfig,
    record: OnlineDatabaseUpdateRecord,
): Promise<MistakeReviewScanTarget[]> {
    const targets: MistakeReviewScanTarget[] = [];
    const seen = new Set<number>();
    const addTarget = (target: MistakeReviewScanTarget | null) => {
        if (!target || seen.has(target.playerId)) return;
        seen.add(target.playerId);
        targets.push(target);
    };

    for (const target of await resolveMistakeReviewPlayersByName(
        config.playerDb,
        config.playerName,
    )) {
        addTarget(target);
    }
    addTarget({ playerId: config.playerId, playerName: config.playerName });

    for (const playerName of getMistakeReviewAutoUpdatePlayerNameCandidates(config, record)) {
        for (const target of await resolveMistakeReviewPlayersByName(config.playerDb, playerName)) {
            addTarget(target);
        }
    }

    return targets;
}

export function getMistakeReviewAutoUpdatePlayerNameCandidates(
    config: MistakeReviewAutoUpdateConfig,
    record: OnlineDatabaseUpdateRecord,
) {
    const names: string[] = [];
    const seen = new Set<string>();
    const addName = (value: string | null | undefined) => {
        const name = value?.trim();
        const key = normalizeMistakeReviewPlayerName(name);
        if (!name || !key || seen.has(key)) return;
        seen.add(key);
        names.push(name);
    };

    addName(config.playerName);
    for (const account of getOnlineDatabaseUpdateAccounts(record)) {
        addName(account.username);
    }
    addName(record.username);

    return names;
}

async function resolveMistakeReviewPlayersByName(
    playerDb: string,
    playerName: string | null | undefined,
): Promise<MistakeReviewScanTarget[]> {
    if (!playerName?.trim()) return [];

    const players = await query_players(playerDb, {
        name: playerName,
        range: null,
        options: {
            skipCount: true,
            page: 1,
            pageSize: 100,
            sort: "name",
            direction: "asc",
        },
    }).catch(() => null);

    return selectMistakeReviewPlayerTargets(players?.data ?? [], playerName);
}

export function selectMistakeReviewPlayerTargets(
    players: Pick<Player, "id" | "name">[],
    playerName: string | null | undefined,
): MistakeReviewScanTarget[] {
    const normalizedTarget = normalizeMistakeReviewPlayerName(playerName);
    if (!normalizedTarget) return [];

    return players
        .filter((player) => normalizeMistakeReviewPlayerName(player.name) === normalizedTarget)
        .map((player) => ({
            playerId: player.id,
            playerName: player.name ?? playerName,
        }));
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
                `${record.dbPath}:${record.lastUpdatedAt ?? 0}:${record.lastKnownGameCount ?? 0}:${getOnlineDatabaseUpdateAccounts(
                    record,
                )
                    .map(
                        (account) =>
                            `${account.source}:${account.username}:${account.lastUpdatedAt ?? 0}:${account.lastKnownGameCount ?? 0}`,
                    )
                    .sort()
                    .join(",")}`,
        )
        .sort()
        .join("|");
}

export function normalizeMistakeReviewPlayerName(value: string | null | undefined) {
    return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
