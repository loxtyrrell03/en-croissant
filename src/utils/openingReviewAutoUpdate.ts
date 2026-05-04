import type { SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { warn } from "@tauri-apps/plugin-log";
import { useAtomValue, useSetAtom } from "jotai";
import type { RepertoireGap } from "@/bindings";
import { commands } from "@/bindings";
import { createOpeningHealthTrainingItem, type Position } from "@/components/files/opening";
import {
    type OnlineDatabaseUpdateRecord,
    type OnlineDatabaseUpdateRecords,
    type OpeningReviewAutoUpdateState,
    onlineDatabaseUpdatesAtom,
    openingReviewAutoUpdateStateAtom,
} from "@/state/atoms";
import { query_players } from "@/utils/db";
import { getDocumentDir } from "@/utils/directories";
import {
    type OpeningReviewAutoUpdateConfig,
    type OpeningReviewDeck,
    listOpeningReviewDecks,
    mergeOpeningReviewPositions,
    readOpeningReviewDeck,
    reviewPositionKey,
    writeOpeningReviewDeck,
} from "@/utils/openingReview";
import {
    getOpeningHealthDateBounds,
    type OpeningHealthDateBounds,
} from "@/utils/openingHealthDateFilter";

const AUTO_UPDATE_TOP_REFERENCE_MOVES = 3;
const UNSUPPORTED_ONLINE_REFERENCE_PREFIX = "online:";
const OPENING_REVIEW_AUTO_UPDATE_INITIAL_DELAY_MS = 30 * 1000;

type AutoUpdateJob = {
    path: string;
    deck: OpeningReviewDeck;
    config: OpeningReviewAutoUpdateConfig;
    record: OnlineDatabaseUpdateRecord;
};

type SetOpeningReviewAutoUpdateState = (
    value: SetStateAction<OpeningReviewAutoUpdateState>,
) => void;

export function useOpeningReviewDeckAutoUpdater() {
    const records = useAtomValue(onlineDatabaseUpdatesAtom);
    const setState = useSetAtom(openingReviewAutoUpdateStateAtom);
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
        const runLatest = () => {
            const latestRecords = recordsRef.current;
            const recordsKey = getOnlineRecordsUpdateKey(latestRecords);
            if (recordsKey === recordsKeyRef.current) return;
            if (runningRef.current) return;
            recordsKeyRef.current = recordsKey;

            runningRef.current = true;
            void runOpeningReviewAutoUpdates(latestRecords, setState, () => disposedRef.current)
                .catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    warn(`Opening Review auto-update failed: ${message}`);
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
        };

        if (!initialDelayDoneRef.current) {
            if (initialTimerRef.current === null) {
                initialTimerRef.current = window.setTimeout(() => {
                    initialDelayDoneRef.current = true;
                    initialTimerRef.current = null;
                    runLatest();
                }, OPENING_REVIEW_AUTO_UPDATE_INITIAL_DELAY_MS);
            }
            return;
        }

        runLatest();
    }, [records, setState]);
}

export async function runOpeningReviewAutoUpdates(
    records: OnlineDatabaseUpdateRecords,
    setState: SetOpeningReviewAutoUpdateState,
    isDisposed: () => boolean = () => false,
) {
    const jobs = await collectOpeningReviewAutoUpdateJobs(records);
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
            phase: "Analyzing gaps",
            progress: (index / jobs.length) * 100,
            deckName: job.deck.name,
            deckPath: job.path,
            databaseTitle: job.record.title,
            checkedDecks: index,
        }));

        try {
            const result = await updateOpeningReviewDeckFromOnlineDatabase(job, setState);
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
            warn(`Opening Review auto-update failed for ${job.deck.name}: ${message}`);
            await writeAutoUpdateError(job, message).catch((writeError) => {
                warn(`Could not save Opening Review auto-update error: ${writeError}`);
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

async function collectOpeningReviewAutoUpdateJobs(
    records: OnlineDatabaseUpdateRecords,
): Promise<AutoUpdateJob[]> {
    const documentDir = await getDocumentDir();
    const summaries = await listOpeningReviewDecks(documentDir);
    const jobs: AutoUpdateJob[] = [];

    for (const summary of summaries) {
        const deck = await readOpeningReviewDeck(summary.path).catch(() => null);
        if (!deck?.autoUpdate?.enabled) continue;

        const config = deck.autoUpdate;
        const record = records[config.playerDb];
        if (!record) continue;

        const recordUpdatedAt = record.lastUpdatedAt ?? 0;
        const recordGameCount = record.lastKnownGameCount ?? 0;
        const deckSawGameCount = config.lastKnownGameCount ?? 0;
        const hasMoreGames = recordGameCount > deckSawGameCount;
        if (!recordUpdatedAt || !hasMoreGames) continue;

        jobs.push({ path: summary.path, deck, config, record });
    }

    return jobs;
}

async function updateOpeningReviewDeckFromOnlineDatabase(
    job: AutoUpdateJob,
    setState: SetOpeningReviewAutoUpdateState,
) {
    const { config, deck, path, record } = job;
    if (config.referenceDb.startsWith(UNSUPPORTED_ONLINE_REFERENCE_PREFIX)) {
        throw new Error("Automatic deck updates need a local strong-games source.");
    }

    const playerId = await resolveOpeningReviewAutoUpdatePlayerId(config);
    if (playerId === null) {
        throw new Error("Choose a player in this deck's Opening gap settings.");
    }
    const requestId = `opening-review-auto-${Date.now()}`;
    const dateBounds = getOpeningHealthDateBounds(
        config.dateRange ?? "all",
        config.startDate,
        config.endDate,
    );
    setState((current) => ({
        ...current,
        phase: "Scanning games",
        progress: current.progress === null ? null : Math.min(95, current.progress + 10),
    }));

    const result = await commands.findRepertoireGaps({
        playerDb: config.playerDb,
        referenceDb: config.referenceDb,
        playerId,
        color: "any",
        maxPlies: config.maxPlies,
        minPlayerGames: config.minPlayerGames,
        minReferenceGames: config.minReferenceGames,
        topReferenceMoves: config.topReferenceMoves || AUTO_UPDATE_TOP_REFERENCE_MOVES,
        startDate: dateBounds.startDate,
        endDate: dateBounds.endDate,
        requestId,
    });

    if (result.status === "error") {
        throw new Error(result.error);
    }

    const sortedGaps = [...result.data.gaps].sort(
        (a, b) =>
            openingReviewGapUrgency(b) - openingReviewGapUrgency(a) ||
            b.playerPositionGames - a.playerPositionGames ||
            openingReviewRecencyScore(b.lastPlayed) - openingReviewRecencyScore(a.lastPlayed) ||
            a.ply - b.ply,
    );
    const positions = sortedGaps
        .map((gap) => createAutoUpdatedOpeningReviewPosition(gap, config.mode, dateBounds))
        .filter((position): position is Position => Boolean(position));
    const existingKeys = new Set(deck.positions.map(reviewPositionKey));
    const now = Date.now();
    const merged = mergeOpeningReviewPositions(deck, positions);
    const cappedPositions = capOpeningReviewPositions(
        merged.positions,
        getConfiguredMaxPositions(config),
    );
    const cappedKeys = new Set(cappedPositions.map(reviewPositionKey));
    const added = positions.filter((position) => {
        const key = reviewPositionKey(position);
        return !existingKeys.has(key) && cappedKeys.has(key);
    }).length;

    await writeOpeningReviewDeck(path, {
        ...merged,
        positions: cappedPositions,
        autoUpdate: {
            ...config,
            color: "any",
            lastRunAt: now,
            lastUpdatedDatabaseAt: record.lastUpdatedAt,
            lastKnownGameCount: record.lastKnownGameCount,
            lastAdded: added,
            lastError: null,
            updatedAt: now,
        },
    });

    return { added, total: positions.length };
}

async function writeAutoUpdateError(job: AutoUpdateJob, message: string) {
    await writeOpeningReviewDeck(job.path, {
        ...job.deck,
        autoUpdate: {
            ...job.config,
            lastRunAt: Date.now(),
            lastError: message,
        },
    });
}

async function resolveOpeningReviewAutoUpdatePlayerId(config: OpeningReviewAutoUpdateConfig) {
    if (!config.playerName?.trim()) {
        return config.playerId ?? null;
    }

    const players = await query_players(config.playerDb, {
        name: config.playerName,
        range: null,
        options: {
            skipCount: true,
            page: 1,
            pageSize: 25,
            sort: "name",
            direction: "asc",
        },
    }).catch(() => null);
    const normalizedTarget = normalizeOpeningReviewPlayerName(config.playerName);
    const exact = players?.data.find(
        (player) => normalizeOpeningReviewPlayerName(player.name) === normalizedTarget,
    );

    return exact?.id ?? config.playerId ?? players?.data[0]?.id ?? null;
}

function createAutoUpdatedOpeningReviewPosition(
    gap: RepertoireGap,
    mode: "self" | "opponent",
    dateBounds: OpeningHealthDateBounds,
) {
    const trainingMove = getAutoUpdateTrainingMove(gap);
    if (!trainingMove) return null;
    const strongMoveResult = gap.topReferenceMoves.find((move) => move.uci === gap.playerMoveUci);
    const topMove = gap.topReferenceMoves[0];
    const sideToMove = gap.sideToMove === "black" ? "black" : "white";

    return createOpeningHealthTrainingItem(gap, trainingMove, {
        priority: openingReviewGapUrgency(gap),
        importedAt: Date.now(),
        reason: getOpeningReviewGapReason(gap, mode),
        evidence: `${formatReviewNumber(gap.playerPositionGames)} games; ${formatOpeningReviewLastPlayed(
            gap.lastPlayed,
        )}; result ${formatReviewPercent(gap.playerScore)}`,
        openingHealth: {
            mode,
            sideToMove,
            reviewSide: getOpeningReviewSide(mode, sideToMove),
            usualMoveSan: gap.playerMoveSan,
            usualMoveUci: gap.playerMoveUci,
            games: gap.playerPositionGames,
            white: gap.playerWhite,
            draw: gap.playerDraw,
            black: gap.playerBlack,
            score: gap.playerScore,
            strongGames: gap.referenceGames,
            strongWhite: strongMoveResult?.white ?? null,
            strongDraw: strongMoveResult?.draw ?? null,
            strongBlack: strongMoveResult?.black ?? null,
            strongScore: strongMoveResult?.scoreForSide ?? gap.referenceScore,
            topMoveSan: topMove?.san ?? null,
            topMoveUci: topMove?.uci ?? null,
            lastPlayed: gap.lastPlayed,
            dateRange: dateBounds.range,
            startDate: dateBounds.startDate,
            endDate: dateBounds.endDate,
        },
    });
}

function getOpeningReviewSide(mode: "self" | "opponent", sideToMove: "white" | "black") {
    if (mode === "opponent") return sideToMove === "white" ? "black" : "white";
    return sideToMove;
}

function capOpeningReviewPositions(positions: Position[], maxPositions: number) {
    if (maxPositions <= 0 || positions.length <= maxPositions) return positions;

    return rankOpeningReviewPositions(positions)
        .slice(0, maxPositions)
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.position);
}

function getConfiguredMaxPositions(config: OpeningReviewAutoUpdateConfig) {
    return config.maxPositions ?? config.limit ?? 0;
}

function getAutoUpdateTrainingMove(gap: RepertoireGap) {
    if (gap.classification === "preparedUnderperforming") {
        return {
            san: gap.playerMoveSan,
            uci: gap.playerMoveUci,
        };
    }

    const differentMove = gap.topReferenceMoves.find((move) => move.uci !== gap.playerMoveUci);
    const move = differentMove ?? gap.topReferenceMoves[0];
    if (!move) return null;

    return {
        san: move.san,
        uci: move.uci,
    };
}

export function getOpeningReviewGapReason(gap: RepertoireGap, mode: "self" | "opponent") {
    const owner = mode === "self" ? "You" : "They";
    const possessive = mode === "self" ? "your" : "their";
    const topMove = gap.topReferenceMoves[0];

    if (gap.classification === "preparedUnderperforming") {
        return `${owner} made a normal move, but ${possessive} score here is ${formatReviewPercent(
            gap.playerScore,
        )} across ${formatReviewNumber(
            gap.playerPositionGames,
        )} games. Study the plans after ${gap.playerMoveSan}.`;
    }

    if (gap.classification === "repertoireGap") {
        return `${owner} played ${gap.playerMoveSan}, which is rare in strong games.${
            topMove ? ` The main reference move is ${topMove.san}.` : ""
        }`;
    }

    return `There are only ${formatReviewNumber(
        gap.playerPositionGames,
    )} games here, so review this before trusting the line.`;
}

export function rankOpeningReviewPositions(positions: Position[]) {
    return positions
        .map((position, index) => ({
            position,
            index,
            urgency: openingReviewPositionUrgency(position),
            lastPlayedTime: parseOpeningReviewDate(position.openingHealth?.lastPlayed)?.getTime() ?? 0,
        }))
        .sort(
            (a, b) =>
                b.urgency - a.urgency ||
                b.lastPlayedTime - a.lastPlayedTime ||
                (b.position.openingHealth?.games ?? 0) - (a.position.openingHealth?.games ?? 0) ||
                a.index - b.index,
        )
        .map((entry, rank) => ({ ...entry, rank: rank + 1 }));
}

export function openingReviewPositionUrgency(position: Position) {
    const priority = position.priority ?? 0;
    if (priority > 1) return clamp(Math.round(priority), 0, 100);
    return clamp(Math.round(priority * 100), 0, 100);
}

export function openingReviewUrgencyColor(urgency: number) {
    if (urgency >= 75) return "red";
    if (urgency >= 55) return "orange";
    if (urgency >= 35) return "yellow";
    return "blue";
}

export type OpeningReviewGapTrainingType = "openingGap" | "planGap" | "other";

export function getOpeningReviewGapTrainingType(position: Position): OpeningReviewGapTrainingType {
    const health = position.openingHealth;
    const hasUsualMove = Boolean(health?.usualMoveUci || health?.usualMoveSan);

    if (hasUsualMove) {
        return openingReviewSavedAnswerMatches(position, health?.usualMoveUci, health?.usualMoveSan)
            ? "planGap"
            : "openingGap";
    }

    if (health?.classification === "preparedUnderperforming") return "planGap";
    if (health?.classification === "repertoireGap") return "openingGap";

    const normalizedTags = (position.tags ?? []).map(normalizeOpeningReviewText);
    if (
        normalizedTags.includes("openingplangap") ||
        normalizedTags.includes("preparedbutunderperforming")
    ) {
        return "planGap";
    }
    if (normalizedTags.includes("openinggap") || normalizedTags.includes("repertoiregap")) {
        return "openingGap";
    }

    return "other";
}

export function openingReviewGapTrainingTypeLabel(type: OpeningReviewGapTrainingType) {
    switch (type) {
        case "openingGap":
            return "Opening gap";
        case "planGap":
            return "Plan gap";
        case "other":
            return "Other";
    }
}

export function openingReviewGapTrainingTypePluralLabel(type: OpeningReviewGapTrainingType) {
    switch (type) {
        case "openingGap":
            return "opening gaps";
        case "planGap":
            return "plan gaps";
        case "other":
            return "other positions";
    }
}

export function openingReviewGapTrainingTypeColor(type: OpeningReviewGapTrainingType) {
    switch (type) {
        case "openingGap":
            return "orange";
        case "planGap":
            return "blue";
        case "other":
            return "gray";
    }
}

export function openingReviewPositionExplanation(position: Position) {
    if (position.reason) return position.reason;
    if (position.openingHealth) {
        const health = position.openingHealth;
        const owner = health.mode === "opponent" ? "They" : "You";
        if (
            health.topMoveUci &&
            health.usualMoveUci &&
            health.topMoveUci !== health.usualMoveUci
        ) {
            return `${owner} usually played ${health.usualMoveSan ?? "this move"}, while strong games prefer ${health.topMoveSan ?? "another move"}.`;
        }
        return `${owner} reached this position ${formatReviewNumber(
            health.games ?? 0,
        )} times; review the plans after ${position.answer}.`;
    }
    return position.evidence || "Saved for Opening Review.";
}

function openingReviewSavedAnswerMatches(
    position: Position,
    uci: string | null | undefined,
    san: string | null | undefined,
) {
    return openingReviewMoveFieldsMatch(position.answerUci, position.answer, uci, san);
}

function openingReviewMoveFieldsMatch(
    aUci: string | null | undefined,
    aSan: string | null | undefined,
    bUci: string | null | undefined,
    bSan: string | null | undefined,
) {
    if (aUci && bUci && aUci.toLowerCase() === bUci.toLowerCase()) return true;

    const normalizedA = normalizeOpeningReviewMove(aSan);
    const normalizedB = normalizeOpeningReviewMove(bSan);
    return Boolean(normalizedA && normalizedB && normalizedA === normalizedB);
}

function normalizeOpeningReviewMove(value: string | null | undefined) {
    return (value ?? "")
        .replace(/[+#?!\s]/g, "")
        .replace(/e\.p\.$/i, "")
        .toLowerCase();
}

function normalizeOpeningReviewText(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function formatOpeningReviewLastPlayed(value: string | null | undefined) {
    const date = parseOpeningReviewDate(value);
    if (!date) return "Last played unknown";

    const iso = date.toISOString().slice(0, 10);
    const ageDays = Math.max(0, Math.round((Date.now() - date.getTime()) / 86_400_000));
    if (ageDays === 0) return `Last played ${iso} (today)`;
    if (ageDays === 1) return `Last played ${iso} (yesterday)`;
    if (ageDays < 45) return `Last played ${iso} (${ageDays} days ago)`;

    const ageMonths = Math.round(ageDays / 30.44);
    if (ageMonths < 18) {
        return `Last played ${iso} (${ageMonths} month${ageMonths === 1 ? "" : "s"} ago)`;
    }

    const ageYears = Math.round(ageMonths / 12);
    return `Last played ${iso} (${ageYears} year${ageYears === 1 ? "" : "s"} ago)`;
}

export function parseOpeningReviewDate(value: string | null | undefined) {
    const match = value?.match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || !month || !day) return null;

    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
}

function openingReviewGapUrgency(gap: RepertoireGap) {
    const frequency = clamp(Math.log1p(gap.playerPositionGames) / Math.log1p(1000), 0, 1);
    const recency = openingReviewRecencyScore(gap.lastPlayed);
    const resultGap = clamp(gap.scoreGap / 0.3, 0, 1);
    const poorAbsoluteScore = clamp((0.55 - gap.playerScore) / 0.4, 0, 1);
    const sampleConfidence = clamp(Math.log1p(gap.playerPositionGames) / Math.log1p(40), 0.35, 1);
    const resultPressure = (resultGap * 0.72 + poorAbsoluteScore * 0.28) * sampleConfidence;
    const unusualMove = clamp(gap.popularityGap, 0, 1);
    return resultPressure * 0.48 + frequency * 0.28 + recency * 0.18 + unusualMove * 0.06;
}

function openingReviewRecencyScore(lastPlayed: string | null | undefined) {
    const date = parseOpeningReviewDate(lastPlayed);
    if (!date) return 0.35;

    const ageYears = Math.max(0, (Date.now() - date.getTime()) / 31_557_600_000);
    return clamp(Math.exp(-ageYears / 4), 0.08, 1);
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

function normalizeOpeningReviewPlayerName(value: string | null | undefined) {
    return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatReviewPercent(value: number) {
    return `${Math.round(value * 100)}%`;
}

function formatReviewNumber(value: number) {
    return new Intl.NumberFormat().format(value);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
