import type { DrawShape } from "@lichess-org/chessground/draw";
import type { MantineColor } from "@mantine/core";
import { resolve } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseUci } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import equal from "fast-deep-equal";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily, atomWithStorage, createJSONStorage, unwrap } from "jotai/utils";
import type { AtomFamily } from "jotai/vanilla/utils/atomFamily";
import type {
    AsyncStorage,
    AsyncStringStorage,
    SyncStorage,
} from "jotai/vanilla/utils/atomWithStorage";
import type { ReviewLog } from "ts-fsrs";
import { z } from "zod";
import type { BestMoves, GoMode, PlanExplorerData, RepertoireGapReport, Score } from "@/bindings";
import { DEFAULT_TIME_CONTROL, type OpponentSettings } from "@/components/boards/OpponentForm";
import { type Position, positionSchema } from "@/components/files/opening";
import type { LocalOptions } from "@/components/panels/database/DatabasePanel";
import { positionFromFen, swapMove } from "@/utils/chessops";
import type { SuccessDatabaseInfo } from "@/utils/db";
import { type Engine, type EngineSettings, engineSchema } from "@/utils/engines";
import type { EnginePlanReport } from "@/utils/enginePlanExplorer";
import type { OpeningMoveHealthSidePreference } from "@/utils/openingMoveHealth";
import type { OnlineGameSource } from "@/utils/onlineGameSource";
import type { ColoredPlanExplorerLine } from "@/utils/planExplorer";
import {
    type LichessGamesOptions,
    lichessGamesOptionsSchema,
    type MasterGamesOptions,
    masterOptionsSchema,
} from "@/utils/lichess/explorer";
import { getWinChance, normalizeScore } from "@/utils/score";
import { type Tab, tabSchema } from "@/utils/tabs";
import { getEnginesDir } from "../utils/directories";
import type { Session } from "../utils/session";
import { createAsyncZodStorage, createZodStorage } from "./utils";

const zodArray = <Input, Output>(itemSchema: z.ZodType<Output, z.ZodTypeDef, Input>) => {
    const catchValue = {} as never;

    const res = z
        .array(itemSchema.catch(catchValue))
        .transform((a) => a.filter((o): o is Output => o !== catchValue))
        .catch([]);

    return res as z.ZodType<Output[], z.ZodTypeDef, Input[]>;
};

// Tabs

export const tabsAtom = atomWithStorage<Tab[]>(
    "tabs",
    [],
    createZodStorage(z.array(tabSchema), sessionStorage),
);

export const activeTabAtom = atomWithStorage<string | null>(
    "activeTab",
    null,
    createJSONStorage(() => sessionStorage),
);

export const expandedDirectoriesAtom = atomWithStorage<string[]>(
    "expanded-directories",
    [],
    createZodStorage(z.array(z.string()), sessionStorage),
);

export const currentTabAtom = atom(
    (get) => {
        const tabs = get(tabsAtom);
        const activeTab = get(activeTabAtom);
        return (
            tabs.find((tab) => tab.value === activeTab) ?? tabs.find((tab) => tab.type !== "new")
        );
    },
    (get, set, newValue: Tab | ((currentTab: Tab) => Tab)) => {
        const tabs = get(tabsAtom);
        const currentTab = get(currentTabAtom);
        if (!currentTab) return;
        const nextValue = typeof newValue === "function" ? newValue(currentTab) : newValue;
        const newTabs = tabs.map((tab) => {
            if (tab.value === currentTab.value) {
                return nextValue;
            }
            return tab;
        });
        set(tabsAtom, newTabs);
    },
);

// Directories
export const storedDocumentDirAtom = atomWithStorage<string>("document-dir", "", undefined, {
    getOnInit: true,
});
export const storedDatabasesDirAtom = atomWithStorage<string>("databases-dir", "", undefined, {
    getOnInit: true,
});
export const storedEnginesDirAtom = atomWithStorage<string>("engines-dir", "", undefined, {
    getOnInit: true,
});
export const storedPuzzlesDirAtom = atomWithStorage<string>("puzzles-dir", "", undefined, {
    getOnInit: true,
});

async function ensureParentDir(path: string): Promise<void> {
    const separator = path.includes("\\") ? "\\" : "/";
    const lastSeparator = path.lastIndexOf(separator);
    if (lastSeparator === -1) return;

    const parentDir = path.slice(0, lastSeparator);
    if (!parentDir) return;

    if (!(await exists(parentDir))) {
        await mkdir(parentDir, { recursive: true });
    }
}

async function getEnginesStoragePath(key: string): Promise<string> {
    const enginesDir = await getEnginesDir();
    const filename = key.replace(/^engines[\\/]/, "");
    return resolve(enginesDir, filename);
}

const enginesFileStorage: AsyncStringStorage = {
    async getItem(key) {
        try {
            return await readTextFile(await getEnginesStoragePath(key));
        } catch {
            return null;
        }
    },
    async setItem(key, newValue) {
        const path = await getEnginesStoragePath(key);
        await ensureParentDir(path);
        await writeTextFile(path, newValue);
    },
    async removeItem(key) {
        const path = await getEnginesStoragePath(key);
        try {
            await writeTextFile(path, "[]");
        } catch {
            // no-op
        }
    },
};

export const enginesAtom = unwrap(
    atomWithStorage<Engine[]>(
        "engines/engines.json",
        [],
        createAsyncZodStorage(zodArray(engineSchema), enginesFileStorage) as AsyncStorage<Engine[]>,
    ),
);

// Settings

export const tableViewAtom = atomWithStorage<boolean>("table-view", false);

export const fontSizeAtom = atomWithStorage(
    "font-size",
    Number.parseInt(document.documentElement.style.fontSize) || 100,
);

export const moveNotationTypeAtom = atomWithStorage<"letters" | "symbols">("letters", "symbols");
export const moveMethodAtom = atomWithStorage<"drag" | "select" | "both">("move-method", "both");
export const spellCheckAtom = atomWithStorage<boolean>("spell-check", false);
export const moveInputAtom = atomWithStorage<boolean>("move-input", false);
export const showDestsAtom = atomWithStorage<boolean>("show-dests", true);
export const moveHighlightAtom = atomWithStorage<boolean>("move-highlight", true);
export const snapArrowsAtom = atomWithStorage<boolean>("snap-dests", true);
export const showArrowsAtom = atomWithStorage<boolean>("show-arrows", true);
export const showConsecutiveArrowsAtom = atomWithStorage<boolean>("show-consecutive-arrows", false);
export const showVariationArrowsAtom = atomWithStorage<boolean>("show-variation-arrows", false);
export const showPlanExplorerArrowsAtom = atomWithStorage<boolean>(
    "show-plan-explorer-arrows",
    true,
);
export const planExplorerArrowLimitAtom = atomWithStorage<number>("plan-explorer-arrow-limit", 10);
export const planExplorerHoverEverywhereAtom = atomWithStorage<boolean>(
    "plan-explorer-hover-everywhere",
    false,
);
export const showEngineDockAtom = atomWithStorage<boolean>("show-engine-dock", true);
export const engineHotkeysEnabledAtom = atomWithStorage<boolean>("engine-hotkeys-enabled", true);
export const boardManualSizeAtom = atomWithStorage<number | null>("board-manual-size", null);
export const mistakeReviewAutoPlayLineAtom = atomWithStorage<boolean>(
    "mistake-review-auto-play-line",
    true,
);
export const mistakeReviewRevealDelayAtom = atomWithStorage<number>(
    "mistake-review-reveal-delay",
    0,
);
export const mistakeReviewAutoRevealBestAtom = atomWithStorage<boolean>(
    "mistake-review-auto-reveal-best",
    false,
);
export const mistakeReviewSampleLinePliesAtom = atomWithStorage<number>(
    "mistake-review-sample-line-plies",
    6,
);
export const mistakeReviewSampleLineSpeedAtom = atomWithStorage<number>(
    "mistake-review-sample-line-speed",
    1000,
);
export const mistakeReviewEngineOnRevealAtom = atomWithStorage<boolean>(
    "mistake-review-engine-on-reveal",
    false,
);
export const mistakeReviewEngineOffOnNavigationAtom = atomWithStorage<boolean>(
    "mistake-review-engine-off-on-navigation",
    false,
);
export const planExplorerSourceAtom = atomWithStorage<"local" | "lch_all" | "lch_master">(
    "plan-explorer-source",
    "local",
);
export const planExplorerEngineStrengthEnabledAtom = atomWithStorage<boolean>(
    "plan-explorer-engine-strength-enabled",
    true,
);
export const planExplorerEngineStrengthDepthAtom = atomWithStorage<number>(
    "plan-explorer-engine-strength-depth",
    12,
);
export const planExplorerEngineStrengthMultipvAtom = atomWithStorage<number>(
    "plan-explorer-engine-strength-multipv",
    5,
);
export const enginePlanMultipvAtom = atomWithStorage<number>("engine-plan-multipv", 5);
export const enginePlanLimitModeAtom = atomWithStorage<"depth" | "time">(
    "engine-plan-limit-mode",
    "depth",
);
export const enginePlanDepthAtom = atomWithStorage<number>("engine-plan-depth", 12);
export const enginePlanTimeMsAtom = atomWithStorage<number>("engine-plan-time-ms", 2000);
export const enginePlanSideFilterAtom = atomWithStorage<"all" | "white" | "black">(
    "engine-plan-side-filter",
    "all",
);
export const eraseDrawablesOnClickAtom = atomWithStorage<boolean>(
    "erase-drawables-on-click",
    false,
);
export const autoPromoteAtom = atomWithStorage<boolean>("auto-promote", true);
export const autoSaveAtom = atomWithStorage<boolean>("auto-save", true);
export const previewBoardOnHoverAtom = atomWithStorage<boolean>("preview-board-on-hover", true);
export const enableBoardScrollAtom = atomWithStorage<boolean>("board-scroll", true);
export const materialDisplayAtom = atomWithStorage<"diff" | "all">("material-display", "diff");
export const forcedEnPassantAtom = atomWithStorage<boolean>("forced-ep", false);
export const showCoordinatesAtom = atomWithStorage<"no" | "edge" | "all">(
    "show-coordinates-v2",
    "no",
    undefined,
    { getOnInit: true },
);
export const soundCollectionAtom = atomWithStorage<string>(
    "sound-collection",
    "standard",
    undefined,
    {
        getOnInit: true,
    },
);

export const soundVolumeAtom = atomWithStorage<number>("sound-volume", 0.8, undefined, {
    getOnInit: true,
});

export const pieceSetAtom = atomWithStorage<string>("piece-set", "staunty");
export const boardImageAtom = atomWithStorage<string>("board-image", "gray.svg");
export const primaryColorAtom = atomWithStorage<MantineColor>("mantine-primary-color", "blue");
export const sessionsAtom = atomWithStorage<Session[]>("sessions", []);
export const latestOnlineGameAccountSelectionAtom = atomWithStorage<Record<string, boolean>>(
    "latest-online-game-accounts",
    {},
);
export const nativeBarAtom = atomWithStorage<boolean>("native-bar", false);
export const telemetryEnabledAtom = atomWithStorage<boolean>("telemetry-enabled", true, undefined, {
    getOnInit: true,
});

// Recent Files

export type RecentFile = {
    name: string;
    path: string;
    type: "game" | "repertoire" | "tournament" | "puzzle" | "other";
    lastOpened: number;
};

const MAX_RECENT_FILES = 10;

export const recentFilesAtom = atomWithStorage<RecentFile[]>("recent-files", []);

export const addRecentFileAtom = atom(null, (get, set, file: Omit<RecentFile, "lastOpened">) => {
    const current = get(recentFilesAtom);
    const filtered = current.filter((f) => f.path !== file.path);
    const updated = [{ ...file, lastOpened: Date.now() }, ...filtered].slice(0, MAX_RECENT_FILES);
    set(recentFilesAtom, updated);
});

// Daily Goals

export type DailyGoalKind = "mistake-review" | "opening-review" | "prep" | "puzzles";

export type DailyGoal = {
    id: string;
    kind: DailyGoalKind;
    title: string;
    enabled: boolean;
    target: number;
    deckPath?: string | null;
    filePath?: string | null;
    fileName?: string | null;
    fileType?: RecentFile["type"];
};

export type DailyGoalHistoryEntry = {
    counts: Record<string, number>;
    completedAt?: number | null;
};

export type DailyGoalHistory = Record<string, DailyGoalHistoryEntry>;

export const DEFAULT_DAILY_GOALS: DailyGoal[] = [
    {
        id: "daily-mistake-review",
        kind: "mistake-review",
        title: "Mistake review",
        enabled: true,
        target: 15,
        deckPath: null,
    },
    {
        id: "daily-opening-gaps",
        kind: "opening-review",
        title: "Opening gaps",
        enabled: true,
        target: 15,
        deckPath: null,
    },
];

export const dailyGoalsAtom = atomWithStorage<DailyGoal[]>("daily-goals", DEFAULT_DAILY_GOALS);

export const dailyGoalHistoryAtom = atomWithStorage<DailyGoalHistory>("daily-goal-history", {});

// Database

export const referenceDbAtom = atomWithStorage<string | null>("reference-database", null);

export type DatabaseSourcePreference =
    | {
          type: "local";
          value: string | null;
      }
    | {
          type: "lch_all" | "lch_master";
      };

export const defaultDatabaseSourceAtom = atomWithStorage<DatabaseSourcePreference>(
    "default-database-source",
    { type: "local", value: null },
);

export const defaultCompareDatabasesAtom = atomWithStorage<(string | null)[]>(
    "default-compare-databases",
    [],
);

export type StoredDatabaseLocalOptions = Omit<LocalOptions, "fen" | "path">;

export type DatabasePanelFileSettings = {
    source: DatabaseSourcePreference;
    localOptions: StoredDatabaseLocalOptions;
    lichessOptions: LichessGamesOptions;
    masterOptions: MasterGamesOptions;
    moveHealthSide: OpeningMoveHealthSidePreference;
    tabType: string;
};

export const databasePanelSettingsByFileAtom = atomWithStorage<
    Record<string, DatabasePanelFileSettings>
>("database-panel-settings-by-file", {});

export type ComparePanelSlotSettings = {
    sourceValue: string | null;
    localOptions: StoredDatabaseLocalOptions;
};

export type ComparePanelFileSettings = {
    slots: ComparePanelSlotSettings[];
    lichessOptions: LichessGamesOptions;
    masterOptions: MasterGamesOptions;
    moveHealthSide: OpeningMoveHealthSidePreference;
};

export const comparePanelSettingsByFileAtom = atomWithStorage<
    Record<string, ComparePanelFileSettings>
>("database-compare-settings-by-file", {});

export const databaseMoveHealthSideAtom = atomWithStorage<OpeningMoveHealthSidePreference>(
    "database-move-health-side",
    "sideToMove",
);

export const selectedPuzzleDbAtom = atomWithStorage<string | null>("puzzle-db", null);

export type DatabaseConversionState = {
    inProgress: boolean;
    phase: "downloading" | "converting" | null;
    progress: number | null;
    progressId: string | null;
    totalGames: number;
    totalGamesExpected: number | null;
    elapsedSeconds: number;
    targetDatabasePath: string | null;
    targetDatabaseTitle: string | null;
    sourceFileName: string | null;
};

export const databaseConversionStateAtom = atomWithStorage<DatabaseConversionState>(
    "database-conversion-state",
    {
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
    },
    createJSONStorage(() => sessionStorage),
);

export const selectedDatabaseAtom = atomWithStorage<SuccessDatabaseInfo | null>(
    "database-view",
    null,
    createJSONStorage(() => sessionStorage),
);

export type OnlineDatabaseUpdateRecord = {
    source: OnlineGameSource;
    username: string;
    accounts?: OnlineDatabaseUpdateAccount[];
    dbPath: string;
    title: string;
    description?: string | null;
    autoUpdate: boolean;
    lastCheckedAt: number | null;
    lastUpdatedAt: number | null;
    lastKnownGameCount: number | null;
};

export type OnlineDatabaseUpdateAccount = {
    source: OnlineGameSource;
    username: string;
    lastCheckedAt?: number | null;
    lastUpdatedAt?: number | null;
    lastKnownGameCount?: number | null;
    lastImportedAt?: number | null;
};

export type OnlineDatabaseUpdateRecords = Record<string, OnlineDatabaseUpdateRecord>;

export const onlineDatabaseUpdatesAtom = atomWithStorage<OnlineDatabaseUpdateRecords>(
    "online-database-updates",
    {},
);

export type LichessStudyDatabaseUpdateRecord = {
    dbPath: string;
    title: string;
    description?: string | null;
    studyId: string;
    chapterId?: string | null;
    studyUrl: string;
    pgnUrl: string;
    pgnHash: string;
    autoUpdate: boolean;
    lastCheckedAt: number | null;
    lastUpdatedAt: number | null;
    lastKnownGameCount: number | null;
};

export type LichessStudyDatabaseUpdateRecords = Record<string, LichessStudyDatabaseUpdateRecord>;

export const lichessStudyDatabaseUpdatesAtom = atomWithStorage<LichessStudyDatabaseUpdateRecords>(
    "lichess-study-database-updates",
    {},
);

// Game Settings

export type GameInputColor = "white" | "random" | "black";

export const gameInputColorAtom = atomWithStorage<GameInputColor>("game-input-color", "white");

const defaultPlayerSettings: OpponentSettings = {
    type: "human",
    name: "Player",
    timeControl: DEFAULT_TIME_CONTROL,
    timeUnit: "m",
    incrementUnit: "s",
};
export const gamePlayer1SettingsAtom = atomWithStorage<OpponentSettings>(
    "game-player1-settings",
    defaultPlayerSettings,
);

export const gamePlayer2SettingsAtom = atomWithStorage<OpponentSettings>(
    "game-player2-settings",
    defaultPlayerSettings,
);

export const gameSameTimeControlAtom = atomWithStorage<boolean>("game-same-time-control", true);

export const gameOpeningBookPathAtom = atomWithStorage<string | null>(
    "game-opening-book-path",
    null,
);

export const gameOpeningBookEnabledAtom = atomWithStorage<boolean>(
    "game-opening-book-enabled",
    false,
);

export const gameOpeningBookMaxPlyAtom = atomWithStorage<number>("game-opening-book-max-ply", 40);

function tabValue<T extends object | string | boolean | number | null | undefined>(
    family: AtomFamily<string, PrimitiveAtom<T>>,
) {
    const fallbackTabValue = "__no-tab-selected__";

    return atom(
        (get) => {
            const tab = get(currentTabAtom);
            const atom = family(tab?.value ?? fallbackTabValue);
            return get(atom);
        },
        (get, set, newValue: T | ((currentValue: T) => T)) => {
            const tab = get(currentTabAtom);
            const atom = family(tab?.value ?? fallbackTabValue);
            const nextValue = typeof newValue === "function" ? newValue(get(atom)) : newValue;
            set(atom, nextValue);
        },
    );
}

// Puzzles
export const hidePuzzleRatingAtom = atomWithStorage<boolean>("hide-puzzle-rating", false);
export const progressivePuzzlesAtom = atomWithStorage<boolean>("progressive-puzzles", false);
export const jumpToNextPuzzleAtom = atomWithStorage<boolean>("puzzle-jump-immediately", true);
export const trackPuzzleTimeAtom = atomWithStorage<boolean>("track-puzzle-time", true);
export const puzzleRatingRangeAtom = atomWithStorage<[number, number]>(
    "puzzle-ratings",
    [1000, 1500],
);

export const puzzleThemeAtom = atomWithStorage<string | null>("puzzle-theme", null);

export const coverageMinGamesAtom = atomWithStorage<number>("coverage-min-games", 50);

export const puzzleTimerFamily = atomFamily((_tab: string) => atom<number | null>(null));
export const currentPuzzleTimerAtom = tabValue(puzzleTimerFamily);

// CP / WDL

export const reportTypeAtom = atom<"CP" | "WDL">("CP");

export const scoreTypeFamily = atomFamily((_engine: string) => atom<"cp" | "wdl">("cp"));

export type LiveEvalState = {
    fen: string;
    movesKey: string;
    score: Score;
};

const liveEvalFamily = atomFamily((_tab: string) => atom<LiveEvalState | null>(null));
export const currentLiveEvalAtom = tabValue(liveEvalFamily);

// Per tab settings

const threatFamily = atomFamily((_tab: string) => atom(false));
export const currentThreatAtom = tabValue(threatFamily);

const evalOpenFamily = atomFamily((_tab: string) => atom(true));
export const currentEvalOpenAtom = tabValue(evalOpenFamily);

const evalBarDisplayFamily = atomFamily((_tab: string) => atom<"cp" | "wdl">("cp"));
export const currentEvalBarDisplayAtom = tabValue(evalBarDisplayFamily);

const invisibleFamily = atomFamily((_tab: string) => atom(false));
export const currentInvisibleAtom = tabValue(invisibleFamily);

const showCommentsFamily = atomFamily((_tab: string) => atom(true));
export const currentShowCommentsAtom = tabValue(showCommentsFamily);

const showVariationsFamily = atomFamily((_tab: string) => atom(true));
export const currentShowVariationsAtom = tabValue(showVariationsFamily);

export const tabFamily = atomFamily((_tab: string) => atom("info"));
export const currentTabSelectedAtom = tabValue(tabFamily);

const localOptionsFamily = atomFamily((_tab: string) =>
    atom<LocalOptions>({
        path: null,
        type: "exact",
        fen: "",
        player: null,
        playerName: "",
        color: "white",
        result: "any",
    }),
);
export const currentLocalOptionsAtom = tabValue(localOptionsFamily);

export const lichessOptionsAtom = atomWithStorage<LichessGamesOptions>(
    "lichess-all-options",
    {
        ratings: [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500],
        speeds: ["bullet", "blitz", "rapid", "classical", "correspondence"],
        color: "white",
    },
    createZodStorage(lichessGamesOptionsSchema, localStorage),
    {
        getOnInit: true,
    },
);

export const masterOptionsAtom = atomWithStorage<MasterGamesOptions>(
    "lichess-master-options",
    {
        topGames: 15,
    },
    createZodStorage(masterOptionsSchema, localStorage),
    {
        getOnInit: true,
    },
);

const dbTypeFamily = atomFamily((_tab: string) =>
    atom<"local" | "lch_all" | "lch_master">("local"),
);
export const currentDbTypeAtom = tabValue(dbTypeFamily);

const dbTabFamily = atomFamily((_tab: string) => atom("stats"));
export const currentDbTabAtom = tabValue(dbTabFamily);

const compareDatabasesFamily = atomFamily((_tab: string) => atom<string[]>([]));
export const currentCompareDatabasesAtom = tabValue(compareDatabasesFamily);

const boardPreviewShapesFamily = atomFamily((_tab: string) =>
    atom<{ fen: string; displayFen?: string; shapes: DrawShape[] } | null>(null),
);
export const currentBoardPreviewShapesAtom = tabValue(boardPreviewShapesFamily);

const planExplorerDataFamily = atomFamily((_tab: string) => atom<PlanExplorerData | null>(null));
export const currentPlanExplorerDataAtom = tabValue(planExplorerDataFamily);

export type PlanExplorerEngineStrengthState = {
    report: EnginePlanReport | null;
    reportCacheKey: string | null;
    cache: Record<string, EnginePlanReport>;
    progress: number;
    running: boolean;
    error: string | null;
    activeRequestKey: string | null;
};

const defaultPlanExplorerEngineStrengthState = (): PlanExplorerEngineStrengthState => ({
    report: null,
    reportCacheKey: null,
    cache: {},
    progress: 0,
    running: false,
    error: null,
    activeRequestKey: null,
});

const planExplorerEngineStrengthFamily = atomFamily((_tab: string) =>
    atom<PlanExplorerEngineStrengthState>(defaultPlanExplorerEngineStrengthState()),
);
export const currentPlanExplorerEngineStrengthAtom = tabValue(planExplorerEngineStrengthFamily);

const enginePlanExplorerDataFamily = atomFamily((_tab: string) =>
    atom<PlanExplorerData | null>(null),
);
export const currentEnginePlanExplorerDataAtom = tabValue(enginePlanExplorerDataFamily);

export type EnginePlanPanelState = {
    report: EnginePlanReport | null;
    reportCacheKey: string | null;
    cache: Record<string, EnginePlanReport>;
    progress: number;
    running: boolean;
    error: string | null;
    activeRequestKey: string | null;
};

const defaultEnginePlanPanelState = (): EnginePlanPanelState => ({
    report: null,
    reportCacheKey: null,
    cache: {},
    progress: 0,
    running: false,
    error: null,
    activeRequestKey: null,
});

const enginePlanReportFamily = atomFamily((_tab: string) =>
    atom<EnginePlanPanelState>(defaultEnginePlanPanelState()),
);
export const currentEnginePlanReportAtom = tabValue(enginePlanReportFamily);

const planExplorerPreviewLineFamily = atomFamily((_tab: string) =>
    atom<ColoredPlanExplorerLine | null>(null),
);
export const currentPlanExplorerPreviewLineAtom = tabValue(planExplorerPreviewLineFamily);

export type OpeningHealthProgress = {
    id: string;
    progress: number;
    gamesScanned: number;
    positionsProcessed: number;
    phase: string;
    finished: boolean;
};

export type OpeningHealthScanState = {
    requestId: string | null;
    loading: boolean;
    paused: boolean;
    stopRequested: boolean;
    progress: OpeningHealthProgress | null;
    report: RepertoireGapReport | null;
    startedAt: number | null;
    completedAt: number | null;
    error: string | null;
};

export type OpeningHealthVerificationStatus = "bad" | "questionable" | "ok" | "missing";

export type OpeningHealthVerification = {
    status: OpeningHealthVerificationStatus;
    source: "lichess" | "chessdb" | "local";
    lossCp: number;
    depth: number | null;
    bestMoveSan: string | null;
    bestMoveUci: string | null;
    playedRank: number | null;
    checkedAt: number;
};

export type OpeningHealthVerificationRun = {
    running: boolean;
    phase?: "bulk" | "deep" | "engine";
    completed: number;
    total: number;
    engineName: string | null;
    depth: number;
    lichess: number;
    chessdb: number;
    local: number;
    missing: number;
} | null;

export const openingHealthScanAtom = atom<OpeningHealthScanState>({
    requestId: null,
    loading: false,
    paused: false,
    stopRequested: false,
    progress: null,
    report: null,
    startedAt: null,
    completedAt: null,
    error: null,
});

export const openingHealthVerificationsAtom = atom<Record<string, OpeningHealthVerification>>({});
export const openingHealthVerificationRunAtom = atom<OpeningHealthVerificationRun>(null);

export const openingHealthVerifyDuringScanAtom = atomWithStorage<boolean>(
    "opening-health-verify-during-scan",
    true,
);
export const openingHealthVerifyDepthAtom = atomWithStorage<number>(
    "opening-health-verify-depth",
    12,
);
export const openingHealthLocalFallbackAtom = atomWithStorage<boolean>(
    "opening-health-local-fallback",
    false,
);

export type OpeningReviewAutoUpdateState = {
    running: boolean;
    phase: string | null;
    progress: number | null;
    deckName: string | null;
    deckPath: string | null;
    databaseTitle: string | null;
    startedAt: number | null;
    completedAt: number | null;
    added: number;
    checkedDecks: number;
    updatedDecks: number;
    error: string | null;
    updatedDeckPaths: string[];
    revision: number;
};

export const openingReviewAutoUpdateStateAtom = atomWithStorage<OpeningReviewAutoUpdateState>(
    "opening-review-auto-update-state",
    {
        running: false,
        phase: null,
        progress: null,
        deckName: null,
        deckPath: null,
        databaseTitle: null,
        startedAt: null,
        completedAt: null,
        added: 0,
        checkedDecks: 0,
        updatedDecks: 0,
        error: null,
        updatedDeckPaths: [],
        revision: 0,
    },
    createJSONStorage(() => sessionStorage),
);

export type MistakeReviewAutoUpdateState = OpeningReviewAutoUpdateState;

export const mistakeReviewAutoUpdateStateAtom = atomWithStorage<MistakeReviewAutoUpdateState>(
    "mistake-review-auto-update-state",
    {
        running: false,
        phase: null,
        progress: null,
        deckName: null,
        deckPath: null,
        databaseTitle: null,
        startedAt: null,
        completedAt: null,
        added: 0,
        checkedDecks: 0,
        updatedDecks: 0,
        error: null,
        updatedDeckPaths: [],
        revision: 0,
    },
    createJSONStorage(() => sessionStorage),
);

export type MistakeReviewScanProgressState = {
    requestId: string | null;
    running: boolean;
    progress: number | null;
    deckName: string | null;
    phase: string | null;
    paused: boolean;
    gamesAnalyzed: number;
    gamesTotal: number;
    positionsAnalyzed: number;
    candidateMoves: number;
    mistakesFound: number;
    stopping: boolean;
    error: string | null;
    startedAt: number | null;
    completedAt: number | null;
};

export const mistakeReviewScanProgressAtom = atom<MistakeReviewScanProgressState>({
    requestId: null,
    running: false,
    progress: null,
    deckName: null,
    phase: null,
    paused: false,
    gamesAnalyzed: 0,
    gamesTotal: 0,
    positionsAnalyzed: 0,
    candidateMoves: 0,
    mistakesFound: 0,
    stopping: false,
    error: null,
    startedAt: null,
    completedAt: null,
});

const analysisTabFamily = atomFamily((_tab: string) => atom("engines"));
export const currentAnalysisTabAtom = tabValue(analysisTabFamily);

const practiceTabFamily = atomFamily((_tab: string) => atom("train"));
export const currentPracticeTabAtom = tabValue(practiceTabFamily);

const expandedEnginesFamily = atomFamily((_tab: string) => atom<string[] | undefined>(undefined));
export const currentExpandedEnginesAtom = tabValue(expandedEnginesFamily);

export const currentDetachedEngineAtom = atomWithStorage<string | null>("detached-engine", null);

const pgnOptionsFamily = atomFamily((_tab: string) =>
    atom({
        comments: true,
        glyphs: true,
        variations: true,
        extraMarkups: true,
    }),
);
export const currentPgnOptionsAtom = tabValue(pgnOptionsFamily);

const currentPuzzleFamily = atomFamily((_tab: string) => atom(0));
export const currentPuzzleAtom = tabValue(currentPuzzleFamily);

// Game

type GameState = "settingUp" | "playing" | "gameOver";
const gameStateFamily = atomFamily((_tab: string) => atom<GameState>("settingUp"));
export const currentGameStateAtom = tabValue(gameStateFamily);

const playersFamily = atomFamily((_tab: string) =>
    atom<{
        white: OpponentSettings;
        black: OpponentSettings;
    }>({ white: {} as OpponentSettings, black: {} as OpponentSettings }),
);
export const currentPlayersAtom = tabValue(playersFamily);

const gameIdFamily = atomFamily((_tab: string) => atom<string | null>(null));
export const currentGameIdAtom = tabValue(gameIdFamily);

// Practice

const reviewLogSchema = z
    .object({
        fen: z.string(),
    })
    .passthrough();

const practiceDataSchema = z.object({
    positions: positionSchema.array(),
    logs: reviewLogSchema.array(),
});

export type PracticeData = {
    positions: Position[];
    logs: (ReviewLog & { fen: string })[];
};

const FILE_BACKED_REVIEW_DECK_EXTENSIONS = [".opening-review.json", ".mistake-review.json"];

function emptyPracticeData(): PracticeData {
    return {
        positions: [],
        logs: [],
    };
}

export function getDeckStorageKey(file: string, game: number) {
    return `deck-${file}-${game}`;
}

export function isFileBackedReviewDeck(file: string) {
    const lowerFile = file.toLowerCase();
    return FILE_BACKED_REVIEW_DECK_EXTENSIONS.some((extension) => lowerFile.endsWith(extension));
}

export const deckAtomFamily = atomFamily(
    ({ file, game }: { file: string; game: number }) => {
        if (isFileBackedReviewDeck(file)) {
            return atom<PracticeData>(emptyPracticeData());
        }

        return atomWithStorage<PracticeData>(
            getDeckStorageKey(file, game),
            emptyPracticeData(),
            createZodStorage(practiceDataSchema, localStorage) as any as SyncStorage<PracticeData>, // TODO: fix types
        );
    },

    (a, b) => a.file === b.file && a.game === b.game,
);

export type PracticePhase =
    | "idle" // Not practicing
    | "waiting" // Waiting for user to make a move
    | "correct" // Move was correct, waiting for quality rating
    | "incorrect"; // Move was incorrect, showing feedback

export type PracticeState = {
    phase: PracticePhase;
    currentFen?: string;
    answer?: string;
    playedMove?: string;
    playedMoveUci?: string;
    moveAssessment?: "best" | "ok" | "incorrect";
    mistakeReviewLabel?: "best" | "good" | "okay" | "inaccuracy" | "mistake" | "blunder";
    bestMove?: string;
    bestMoveUci?: string;
    moveLossCp?: number;
    winProbabilityDrop?: number;
    requestedDepth?: number;
    reachedDepth?: number;
    engineName?: string;
    chessDbRank?: number | null;
    timeTaken?: number;
    positionIndex?: number;
    resultRecorded?: boolean;
};

export const practiceStateFamily = atomFamily((_tab: string) =>
    atom<PracticeState>({ phase: "idle" }),
);
export const practiceStateAtom = tabValue(practiceStateFamily);

export type PracticeSessionStats = {
    mode: "anki" | "full" | "srs-list";
    remainingPositions: number[];
    correct: number;
    incorrect: number;
    streak: number;
    bestStreak: number;
};

const practiceSessionStatsFamily = atomFamily((_tab: string) =>
    atom<PracticeSessionStats>({
        mode: "anki",
        remainingPositions: [],
        correct: 0,
        incorrect: 0,
        streak: 0,
        bestStreak: 0,
    }),
);
export const practiceSessionStatsAtom = tabValue(practiceSessionStatsFamily);

export const practiceAutoDifficultyAtom = atomWithStorage<"none" | "1" | "2" | "3" | "4">(
    "practice-auto-difficulty",
    "none",
);
export const openingReviewHideMovesDuringPracticeAtom = atomWithStorage<boolean>(
    "opening-review-hide-moves-during-practice",
    false,
);

const practiceCardStartTimeFamily = atomFamily((_tab: string) => atom<number>(0));
export const practiceCardStartTimeAtom = tabValue(practiceCardStartTimeFamily);

export const engineMovesFamily = atomFamily(
    ({ tab: _tab, engine: _engine }: { tab: string; engine: string }) =>
        atom<Map<string, BestMoves[]>>(new Map()),
    (a, b) => a.tab === b.tab && a.engine === b.engine,
);

export const engineProgressFamily = atomFamily(
    ({ tab: _tab, engine: _engine }: { tab: string; engine: string }) => atom<number>(0),
    (a, b) => a.tab === b.tab && a.engine === b.engine,
);

// returns the best moves of each engine for the current position
export const bestMovesFamily = atomFamily(
    ({ fen, gameMoves }: { fen: string; gameMoves: string[] }) =>
        atom<Map<number, { pv: string[]; winChance: number }[]>>((get) => {
            const tab = get(activeTabAtom);
            if (!tab) return new Map();
            const engines = get(enginesAtom);
            if (!engines) return new Map();
            const bestMoves = new Map<number, { pv: string[]; winChance: number }[]>();
            let n = 0;
            for (const engine of engines.filter((e) => e.loaded)) {
                const settingsAtom = tabEngineSettingsFamily({
                    tab,
                    engineId: engine.id,
                    defaultSettings: engine.type === "local" ? engine.settings || [] : undefined,
                    defaultGo: engine.go ?? undefined,
                });
                if (!get(settingsAtom).enabled) {
                    n++;
                    continue;
                }
                const engineMoves = get(engineMovesFamily({ tab, engine: engine.id }));
                const [pos] = positionFromFen(fen);
                let finalFen = INITIAL_FEN;
                if (pos) {
                    for (const move of gameMoves) {
                        const m = parseUci(move);
                        pos.play(m!);
                    }
                    finalFen = makeFen(pos.toSetup());
                }
                const moves =
                    engineMoves.get(`${swapMove(finalFen)}:`) ||
                    engineMoves.get(`${fen}:${gameMoves.join(",")}`);
                if (moves && moves.length > 0) {
                    const bestWinChange = getWinChance(
                        normalizeScore(moves[0].score.value, pos?.turn || "white"),
                    );
                    bestMoves.set(
                        n,
                        moves.reduce<{ pv: string[]; winChance: number }[]>((acc, m) => {
                            const winChance = getWinChance(
                                normalizeScore(m.score.value, pos?.turn || "white"),
                            );
                            if (bestWinChange - winChance < 10) {
                                acc.push({ pv: m.uciMoves, winChance });
                            }
                            return acc;
                        }, []),
                    );
                }
                n++;
            }
            return bestMoves;
        }),
    (a, b) => a.fen === b.fen && equal(a.gameMoves, b.gameMoves),
);

export const firstEngineWithLinesFamily = atomFamily(
    ({ fen, gameMoves }: { fen: string; gameMoves: string[] }) =>
        atom<string | null>((get) => {
            const tab = get(activeTabAtom);
            if (!tab) return null;
            const engines = get(enginesAtom);
            if (!engines) return null;

            const [pos] = positionFromFen(fen);
            let finalFen = INITIAL_FEN;
            if (pos) {
                for (const move of gameMoves) {
                    const m = parseUci(move);
                    if (m) pos.play(m);
                }
                finalFen = makeFen(pos.toSetup());
            }

            for (const engine of engines.filter((e) => e.loaded)) {
                const settingsAtom = tabEngineSettingsFamily({
                    tab,
                    engineId: engine.id,
                    defaultSettings: engine.type === "local" ? engine.settings || [] : undefined,
                    defaultGo: engine.go ?? undefined,
                });
                if (!get(settingsAtom).enabled) continue;

                const engineMoves = get(engineMovesFamily({ tab, engine: engine.id }));
                const moves =
                    engineMoves.get(`${swapMove(finalFen)}:`) ||
                    engineMoves.get(`${fen}:${gameMoves.join(",")}`);

                if (moves && moves.length > 0) {
                    return engine.id;
                }
            }
            return null;
        }),
    (a, b) => a.fen === b.fen && equal(a.gameMoves, b.gameMoves),
);

export const tabEngineSettingsFamily = atomFamily(
    ({
        tab: _tab,
        engineId: _engineId,
        defaultSettings,
        defaultGo,
    }: {
        tab: string;
        engineId: string;
        defaultSettings?: EngineSettings;
        defaultGo?: GoMode;
    }) => {
        return atom<{
            enabled: boolean;
            settings: EngineSettings;
            go: GoMode;
            synced: boolean;
        }>({
            enabled: false,
            settings: defaultSettings || [],
            go: defaultGo || { t: "Infinite" },
            synced: true,
        });
    },
    (a, b) => a.tab === b.tab && a.engineId === b.engineId,
);

export const allEnabledAtom = atom((get) => {
    const engines = get(enginesAtom);
    if (!engines) return false;

    const v = engines
        .filter((e) => e.loaded)
        .every((engine) => {
            const atom = tabEngineSettingsFamily({
                tab: get(activeTabAtom)!,
                engineId: engine.id,
                defaultSettings: engine.type === "local" ? engine.settings || [] : undefined,
                defaultGo: engine.go ?? undefined,
            });
            return get(atom).enabled;
        });

    return v;
});

export const enableAllAtom = atom(null, (get, set, value: boolean) => {
    const engines = get(enginesAtom);
    if (!engines) return;

    for (const engine of engines.filter((e) => e.loaded)) {
        const atom = tabEngineSettingsFamily({
            tab: get(activeTabAtom)!,
            engineId: engine.id,
            defaultSettings: engine.type === "local" ? engine.settings || [] : undefined,
            defaultGo: engine.go ?? undefined,
        });
        set(atom, { ...get(atom), enabled: value });
    }
});
