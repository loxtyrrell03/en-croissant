import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  NumberInput,
  Popover,
  Progress,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCloudDownload,
  IconExternalLink,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
  IconSettings,
  IconSparkles,
  IconTarget,
  IconX,
} from "@tabler/icons-react";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import { resolve, tempDir } from "@tauri-apps/api/path";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { isNormal, makeSquare } from "chessops";
import { parseSan } from "chessops/san";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { mutate } from "swr";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import dayjs from "dayjs";
import { commands, type NormalizedGame } from "@/bindings";
import { usePanelDensity } from "@/components/common/ResponsivePanel";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import DatabaseFolderSelect from "@/components/common/DatabaseFolderSelect";
import {
  activeTabAtom,
  comparePanelSettingsByFileAtom,
  currentBoardPreviewShapesAtom,
  currentLocalOptionsAtom,
  currentOpponentPrepAtom,
  currentTabAtom,
  currentUnderBoardLocalOptionsAtom,
  currentUnderBoardOpponentPrepAtom,
  currentUnderBoardReferenceDbAtom,
  databaseConversionStateAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  onlineDatabaseUpdatesAtom,
  opponentPrepSettingsAtom,
  referenceDbAtom,
  sessionsAtom,
  storedDatabasesDirAtom,
  tabsAtom,
  underBoardLichessOptionsAtom,
  underBoardMasterOptionsAtom,
  underBoardOpponentPrepSettingsAtom,
  type OpponentPrepState,
  type OpponentPrepStoredSettings,
  type StoredDatabaseLocalOptions,
} from "@/state/atoms";
import { getRecentChessComGames } from "@/utils/chess.com/api";
import {
  cancelDatabaseSearch,
  getDatabases,
  getDatabaseSelectData,
  getMostCommonPlayer,
  query_players,
  searchPosition,
  type Opening,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { getDatabasesDir } from "@/utils/directories";
import { formatNumber } from "@/utils/format";
import { getLichessGames, getMasterGames, getRecentLichessGames } from "@/utils/lichess/api";
import { isPrefix } from "@/utils/misc";
import {
  getOnlineGameSourceLabel,
  importOnlineGamesToDatabase,
  resetDatabaseConversionState,
  upsertOnlineDatabaseUpdateRecord,
  type OnlineGameSource,
} from "@/utils/onlineGameImport";
import {
  findFirstOpponentBranch,
  findLastOpponentBranch,
  findOpponentPrepSourceMovePath,
  findOpponentPrepStart,
  choosePrepBuilderMove,
  findPrepStraightLineCandidates,
  getFenTurn,
  getLineSans,
  getOpeningTotal,
  getOpponentPrepBranchKey,
  getOpponentPrepBranchStats,
  getOpponentPrepMoveRows,
  getPrepBuilderBranchValue,
  getPrepBuilderEvidenceMinGames,
  getPrepBuilderReplyPolicy,
  getPrepBuilderStopReason,
  getPrepBuilderTaskPriority,
  getPrepBuilderUserResponseChildIndex,
  getPrepMoveStrengthMap,
  getPrepStrengthMoveListKey,
  hasPrepBuilderDatabaseCandidates,
  isPrepStraightLineBadForOpponent,
  normalizePrepBuilderSettings,
  oppositePrepColor,
  pathExists,
  sortOpponentPrepOpenings,
  type PrepBuilderEngineMove,
  type PrepBuilderMoveChoice,
  type PrepBuilderSettings,
  type PrepMoveStrength,
  type PrepStraightLineCandidate,
  type PrepStraightLineSearchMode,
  type OpponentPrepBranchStats,
  type OpponentPrepMoveRow,
} from "@/utils/opponentPrep";
import { createTab, getTabWorkspaceKey, saveToFile } from "@/utils/tabs";
import { parsePGN } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { getTreeStructureHash, type TreeState } from "@/utils/treeReducer";
import { queryChessDbMoves } from "@/utils/chessdb/api";
import { queryLichessCloudMoves } from "@/utils/lichess/api";
import { unwrap } from "@/utils/unwrap";
import { BoundedMap } from "@/utils/boundedCache";
import { DatabasePerspectiveControls } from "../database/DatabasePerspectiveControls";

const DEFAULT_PREP_MIN_GAMES = 2;
const DEFAULT_PREP_MOVE_LIMIT = 8;
const DEFAULT_STRAIGHT_LINE_MODE: PrepStraightLineSearchMode = "venom";
const DEFAULT_VENOM_LINE_MIN_SHARE = 65;
const DEFAULT_VENOM_LINE_MIN_CP = 40;
const DEFAULT_STRICT_LINE_MIN_SHARE = 90;
const DEFAULT_STRICT_LINE_MIN_CP = 80;
const DEFAULT_STRAIGHT_LINE_MIN_SHARE = DEFAULT_VENOM_LINE_MIN_SHARE;
const DEFAULT_STRAIGHT_LINE_MIN_CP = DEFAULT_VENOM_LINE_MIN_CP;
const DEFAULT_STRAIGHT_LINE_MAX_PLY = 12;
const STRAIGHT_LINE_USER_CANDIDATES = 4;
const STRAIGHT_LINE_MAX_FRONTIER = 8;
const STRAIGHT_LINE_MAX_POSITIONS = 48;
const LICHESS_ALL_SOURCE = "online:lichess-all";
const LICHESS_MASTER_SOURCE = "online:lichess-master";
const MAX_PREP_MOVE_CACHE_ENTRIES = 80;
const MAX_PREP_BUILDER_REFERENCE_CACHE_ENTRIES = 120;
const DEFAULT_PLAYER_LOOKUP_VERSION = "game-count-v2";
const DEFAULT_ONLINE_IMPORT_GAMES = 100;
const MAX_ONLINE_IMPORT_GAMES = 2000;
const PREP_SOURCE_GAME_SAMPLE_LIMIT = 5000;

type PrepOnlineImportMode = "count" | "range";
type PrepOnlineRangePreset = "3m" | "6m" | "1y" | "2y" | "all";

type PrepOnlineImportedGame = {
  source: OnlineGameSource;
  username: string;
  pgn: string;
  playedAt: number;
  url: string;
};

type PrepOnlineCountPreview = {
  requestedGames: number;
  foundGames: number;
  oldestPlayedAt: number | null;
  newestPlayedAt: number | null;
};

const PREP_ONLINE_RANGE_OPTIONS: { value: PrepOnlineRangePreset; label: string }[] = [
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "1y", label: "Last year" },
  { value: "2y", label: "Last 2 years" },
  { value: "all", label: "All games" },
];

type PrepCandidateMoveRow = Opening & {
  key: string;
  total: number;
  share: number;
};

type PrepSortDirection = "asc" | "desc";
type OpponentPrepSortColumn = "move" | "strength" | "games" | "results" | "prep" | "state";
type CandidatePrepSortColumn = "move" | "strength" | "games" | "results";
type PrepSortState<TColumn extends string> = {
  column: TColumn;
  direction: PrepSortDirection;
};
type PrepMoveTableSortState = {
  opponent: PrepSortState<OpponentPrepSortColumn>;
  candidate: PrepSortState<CandidatePrepSortColumn>;
};
type PrepMoveSortDefaults = {
  opponent: OpponentPrepSortColumn;
  candidate: CandidatePrepSortColumn;
};
type PrepStoredSettingsPatch = Partial<OpponentPrepStoredSettings>;

const DEFAULT_PREP_MOVE_SORT_DEFAULTS: PrepMoveSortDefaults = {
  opponent: "games",
  candidate: "strength",
};
const PREP_OPPONENT_SORT_OPTIONS: { value: OpponentPrepSortColumn; label: string }[] = [
  { value: "games", label: "Usage" },
  { value: "strength", label: "Smart strength" },
  { value: "results", label: "Results" },
  { value: "prep", label: "Prep coverage" },
  { value: "state", label: "State" },
  { value: "move", label: "Move" },
];
const PREP_CANDIDATE_SORT_OPTIONS: { value: CandidatePrepSortColumn; label: string }[] = [
  { value: "strength", label: "Smart strength" },
  { value: "games", label: "Usage" },
  { value: "results", label: "WDL" },
  { value: "move", label: "Move" },
];

type PrepBuilderStatus = {
  phase: string;
  addedMoves: number;
  visitedPositions: number;
  stoppedLines: number;
};

type PrepBuilderQueueItem = {
  path: number[];
  branchShare: number;
  depthShare: number;
  branchValue?: number;
  ply: number;
};

type PrepStraightLineStatus = {
  phase: string;
  checkedPositions: number;
  candidates: number;
  tone?: "running" | "empty" | "error";
};

type PrepStraightLineSearchResult = PrepStraightLineCandidate & {
  fromPath: number[];
};

function normalizePrepPlayerName(name: string) {
  return name.trim().toLowerCase();
}

function getDatabaseTitlePlayerName(databaseLabel: string | null | undefined, playerName: string) {
  const label = databaseLabel?.trim();
  if (!label) return null;

  const candidate = getDatabaseLabelPlayerCandidate(label);
  if (!candidate || normalizePrepPlayerName(candidate) !== normalizePrepPlayerName(playerName)) {
    return null;
  }

  return candidate;
}

function getDatabaseLabelPlayerCandidate(databaseLabel: string) {
  let candidate = databaseLabel.replace(/\.db3$/i, "").trim();
  const suffixes = [
    /(?:[_\s-]+online\s+games)$/i,
    /(?:[_\s-]+chess\.com)$/i,
    /(?:[_\s-]+chesscom)$/i,
    /(?:[_\s-]+lichess)$/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      const next = candidate.replace(suffix, "").trim();
      if (next !== candidate) {
        candidate = next;
        changed = true;
      }
    }
  }

  return candidate;
}

function getPrepCandidateRows({
  fen,
  openings,
  minGames,
  moveLimit,
}: {
  fen: string;
  openings: Opening[];
  minGames: number;
  moveLimit: number;
}): PrepCandidateMoveRow[] {
  const sorted = sortOpponentPrepOpenings(openings, minGames, moveLimit);
  const totalGames = sorted.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);

  return sorted.map((opening) => ({
    ...opening,
    key: getOpponentPrepBranchKey(fen, opening.move),
    total: getOpeningTotal(opening),
    share: totalGames > 0 ? getOpeningTotal(opening) / totalGames : 0,
  }));
}

type OpponentPrepPanelScope = "side" | "underBoard";

function OpponentPrepPanel({
  underBoard = false,
  scope = underBoard ? "underBoard" : "side",
}: {
  underBoard?: boolean;
  scope?: OpponentPrepPanelScope;
}) {
  const store = useContext(TreeStateContext)!;
  const currentNode = useStore(store, (s) => s.currentNode());
  const currentFen = currentNode.fen;
  const currentPath = useStore(store, (s) => s.position);
  const root = useStore(store, (s) => s.root);
  const prepAtom =
    scope === "underBoard" ? currentUnderBoardOpponentPrepAtom : currentOpponentPrepAtom;
  const prepSettingsAtom =
    scope === "underBoard" ? underBoardOpponentPrepSettingsAtom : opponentPrepSettingsAtom;
  const localOptionsAtom =
    scope === "underBoard" ? currentUnderBoardLocalOptionsAtom : currentLocalOptionsAtom;
  const lichessOptionsStateAtom =
    scope === "underBoard" ? underBoardLichessOptionsAtom : lichessOptionsAtom;
  const masterOptionsStateAtom =
    scope === "underBoard" ? underBoardMasterOptionsAtom : masterOptionsAtom;
  const referenceDatabaseAtom =
    scope === "underBoard" ? currentUnderBoardReferenceDbAtom : referenceDbAtom;
  const [prep, setPrep] = useAtom(prepAtom);
  const [savedPrepSettings, setSavedPrepSettings] = useAtom(prepSettingsAtom);
  const currentLocalOptions = useAtomValue(localOptionsAtom);
  const lichessOptions = useAtomValue(lichessOptionsStateAtom);
  const masterOptions = useAtomValue(masterOptionsStateAtom);
  const compareSettingsByFile = useAtomValue(comparePanelSettingsByFileAtom);
  const referenceDb = useAtomValue(referenceDatabaseAtom);
  const sessions = useAtomValue(sessionsAtom);
  const [databaseDir] = useAtom(storedDatabasesDirAtom);
  const [, setConversionState] = useAtom(databaseConversionStateAtom);
  const [, setOnlineDatabaseUpdates] = useAtom(onlineDatabaseUpdatesAtom);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const { documentDir } = useLoaderData({ from: "/" });
  const navigate = useNavigate();
  const setBoardPreviewShapes = useSetAtom(currentBoardPreviewShapesAtom);
  const panelDensity = usePanelDensity();
  const compact = underBoard || panelDensity !== "regular";
  const dense = underBoard || panelDensity === "dense";
  const [advancing, setAdvancing] = useState(false);
  const [commonMoving, setCommonMoving] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderRunning, setBuilderRunning] = useState(false);
  const [builderNeedsSave, setBuilderNeedsSave] = useState(false);
  const [savingBuilderResult, setSavingBuilderResult] = useState<"new" | "overwrite" | null>(null);
  const [builderStatus, setBuilderStatus] = useState<PrepBuilderStatus | null>(null);
  const [straightLineRunning, setStraightLineRunning] = useState(false);
  const [straightLineStatus, setStraightLineStatus] = useState<PrepStraightLineStatus | null>(null);
  const [straightLineResult, setStraightLineResult] = useState<PrepStraightLineSearchResult | null>(
    null,
  );
  const [straightLineMode, setStraightLineMode] = useState<PrepStraightLineSearchMode>(
    DEFAULT_STRAIGHT_LINE_MODE,
  );
  const [straightLineMinShare, setStraightLineMinShare] = useState(DEFAULT_STRAIGHT_LINE_MIN_SHARE);
  const [straightLineMinCp, setStraightLineMinCp] = useState(DEFAULT_STRAIGHT_LINE_MIN_CP);
  const [straightLineMaxPly, setStraightLineMaxPly] = useState(DEFAULT_STRAIGHT_LINE_MAX_PLY);
  const [onlineImportOpen, setOnlineImportOpen] = useState(false);
  const [onlineImportSource, setOnlineImportSource] = useState<OnlineGameSource>("lichess");
  const [onlineImportUsername, setOnlineImportUsername] = useState("");
  const [onlineImportMode, setOnlineImportMode] = useState<PrepOnlineImportMode>("count");
  const [onlineImportGameCount, setOnlineImportGameCount] = useState(DEFAULT_ONLINE_IMPORT_GAMES);
  const [onlineImportRange, setOnlineImportRange] = useState<PrepOnlineRangePreset>("3m");
  const [onlineImportSaveDatabase, setOnlineImportSaveDatabase] = useState(true);
  const [onlineImporting, setOnlineImporting] = useState(false);
  const [onlineImportProgress, setOnlineImportProgress] = useState<number | null>(null);
  const [onlineImportPreviewLoading, setOnlineImportPreviewLoading] = useState(false);
  const [onlineImportPreview, setOnlineImportPreview] = useState<PrepOnlineCountPreview | null>(
    null,
  );
  const [openingSourceGameKey, setOpeningSourceGameKey] = useState<string | null>(null);
  const [underBoardStage, setUnderBoardStage] = useState<"setup" | "train">("setup");
  const [moveTableSort, setMoveTableSort] = useState<PrepMoveTableSortState>(() =>
    getDefaultPrepMoveTableSortState(prep.sortDefaults),
  );
  const moveCacheRef = useRef(new BoundedMap<string, Opening[]>(MAX_PREP_MOVE_CACHE_ENTRIES));
  const builderReferenceCacheRef = useRef(
    new BoundedMap<string, Opening[]>(MAX_PREP_BUILDER_REFERENCE_CACHE_ENTRIES),
  );
  const builderCancelRef = useRef(false);
  const straightLineCancelRef = useRef(false);
  const seededRef = useRef(false);
  const savedSettingsAppliedRef = useRef(false);
  const seededDefaultPlayerDatabaseRef = useRef<string | null>(null);
  const settingsKey = useMemo(() => getTabWorkspaceKey(currentTab), [currentTab]);
  const savedCompareSettings = settingsKey ? compareSettingsByFile[settingsKey] : undefined;
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const prepMode = prep.mode ?? "player";
  const prepSource = prep.source ?? "local";
  const builderSettings = useMemo(() => normalizePrepBuilderSettings(prep.builder), [prep.builder]);
  const prepSortDefaults = useMemo(
    () => normalizePrepMoveSortDefaults(prep.sortDefaults),
    [prep.sortDefaults],
  );

  useEffect(() => {
    setMoveTableSort(getDefaultPrepMoveTableSortState(prep.sortDefaults));
  }, [prep.sortDefaults]);
  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter(
        (database): database is SuccessDatabaseInfo => database.type === "success",
      ),
    [databases],
  );
  const sourceOptions = useMemo(() => {
    const groupedOptions = getDatabaseSelectData(localDatabases);

    if (
      prepSource === "local" &&
      prep.databasePath &&
      !localDatabases.some((database) => database.file === prep.databasePath)
    ) {
      groupedOptions.unshift({
        group: "Current",
        items: [
          {
            value: prep.databasePath,
            label: prep.databaseLabel || "Imported prep games",
          },
        ],
      });
    }

    return [
      {
        group: "Online",
        items: [
          {
            value: LICHESS_ALL_SOURCE,
            label: "Lichess All",
          },
          {
            value: LICHESS_MASTER_SOURCE,
            label: "Lichess Masters",
          },
        ],
      },
      ...groupedOptions,
    ];
  }, [localDatabases, prep.databaseLabel, prep.databasePath, prepSource]);
  const selectedDatabase = useMemo(
    () => localDatabases.find((database) => database.file === prep.databasePath) ?? null,
    [localDatabases, prep.databasePath],
  );
  const selectedDatabaseLabel =
    selectedDatabase?.title || selectedDatabase?.filename || prep.databaseLabel;
  const defaultPlayerLookupKey = prep.databasePath
    ? `${DEFAULT_PLAYER_LOOKUP_VERSION}:${prep.databasePath}`
    : null;
  const shouldLoadDefaultPlayer =
    prepMode === "player" &&
    prepSource === "local" &&
    Boolean(prep.databasePath) &&
    !prep.player &&
    prep.playerName.trim().length === 0 &&
    seededDefaultPlayerDatabaseRef.current !== defaultPlayerLookupKey;
  const { data: defaultPlayer } = useSWR(
    shouldLoadDefaultPlayer && prep.databasePath
      ? ["opponent-prep-default-player", DEFAULT_PLAYER_LOOKUP_VERSION, prep.databasePath]
      : null,
    () => getMostCommonPlayer(prep.databasePath!),
  );
  const rootPath = useMemo(() => {
    const candidate = prep.rootPath ?? [];
    return pathExists(root, candidate) ? candidate : [];
  }, [prep.rootPath, root]);
  const rootPathKey = rootPath.join("/");
  const isInsidePrepTree = isPrefix(rootPath, currentPath);
  const opponentToMove = getFenTurn(currentFen) === prep.color;
  const userColor = oppositePrepColor(prep.color);
  const hasPlayer = Boolean(prep.player) || prep.playerName.trim().length >= 3;
  const missingExplorerToken = prepSource !== "local" && !explorerToken;
  const sourceReady = prepSource === "local" ? Boolean(prep.databasePath) : !missingExplorerToken;
  const targetReady = prepMode === "general" || hasPlayer;
  const canOpenPrepSourceGames =
    prepMode === "player" && prepSource === "local" && Boolean(prep.databasePath);
  const configReady = sourceReady && targetReady;
  const showSetupStage = !underBoard || underBoardStage === "setup";
  const showTrainingStage = !underBoard || underBoardStage === "train";
  const sourceValue =
    prepSource === "lch_all"
      ? LICHESS_ALL_SOURCE
      : prepSource === "lch_master"
        ? LICHESS_MASTER_SOURCE
        : prep.databasePath;
  const queryScope = useMemo(
    () =>
      JSON.stringify({
        scope,
        mode: prepMode,
        source: prepSource,
        databasePath: prep.databasePath,
        player: prepMode === "player" ? prep.player : null,
        playerName: prepMode === "player" ? prep.playerName.trim() : "",
        color: prep.color,
        startDate: prep.start_date ?? "",
        endDate: prep.end_date ?? "",
        result: prep.result,
        lichessOptions:
          prepSource === "lch_all"
            ? {
                ...lichessOptions,
                player: undefined,
                moves: Math.max(12, prep.moveLimit),
              }
            : null,
        masterOptions:
          prepSource === "lch_master"
            ? {
                ...masterOptions,
                moves: Math.max(12, prep.moveLimit),
              }
            : null,
        auth: prepSource === "local" ? "local" : explorerToken ? "auth" : "no-auth",
      }),
    [
      explorerToken,
      lichessOptions,
      masterOptions,
      prep.color,
      prep.databasePath,
      prep.end_date,
      prep.moveLimit,
      prep.player,
      prep.playerName,
      prep.result,
      prepMode,
      prepSource,
      scope,
      prep.start_date,
    ],
  );
  const currentSearchId =
    configReady && prepSource === "local" ? getPrepSearchId(queryScope, currentFen) : null;

  useEffect(() => {
    moveCacheRef.current.clear();
  }, [queryScope]);

  useEffect(() => {
    builderReferenceCacheRef.current.clear();
  }, [lichessOptions]);

  useEffect(() => {
    if (!onlineImportOpen || onlineImportUsername.trim()) return;
    if (prep.playerName.trim()) {
      setOnlineImportUsername(prep.playerName.trim());
    }
  }, [onlineImportOpen, onlineImportUsername, prep.playerName]);

  useEffect(() => {
    setOnlineImportPreview(null);
  }, [onlineImportGameCount, onlineImportSource, onlineImportUsername]);

  useEffect(() => {
    if (savedSettingsAppliedRef.current) return;
    savedSettingsAppliedRef.current = true;
    if (hasStoredPrepSourceSettings(savedPrepSettings)) {
      seededRef.current = true;
    }

    setPrep((current) => {
      if (!shouldApplyStoredPrepSettings(current)) return current;

      return {
        ...current,
        ...savedPrepSettings,
        rootPath: current.rootPath,
        completedBranches: current.completedBranches,
        skippedBranches: current.skippedBranches,
        builder: savedPrepSettings.builder
          ? normalizePrepBuilderSettings(savedPrepSettings.builder)
          : current.builder,
        sortDefaults: savedPrepSettings.sortDefaults
          ? normalizePrepMoveSortDefaults(savedPrepSettings.sortDefaults)
          : current.sortDefaults,
      };
    });
  }, [savedPrepSettings, setPrep]);

  useEffect(() => {
    if (
      !savedSettingsAppliedRef.current ||
      seededRef.current ||
      prepSource !== "local" ||
      prep.databasePath ||
      localDatabases.length === 0
    ) {
      return;
    }
    const seed = getInitialPrepSeed({
      currentLocalOptions,
      localDatabases,
      referenceDb,
      savedCompareSettings,
    });
    if (!seed) return;

    seededRef.current = true;
    setPrep((current) => ({
      ...current,
      ...seed,
      rootPath: current.rootPath ?? [],
    }));
  }, [
    currentLocalOptions,
    localDatabases,
    prep.databasePath,
    prepSource,
    referenceDb,
    savedCompareSettings,
    setPrep,
  ]);

  useEffect(() => {
    if (!configReady || prep.rootPath !== null) return;
    setPrep((current) =>
      current.rootPath === null
        ? {
            ...current,
            rootPath: [],
          }
        : current,
    );
  }, [configReady, prep.rootPath, setPrep]);

  useEffect(() => {
    if (underBoard && !configReady) {
      setUnderBoardStage("setup");
    }
  }, [configReady, underBoard]);

  useEffect(() => {
    if (!currentSearchId) return undefined;

    return () => {
      void cancelDatabaseSearch(currentSearchId);
    };
  }, [currentSearchId]);

  useEffect(() => {
    setStraightLineResult(null);
    setStraightLineStatus(null);
  }, [queryScope, rootPathKey]);

  const loadOpeningsForFen = useCallback(
    async (fen: string, moveLimitOverride?: number) => {
      if (prepSource === "local" && !prep.databasePath) return [];
      if (prepSource !== "local" && !explorerToken) return [];

      const moveLimit = moveLimitOverride ?? prep.moveLimit;
      const cacheKey = `${queryScope}|${moveLimit}|${fen}`;
      const cached = moveCacheRef.current.get(cacheKey);
      if (cached) return cached;

      let openings: Opening[];
      if (prepSource === "lch_all") {
        const data = await getLichessGames(
          fen,
          {
            ...lichessOptions,
            player: undefined,
            moves: getPrepBuilderExplorerMoveLimit(moveLimit),
          },
          explorerToken,
        );
        openings = lichessMovesToOpenings(data.moves);
      } else if (prepSource === "lch_master") {
        const data = await getMasterGames(
          fen,
          {
            ...masterOptions,
            moves: getPrepBuilderExplorerMoveLimit(moveLimit),
          },
          explorerToken,
        );
        openings = lichessMovesToOpenings(data.moves);
      } else {
        const requestId = getPrepSearchId(queryScope, fen);
        const [localOpenings] = await searchPosition(
          {
            path: prep.databasePath,
            fen,
            type: "exact",
            player: prepMode === "player" ? prep.player : null,
            playerName: prepMode === "player" ? prep.playerName : "",
            color: prep.color,
            start_date: prep.start_date,
            end_date: prep.end_date,
            result: prep.result,
          },
          requestId,
          {
            includeGames: false,
          },
        );
        openings = localOpenings;
      }

      moveCacheRef.current.set(cacheKey, openings);
      return openings;
    },
    [
      explorerToken,
      lichessOptions,
      masterOptions,
      prep.color,
      prep.databasePath,
      prep.end_date,
      prep.moveLimit,
      prep.player,
      prep.playerName,
      prep.result,
      prep.start_date,
      prepMode,
      prepSource,
      queryScope,
    ],
  );

  const loadLichessAllOpeningsForFen = useCallback(
    async (fen: string, settings: PrepBuilderSettings) => {
      if (!settings.useLichessAll) return [];
      const moveLimit = getPrepBuilderReferenceMoveLimit(settings.opponentMoveLimit);

      const cacheKey = JSON.stringify({
        source: "builder-lichess-all",
        fen,
        moves: moveLimit,
        lichessOptions,
        auth: explorerToken ? "auth" : "public",
      });
      const cached = builderReferenceCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const data = await getLichessGames(
        fen,
        {
          ...lichessOptions,
          player: undefined,
          moves: moveLimit,
        },
        explorerToken,
      );
      const openings = lichessMovesToOpenings(data.moves);
      builderReferenceCacheRef.current.set(cacheKey, openings);
      return openings;
    },
    [explorerToken, lichessOptions],
  );

  const loadPrepBuilderEngineMoves = useCallback(
    async (fen: string, userColor: "white" | "black", settings: PrepBuilderSettings) => {
      if (!settings.useCloudEngine) return [];

      const multipv = Math.max(3, Math.min(8, settings.opponentMoveLimit + 3));
      const [lichessResult, chessDbResult] = await Promise.allSettled([
        queryLichessCloudMoves(fen, multipv),
        queryChessDbMoves(fen),
      ]);
      const lichessMoves =
        lichessResult.status === "fulfilled" && lichessResult.value
          ? lichessResult.value.map<PrepBuilderEngineMove>((move, index) => ({
              san: move.san,
              scoreCpForSide:
                move.scoreCpForWhite === null
                  ? null
                  : userColor === "black"
                    ? -move.scoreCpForWhite
                    : move.scoreCpForWhite,
              rank: index + 1,
              source: "lichess",
            }))
          : [];
      const chessDbMoves =
        chessDbResult.status === "fulfilled" && chessDbResult.value
          ? chessDbResult.value.map<PrepBuilderEngineMove>((move, index) => ({
              san: move.san,
              scoreCpForSide:
                move.scoreCpForWhite === null
                  ? null
                  : userColor === "black"
                    ? -move.scoreCpForWhite
                    : move.scoreCpForWhite,
              rank: move.rank && move.rank > 0 ? move.rank : index + 1,
              source: "chessdb",
            }))
          : [];

      return mergePrepBuilderEngineMoves([...lichessMoves, ...chessDbMoves]);
    },
    [],
  );

  const {
    data: currentOpenings,
    isLoading,
    error,
  } = useSWR(configReady ? ["opponent-prep-openings", queryScope, currentFen] : null, () =>
    loadOpeningsForFen(currentFen),
  );

  const currentRows = useMemo(
    () =>
      opponentToMove
        ? getOpponentPrepMoveRows({
            fen: currentFen,
            node: currentNode,
            openings: currentOpenings ?? [],
            minGames: prep.minGames,
            moveLimit: prep.moveLimit,
            completedBranches: prep.completedBranches,
            skippedBranches: prep.skippedBranches,
          })
        : [],
    [
      currentFen,
      currentNode,
      currentOpenings,
      opponentToMove,
      prep.completedBranches,
      prep.minGames,
      prep.moveLimit,
      prep.skippedBranches,
    ],
  );
  const candidateRows = useMemo(
    () =>
      !opponentToMove
        ? getPrepCandidateRows({
            fen: currentFen,
            openings: currentOpenings ?? [],
            minGames: prep.minGames,
            moveLimit: prep.moveLimit,
          })
        : [],
    [currentFen, currentOpenings, opponentToMove, prep.minGames, prep.moveLimit],
  );
  const strengthRows = opponentToMove ? currentRows : candidateRows;
  const strengthSide = opponentToMove ? prep.color : userColor;
  const strengthRowsKey = useMemo(
    () => getPrepStrengthMoveListKey(strengthRows.map((row) => row.move)),
    [strengthRows],
  );
  const strengthEngineKey =
    showTrainingStage && configReady && builderSettings.useCloudEngine && strengthRows.length > 0
      ? [
          "opponent-prep-strength-engine",
          currentFen,
          strengthSide,
          strengthRowsKey,
          builderSettings.mode,
          builderSettings.engineWeight,
          builderSettings.maxEngineCpLoss,
          builderSettings.opponentMoveLimit,
        ]
      : null;
  const { data: strengthEngineMoves, isLoading: strengthLoading } = useSWR(strengthEngineKey, () =>
    loadPrepBuilderEngineMoves(currentFen, strengthSide, builderSettings),
  );
  const strengthByMove = useMemo(
    () =>
      getPrepMoveStrengthMap({
        openings: strengthRows,
        engineMoves: strengthEngineMoves ?? [],
        side: strengthSide,
        settings: builderSettings,
      }),
    [builderSettings, strengthEngineMoves, strengthRows, strengthSide],
  );
  const currentTreeHash = useMemo(() => getTreeStructureHash(currentNode), [currentNode]);
  const branchStatsKey =
    configReady && opponentToMove && currentRows.length > 0
      ? [
          "opponent-prep-branch-stats",
          queryScope,
          currentFen,
          prep.minGames,
          prep.moveLimit,
          currentTreeHash,
          JSON.stringify(prep.completedBranches),
          JSON.stringify(prep.skippedBranches),
          currentRows.map((row) => row.key).join("|"),
        ]
      : null;
  const { data: branchStatsByKey, isLoading: branchStatsLoading } = useSWR(
    branchStatsKey,
    async () => {
      const entries = await Promise.all(
        currentRows.map(async (row) => {
          const stats = await getOpponentPrepBranchStats({
            parentNode: currentNode,
            row,
            opponentColor: prep.color,
            loadOpenings: loadOpeningsForFen,
            minGames: prep.minGames,
            moveLimit: prep.moveLimit,
            completedBranches: prep.completedBranches,
            skippedBranches: prep.skippedBranches,
          });
          return [row.key, stats] as const;
        }),
      );

      return Object.fromEntries(entries);
    },
  );
  const activeBranch = useMemo(
    () =>
      isInsidePrepTree ? findLastOpponentBranch(root, currentPath, prep.color, rootPath) : null,
    [currentPath, isInsidePrepTree, prep.color, root, rootPath],
  );
  const lineSans = useMemo(
    () => (isInsidePrepTree ? getLineSans(root, currentPath, rootPath) : []),
    [currentPath, isInsidePrepTree, root, rootPath],
  );
  const rootSans = useMemo(() => getLineSans(root, rootPath), [root, rootPath]);
  const preparedCount = currentRows.filter((row) => row.status === "prepared").length;
  const startedCount = currentRows.filter((row) => row.status === "started").length;
  const skippedCount = currentRows.filter((row) => row.status === "skipped").length;

  const setOpponentMoveSortColumn = useCallback((column: OpponentPrepSortColumn) => {
    setMoveTableSort((current) => {
      const opponent = getNextPrepSort(current.opponent, column);
      return {
        opponent,
        candidate: isCandidatePrepSortColumn(opponent.column)
          ? {
              column: opponent.column,
              direction: opponent.direction,
            }
          : current.candidate,
      };
    });
  }, []);

  const setCandidateMoveSortColumn = useCallback((column: CandidatePrepSortColumn) => {
    setMoveTableSort((current) => {
      const candidate = getNextPrepSort(current.candidate, column);
      return {
        candidate,
        opponent: {
          column: candidate.column,
          direction: candidate.direction,
        },
      };
    });
  }, []);
  const controlSize = compact ? "xs" : "sm";
  const databaseLabel = selectedDatabaseLabel;
  const canOverwriteCurrent =
    currentTab?.gameOrigin.kind === "file" ||
    currentTab?.gameOrigin.kind === "temp_file" ||
    currentTab?.gameOrigin.kind === "database";
  const onlineImportUsernameTrimmed = onlineImportUsername.trim();
  const onlineImportToken =
    onlineImportSource === "lichess"
      ? sessions.find(
          (session) =>
            session.lichess?.username &&
            normalizePrepPlayerName(session.lichess.username) ===
              normalizePrepPlayerName(onlineImportUsernameTrimmed),
        )?.lichess?.accessToken
      : undefined;
  const onlineImportRangeSince = getPrepOnlineRangeSince(onlineImportRange);
  const onlineImportRangeLabel = getPrepOnlineRangeLabel(onlineImportRange);
  const onlineImportPreviewText = getPrepOnlineImportPreviewText({
    mode: onlineImportMode,
    range: onlineImportRange,
    preview: onlineImportPreview,
    requestedGames: onlineImportGameCount,
  });
  const canRunStraightLine =
    configReady &&
    prepMode === "player" &&
    prepSource === "local" &&
    sourceReady &&
    targetReady &&
    Boolean(prep.databasePath);
  const straightLineQualifies = isPrepStraightLineBadForOpponent(
    straightLineResult,
    straightLineMinCp,
  );

  const updateSettings = useCallback(
    (patch: PrepStoredSettingsPatch, resetProgress = true) => {
      setSavedPrepSettings((current) => ({
        ...current,
        ...patch,
      }));
      setPrep((current) => ({
        ...current,
        ...patch,
        rootPath: resetProgress ? (current.rootPath ?? []) : current.rootPath,
        completedBranches: resetProgress ? {} : current.completedBranches,
        skippedBranches: resetProgress ? {} : current.skippedBranches,
      }));
    },
    [setPrep, setSavedPrepSettings],
  );

  useEffect(() => {
    if (
      !shouldLoadDefaultPlayer ||
      defaultPlayer === undefined ||
      !prep.databasePath ||
      !defaultPlayerLookupKey
    ) {
      return;
    }

    seededDefaultPlayerDatabaseRef.current = defaultPlayerLookupKey;
    if (!defaultPlayer?.name) return;

    const defaultPlayerName = defaultPlayer.name;
    let appliedPlayerId: number | null = null;
    let appliedPlayerName = "";
    setPrep((current) => {
      if (
        (current.mode ?? "player") !== "player" ||
        (current.source ?? "local") !== "local" ||
        current.databasePath !== prep.databasePath ||
        current.player ||
        current.playerName.trim().length > 0
      ) {
        return current;
      }

      const playerName =
        getDatabaseTitlePlayerName(current.databaseLabel, defaultPlayerName) ?? defaultPlayerName;
      appliedPlayerId = defaultPlayer.id;
      appliedPlayerName = playerName;

      return {
        ...current,
        player: defaultPlayer.id,
        playerName,
      };
    });
    if (appliedPlayerId !== null) {
      setSavedPrepSettings((current) => ({
        ...current,
        player: appliedPlayerId,
        playerName: appliedPlayerName,
      }));
    }
  }, [
    defaultPlayer,
    defaultPlayerLookupKey,
    prep.databasePath,
    setPrep,
    setSavedPrepSettings,
    shouldLoadDefaultPlayer,
  ]);

  const updateBuilderSettings = useCallback(
    (patch: Partial<PrepBuilderSettings>) => {
      setSavedPrepSettings((current) => ({
        ...current,
        builder: normalizePrepBuilderSettings(getPrepBuilderSettingsPatch(current.builder, patch)),
      }));
      setPrep((current) => ({
        ...current,
        builder: normalizePrepBuilderSettings(getPrepBuilderSettingsPatch(current.builder, patch)),
      }));
    },
    [setPrep, setSavedPrepSettings],
  );

  const updateOpponentSortDefault = useCallback(
    (column: OpponentPrepSortColumn) => {
      const sort = getDefaultPrepSortState(column);
      setMoveTableSort((current) => ({
        ...current,
        opponent: sort,
      }));
      setSavedPrepSettings((current) => ({
        ...current,
        sortDefaults: {
          ...normalizePrepMoveSortDefaults(current.sortDefaults),
          opponent: column,
        },
      }));
      setPrep((current) => ({
        ...current,
        sortDefaults: {
          ...normalizePrepMoveSortDefaults(current.sortDefaults),
          opponent: column,
        },
      }));
    },
    [setPrep, setSavedPrepSettings],
  );

  const updateCandidateSortDefault = useCallback(
    (column: CandidatePrepSortColumn) => {
      const sort = getDefaultPrepSortState(column);
      setMoveTableSort((current) => ({
        ...current,
        candidate: sort,
      }));
      setSavedPrepSettings((current) => ({
        ...current,
        sortDefaults: {
          ...normalizePrepMoveSortDefaults(current.sortDefaults),
          candidate: column,
        },
      }));
      setPrep((current) => ({
        ...current,
        sortDefaults: {
          ...normalizePrepMoveSortDefaults(current.sortDefaults),
          candidate: column,
        },
      }));
    },
    [setPrep, setSavedPrepSettings],
  );

  const changePrepMode = useCallback(
    (mode: "player" | "general") => {
      if (mode === "general") {
        updateSettings(
          {
            mode,
            source: "lch_all",
            databasePath: null,
            databaseLabel: "Lichess All",
            color: "black",
            player: null,
            playerName: "",
          },
          true,
        );
        return;
      }

      if (prepSource === "local") {
        updateSettings({ mode }, true);
        return;
      }

      const database = localDatabases[0] ?? null;
      updateSettings(
        {
          mode,
          source: "local",
          databasePath: database?.file ?? null,
          databaseLabel: database ? database.title || database.filename : null,
          player: null,
          playerName: "",
        },
        true,
      );
    },
    [localDatabases, prepSource, updateSettings],
  );

  const changePrepSource = useCallback(
    (value: string | null) => {
      if (!value) return;

      if (value === LICHESS_ALL_SOURCE) {
        updateSettings(
          {
            mode: "general",
            source: "lch_all",
            databasePath: null,
            databaseLabel: "Lichess All",
            color: prepMode === "general" ? prep.color : "black",
            player: null,
            playerName: "",
          },
          true,
        );
        return;
      }

      if (value === LICHESS_MASTER_SOURCE) {
        updateSettings(
          {
            mode: "general",
            source: "lch_master",
            databasePath: null,
            databaseLabel: "Lichess Masters",
            color: prepMode === "general" ? prep.color : "black",
            player: null,
            playerName: "",
          },
          true,
        );
        return;
      }

      const database = localDatabases.find((item) => item.file === value);
      updateSettings(
        {
          source: "local",
          databasePath: value,
          databaseLabel: database ? database.title || database.filename : null,
          player: null,
          playerName: "",
        },
        true,
      );
    },
    [localDatabases, prep.color, prepMode, updateSettings],
  );

  const changeGeneralUserColor = useCallback(
    (color: "white" | "black") => {
      updateSettings({ color: oppositePrepColor(color) }, true);
    },
    [updateSettings],
  );

  const previewOnlineImportCount = useCallback(async () => {
    if (!onlineImportUsernameTrimmed || onlineImportPreviewLoading) return;

    setOnlineImportPreviewLoading(true);
    try {
      const games = await fetchPrepOnlineRecentGames({
        source: onlineImportSource,
        username: onlineImportUsernameTrimmed,
        count: onlineImportGameCount,
        token: onlineImportToken,
      });
      setOnlineImportPreview(createPrepOnlineCountPreview(games, onlineImportGameCount));
      if (games.length === 0) {
        notifications.show({
          title: "No games found",
          message: `${getOnlineGameSourceLabel(
            onlineImportSource,
          )} did not return public PGNs for ${onlineImportUsernameTrimmed}.`,
          color: "yellow",
        });
      }
    } catch (error) {
      notifications.show({
        title: "Could not check online games",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setOnlineImportPreviewLoading(false);
    }
  }, [
    onlineImportGameCount,
    onlineImportPreviewLoading,
    onlineImportSource,
    onlineImportToken,
    onlineImportUsernameTrimmed,
  ]);

  const importOnlineGamesForPrep = useCallback(async () => {
    if (!onlineImportUsernameTrimmed || onlineImporting) return;

    setOnlineImporting(true);
    setOnlineImportProgress(null);
    try {
      const baseDatabaseDir = databaseDir || (await getDatabasesDir());
      const titleBase = getPrepOnlineImportTitle({
        source: onlineImportSource,
        username: onlineImportUsernameTrimmed,
        mode: onlineImportMode,
        games: onlineImportGameCount,
        range: onlineImportRange,
      });
      const title = onlineImportSaveDatabase
        ? getUniquePrepOnlineImportTitle(titleBase, localDatabases)
        : titleBase;
      const dbDir = onlineImportSaveDatabase ? baseDatabaseDir : await tempDir();
      const dbPath = await resolve(dbDir, `${sanitizePrepImportFilename(title)}.db3`);
      const description = getPrepOnlineImportDescription({
        source: onlineImportSource,
        username: onlineImportUsernameTrimmed,
        mode: onlineImportMode,
        games: onlineImportGameCount,
        range: onlineImportRange,
      });
      let importedGames: PrepOnlineImportedGame[] | null = null;

      if (onlineImportMode === "count") {
        setConversionState((current) => ({
          ...current,
          inProgress: true,
          phase: "downloading",
          progress: 0,
          progressId: null,
          sourceKind: "online-games",
          startedAt: Date.now(),
          updatedAt: Date.now(),
          totalGames: 0,
          totalGamesExpected: onlineImportGameCount,
          elapsedSeconds: 0,
          targetDatabasePath: dbPath,
          targetDatabaseTitle: title,
          sourceFileName: null,
        }));
        const recentGames = await fetchPrepOnlineRecentGames({
          source: onlineImportSource,
          username: onlineImportUsernameTrimmed,
          count: onlineImportGameCount,
          token: onlineImportToken,
          onProgress: (loaded, total) => {
            const progress = total > 0 ? Math.min(100, (loaded / total) * 100) : null;
            setOnlineImportProgress(progress);
            setConversionState((current) => ({
              ...current,
              progress,
              totalGames: loaded,
              updatedAt: Date.now(),
            }));
          },
        });
        importedGames = recentGames;
        if (recentGames.length === 0) {
          throw new Error("No public PGNs were found for that player.");
        }
        setConversionState((current) => ({
          ...current,
          phase: "converting",
          progress: recentGames.length > 0 ? 0 : null,
          totalGames: 0,
          totalGamesExpected: recentGames.length,
          updatedAt: Date.now(),
        }));
        await createPrepOnlineGamesDatabase({
          games: recentGames,
          dbPath,
          title,
          description,
        });
        setOnlineImportPreview(createPrepOnlineCountPreview(recentGames, onlineImportGameCount));
      } else {
        await importOnlineGamesToDatabase({
          source: onlineImportSource,
          username: onlineImportUsernameTrimmed,
          databaseDir: baseDatabaseDir,
          dbPath,
          title,
          description,
          since: onlineImportRangeSince,
          remainingGames: 0,
          token: onlineImportToken,
          setProgress: setOnlineImportProgress,
          setConversionState,
        });
        unwrap(await commands.deleteDuplicatedGames(dbPath));
        unwrap(await commands.deleteEmptyGames(dbPath));
      }

      await commands.clearGames();
      const nextDatabases = onlineImportSaveDatabase ? await getDatabases() : localDatabases;
      if (onlineImportSaveDatabase) {
        await mutate("databases", nextDatabases, { revalidate: false });
      }
      const importedDatabase =
        nextDatabases.find(
          (database): database is SuccessDatabaseInfo =>
            database.type === "success" && database.file === dbPath,
        ) ?? null;
      const player = await resolvePrepOnlineImportPlayer(dbPath, onlineImportUsernameTrimmed);
      const importedAt = Date.now();

      if (onlineImportSaveDatabase) {
        setOnlineDatabaseUpdates((records) =>
          upsertOnlineDatabaseUpdateRecord(records, {
            source: onlineImportSource,
            username: onlineImportUsernameTrimmed,
            dbPath,
            title,
            description,
            autoUpdate: false,
            lastCheckedAt: importedAt,
            lastUpdatedAt: importedAt,
            lastKnownGameCount:
              importedDatabase?.game_count ?? importedGames?.length ?? onlineImportGameCount,
          }),
        );
      }

      setPrep((current) => ({
        ...current,
        mode: "player",
        source: "local",
        databasePath: dbPath,
        databaseLabel:
          importedDatabase?.title || (onlineImportSaveDatabase ? title : `${title} (temporary)`),
        player: player?.id ?? null,
        playerName: player?.name ?? onlineImportUsernameTrimmed,
        rootPath: [],
        completedBranches: {},
        skippedBranches: {},
      }));
      setSavedPrepSettings((current) => ({
        ...current,
        mode: "player",
        source: "local",
        databasePath: dbPath,
        databaseLabel:
          importedDatabase?.title || (onlineImportSaveDatabase ? title : `${title} (temporary)`),
        player: player?.id ?? null,
        playerName: player?.name ?? onlineImportUsernameTrimmed,
      }));
      notifications.show({
        title: "Prep games imported",
        message: `${importedDatabase?.game_count ?? importedGames?.length ?? "Online"} game${
          (importedDatabase?.game_count ?? importedGames?.length ?? 2) === 1 ? "" : "s"
        } ready for opponent prep.`,
        color: "green",
      });
      setOnlineImportOpen(false);
    } catch (error) {
      notifications.show({
        title: "Could not import prep games",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      resetDatabaseConversionState(setConversionState);
      setOnlineImportProgress(null);
      setOnlineImporting(false);
    }
  }, [
    databaseDir,
    localDatabases,
    onlineImportGameCount,
    onlineImporting,
    onlineImportMode,
    onlineImportRange,
    onlineImportRangeSince,
    onlineImportSaveDatabase,
    onlineImportSource,
    onlineImportToken,
    onlineImportUsernameTrimmed,
    setConversionState,
    setOnlineDatabaseUpdates,
    setPrep,
    setSavedPrepSettings,
  ]);

  const clearMovePreview = useCallback(() => {
    setBoardPreviewShapes(null);
  }, [setBoardPreviewShapes]);

  const previewMove = useCallback(
    (moveSan: string) => {
      const [pos] = positionFromFen(currentFen);
      if (!pos) {
        clearMovePreview();
        return;
      }

      const move = parseSan(pos, moveSan);
      if (!move || !isNormal(move)) {
        clearMovePreview();
        return;
      }

      setBoardPreviewShapes({
        fen: currentFen,
        shapes: [
          {
            orig: makeSquare(move.from),
            dest: makeSquare(move.to),
            brush: "preview",
            modifiers: {
              lineWidth: 10,
            },
          },
        ],
      });
    },
    [clearMovePreview, currentFen, setBoardPreviewShapes],
  );

  useEffect(() => clearMovePreview, [clearMovePreview]);

  const playMove = useCallback(
    (moveSan: string) => {
      clearMovePreview();
      store.getState().makeMove({ payload: moveSan });
    },
    [clearMovePreview, store],
  );

  const openPrepSourceGame = useCallback(
    async ({
      key,
      fen,
      move,
      uci,
    }: {
      key: string;
      fen: string;
      move: string;
      uci?: string | null;
    }) => {
      if (!canOpenPrepSourceGames || !prep.databasePath || openingSourceGameKey) return;

      setOpeningSourceGameKey(key);
      clearMovePreview();
      try {
        const [, games] = await searchPosition(
          {
            path: prep.databasePath,
            fen,
            type: "exact",
            player: prep.player,
            playerName: prep.playerName,
            color: prep.color,
            start_date: prep.start_date,
            end_date: prep.end_date,
            result: prep.result,
          },
          getPrepSourceGameSearchId(queryScope, key),
          {
            includeOpenings: false,
            includeGames: true,
            gameLimit: PREP_SOURCE_GAME_SAMPLE_LIMIT,
          },
        );
        const match = await findPrepSourceGameMatch(games, fen, move, uci);

        if (!match) {
          notifications.show({
            title: "No source game found",
            message: "No sampled game matched that exact prep move with the current filters.",
            color: "yellow",
          });
          return;
        }

        match.tree.headers = match.game;
        match.tree.position = match.path;
        await createTab({
          tab: {
            name: `${match.game.white} - ${match.game.black}`,
            type: "analysis",
          },
          setTabs,
          setActiveTab,
          initialState: match.tree,
          headers: match.game,
          position: match.path,
          gameOrigin: {
            kind: "database",
            database: prep.databasePath,
            gameId: match.game.id,
          },
        });
        navigate({ to: "/" });
        notifications.show({
          title: "Game opened",
          message: `${move} in ${match.game.white} - ${match.game.black}.`,
          color: "green",
        });
      } catch (error) {
        notifications.show({
          title: "Could not open source game",
          message: error instanceof Error ? error.message : String(error),
          color: "red",
        });
      } finally {
        setOpeningSourceGameKey((current) => (current === key ? null : current));
      }
    },
    [
      canOpenPrepSourceGames,
      clearMovePreview,
      navigate,
      openingSourceGameKey,
      prep.color,
      prep.databasePath,
      prep.end_date,
      prep.player,
      prep.playerName,
      prep.result,
      prep.start_date,
      queryScope,
      setActiveTab,
      setTabs,
    ],
  );

  const playCommonMoveFromStart = useCallback(async () => {
    if (!configReady || commonMoving) return;

    setCommonMoving(true);
    clearMovePreview();
    try {
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      const start = findOpponentPrepStart(state.root, safeRootPath, prep.color);

      if (!start) {
        notifications.show({
          title: "Choose your move first",
          message: "Play into the prep line before asking for the opponent's common move.",
          color: "yellow",
        });
        return;
      }

      const branchNode = state.getNode(start.branchPath);
      if (!branchNode) return;

      const openings = await loadOpeningsForFen(branchNode.fen);
      const rows = getOpponentPrepMoveRows({
        fen: branchNode.fen,
        node: branchNode,
        openings,
        minGames: prep.minGames,
        moveLimit: prep.moveLimit,
        completedBranches: prep.completedBranches,
        skippedBranches: prep.skippedBranches,
      });
      const nextRow = rows.find((row) => row.status === "new" || row.status === "started");

      store.getState().goToMove(start.branchPath);
      if (!nextRow) {
        notifications.show({
          title: "Shown moves covered",
          message: "No unprepared move is left in Show top. Increase Show top to include more.",
          color: "green",
        });
        return;
      }

      store.getState().makeMove({ payload: nextRow.move });
    } catch (error) {
      notifications.show({
        title: "Could not play the common move",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setCommonMoving(false);
    }
  }, [
    clearMovePreview,
    commonMoving,
    configReady,
    loadOpeningsForFen,
    prep.color,
    prep.completedBranches,
    prep.minGames,
    prep.moveLimit,
    prep.rootPath,
    prep.skippedBranches,
    store,
  ]);

  const markMoveDone = useCallback(
    (row: Pick<OpponentPrepMoveRow, "key">) => {
      setPrep((current) => ({
        ...current,
        completedBranches: {
          ...current.completedBranches,
          [row.key]: Date.now(),
        },
        skippedBranches: omitKey(current.skippedBranches, row.key),
      }));
    },
    [setPrep],
  );

  const skipMove = useCallback(
    (row: Pick<OpponentPrepMoveRow, "key">) => {
      setPrep((current) => ({
        ...current,
        completedBranches: omitKey(current.completedBranches, row.key),
        skippedBranches: {
          ...current.skippedBranches,
          [row.key]: Date.now(),
        },
      }));
    },
    [setPrep],
  );

  const setRootHere = useCallback(() => {
    setPrep((current) => ({
      ...current,
      rootPath: currentPath,
      completedBranches: {},
      skippedBranches: {},
    }));
  }, [currentPath, setPrep]);

  const startUnderBoardPrep = useCallback(() => {
    if (!configReady) return;
    setRootHere();
    setUnderBoardStage("train");
  }, [configReady, setRootHere]);

  const resetLine = useCallback(() => {
    store.getState().goToMove(rootPath);
  }, [rootPath, store]);

  const goToActiveChoice = useCallback(() => {
    if (!activeBranch) return;
    store.getState().goToMove(activeBranch.branchPath);
  }, [activeBranch, store]);

  const advanceToNextBranch = useCallback(async () => {
    if (!configReady || advancing) return;

    setAdvancing(true);
    clearMovePreview();
    try {
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      const currentInsidePrep = isPrefix(safeRootPath, state.position);
      const start = findOpponentPrepStart(state.root, safeRootPath, prep.color);
      const active = start?.branch
        ? start.branch
        : currentInsidePrep && start
          ? findFirstOpponentBranch(state.root, state.position, prep.color, start.branchPath)
          : null;
      const branchPath = start?.branchPath;
      const completedBranches = {
        ...prep.completedBranches,
        ...(active ? { [active.key]: Date.now() } : {}),
      };

      if (active) {
        setPrep((current) => ({
          ...current,
          completedBranches: {
            ...current.completedBranches,
            [active.key]: Date.now(),
          },
          skippedBranches: omitKey(current.skippedBranches, active.key),
        }));
      }

      if (!branchPath) {
        notifications.show({
          title: "Choose your reply first",
          message: "Play into the prep line before cycling their replies.",
          color: "yellow",
        });
        return;
      }

      const branchNode = state.getNode(branchPath);
      if (!branchNode) return;

      const openings = await loadOpeningsForFen(branchNode.fen);
      const rows = getOpponentPrepMoveRows({
        fen: branchNode.fen,
        node: branchNode,
        openings,
        minGames: prep.minGames,
        moveLimit: prep.moveLimit,
        completedBranches,
        skippedBranches: prep.skippedBranches,
      });
      const nextRow = rows.find((row) => row.status === "new" || row.status === "started");

      if (nextRow) {
        store.getState().goToMove(branchPath);
        store.getState().makeMove({ payload: nextRow.move });
        notifications.show({
          title: "Next prep branch",
          message: `${nextRow.move} is next in ${databaseLabel || "the selected database"}.`,
          color: "blue",
        });
        return;
      }

      store.getState().goToMove(branchPath);
      notifications.show({
        title: "Prep branches covered",
        message: "No unprepared move is left in Show top. Increase Show top to include more.",
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Could not move to the next branch",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setAdvancing(false);
    }
  }, [
    advancing,
    clearMovePreview,
    configReady,
    databaseLabel,
    loadOpeningsForFen,
    prep.color,
    prep.completedBranches,
    prep.minGames,
    prep.moveLimit,
    prep.rootPath,
    prep.skippedBranches,
    setPrep,
    store,
  ]);

  const runStraightLineSearch = useCallback(async () => {
    if (!canRunStraightLine || straightLineRunning) return;

    const settings = normalizePrepBuilderSettings({
      ...prep.builder,
      useCloudEngine: true,
    });
    const minShare = Math.max(1, Math.min(100, straightLineMinShare)) / 100;
    const minGames = Math.max(1, prep.minGames);
    const maxPly = Math.max(2, Math.min(30, straightLineMaxPly));
    const engineCache = new Map<string, PrepBuilderEngineMove[]>();
    const loadEngineMoves = async (fen: string) => {
      const cached = engineCache.get(fen);
      if (cached) return cached;

      const moves = await loadPrepBuilderEngineMoves(fen, userColor, settings).catch(() => []);
      engineCache.set(fen, moves);
      return moves;
    };

    straightLineCancelRef.current = false;
    setStraightLineRunning(true);
    setStraightLineResult(null);
    setStraightLineStatus({
      phase: "Starting straight-line search",
      checkedPositions: 0,
      candidates: 0,
      tone: "running",
    });

    try {
      const state = store.getState();
      const startPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      const startNode = state.getNode(startPath);
      if (!startNode) return;

      const search = await findPrepStraightLineCandidates({
        mode: straightLineMode,
        startFen: startNode.fen,
        opponentColor: prep.color,
        minGames,
        minShare,
        maxPly,
        userCandidateLimit: STRAIGHT_LINE_USER_CANDIDATES,
        maxFrontier: STRAIGHT_LINE_MAX_FRONTIER,
        maxPositions: STRAIGHT_LINE_MAX_POSITIONS,
        loadOpenings: (fen) =>
          loadOpeningsForFen(fen, Math.max(prep.moveLimit, 40)).catch(() => []),
        loadEngineMoves,
        isCancelled: () => straightLineCancelRef.current,
        onProgress: (progress) =>
          setStraightLineStatus({
            ...progress,
            tone: "running",
          }),
      });

      if (search.best) {
        const result = {
          ...search.best,
          fromPath: startPath,
          searchedPositions: search.checkedPositions,
        };
        setStraightLineResult(result);
        setStraightLineStatus({
          phase: search.stopped ? "Stopped with best line" : "Straight-line search done",
          checkedPositions: search.checkedPositions,
          candidates: search.candidates.length,
          tone: "empty",
        });
        return;
      }

      setStraightLineStatus({
        phase: search.stopped
          ? "Straight-line search stopped"
          : getPrepStraightLineEmptyStatus(search),
        checkedPositions: search.checkedPositions,
        candidates: 0,
        tone: search.stopped ? "empty" : "error",
      });
    } catch (error) {
      setStraightLineStatus({
        phase: error instanceof Error ? error.message : String(error),
        checkedPositions: 0,
        candidates: 0,
        tone: "error",
      });
      notifications.show({
        title: "Straight-line search failed",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      straightLineCancelRef.current = false;
      setStraightLineRunning(false);
    }
  }, [
    canRunStraightLine,
    loadOpeningsForFen,
    loadPrepBuilderEngineMoves,
    prep.builder,
    prep.color,
    prep.minGames,
    prep.moveLimit,
    prep.rootPath,
    straightLineMaxPly,
    straightLineMode,
    straightLineMinShare,
    straightLineRunning,
    store,
    userColor,
  ]);

  const stopStraightLineSearch = useCallback(() => {
    straightLineCancelRef.current = true;
    setStraightLineStatus((current) =>
      current
        ? {
            ...current,
            phase: "Stopping straight-line search",
          }
        : current,
    );
  }, []);

  const playStraightLineResult = useCallback(() => {
    if (!straightLineResult) return;

    clearMovePreview();
    const state = store.getState();
    if (!pathExists(state.root, straightLineResult.fromPath)) {
      notifications.show({
        title: "Could not play line",
        message: "The prep starting position changed. Run the straight-line search again.",
        color: "yellow",
      });
      return;
    }

    state.goToMove(straightLineResult.fromPath);
    for (const step of straightLineResult.steps) {
      store.getState().makeMove({ payload: step.move });
    }
  }, [clearMovePreview, store, straightLineResult]);

  const runPrepBuilder = useCallback(async () => {
    if (!configReady || builderRunning) return;

    const settings = normalizePrepBuilderSettings(prep.builder);
    const userSide = oppositePrepColor(prep.color);
    const safetyPositionLimit = getPrepBuilderSafetyPositionLimit(settings.size);
    builderCancelRef.current = false;
    setBuilderRunning(true);
    setBuilderNeedsSave(false);
    clearMovePreview();
    setBuilderStatus({
      phase: "Starting",
      addedMoves: 0,
      visitedPositions: 0,
      stoppedLines: 0,
    });

    let addedMoves = 0;
    let visitedPositions = 0;
    let stoppedLines = 0;
    let touchedTree = false;
    let currentPhase = "Starting";
    let lastPublishedAt = 0;
    let lastYieldWork = 0;
    let rootDatabaseGames: number | null = null;

    const updateStatus = (phase: string, force = false) => {
      currentPhase = phase;
      const now = Date.now();
      if (!force && now - lastPublishedAt < 120) return;
      lastPublishedAt = now;
      setBuilderStatus({
        phase,
        addedMoves,
        visitedPositions,
        stoppedLines,
      });
    };

    const yieldToBuilderUi = async (force = false) => {
      const work = addedMoves + visitedPositions + stoppedLines;
      if (!force && work - lastYieldWork < 6) return;
      lastYieldWork = work;
      updateStatus(currentPhase, true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    };

    const getPlayableGames = (openings: Opening[]) =>
      openings.reduce(
        (sum, opening) =>
          opening.move === "*" || opening.move === "Total" ? sum : sum + getOpeningTotal(opening),
        0,
      );

    const rememberRootDatabaseGames = (openings: Opening[]) => {
      if (rootDatabaseGames !== null) return;
      rootDatabaseGames = getPlayableGames(openings);
    };

    const getEvidenceMinGames = (ply: number) =>
      getPrepBuilderEvidenceMinGames({
        settings,
        rootGames: rootDatabaseGames,
        ply,
      });

    const addMoveWithComment = (path: number[], moveSan: string, comment: string) => {
      const state = store.getState();
      if (!pathExists(state.root, path)) return null;

      const parent = state.getNode(path);
      if (!parent) return null;
      const existingIndex = parent.children.findIndex((child) => child.san === moveSan);
      state.goToMove(path);
      state.makeMove({ payload: moveSan, changeHeaders: false });

      const nextPath = store.getState().position;
      if (!isPrefix(path, nextPath) || nextPath.length !== path.length + 1) {
        return null;
      }

      const node = store.getState().getNode(nextPath);
      if (!node) return null;
      const nextComment = mergePrepBuilderComment(node.comment, comment);
      store.getState().setCommentAtPath(nextPath, nextComment);

      return {
        path: nextPath,
        created: existingIndex === -1,
      };
    };

    const addUserResponseAtPath = async (
      task: PrepBuilderQueueItem,
    ): Promise<PrepBuilderQueueItem | null> => {
      if (builderCancelRef.current) return null;

      const currentState = store.getState();
      if (!pathExists(currentState.root, task.path)) return null;

      const node = currentState.getNode(task.path);
      if (!node) return null;

      const stopReason = getPrepBuilderStopReason({
        branchShare: task.branchShare,
        depthShare: task.depthShare,
        ply: task.ply,
        settings,
      });
      if (stopReason) {
        stoppedLines += 1;
        updateStatus(stopReason);
        return null;
      }

      const existingResponseIndex = getPrepBuilderUserResponseChildIndex(node);
      if (existingResponseIndex !== null) {
        return {
          path: [...task.path, existingResponseIndex],
          branchShare: task.branchShare,
          depthShare: task.depthShare,
          branchValue: task.branchValue,
          ply: task.ply + 1,
        };
      }

      updateStatus("Choosing your move");
      const [opponentOpenings, referenceOpenings, engineMoves] = await Promise.all([
        loadOpeningsForFen(node.fen, settings.opponentMoveLimit).catch(() => []),
        loadLichessAllOpeningsForFen(node.fen, settings).catch(() => []),
        loadPrepBuilderEngineMoves(node.fen, userSide, settings).catch(() => []),
      ]);
      if (builderCancelRef.current) return null;

      rememberRootDatabaseGames(opponentOpenings);
      const evidenceMinGames = getEvidenceMinGames(task.ply);
      const availableGames = getPlayableGames(opponentOpenings);
      const hasDatabaseCandidate = hasPrepBuilderDatabaseCandidates(
        opponentOpenings,
        evidenceMinGames,
      );
      const availabilityStop = getPrepBuilderStopReason({
        branchShare: task.branchShare,
        depthShare: task.depthShare,
        ply: task.ply,
        availableGames,
        minGames: evidenceMinGames,
        settings,
      });

      if (availabilityStop && referenceOpenings.length === 0 && engineMoves.length === 0) {
        stoppedLines += 1;
        updateStatus(availabilityStop);
        return null;
      }

      if (!hasDatabaseCandidate) {
        stoppedLines += 1;
        updateStatus("No database result");
        return null;
      }

      const choice = choosePrepBuilderMove({
        opponentOpenings,
        referenceOpenings,
        engineMoves,
        userColor: userSide,
        settings,
        minGames: evidenceMinGames,
      });

      if (!choice) {
        stoppedLines += 1;
        updateStatus("No supported database move");
        return null;
      }

      const child = addMoveWithComment(
        task.path,
        choice.move,
        formatPrepBuilderChoiceComment(choice),
      );
      if (!child) {
        stoppedLines += 1;
        updateStatus("Could not add chosen move");
        return null;
      }
      touchedTree = true;
      if (child.created) addedMoves += 1;
      await yieldToBuilderUi();

      return {
        path: child.path,
        branchShare: task.branchShare,
        depthShare: task.depthShare,
        branchValue: task.branchValue,
        ply: task.ply + 1,
      };
    };

    try {
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      const queue: PrepBuilderQueueItem[] = [
        {
          path: safeRootPath,
          branchShare: 1,
          depthShare: 1,
          ply: 0,
        },
      ];
      const enqueueTasks = (tasks: PrepBuilderQueueItem[]) => {
        queue.push(...tasks);
        queue.sort(
          (a, b) =>
            a.ply - b.ply ||
            getPrepBuilderTaskPriority({
              branchShare: b.branchShare,
              branchValue: b.branchValue,
              ply: b.ply,
              settings,
            }) -
              getPrepBuilderTaskPriority({
                branchShare: a.branchShare,
                branchValue: a.branchValue,
                ply: a.ply,
                settings,
              }) ||
            b.depthShare - a.depthShare,
        );
      };

      while (
        queue.length > 0 &&
        visitedPositions < safetyPositionLimit &&
        !builderCancelRef.current
      ) {
        const task = queue.shift()!;
        if (builderCancelRef.current) break;
        const currentState = store.getState();
        if (!pathExists(currentState.root, task.path)) continue;

        const node = currentState.getNode(task.path);
        if (!node) continue;
        const stopReason = getPrepBuilderStopReason({
          branchShare: task.branchShare,
          depthShare: task.depthShare,
          ply: task.ply,
          settings,
        });
        if (stopReason) {
          stoppedLines += 1;
          updateStatus(stopReason);
          continue;
        }

        const turn = getFenTurn(node.fen);

        if (turn === prep.color) {
          visitedPositions += 1;
          updateStatus(prepMode === "general" ? "Adding common replies" : "Adding their replies");
          const replyPolicy = getPrepBuilderReplyPolicy({
            branchShare: task.depthShare,
            settings,
          });
          const openings = await loadOpeningsForFen(
            node.fen,
            getPrepBuilderBranchSearchMoveLimit(settings),
          );
          if (builderCancelRef.current) break;
          rememberRootDatabaseGames(openings);
          const replyMinGames = getEvidenceMinGames(task.ply + 1);
          const availableGames = getPlayableGames(openings);
          const availabilityStop = getPrepBuilderStopReason({
            branchShare: task.branchShare,
            depthShare: task.depthShare,
            ply: task.ply,
            availableGames,
            minGames: replyMinGames,
            settings,
          });
          if (availabilityStop) {
            stoppedLines += 1;
            updateStatus(availabilityStop);
            continue;
          }

          const rows = getOpponentPrepMoveRows({
            fen: node.fen,
            node,
            openings,
            minGames: replyMinGames,
            moveLimit: replyPolicy.moveLimit,
            completedBranches: prep.completedBranches,
            skippedBranches: prep.skippedBranches,
          }).filter(
            (row) =>
              row.status !== "skipped" &&
              row.total >= replyMinGames &&
              row.share * 100 >= replyPolicy.minMoveShare,
          );

          if (rows.length === 0) {
            stoppedLines += 1;
            updateStatus("No common reply above threshold");
            continue;
          }

          const nextTasks: PrepBuilderQueueItem[] = [];
          for (const row of rows.slice(0, replyPolicy.moveLimit)) {
            if (builderCancelRef.current) break;

            const nextBranchShare = task.branchShare * row.share;
            const nextDepthShare = Math.min(task.depthShare, row.share);
            const nextBranchValue = getPrepBuilderBranchValue({
              opening: row,
              userColor: userSide,
              settings,
            });
            const nextPly = task.ply + 1;
            const branchStopReason = getPrepBuilderStopReason({
              branchShare: nextBranchShare,
              depthShare: nextDepthShare,
              ply: nextPly,
              settings,
            });
            if (branchStopReason) {
              stoppedLines += 1;
              updateStatus(branchStopReason);
              continue;
            }

            const child = addMoveWithComment(
              task.path,
              row.move,
              formatPrepBuilderOpponentComment({
                row,
                branchShare: nextBranchShare,
                general: prepMode === "general",
              }),
            );
            if (!child) continue;

            const responseChild = await addUserResponseAtPath({
              path: child.path,
              branchShare: nextBranchShare,
              depthShare: nextDepthShare,
              branchValue: nextBranchValue,
              ply: nextPly,
            });
            if (!responseChild) {
              if (child.created) {
                store.getState().deleteMove(child.path);
              }
              continue;
            }

            touchedTree = true;
            if (child.created) addedMoves += 1;
            nextTasks.push(responseChild);
            await yieldToBuilderUi();
          }
          enqueueTasks(nextTasks);
        } else {
          const responseChild = await addUserResponseAtPath(task);
          if (responseChild) enqueueTasks([responseChild]);
        }
        await yieldToBuilderUi();
      }

      store.getState().goToMove(safeRootPath);
      updateStatus(
        builderCancelRef.current
          ? "Stopped"
          : queue.length > 0 && visitedPositions >= safetyPositionLimit
            ? "Safety stop"
            : "Done",
        true,
      );
      setBuilderNeedsSave(touchedTree);
      notifications.show({
        title: builderCancelRef.current ? "Prep builder stopped" : "Prep builder done",
        message: `${addedMoves} move${addedMoves === 1 ? "" : "s"} added.`,
        color: builderCancelRef.current ? "yellow" : "green",
      });
    } catch (error) {
      notifications.show({
        title: "Prep builder failed",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setBuilderRunning(false);
    }
  }, [
    builderRunning,
    clearMovePreview,
    configReady,
    loadLichessAllOpeningsForFen,
    loadOpeningsForFen,
    loadPrepBuilderEngineMoves,
    prep.builder,
    prep.color,
    prep.completedBranches,
    prep.rootPath,
    prep.skippedBranches,
    prepMode,
    store,
  ]);

  const stopPrepBuilder = useCallback(() => {
    builderCancelRef.current = true;
    setBuilderStatus((current) =>
      current
        ? {
            ...current,
            phase: "Stopping",
          }
        : current,
    );
  }, []);

  const saveBuilderResult = useCallback(
    async (mode: "new" | "overwrite") => {
      if (savingBuilderResult) return;

      setSavingBuilderResult(mode);
      try {
        const saved = await saveToFile({
          dir: documentDir,
          tab: currentTab,
          setCurrentTab,
          store,
          forceSaveAs: mode === "new",
        });
        if (!saved) return;

        setBuilderNeedsSave(false);
        notifications.show({
          title: mode === "new" ? "Prep saved to new file" : "Prep saved",
          message:
            mode === "new"
              ? "The generated prep has been saved as a separate PGN."
              : "The generated prep has been written to the current file.",
          color: "green",
        });
      } catch (error) {
        notifications.show({
          title: "Could not save prep",
          message: error instanceof Error ? error.message : String(error),
          color: "red",
        });
      } finally {
        setSavingBuilderResult(null);
      }
    },
    [currentTab, documentDir, savingBuilderResult, setCurrentTab, store],
  );

  return (
    <Stack h="100%" gap={dense ? 4 : "xs"} p={dense ? 4 : "xs"} style={{ overflow: "hidden" }}>
      {showSetupStage ? (
        <>
          <Group
            justify="space-between"
            align="center"
            gap="xs"
            wrap="wrap"
            style={{ flexShrink: 0 }}
          >
            <Group gap="xs" wrap="wrap">
              <Text fw={700} fz={compact ? "sm" : "md"}>
                {prepMode === "general" ? "Opening prep" : "Opponent prep"}
              </Text>
              {databaseLabel ? (
                <Badge variant="light" size={compact ? "sm" : "md"}>
                  {databaseLabel}
                </Badge>
              ) : null}
              {prepMode === "general" ? (
                <Badge color="teal" variant="light" size={compact ? "sm" : "md"}>
                  You as {userColor}
                </Badge>
              ) : prep.playerName.trim() ? (
                <Badge color="orange" variant="light" size={compact ? "sm" : "md"}>
                  {prep.playerName.trim()} as {prep.color}
                </Badge>
              ) : null}
            </Group>
            {underBoard ? (
              <Button
                variant="filled"
                size={controlSize}
                leftSection={<IconPlayerPlay size="0.95rem" />}
                disabled={!configReady}
                onClick={startUnderBoardPrep}
              >
                Start prep
              </Button>
            ) : (
              <Group gap={4} wrap="nowrap">
                <Tooltip label="Use the current board position as the start for prep and the builder">
                  <Button
                    variant="default"
                    size={controlSize}
                    leftSection={<IconTarget size="0.95rem" />}
                    onClick={setRootHere}
                  >
                    Start here
                  </Button>
                </Tooltip>
                <Tooltip label="Go back to the starting position">
                  <ActionIcon variant="default" size={compact ? "sm" : "lg"} onClick={resetLine}>
                    <IconArrowBackUp size="1rem" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Clear manual done and skipped marks">
                  <ActionIcon
                    variant="default"
                    size={compact ? "sm" : "lg"}
                    onClick={() =>
                      setPrep((current) => ({
                        ...current,
                        completedBranches: {},
                        skippedBranches: {},
                      }))
                    }
                  >
                    <IconRefresh size="1rem" />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
          </Group>

          <Group gap={dense ? 4 : "xs"} wrap="wrap" style={{ flexShrink: 0 }}>
            <Tooltip label="Choose whether to target one player or a general opening source">
              <SegmentedControl
                aria-label="Prep target"
                data={[
                  { value: "player", label: "Player" },
                  { value: "general", label: "General" },
                ]}
                value={prepMode}
                onChange={(value) => changePrepMode(value as "player" | "general")}
                size={controlSize}
              />
            </Tooltip>
            <DatabaseFolderSelect
              data={sourceOptions}
              value={sourceValue}
              onChange={changePrepSource}
              placeholder="Prep source"
              size={controlSize}
              width={dense ? 180 : 230}
              allowDeselect={false}
            />
            <Tooltip label="Import a player's online games and use them as this prep source">
              <Button
                variant="default"
                size={controlSize}
                leftSection={<IconCloudDownload size="0.95rem" />}
                onClick={() => setOnlineImportOpen((open) => !open)}
              >
                Import games
              </Button>
            </Tooltip>
            {underBoard ? (
              <PrepStrengthSettingsButton
                builderSettings={builderSettings}
                updateBuilderSettings={updateBuilderSettings}
                controlSize={controlSize}
              />
            ) : null}
          </Group>

          <Collapse in={!onlineImportOpen} style={{ flexShrink: 0 }}>
            <Group gap={dense ? 4 : "xs"} wrap="wrap" align="flex-end">
              {prepMode === "player" ? (
                <DatabasePerspectiveControls
                  databasePath={prepSource === "local" ? prep.databasePath : null}
                  player={prep.player}
                  playerName={prep.playerName}
                  color={prep.color}
                  onPlayerChange={(player) => updateSettings({ player }, false)}
                  onPlayerNameChange={(playerName) => updateSettings({ playerName }, false)}
                  onColorChange={(color) => updateSettings({ color }, true)}
                  size={controlSize}
                  playerWidth={dense ? 170 : 210}
                  colorWidth={dense ? 236 : 280}
                  colorLabelPlayerName={prep.playerName}
                />
              ) : (
                <Tooltip label="The side you are preparing to play">
                  <SegmentedControl
                    aria-label="Your prep side"
                    data={[
                      { value: "white", label: "I'm white" },
                      { value: "black", label: "I'm black" },
                    ]}
                    value={userColor}
                    onChange={(value) => changeGeneralUserColor(value as "white" | "black")}
                    size={controlSize}
                    w={dense ? 196 : 220}
                  />
                </Tooltip>
              )}
              <Tooltip
                label={
                  prepMode === "general"
                    ? "Only show database moves that appear at least this many times"
                    : "Only show opponent moves they have played at least this many times"
                }
              >
                <NumberInput
                  label="Min games"
                  value={prep.minGames}
                  onChange={(value) =>
                    updateSettings(
                      {
                        minGames: Math.max(1, Number(value) || DEFAULT_PREP_MIN_GAMES),
                      },
                      false,
                    )
                  }
                  min={1}
                  max={999}
                  step={1}
                  size={controlSize}
                  w={dense ? 92 : 108}
                  aria-label="Minimum games"
                />
              </Tooltip>
              <Tooltip
                label={
                  prepMode === "general"
                    ? "How many common database moves to show at each position"
                    : "How many of their most common moves to show at each position"
                }
              >
                <NumberInput
                  label="Show top"
                  value={prep.moveLimit}
                  onChange={(value) =>
                    updateSettings(
                      {
                        moveLimit: Math.max(1, Number(value) || DEFAULT_PREP_MOVE_LIMIT),
                      },
                      false,
                    )
                  }
                  min={1}
                  max={20}
                  step={1}
                  size={controlSize}
                  w={dense ? 92 : 108}
                  aria-label="Top opponent moves to show"
                />
              </Tooltip>
            </Group>
          </Collapse>
          <Collapse in={underBoard && builderOpen} style={{ flexShrink: 0 }}>
            <Group gap={dense ? 4 : "xs"} wrap="wrap" pt={dense ? 2 : 4}>
              <SegmentedControl
                aria-label="Prep strength mode"
                data={[
                  { value: "smart", label: "Smart" },
                  { value: "engine", label: "Engine" },
                  { value: "practical", label: "Practical" },
                ]}
                value={builderSettings.mode}
                onChange={(value) =>
                  updateBuilderSettings({ mode: value as PrepBuilderSettings["mode"] })
                }
                size={controlSize}
              />
              <Select
                label={prepMode === "general" ? "Source move sort" : "Their move sort"}
                value={prepSortDefaults.opponent}
                data={PREP_OPPONENT_SORT_OPTIONS}
                onChange={(value) => {
                  if (isOpponentPrepSortColumn(value)) updateOpponentSortDefault(value);
                }}
                size={controlSize}
                w={dense ? 130 : 158}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
              <Select
                label="Your move sort"
                value={prepSortDefaults.candidate}
                data={PREP_CANDIDATE_SORT_OPTIONS}
                onChange={(value) => {
                  if (isCandidatePrepSortColumn(value)) updateCandidateSortDefault(value);
                }}
                size={controlSize}
                w={dense ? 130 : 158}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
              <Tooltip label="Smart mode blend: 0 is database WDL only, 100 is cloud engine only">
                <NumberInput
                  label="Engine blend"
                  suffix="%"
                  value={builderSettings.engineWeight}
                  onChange={(value) =>
                    updateBuilderSettings({
                      engineWeight: Math.max(0, Math.min(100, Number(value) || 0)),
                    })
                  }
                  min={0}
                  max={100}
                  step={5}
                  size={controlSize}
                  w={dense ? 104 : 128}
                  aria-label="Smart mode engine blend"
                />
              </Tooltip>
              <Tooltip label="Moves worse than this cloud-engine drop are treated as unsafe when cloud evals are available">
                <NumberInput
                  label="Max CP drop"
                  suffix=" cp"
                  value={builderSettings.maxEngineCpLoss}
                  onChange={(value) =>
                    updateBuilderSettings({
                      maxEngineCpLoss: Math.max(0, Math.min(300, Number(value) || 0)),
                    })
                  }
                  min={0}
                  max={300}
                  step={5}
                  size={controlSize}
                  w={dense ? 104 : 128}
                  aria-label="Maximum engine centipawn drop"
                />
              </Tooltip>
            </Group>
          </Collapse>
        </>
      ) : null}

      <Collapse in={showSetupStage && onlineImportOpen} style={{ flexShrink: 0 }}>
        <Stack gap={dense ? 3 : 6} pt={dense ? 2 : 4} pb={dense ? 4 : 6}>
          <Group gap={dense ? 4 : 6} wrap="wrap" align="flex-end">
            <SegmentedControl
              aria-label="Online prep source"
              data={[
                { value: "lichess", label: "Lichess" },
                { value: "chesscom", label: "Chess.com" },
              ]}
              value={onlineImportSource}
              onChange={(value) => setOnlineImportSource(value as OnlineGameSource)}
              size={controlSize}
            />
            <TextInput
              label="Player"
              value={onlineImportUsername}
              onChange={(event) => setOnlineImportUsername(event.currentTarget.value)}
              placeholder="Username"
              size={controlSize}
              w={dense ? 130 : 170}
            />
            <SegmentedControl
              aria-label="Online import scope"
              data={[
                { value: "count", label: "Most recent" },
                { value: "range", label: "Date range" },
              ]}
              value={onlineImportMode}
              onChange={(value) => setOnlineImportMode(value as PrepOnlineImportMode)}
              size={controlSize}
            />
            {onlineImportMode === "count" ? (
              <NumberInput
                label="Games"
                value={onlineImportGameCount}
                onChange={(value) =>
                  setOnlineImportGameCount(
                    Math.max(1, Math.min(MAX_ONLINE_IMPORT_GAMES, Number(value) || 1)),
                  )
                }
                min={1}
                max={MAX_ONLINE_IMPORT_GAMES}
                step={25}
                size={controlSize}
                w={dense ? 92 : 112}
                aria-label="Most recent online games"
              />
            ) : (
              <Select
                label="Range"
                data={PREP_ONLINE_RANGE_OPTIONS}
                value={onlineImportRange}
                onChange={(value) =>
                  setOnlineImportRange((value as PrepOnlineRangePreset | null) ?? "3m")
                }
                size={controlSize}
                w={dense ? 132 : 156}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
            )}
          </Group>
          <Group gap={dense ? 4 : "xs"} wrap="wrap" align="center">
            <Checkbox
              label="Save database"
              checked={onlineImportSaveDatabase}
              onChange={(event) => setOnlineImportSaveDatabase(event.currentTarget.checked)}
              size={controlSize}
              styles={{ body: { alignItems: "center" } }}
            />
            {onlineImportMode === "count" ? (
              <Button
                variant="default"
                size={controlSize}
                disabled={!onlineImportUsernameTrimmed}
                loading={onlineImportPreviewLoading}
                onClick={() => void previewOnlineImportCount()}
              >
                Check range
              </Button>
            ) : (
              <Badge variant="light">{onlineImportRangeLabel}</Badge>
            )}
            <Text size="xs" c="dimmed" style={{ flex: "1 1 18rem", minWidth: 0 }}>
              {onlineImportPreviewText}
            </Text>
            <Button
              variant="filled"
              size={controlSize}
              leftSection={<IconCloudDownload size="0.95rem" />}
              disabled={!onlineImportUsernameTrimmed}
              loading={onlineImporting}
              onClick={() => void importOnlineGamesForPrep()}
            >
              Import + use
            </Button>
            {onlineImportProgress !== null ? (
              <Group gap={6} wrap="nowrap" style={{ flex: `0 0 ${dense ? 120 : 160}px` }}>
                <Progress value={onlineImportProgress} size="xs" style={{ flex: 1 }} />
                <Text size="xs" c="dimmed">
                  {Math.round(onlineImportProgress)}%
                </Text>
              </Group>
            ) : null}
          </Group>
        </Stack>
        <Divider my={dense ? 2 : 4} />
      </Collapse>

      {!underBoard ? (
        <Box style={{ flexShrink: 0 }}>
          <Group justify="space-between" gap="xs" wrap="wrap">
            <Group gap={4} wrap="wrap">
              <Tooltip label="Automatically add repertoire lines from the current prep start">
                <Button
                  variant="filled"
                  size={controlSize}
                  leftSection={<IconSparkles size="0.95rem" />}
                  disabled={!configReady}
                  loading={builderRunning}
                  onClick={() => void runPrepBuilder()}
                >
                  Build prep
                </Button>
              </Tooltip>
              <Tooltip
                label={
                  canRunStraightLine
                    ? "Find a high-confidence line where this player keeps following forced moves into a bad engine position"
                    : "Straight lines need Player mode with a local player source"
                }
              >
                <Button
                  variant={straightLineQualifies ? "light" : "default"}
                  color={straightLineQualifies ? "red" : undefined}
                  size={controlSize}
                  leftSection={<IconRoute size="0.95rem" />}
                  disabled={!canRunStraightLine}
                  loading={straightLineRunning}
                  onClick={() => void runStraightLineSearch()}
                >
                  {straightLineMode === "venom" ? "Find venom" : "Find line"}
                </Button>
              </Tooltip>
              {straightLineRunning ? (
                <Tooltip label="Stop after the current lookup finishes">
                  <Button
                    color="red"
                    variant="default"
                    size={controlSize}
                    leftSection={<IconX size="0.95rem" />}
                    onClick={stopStraightLineSearch}
                  >
                    Stop line
                  </Button>
                </Tooltip>
              ) : null}
              <PrepStraightLineSettingsButton
                controlSize={controlSize}
                mode={straightLineMode}
                minShare={straightLineMinShare}
                minCp={straightLineMinCp}
                maxPly={straightLineMaxPly}
                onModeChange={(mode) => {
                  setStraightLineMode(mode);
                  setStraightLineMinShare(
                    mode === "strict"
                      ? DEFAULT_STRICT_LINE_MIN_SHARE
                      : DEFAULT_VENOM_LINE_MIN_SHARE,
                  );
                  setStraightLineMinCp(
                    mode === "strict" ? DEFAULT_STRICT_LINE_MIN_CP : DEFAULT_VENOM_LINE_MIN_CP,
                  );
                }}
                onMinShareChange={setStraightLineMinShare}
                onMinCpChange={setStraightLineMinCp}
                onMaxPlyChange={setStraightLineMaxPly}
              />
              {builderRunning ? (
                <Tooltip label="Stop after the current lookup finishes">
                  <Button
                    color="red"
                    variant="default"
                    size={controlSize}
                    leftSection={<IconX size="0.95rem" />}
                    onClick={stopPrepBuilder}
                  >
                    Stop
                  </Button>
                </Tooltip>
              ) : null}
              <Tooltip label="Tune how the prep builder balances engine moves, WDL results, breadth, and depth">
                <Button
                  variant="default"
                  size={controlSize}
                  leftSection={<IconSettings size="0.95rem" />}
                  onClick={() => setBuilderOpen((open) => !open)}
                >
                  Builder settings
                </Button>
              </Tooltip>
              <PrepStrengthSettingsButton
                builderSettings={builderSettings}
                updateBuilderSettings={updateBuilderSettings}
                controlSize={controlSize}
              />
            </Group>
            {builderStatus ? (
              <Text size="xs" c={builderRunning ? "blue" : "dimmed"}>
                {builderStatus.phase} - {builderStatus.addedMoves} added,{" "}
                {builderStatus.visitedPositions} checked
              </Text>
            ) : null}
          </Group>
          <Collapse in={builderOpen}>
            <Stack gap={dense ? 4 : "xs"} pt="xs">
              <Group gap={dense ? 4 : "xs"} wrap="wrap">
                <SegmentedControl
                  aria-label="Prep builder mode"
                  data={[
                    { value: "smart", label: "Smart" },
                    { value: "engine", label: "Engine" },
                    { value: "practical", label: "Practical" },
                  ]}
                  value={builderSettings.mode}
                  onChange={(value) =>
                    updateBuilderSettings({ mode: value as PrepBuilderSettings["mode"] })
                  }
                  size={controlSize}
                />
                <Select
                  label={prepMode === "general" ? "Source move sort" : "Their move sort"}
                  value={prepSortDefaults.opponent}
                  data={PREP_OPPONENT_SORT_OPTIONS}
                  onChange={(value) => {
                    if (isOpponentPrepSortColumn(value)) updateOpponentSortDefault(value);
                  }}
                  size={controlSize}
                  w={dense ? 130 : 158}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label="Your move sort"
                  value={prepSortDefaults.candidate}
                  data={PREP_CANDIDATE_SORT_OPTIONS}
                  onChange={(value) => {
                    if (isCandidatePrepSortColumn(value)) updateCandidateSortDefault(value);
                  }}
                  size={controlSize}
                  w={dense ? 130 : 158}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: true }}
                />
                <SegmentedControl
                  aria-label="Prep builder depth"
                  data={[
                    { value: "quick", label: "Short" },
                    { value: "balanced", label: "Normal" },
                    { value: "deep", label: "Deep" },
                  ]}
                  value={builderSettings.size}
                  onChange={(value) =>
                    updateBuilderSettings({ size: value as PrepBuilderSettings["size"] })
                  }
                  size={controlSize}
                />
                <Tooltip label="Opponent moves below this play rate are ignored by the builder">
                  <NumberInput
                    label="Min play rate"
                    suffix="%"
                    value={builderSettings.minOpponentMoveShare}
                    onChange={(value) =>
                      updateBuilderSettings({
                        minOpponentMoveShare: Math.max(0, Number(value) || 0),
                      })
                    }
                    min={0}
                    max={80}
                    step={1}
                    size={controlSize}
                    w={dense ? 104 : 128}
                    aria-label="Minimum opponent play rate"
                  />
                </Tooltip>
                <Tooltip label="Smart mode blend: 0 is database WDL only, 100 is cloud engine only">
                  <NumberInput
                    label="Engine blend"
                    suffix="%"
                    value={builderSettings.engineWeight}
                    onChange={(value) =>
                      updateBuilderSettings({
                        engineWeight: Math.max(0, Math.min(100, Number(value) || 0)),
                      })
                    }
                    min={0}
                    max={100}
                    step={5}
                    size={controlSize}
                    w={dense ? 104 : 128}
                    aria-label="Smart mode engine blend"
                  />
                </Tooltip>
                <Tooltip label="Moves worse than this cloud-engine drop are treated as unsafe when cloud evals are available">
                  <NumberInput
                    label="Max CP drop"
                    suffix=" cp"
                    value={builderSettings.maxEngineCpLoss}
                    onChange={(value) =>
                      updateBuilderSettings({
                        maxEngineCpLoss: Math.max(0, Math.min(300, Number(value) || 0)),
                      })
                    }
                    min={0}
                    max={300}
                    step={5}
                    size={controlSize}
                    w={dense ? 104 : 128}
                    aria-label="Maximum engine centipawn drop"
                  />
                </Tooltip>
                <Badge variant="light">Lichess All reference</Badge>
                <Badge variant="light">Cloud engine</Badge>
              </Group>
            </Stack>
            <Divider my={dense ? 4 : "xs"} />
          </Collapse>
          {builderNeedsSave ? (
            <Group gap={4} mt={dense ? 4 : "xs"} wrap="wrap">
              <Text size="xs" c="dimmed">
                Builder output is ready to save.
              </Text>
              <Button
                variant="default"
                size={controlSize}
                loading={savingBuilderResult === "new"}
                onClick={() => void saveBuilderResult("new")}
              >
                Save new file
              </Button>
              <Button
                variant="default"
                size={controlSize}
                disabled={!canOverwriteCurrent}
                loading={savingBuilderResult === "overwrite"}
                onClick={() => void saveBuilderResult("overwrite")}
              >
                Overwrite current
              </Button>
            </Group>
          ) : null}
          {straightLineStatus || straightLineResult ? (
            <PrepStraightLineResultPanel
              result={straightLineResult}
              status={straightLineStatus}
              running={straightLineRunning}
              qualifies={straightLineQualifies}
              mode={straightLineMode}
              minCp={straightLineMinCp}
              onPlay={playStraightLineResult}
              onClear={() => {
                setStraightLineResult(null);
                setStraightLineStatus(null);
              }}
            />
          ) : null}
        </Box>
      ) : null}

      {showTrainingStage ? (
        <Group justify="space-between" gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
          <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
            <Text size="xs" c="dimmed" truncate>
              Start: {rootSans.length > 0 ? rootSans.join(" ") : "game start"}
            </Text>
            <Text
              size="xs"
              c={!isInsidePrepTree || !opponentToMove ? "dimmed" : undefined}
              truncate
            >
              {!isInsidePrepTree
                ? "Away from prep start"
                : opponentToMove
                  ? prepMode === "general"
                    ? `${prep.color === "white" ? "White" : "Black"} to move`
                    : `${prep.playerName.trim() || "Opponent"} to move`
                  : `Play your ${userColor} ${prepMode === "general" ? "move" : "response"} on the board`}
              {lineSans.length > 0 ? ` - ${lineSans.slice(-10).join(" ")}` : ""}
            </Text>
          </Stack>
          <Group gap={4} wrap="nowrap">
            <Tooltip label="Play the first unprepared common move from the prep start">
              <Button
                variant="filled"
                size={controlSize}
                leftSection={<IconPlayerPlay size="0.95rem" />}
                disabled={!configReady}
                loading={commonMoving}
                onClick={() => void playCommonMoveFromStart()}
              >
                Common move
              </Button>
            </Tooltip>
            <Tooltip label="Mark this line done and play the next common move from the starting position">
              <Button
                variant="default"
                size={controlSize}
                leftSection={<IconArrowRight size="0.95rem" />}
                disabled={!configReady}
                loading={advancing}
                onClick={() => void advanceToNextBranch()}
              >
                Done + next
              </Button>
            </Tooltip>
            {activeBranch ? (
              canOpenPrepSourceGames ? (
                <Tooltip label={`Open a source game at ${activeBranch.san}`}>
                  <Button
                    variant="default"
                    size={controlSize}
                    leftSection={<IconExternalLink size="0.95rem" />}
                    loading={openingSourceGameKey === activeBranch.key}
                    disabled={!configReady}
                    onClick={() =>
                      void openPrepSourceGame({
                        key: activeBranch.key,
                        fen: activeBranch.fen,
                        move: activeBranch.san,
                        uci: activeBranch.uci,
                      })
                    }
                  >
                    Go to game
                  </Button>
                </Tooltip>
              ) : null
            ) : null}
            {activeBranch ? (
              <Tooltip label="Return to the last opponent choice in this line">
                <ActionIcon
                  variant="default"
                  size={compact ? "sm" : "lg"}
                  onClick={goToActiveChoice}
                >
                  <IconArrowBackUp size="1rem" />
                </ActionIcon>
              </Tooltip>
            ) : null}
            {underBoard ? (
              <Tooltip label="Change prep source and target">
                <ActionIcon
                  aria-label="Change prep setup"
                  variant="default"
                  size={compact ? "sm" : "lg"}
                  onClick={() => setUnderBoardStage("setup")}
                >
                  <IconSettings size="1rem" />
                </ActionIcon>
              </Tooltip>
            ) : null}
          </Group>
        </Group>
      ) : null}

      {!sourceReady ? (
        <Alert color="yellow" variant="light">
          {missingExplorerToken
            ? "Link a Lichess account to use Lichess All or Lichess Masters in prep."
            : "Choose a prep source before starting."}
        </Alert>
      ) : !targetReady ? (
        <Alert color="yellow" variant="light">
          Choose the opponent player and the colour they play in the games you want to prepare
          against.
        </Alert>
      ) : !isInsidePrepTree && !underBoard ? (
        <Alert color="blue" variant="light">
          You are away from the starting position for this prep. Go back to start, or start from the
          current board position.
        </Alert>
      ) : null}

      {showTrainingStage && configReady && opponentToMove && currentRows.length > 0 ? (
        <Group gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
          <Badge variant="light">{preparedCount} prepared</Badge>
          {startedCount > 0 ? <Badge variant="light">{startedCount} started</Badge> : null}
          {skippedCount > 0 ? (
            <Badge color="gray" variant="light">
              {skippedCount} skipped
            </Badge>
          ) : null}
          <Text size="xs" c="dimmed">
            {formatNumber(currentRows.reduce((sum, row) => sum + row.total, 0))} games in shown
            moves
          </Text>
        </Group>
      ) : null}

      {showTrainingStage ? (
        <Box flex={1} style={{ minHeight: 0, overflow: "auto" }}>
          {error ? (
            <Alert color="red">Could not search the prep source from this position.</Alert>
          ) : !configReady ? null : opponentToMove ? (
            <OpponentPrepMoveTable
              rows={currentRows}
              loading={isLoading}
              dense={dense}
              general={prepMode === "general"}
              resultSide={prep.color}
              onPlay={playMove}
              onOpenGame={
                canOpenPrepSourceGames
                  ? (row) =>
                      openPrepSourceGame({
                        key: row.key,
                        fen: currentFen,
                        move: row.move,
                        uci: row.uci,
                      })
                  : undefined
              }
              openingGameKey={openingSourceGameKey}
              onDone={markMoveDone}
              onSkip={skipMove}
              onPreview={previewMove}
              onClearPreview={clearMovePreview}
              branchStatsByKey={branchStatsByKey}
              branchStatsLoading={branchStatsLoading}
              strengthByMove={strengthByMove}
              strengthLoading={strengthLoading}
              sort={moveTableSort.opponent}
              onSort={setOpponentMoveSortColumn}
            />
          ) : (
            <PrepCandidateMoveTable
              rows={candidateRows}
              loading={isLoading}
              dense={dense}
              general={prepMode === "general"}
              userColor={userColor}
              onPlay={playMove}
              onPreview={previewMove}
              onClearPreview={clearMovePreview}
              strengthByMove={strengthByMove}
              strengthLoading={strengthLoading}
              sort={moveTableSort.candidate}
              onSort={setCandidateMoveSortColumn}
            />
          )}
        </Box>
      ) : null}
    </Stack>
  );
}

function OpponentPrepMoveTable({
  rows,
  loading,
  dense,
  general,
  resultSide,
  onPlay,
  onOpenGame,
  openingGameKey,
  onDone,
  onSkip,
  onPreview,
  onClearPreview,
  branchStatsByKey,
  branchStatsLoading,
  strengthByMove,
  strengthLoading,
  sort,
  onSort,
}: {
  rows: OpponentPrepMoveRow[];
  loading: boolean;
  dense: boolean;
  general: boolean;
  resultSide: "white" | "black";
  onPlay: (move: string) => void;
  onOpenGame?: (row: OpponentPrepMoveRow) => void;
  openingGameKey?: string | null;
  onDone: (row: OpponentPrepMoveRow) => void;
  onSkip: (row: OpponentPrepMoveRow) => void;
  onPreview: (move: string) => void;
  onClearPreview: () => void;
  branchStatsByKey?: Record<string, OpponentPrepBranchStats>;
  branchStatsLoading: boolean;
  strengthByMove: Map<string, PrepMoveStrength>;
  strengthLoading: boolean;
  sort: PrepSortState<OpponentPrepSortColumn>;
  onSort: (column: OpponentPrepSortColumn) => void;
}) {
  const textSize = dense ? "xs" : "sm";
  const sortedRows = useMemo(
    () => sortOpponentPrepTableRows(rows, sort, branchStatsByKey, resultSide, strengthByMove),
    [branchStatsByKey, resultSide, rows, sort, strengthByMove],
  );

  if (loading) {
    return (
      <Stack gap="xs" py="md" align="center">
        <Progress value={100} animated w="min(18rem, 100%)" />
        <Text size="xs" c="dimmed">
          {general ? "Checking database moves" : "Checking opponent moves"}
        </Text>
      </Stack>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert color="gray" variant="light">
        {general
          ? "No common database moves met the current game threshold from this position."
          : "No common opponent moves met the current game threshold from this position."}
      </Alert>
    );
  }

  return (
    <Table
      withTableBorder
      stickyHeader
      highlightOnHover
      horizontalSpacing={dense ? 4 : "xs"}
      verticalSpacing={dense ? 3 : "xs"}
    >
      <Table.Thead>
        <Table.Tr>
          <SortablePrepTh
            label="Move"
            column="move"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 64 : 90 }}
          />
          <SortablePrepTh
            label="Strength"
            column="strength"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 80 : 104 }}
          />
          <SortablePrepTh
            label="Games"
            column="games"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 78 : 110 }}
          />
          <SortablePrepTh label="Results" column="results" sort={sort} onSort={onSort} />
          <SortablePrepTh
            label="Prep"
            column="prep"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 110 : 150 }}
          />
          <SortablePrepTh
            label="State"
            column="state"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 76 : 98 }}
          />
          <Table.Th style={{ width: dense ? (onOpenGame ? 118 : 96) : onOpenGame ? 148 : 120 }} />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sortedRows.map((row) => (
          <Table.Tr
            key={row.key}
            style={{ cursor: "pointer" }}
            onClick={() => onPlay(row.move)}
            onMouseEnter={() => onPreview(row.move)}
            onMouseLeave={onClearPreview}
          >
            <Table.Td>
              <Text size={textSize} fw={700}>
                {row.move}
              </Text>
              <PrepLastPlayedText value={row.lastPlayed} kind="played" />
            </Table.Td>
            <Table.Td>
              <PrepStrengthCell
                strength={strengthByMove.get(normalizePrepBuilderSan(row.move))}
                loading={strengthLoading}
              />
            </Table.Td>
            <Table.Td>
              <Text size={textSize}>{formatNumber(row.total)}</Text>
              <Text size="xs" c="dimmed">
                {(row.share * 100).toFixed(0)}%
              </Text>
            </Table.Td>
            <Table.Td>
              <PrepResultBar row={row} />
            </Table.Td>
            <Table.Td>
              <BranchStatsCell
                stats={branchStatsByKey?.[row.key]}
                loading={branchStatsLoading}
                dense={dense}
              />
            </Table.Td>
            <Table.Td>
              <Badge color={statusColor(row.status)} variant="light" size="sm">
                {statusLabel(row.status)}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Group gap={2} wrap="nowrap" justify="flex-end">
                {onOpenGame ? (
                  <Tooltip label="Go to game">
                    <ActionIcon
                      aria-label="Go to game"
                      variant="subtle"
                      size="sm"
                      loading={openingGameKey === row.key}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenGame(row);
                      }}
                    >
                      <IconExternalLink size="0.95rem" />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
                <Tooltip label="Play this move">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPlay(row.move);
                    }}
                  >
                    <IconPlayerPlay size="0.95rem" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Mark this branch done">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDone(row);
                    }}
                  >
                    <IconCheck size="0.95rem" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Skip this branch">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSkip(row);
                    }}
                  >
                    <IconX size="0.95rem" />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function PrepCandidateMoveTable({
  rows,
  loading,
  dense,
  general,
  userColor,
  onPlay,
  onPreview,
  onClearPreview,
  strengthByMove,
  strengthLoading,
  sort,
  onSort,
}: {
  rows: PrepCandidateMoveRow[];
  loading: boolean;
  dense: boolean;
  general: boolean;
  userColor: "white" | "black";
  onPlay: (move: string) => void;
  onPreview: (move: string) => void;
  onClearPreview: () => void;
  strengthByMove: Map<string, PrepMoveStrength>;
  strengthLoading: boolean;
  sort: PrepSortState<CandidatePrepSortColumn>;
  onSort: (column: CandidatePrepSortColumn) => void;
}) {
  const textSize = dense ? "xs" : "sm";
  const colorLabel = userColor === "white" ? "White" : "Black";
  const sortedRows = useMemo(
    () => sortCandidatePrepTableRows(rows, sort, userColor, strengthByMove),
    [rows, sort, userColor, strengthByMove],
  );

  if (loading) {
    return (
      <Stack gap="xs" py="md" align="center">
        <Progress value={100} animated w="min(18rem, 100%)" />
        <Text size="xs" c="dimmed">
          Checking candidate moves
        </Text>
      </Stack>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert color="gray" variant="light">
        No candidate moves met the current game threshold from this position.
      </Alert>
    );
  }

  return (
    <Stack gap={dense ? 4 : "xs"}>
      <Group gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
        <Badge color="blue" variant="light">
          {colorLabel} candidates
        </Badge>
        <Text size="xs" c="dimmed">
          {formatNumber(rows.reduce((sum, row) => sum + row.total, 0))} games in shown moves
        </Text>
      </Group>
      <Table
        withTableBorder
        stickyHeader
        highlightOnHover
        horizontalSpacing={dense ? 4 : "xs"}
        verticalSpacing={dense ? 3 : "xs"}
      >
        <Table.Thead>
          <Table.Tr>
            <SortablePrepTh
              label="Move"
              column="move"
              sort={sort}
              onSort={onSort}
              style={{ width: dense ? 64 : 90 }}
            />
            <SortablePrepTh
              label="Strength"
              column="strength"
              sort={sort}
              onSort={onSort}
              style={{ width: dense ? 80 : 104 }}
            />
            <SortablePrepTh
              label="Games"
              column="games"
              sort={sort}
              onSort={onSort}
              style={{ width: dense ? 78 : 110 }}
            />
            <SortablePrepTh label="WDL" column="results" sort={sort} onSort={onSort} />
            <Table.Th style={{ width: dense ? 64 : 82 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sortedRows.map((row) => (
            <Table.Tr
              key={row.key}
              style={{ cursor: "pointer" }}
              onClick={() => onPlay(row.move)}
              onMouseEnter={() => onPreview(row.move)}
              onMouseLeave={onClearPreview}
            >
              <Table.Td>
                <Text size={textSize} fw={700}>
                  {row.move}
                </Text>
                <PrepLastPlayedText value={row.lastPlayed} kind={general ? "played" : "faced"} />
              </Table.Td>
              <Table.Td>
                <PrepStrengthCell
                  strength={strengthByMove.get(normalizePrepBuilderSan(row.move))}
                  loading={strengthLoading}
                />
              </Table.Td>
              <Table.Td>
                <Text size={textSize}>{formatNumber(row.total)}</Text>
                <Text size="xs" c="dimmed">
                  {(row.share * 100).toFixed(0)}%
                </Text>
              </Table.Td>
              <Table.Td>
                <PrepResultBar row={row} />
              </Table.Td>
              <Table.Td>
                <Group gap={2} wrap="nowrap" justify="flex-end">
                  <Tooltip label={general ? "Play this database move" : "Play this reply"}>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPlay(row.move);
                      }}
                    >
                      <IconPlayerPlay size="0.95rem" />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function PrepLastPlayedText({
  value,
  kind,
}: {
  value: string | null | undefined;
  kind: "played" | "faced";
}) {
  const label = formatPrepLastPlayedRelative(value, kind);
  if (!label) return null;

  const exactDate = formatPrepLastPlayedExactDate(value);
  const content = (
    <Text size="xs" c="dimmed">
      {label}
    </Text>
  );

  if (!exactDate) return content;

  return (
    <Tooltip label={`${getPrepLastPlayedPrefix(kind)} ${exactDate}`} openDelay={350}>
      {content}
    </Tooltip>
  );
}

function SortablePrepTh<TColumn extends string>({
  label,
  column,
  sort,
  onSort,
  style,
}: {
  label: string;
  column: TColumn;
  sort: PrepSortState<TColumn>;
  onSort: (column: TColumn) => void;
  style?: CSSProperties;
}) {
  const active = sort.column === column;
  const directionLabel = sort.direction === "asc" ? "ascending" : "descending";

  return (
    <Table.Th
      aria-sort={active ? directionLabel : "none"}
      role="button"
      tabIndex={0}
      style={{ ...style, cursor: "pointer", userSelect: "none" }}
      onClick={() => onSort(column)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSort(column);
        }
      }}
    >
      <Group gap={4} wrap="nowrap">
        <Text span size="xs" fw={700}>
          {label}
        </Text>
        {active ? (
          sort.direction === "asc" ? (
            <IconChevronUp size="0.75rem" />
          ) : (
            <IconChevronDown size="0.75rem" />
          )
        ) : null}
      </Group>
    </Table.Th>
  );
}

function getNextPrepSort<TColumn extends string>(
  current: PrepSortState<TColumn>,
  column: TColumn,
): PrepSortState<TColumn> {
  if (current.column === column) {
    return {
      column,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }

  return {
    column,
    direction: column === "move" ? "asc" : "desc",
  };
}

function getDefaultPrepMoveTableSortState(
  sortDefaults: OpponentPrepState["sortDefaults"],
): PrepMoveTableSortState {
  const defaults = normalizePrepMoveSortDefaults(sortDefaults);
  return {
    opponent: getDefaultPrepSortState(defaults.opponent),
    candidate: getDefaultPrepSortState(defaults.candidate),
  };
}

function getDefaultPrepSortState<TColumn extends OpponentPrepSortColumn | CandidatePrepSortColumn>(
  column: TColumn,
): PrepSortState<TColumn> {
  return {
    column,
    direction: column === "move" ? "asc" : "desc",
  };
}

function normalizePrepMoveSortDefaults(
  sortDefaults: OpponentPrepState["sortDefaults"],
): PrepMoveSortDefaults {
  return {
    opponent: isOpponentPrepSortColumn(sortDefaults?.opponent)
      ? sortDefaults.opponent
      : DEFAULT_PREP_MOVE_SORT_DEFAULTS.opponent,
    candidate: isCandidatePrepSortColumn(sortDefaults?.candidate)
      ? sortDefaults.candidate
      : DEFAULT_PREP_MOVE_SORT_DEFAULTS.candidate,
  };
}

function shouldApplyStoredPrepSettings(current: OpponentPrepState) {
  return (
    current.rootPath === null &&
    Object.keys(current.completedBranches).length === 0 &&
    Object.keys(current.skippedBranches).length === 0 &&
    current.databasePath === null &&
    current.player === null &&
    current.playerName.trim().length === 0 &&
    current.builder === undefined &&
    current.sortDefaults === undefined
  );
}

function hasStoredPrepSourceSettings(settings: OpponentPrepStoredSettings) {
  return (
    settings.source !== "local" ||
    Boolean(settings.databasePath) ||
    settings.player !== null ||
    settings.playerName.trim().length > 0
  );
}

function isOpponentPrepSortColumn(value: unknown): value is OpponentPrepSortColumn {
  return (
    value === "move" ||
    value === "strength" ||
    value === "games" ||
    value === "results" ||
    value === "prep" ||
    value === "state"
  );
}

function isCandidatePrepSortColumn(value: unknown): value is CandidatePrepSortColumn {
  return value === "move" || value === "strength" || value === "games" || value === "results";
}

function sortOpponentPrepTableRows(
  rows: OpponentPrepMoveRow[],
  sort: PrepSortState<OpponentPrepSortColumn>,
  branchStatsByKey: Record<string, OpponentPrepBranchStats> | undefined,
  resultSide: "white" | "black",
  strengthByMove: Map<string, PrepMoveStrength>,
) {
  return [...rows].sort((a, b) => {
    const diff = compareOpponentPrepRows(
      a,
      b,
      sort.column,
      branchStatsByKey,
      resultSide,
      strengthByMove,
    );
    return withPrepSortDirection(diff, sort.direction) || comparePrepRowsDefault(a, b);
  });
}

function sortCandidatePrepTableRows(
  rows: PrepCandidateMoveRow[],
  sort: PrepSortState<CandidatePrepSortColumn>,
  resultSide: "white" | "black",
  strengthByMove: Map<string, PrepMoveStrength>,
) {
  return [...rows].sort((a, b) => {
    const diff = compareCandidatePrepRows(a, b, sort.column, resultSide, strengthByMove);
    return withPrepSortDirection(diff, sort.direction) || comparePrepRowsDefault(a, b);
  });
}

function compareOpponentPrepRows(
  a: OpponentPrepMoveRow,
  b: OpponentPrepMoveRow,
  column: OpponentPrepSortColumn,
  branchStatsByKey: Record<string, OpponentPrepBranchStats> | undefined,
  resultSide: "white" | "black",
  strengthByMove: Map<string, PrepMoveStrength>,
) {
  if (column === "prep") {
    return (
      getPrepBranchStatsSortScore(a, branchStatsByKey) -
      getPrepBranchStatsSortScore(b, branchStatsByKey)
    );
  }

  if (column === "state") {
    return getPrepStatusSortScore(a.status) - getPrepStatusSortScore(b.status);
  }

  return compareCandidatePrepRows(a, b, column, resultSide, strengthByMove);
}

function compareCandidatePrepRows(
  a: Pick<Opening, "move" | "white" | "draw" | "black"> & { total: number },
  b: Pick<Opening, "move" | "white" | "draw" | "black"> & { total: number },
  column: CandidatePrepSortColumn | Exclude<OpponentPrepSortColumn, "prep" | "state">,
  resultSide: "white" | "black",
  strengthByMove: Map<string, PrepMoveStrength>,
) {
  if (column === "move") {
    return a.move.localeCompare(b.move);
  }

  if (column === "strength") {
    return (
      getPrepStrengthSortScore(a.move, strengthByMove) -
      getPrepStrengthSortScore(b.move, strengthByMove)
    );
  }

  if (column === "results") {
    return getPrepResultScore(a, resultSide) - getPrepResultScore(b, resultSide);
  }

  return a.total - b.total;
}

function getPrepStrengthSortScore(move: string, strengthByMove: Map<string, PrepMoveStrength>) {
  return strengthByMove.get(normalizePrepBuilderSan(move))?.score ?? -1;
}

function withPrepSortDirection(diff: number, direction: PrepSortDirection) {
  return direction === "asc" ? diff : -diff;
}

function comparePrepRowsDefault(
  a: { total: number; move: string },
  b: { total: number; move: string },
) {
  return b.total - a.total || a.move.localeCompare(b.move);
}

function getPrepBranchStatsSortScore(
  row: OpponentPrepMoveRow,
  branchStatsByKey: Record<string, OpponentPrepBranchStats> | undefined,
) {
  const stats = branchStatsByKey?.[row.key];
  if (!stats) return -1;
  return stats.score;
}

function getPrepStatusSortScore(status: OpponentPrepMoveRow["status"]) {
  if (status === "new") return 4;
  if (status === "started") return 3;
  if (status === "prepared") return 2;
  return 1;
}

function getPrepResultScore(
  row: Pick<Opening, "white" | "draw" | "black">,
  side: "white" | "black",
) {
  const total = getOpeningTotal(row);
  if (total <= 0) return 0;
  const wins = side === "white" ? row.white : row.black;
  return (wins + row.draw * 0.5) / total;
}

function PrepStrengthCell({
  strength,
  loading,
}: {
  strength?: PrepMoveStrength;
  loading: boolean;
}) {
  if (!strength) {
    return (
      <Text size="xs" c="dimmed">
        {loading ? "Checking" : "-"}
      </Text>
    );
  }

  return (
    <Tooltip label={strength.detail} multiline w={260}>
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Badge color={strength.engineUnsafe ? "yellow" : "teal"} variant="light" size="sm">
            {strength.label}
          </Badge>
          {loading ? (
            <Text size="xs" c="dimmed">
              ...
            </Text>
          ) : null}
        </Group>
        <Progress
          value={strength.score}
          color={strength.engineUnsafe ? "yellow" : "teal"}
          size={3}
        />
      </Stack>
    </Tooltip>
  );
}

function PrepStrengthSettingsButton({
  builderSettings,
  updateBuilderSettings,
  controlSize,
}: {
  builderSettings: PrepBuilderSettings;
  updateBuilderSettings: (patch: Partial<PrepBuilderSettings>) => void;
  controlSize: "xs" | "sm";
}) {
  return (
    <Popover width={270} position="bottom-start" shadow="md" withinPortal>
      <Popover.Target>
        <Button variant="default" size={controlSize} leftSection={<IconSettings size="0.95rem" />}>
          Strength settings
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Strength settings
          </Text>
          <SegmentedControl
            aria-label="Prep strength mode"
            data={[
              { value: "smart", label: "Smart" },
              { value: "engine", label: "Engine" },
              { value: "practical", label: "Practical" },
            ]}
            value={builderSettings.mode}
            onChange={(value) =>
              updateBuilderSettings({ mode: value as PrepBuilderSettings["mode"] })
            }
            size="xs"
          />
          <Tooltip label="Smart mode blend: 0 is database WDL only, 100 is cloud engine only">
            <NumberInput
              label="Engine blend"
              suffix="%"
              value={builderSettings.engineWeight}
              onChange={(value) =>
                updateBuilderSettings({
                  engineWeight: Math.max(0, Math.min(100, Number(value) || 0)),
                })
              }
              min={0}
              max={100}
              step={5}
              size="xs"
              aria-label="Prep strength engine blend"
            />
          </Tooltip>
          <Tooltip label="Moves worse than this cloud-engine drop are treated as unsafe when cloud evals are available">
            <NumberInput
              label="Max CP drop"
              suffix=" cp"
              value={builderSettings.maxEngineCpLoss}
              onChange={(value) =>
                updateBuilderSettings({
                  maxEngineCpLoss: Math.max(0, Math.min(300, Number(value) || 0)),
                })
              }
              min={0}
              max={300}
              step={5}
              size="xs"
              aria-label="Prep maximum engine centipawn drop"
            />
          </Tooltip>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function PrepStraightLineSettingsButton({
  controlSize,
  mode,
  minShare,
  minCp,
  maxPly,
  onModeChange,
  onMinShareChange,
  onMinCpChange,
  onMaxPlyChange,
}: {
  controlSize: "xs" | "sm";
  mode: PrepStraightLineSearchMode;
  minShare: number;
  minCp: number;
  maxPly: number;
  onModeChange: (value: PrepStraightLineSearchMode) => void;
  onMinShareChange: (value: number) => void;
  onMinCpChange: (value: number) => void;
  onMaxPlyChange: (value: number) => void;
}) {
  return (
    <Popover width={270} position="bottom-start" shadow="md" withinPortal>
      <Popover.Target>
        <Button variant="default" size={controlSize} leftSection={<IconSettings size="0.95rem" />}>
          Line settings
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Straight line settings
          </Text>
          <Tooltip label="Strict finds rare railroad lines; Venom finds repeated engine concessions">
            <SegmentedControl
              value={mode}
              onChange={(value) => onModeChange(value as PrepStraightLineSearchMode)}
              data={[
                { value: "venom", label: "Venom" },
                { value: "strict", label: "Strict" },
              ]}
              size="xs"
              fullWidth
              aria-label="Straight line search mode"
            />
          </Tooltip>
          <Tooltip label="Opponent moves must reach this share of their games from each position">
            <NumberInput
              label={mode === "venom" ? "Habit rate" : "Forced rate"}
              suffix="%"
              value={minShare}
              onChange={(value) =>
                onMinShareChange(
                  Math.max(
                    50,
                    Math.min(100, getPrepNumberInputValue(value, DEFAULT_STRAIGHT_LINE_MIN_SHARE)),
                  ),
                )
              }
              min={50}
              max={100}
              step={1}
              size="xs"
              aria-label="Straight line forced play rate"
            />
          </Tooltip>
          <Tooltip label="Venom counts the opponent's engine concession; Strict also values the final edge">
            <NumberInput
              label={mode === "venom" ? "Min concession" : "Bad for them"}
              suffix=" cp"
              value={minCp}
              onChange={(value) =>
                onMinCpChange(
                  Math.max(
                    0,
                    Math.min(500, getPrepNumberInputValue(value, DEFAULT_STRAIGHT_LINE_MIN_CP)),
                  ),
                )
              }
              min={0}
              max={500}
              step={10}
              size="xs"
              aria-label="Straight line minimum engine edge"
            />
          </Tooltip>
          <Tooltip label="Maximum number of half-moves searched from the prep start">
            <NumberInput
              label="Max ply"
              value={maxPly}
              onChange={(value) =>
                onMaxPlyChange(
                  Math.max(
                    2,
                    Math.min(30, getPrepNumberInputValue(value, DEFAULT_STRAIGHT_LINE_MAX_PLY)),
                  ),
                )
              }
              min={2}
              max={30}
              step={2}
              size="xs"
              aria-label="Straight line maximum ply"
            />
          </Tooltip>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function PrepStraightLineResultPanel({
  result,
  status,
  running,
  qualifies,
  mode,
  minCp,
  onPlay,
  onClear,
}: {
  result: PrepStraightLineSearchResult | null;
  status: PrepStraightLineStatus | null;
  running: boolean;
  qualifies: boolean;
  mode: PrepStraightLineSearchMode;
  minCp: number;
  onPlay: () => void;
  onClear: () => void;
}) {
  const opponentSteps = result?.steps.filter((step) => step.actor === "opponent") ?? [];
  const resultCp = result?.bestOpportunityCpForUser ?? result?.leafScoreCpForUser ?? null;
  const alertColor = running ? "blue" : result ? (qualifies ? "red" : "yellow") : "gray";
  const title = running
    ? mode === "venom"
      ? "Finding venom"
      : "Finding straight line"
    : result
      ? qualifies
        ? mode === "venom"
          ? "Prep venom found"
          : "Straight line found"
        : mode === "venom"
          ? "Best habit found"
          : "Best straight line found"
      : mode === "venom"
        ? "Venom search"
        : "Straight line search";

  return (
    <Alert color={alertColor} variant="light" mt="xs">
      <Stack gap={6}>
        <Group justify="space-between" gap="xs" wrap="wrap">
          <Group gap={6} wrap="wrap">
            <Text size="sm" fw={700}>
              {title}
            </Text>
            {result ? (
              <>
                <Badge color={qualifies ? "red" : "yellow"} variant="light">
                  {formatPrepStraightLineEval(resultCp)} for you
                </Badge>
                <Badge variant="light">
                  {formatPrepStraightLineShare(result.minOpponentShare)} floor
                </Badge>
                <Badge variant="light">
                  {formatPrepStraightLineShare(result.reachProbability)} reach
                </Badge>
                <Badge variant="light">
                  {result.opponentMoveCount} {mode === "venom" ? "habit moves" : "forced moves"}
                </Badge>
              </>
            ) : null}
          </Group>
          <Group gap={4} wrap="nowrap">
            {result ? (
              <Button
                variant="default"
                size="xs"
                leftSection={<IconPlayerPlay size="0.85rem" />}
                onClick={onPlay}
              >
                Play line
              </Button>
            ) : null}
            <Tooltip label="Clear straight-line result">
              <ActionIcon variant="subtle" size="sm" onClick={onClear}>
                <IconX size="0.9rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        {status ? (
          <Text size="xs" c="dimmed">
            {status.phase} - {status.checkedPositions} checked, {status.candidates} candidates
          </Text>
        ) : null}
        {result ? (
          <>
            <Text size="sm" fw={600} style={{ wordBreak: "break-word" }}>
              {result.steps.map((step) => step.move).join(" ")}
            </Text>
            <Text size="xs" c="dimmed">
              {qualifies
                ? mode === "venom"
                  ? `Engine target met: habit concession or final edge is at least ${formatPrepStraightLineEval(minCp)}.`
                  : `Engine target met: final edge is at least ${formatPrepStraightLineEval(minCp)}.`
                : mode === "venom"
                  ? `Best habit is below the ${formatPrepStraightLineEval(minCp)} target; try a lower habit rate, deeper search, or a later prep start.`
                  : `Best line is below the ${formatPrepStraightLineEval(minCp)} target; try a lower forced rate, deeper search, or a later prep start.`}
              {result.leafBestMove ? ` Best next move: ${result.leafBestMove}.` : ""}
              {result.targetMove && result.targetConcessionCpForUser !== null
                ? ` Biggest concession: ${result.targetMove} gives up ${formatPrepStraightLineEval(result.targetConcessionCpForUser)} versus ${result.targetBestMoveForOpponent ?? "the engine's best move"}.`
                : ""}
            </Text>
            {opponentSteps.length > 0 ? (
              <Group gap={4} wrap="wrap">
                {opponentSteps.slice(0, 6).map((step, index) => (
                  <Badge key={`${step.fen}-${step.move}-${index}`} variant="outline" color="orange">
                    {step.move} {formatPrepStraightLineShare(step.share ?? 0)}
                    {step.total !== null ? ` / ${formatNumber(step.total)}` : ""}
                    {step.concessionCpForUser !== null
                      ? `, drops ${formatPrepStraightLineEval(step.concessionCpForUser)}`
                      : ""}
                  </Badge>
                ))}
              </Group>
            ) : null}
          </>
        ) : status && !running ? (
          <Text size="xs" c={status.tone === "error" ? "yellow" : "dimmed"}>
            No line matched the current habit-rate, depth, and engine-eval settings.
          </Text>
        ) : null}
      </Stack>
    </Alert>
  );
}

function formatPrepStraightLineEval(cp: number | null) {
  if (cp === null) return "n/a";
  const value = Math.abs(cp / 100).toFixed(2);
  if (cp > 0) return `+${value}`;
  if (cp < 0) return `-${value}`;
  return "0.00";
}

function formatPrepStraightLineShare(share: number) {
  const percent = Math.max(0, Math.min(1, share)) * 100;
  return `${percent >= 99.95 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function getPrepNumberInputValue(value: string | number, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getPrepStraightLineEmptyStatus(search: {
  userPositionsWithoutMoves: number;
  opponentPositionsWithoutForcedMove: number;
  leafPositionsWithoutEngine: number;
}) {
  if (search.userPositionsWithoutMoves > 0) {
    return "No candidate user moves were available from the searched positions";
  }
  if (search.opponentPositionsWithoutForcedMove > 0) {
    return "No opponent move met the habit-rate and minimum-games settings";
  }
  if (search.leafPositionsWithoutEngine > 0) {
    return "Habit lines were found, but no engine eval was available for their target positions";
  }
  return "No engine-target habit line found";
}

function BranchStatsCell({
  stats,
  loading,
  dense,
}: {
  stats?: OpponentPrepBranchStats;
  loading: boolean;
  dense: boolean;
}) {
  if (!stats) {
    return (
      <Text size="xs" c="dimmed">
        {loading ? "Checking" : "-"}
      </Text>
    );
  }

  const color = branchStatsColor(stats.label);

  return (
    <Tooltip label={branchStatsTooltip(stats)} multiline w={290}>
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Badge color={color} variant="light" size="sm">
            {stats.label}
          </Badge>
          <Text size="xs" fw={700}>
            {stats.score}%
          </Text>
        </Group>
        <Progress value={stats.score} color={color} size={dense ? 3 : "xs"} />
        <Text size="xs" c="dimmed" truncate>
          {Math.round(stats.replyCoverage * 100)}% replies - {stats.depthPly} ply
        </Text>
      </Stack>
    </Tooltip>
  );
}

function PrepResultBar({ row }: { row: Pick<Opening, "white" | "draw" | "black"> }) {
  const total = getOpeningTotal(row);
  const whitePercent = total > 0 ? (row.white / total) * 100 : 0;
  const drawPercent = total > 0 ? (row.draw / total) * 100 : 0;
  const blackPercent = total > 0 ? (row.black / total) * 100 : 0;

  return (
    <Progress.Root size="lg">
      <Progress.Section value={whitePercent} color="gray.2">
        <Progress.Label c="black">
          {whitePercent >= 18 ? `${whitePercent.toFixed(0)}%` : ""}
        </Progress.Label>
      </Progress.Section>
      <Progress.Section value={drawPercent} color="gray">
        <Progress.Label>{drawPercent >= 18 ? `${drawPercent.toFixed(0)}%` : ""}</Progress.Label>
      </Progress.Section>
      <Progress.Section value={blackPercent} color="dark">
        <Progress.Label>{blackPercent >= 18 ? `${blackPercent.toFixed(0)}%` : ""}</Progress.Label>
      </Progress.Section>
    </Progress.Root>
  );
}

async function fetchPrepOnlineRecentGames({
  source,
  username,
  count,
  token,
  onProgress,
}: {
  source: OnlineGameSource;
  username: string;
  count: number;
  token?: string;
  onProgress?: (loaded: number, total: number) => void;
}) {
  const target = Math.max(1, Math.min(MAX_ONLINE_IMPORT_GAMES, Math.round(count)));
  const games: PrepOnlineImportedGame[] = [];
  const seen = new Set<string>();
  let before: number | null = null;

  while (games.length < target) {
    const pageSize = Math.min(30, target - games.length);
    const page =
      source === "lichess"
        ? await getRecentLichessGames(username, pageSize, token, before)
        : await getRecentChessComGames(username, pageSize, before);
    if (page.length === 0) break;

    for (const game of page) {
      const key = game.url || `${game.playedAt}:${game.pgn.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      games.push(game);
      if (games.length >= target) break;
    }

    onProgress?.(games.length, target);
    const oldest = getOldestPrepOnlineGameDate(page);
    if (oldest === null || oldest === before || page.length < pageSize) break;
    before = oldest;
  }

  return games.sort((a, b) => b.playedAt - a.playedAt).slice(0, target);
}

async function createPrepOnlineGamesDatabase({
  games,
  dbPath,
  title,
  description,
}: {
  games: PrepOnlineImportedGame[];
  dbPath: string;
  title: string;
  description: string;
}) {
  const dir = await tempDir();
  const pgnPath = await resolve(dir, `prep-online-games-${Date.now()}.pgn`);
  const pgn = `${games
    .map((game) => game.pgn.trim())
    .filter(Boolean)
    .join("\n\n")}\n`;

  await writeTextFile(pgnPath, pgn);
  unwrap(await commands.convertPgn(pgnPath, dbPath, null, title, description));
  unwrap(await commands.deleteEmptyGames(dbPath));
  unwrap(await commands.deleteDuplicatedGames(dbPath));
}

async function resolvePrepOnlineImportPlayer(dbPath: string, username: string) {
  const players = await query_players(dbPath, {
    name: username,
    range: null,
    options: {
      skipCount: true,
      page: 1,
      pageSize: 50,
      sort: "name",
      direction: "asc",
    },
  });
  const normalizedUsername = normalizePrepOnlinePlayerName(username);
  return (
    players.data.find(
      (player) => normalizePrepOnlinePlayerName(player.name) === normalizedUsername,
    ) ??
    players.data[0] ??
    (await getMostCommonPlayer(dbPath))
  );
}

function createPrepOnlineCountPreview(
  games: PrepOnlineImportedGame[],
  requestedGames: number,
): PrepOnlineCountPreview {
  return {
    requestedGames,
    foundGames: games.length,
    newestPlayedAt: getNewestPrepOnlineGameDate(games),
    oldestPlayedAt: getOldestPrepOnlineGameDate(games),
  };
}

function getPrepOnlineImportPreviewText({
  mode,
  range,
  preview,
  requestedGames,
}: {
  mode: PrepOnlineImportMode;
  range: PrepOnlineRangePreset;
  preview: PrepOnlineCountPreview | null;
  requestedGames: number;
}) {
  if (mode === "range") {
    const since = getPrepOnlineRangeSince(range);
    if (since === null) {
      return "Imports every public PGN for this player; game count is not capped.";
    }
    return `Imports every public PGN since ${formatPrepOnlineDate(
      since,
    )}; game count is not capped.`;
  }

  if (!preview) {
    return `Check range to see how far the latest ${formatNumber(requestedGames)} games go back.`;
  }

  if (preview.foundGames === 0) {
    return "No public PGNs found for that player.";
  }

  const foundText =
    preview.foundGames < preview.requestedGames
      ? `Only ${formatNumber(preview.foundGames)} found`
      : `${formatNumber(preview.foundGames)} games`;
  const oldestText = preview.oldestPlayedAt
    ? `go back to ${formatPrepOnlineDate(preview.oldestPlayedAt)}`
    : "have no game dates";
  return `${foundText} ${oldestText}.`;
}

function getPrepOnlineImportTitle({
  source,
  username,
  mode,
  games,
  range,
}: {
  source: OnlineGameSource;
  username: string;
  mode: PrepOnlineImportMode;
  games: number;
  range: PrepOnlineRangePreset;
}) {
  const sourceLabel = getOnlineGameSourceLabel(source);
  if (mode === "count") {
    return `${username} ${sourceLabel} prep ${formatNumber(games)} games`;
  }
  return `${username} ${sourceLabel} prep ${getPrepOnlineRangeLabel(range).toLowerCase()}`;
}

function getPrepOnlineImportDescription({
  source,
  username,
  mode,
  games,
  range,
}: {
  source: OnlineGameSource;
  username: string;
  mode: PrepOnlineImportMode;
  games: number;
  range: PrepOnlineRangePreset;
}) {
  const sourceLabel = getOnlineGameSourceLabel(source);
  if (mode === "count") {
    return `Opponent prep import from ${sourceLabel} ${username}: latest ${games} games.`;
  }

  const since = getPrepOnlineRangeSince(range);
  const scope =
    since === null
      ? "all games"
      : `${getPrepOnlineRangeLabel(range).toLowerCase()} since ${formatPrepOnlineDate(since)}`;
  return `Opponent prep import from ${sourceLabel} ${username}: ${scope}.`;
}

function getPrepOnlineRangeLabel(range: PrepOnlineRangePreset) {
  return (
    PREP_ONLINE_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? "Last 3 months"
  );
}

function getPrepOnlineRangeSince(range: PrepOnlineRangePreset) {
  switch (range) {
    case "3m":
      return dayjs().subtract(3, "month").valueOf();
    case "6m":
      return dayjs().subtract(6, "month").valueOf();
    case "1y":
      return dayjs().subtract(1, "year").valueOf();
    case "2y":
      return dayjs().subtract(2, "year").valueOf();
    case "all":
      return null;
  }
}

function getUniquePrepOnlineImportTitle(baseTitle: string, databases: SuccessDatabaseInfo[]) {
  const existing = new Set(databases.map((database) => database.title.trim().toLowerCase()));
  let title = baseTitle;
  let index = 2;

  while (existing.has(title.trim().toLowerCase())) {
    title = `${baseTitle} ${index}`;
    index += 1;
  }

  return title;
}

function sanitizePrepImportFilename(title: string) {
  const sanitized = title
    .replace(/[<>:"/\\|?*]+/g, "_")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return sanitized || `online-prep-${Date.now()}`;
}

function getOldestPrepOnlineGameDate(games: Pick<PrepOnlineImportedGame, "playedAt">[]) {
  const dates = games
    .map((game) => game.playedAt)
    .filter((date) => Number.isFinite(date) && date > 0);
  return dates.length > 0 ? Math.min(...dates) : null;
}

function getNewestPrepOnlineGameDate(games: Pick<PrepOnlineImportedGame, "playedAt">[]) {
  const dates = games
    .map((game) => game.playedAt)
    .filter((date) => Number.isFinite(date) && date > 0);
  return dates.length > 0 ? Math.max(...dates) : null;
}

function formatPrepOnlineDate(value: number) {
  return dayjs(value).format("D MMM YYYY");
}

function normalizePrepOnlinePlayerName(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function branchStatsTooltip(stats: OpponentPrepBranchStats) {
  const lines = [
    `${stats.label}: ${stats.score}%`,
    stats.depthPly > 0 ? `Depth: ${stats.depthPly} ply` : "No saved response in this branch yet.",
    stats.opponentPositions > 0
      ? `Covered ${Math.round(stats.replyCoverage * 100)}% of their shown reply frequency across ${stats.opponentPositions} opponent choice${stats.opponentPositions === 1 ? "" : "s"}.`
      : "Add more of your line to reach their next opponent choice.",
    stats.commonReplies > 0
      ? `${stats.preparedReplies}/${stats.commonReplies} shown replies prepared${stats.startedReplies > 0 ? `, ${stats.startedReplies} only started` : ""}.`
      : "",
    stats.missingImportantMoves.length > 0
      ? `Important gaps: ${stats.missingImportantMoves.join(", ")}`
      : "",
  ];

  return lines.filter(Boolean).join("\n");
}

function lichessMovesToOpenings(
  moves: {
    san: string;
    white: number;
    black: number;
    draws: number;
  }[],
): Opening[] {
  return moves.map((move) => ({
    move: move.san,
    white: move.white,
    black: move.black,
    draw: move.draws,
  }));
}

function mergePrepBuilderEngineMoves(moves: PrepBuilderEngineMove[]) {
  const bySan = new Map<string, PrepBuilderEngineMove>();

  for (const move of moves) {
    const key = normalizePrepBuilderSan(move.san);
    const existing = bySan.get(key);
    if (
      !existing ||
      prepBuilderEngineSourceRank(move.source) < prepBuilderEngineSourceRank(existing.source) ||
      ((move.rank ?? 99) < (existing.rank ?? 99) && move.source === existing.source)
    ) {
      bySan.set(key, move);
    }
  }

  return Array.from(bySan.values()).sort(
    (a, b) =>
      prepBuilderEngineSourceRank(a.source) - prepBuilderEngineSourceRank(b.source) ||
      (a.rank ?? 99) - (b.rank ?? 99) ||
      a.san.localeCompare(b.san),
  );
}

function prepBuilderEngineSourceRank(source: PrepBuilderEngineMove["source"]) {
  return source === "lichess" ? 0 : 1;
}

function formatPrepBuilderChoiceComment(choice: PrepBuilderMoveChoice) {
  return choice.reasons.map((reason) => `${reason}.`).join(" ");
}

function formatPrepBuilderOpponentComment({
  row,
  branchShare,
  general,
}: {
  row: OpponentPrepMoveRow;
  branchShare: number;
  general: boolean;
}) {
  const actor = general ? "Common reply" : "Opponent reply";
  return `${actor}: ${row.total} game${row.total === 1 ? "" : "s"}, move ${formatPrepBuilderPercent(
    row.share * 100,
  )}%, line ${formatPrepBuilderPercent(branchShare * 100)}%.`;
}

const PREP_BUILDER_COMMENT_PREFIX = "Prep Builder:";

function mergePrepBuilderComment(existing: string, comment: string) {
  const kept = existing
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(PREP_BUILDER_COMMENT_PREFIX));
  return [...kept, `${PREP_BUILDER_COMMENT_PREFIX} ${comment}`].join("\n\n");
}

function getPrepBuilderSafetyPositionLimit(size: PrepBuilderSettings["size"]) {
  switch (size) {
    case "quick":
      return 300;
    case "deep":
      return 2500;
    case "balanced":
      return 1200;
  }
}

function getPrepBuilderExplorerMoveLimit(moveLimit: number) {
  return Math.max(12, Math.min(100, moveLimit));
}

function getPrepBuilderBranchSearchMoveLimit(settings: PrepBuilderSettings) {
  return Math.max(100, settings.opponentMoveLimit);
}

function getPrepBuilderReferenceMoveLimit(moveLimit: number) {
  return Math.max(20, Math.min(100, moveLimit * 2));
}

function formatPrepBuilderPercent(percent: number) {
  if (percent >= 10) return Math.round(percent).toString();
  return percent.toFixed(1).replace(/\.0$/, "");
}

function normalizePrepBuilderSan(value: string) {
  return value
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .replace(/[+#?!]+$/g, "");
}

async function findPrepSourceGameMatch(
  games: NormalizedGame[],
  fen: string,
  move: string,
  uci?: string | null,
): Promise<{ game: NormalizedGame; tree: TreeState; path: number[] } | null> {
  const candidates = [...games].sort(comparePrepSourceGamesByDate);

  for (const game of candidates) {
    try {
      const tree = await parsePGN(game.moves, game.fen);
      const path = findOpponentPrepSourceMovePath({
        root: tree.root,
        fen,
        san: move,
        uci,
      });
      if (path) return { game, tree, path };
    } catch (error) {
      console.warn("Could not parse prep source game", error);
    }
  }

  return null;
}

function comparePrepSourceGamesByDate(a: NormalizedGame, b: NormalizedGame) {
  return (
    getPrepSourceGameDateSortValue(b) - getPrepSourceGameDateSortValue(a) ||
    b.id - a.id ||
    `${a.white} ${a.black}`.localeCompare(`${b.white} ${b.black}`)
  );
}

function getPrepSourceGameDateSortValue(game: NormalizedGame) {
  const dateDigits = game.date?.replace(/\D/g, "") ?? "";
  const timeDigits = game.time?.replace(/\D/g, "") ?? "";
  return Number(`${dateDigits.padEnd(8, "0")}${timeDigits.padEnd(6, "0")}`) || 0;
}

function getPrepSourceGameSearchId(scope: string, key: string) {
  return `opponent-prep-game|${scope}|${key}`;
}

function getPrepBuilderSettingsPatch(
  current: Partial<PrepBuilderSettings> | undefined,
  patch: Partial<PrepBuilderSettings>,
) {
  const next = {
    ...current,
    ...patch,
  };

  if (patch.mode) {
    delete next.breadthBias;
  }

  if (patch.size) {
    delete next.maxPly;
    delete next.opponentMoveLimit;
    delete next.minOpponentGames;
    delete next.minOpponentMoveShare;
    delete next.minBranchShare;
  }

  return next;
}

function getInitialPrepSeed({
  currentLocalOptions,
  localDatabases,
  referenceDb,
  savedCompareSettings,
}: {
  currentLocalOptions: {
    path: string | null;
    player: number | null;
    playerName?: string;
    color: "white" | "black";
    start_date?: string;
    end_date?: string;
    result: StoredDatabaseLocalOptions["result"];
  };
  localDatabases: SuccessDatabaseInfo[];
  referenceDb: string | null;
  savedCompareSettings?: {
    slots: {
      sourceValue: string | null;
      localOptions: StoredDatabaseLocalOptions;
    }[];
  };
}): Partial<OpponentPrepState> | null {
  const localPaths = new Set(localDatabases.map((database) => database.file));
  const compareSlot = savedCompareSettings?.slots.find(
    (slot) =>
      slot.sourceValue &&
      localPaths.has(slot.sourceValue) &&
      (slot.localOptions.player || slot.localOptions.playerName?.trim()),
  );

  if (compareSlot?.sourceValue) {
    const database = localDatabases.find((item) => item.file === compareSlot.sourceValue);
    return {
      mode: "player",
      source: "local",
      databasePath: compareSlot.sourceValue,
      databaseLabel: database ? database.title || database.filename : null,
      player: compareSlot.localOptions.player,
      playerName: compareSlot.localOptions.playerName ?? "",
      color: compareSlot.localOptions.color,
      start_date: compareSlot.localOptions.start_date,
      end_date: compareSlot.localOptions.end_date,
      result: compareSlot.localOptions.result,
    };
  }

  const databasePath =
    currentLocalOptions.path && localPaths.has(currentLocalOptions.path)
      ? currentLocalOptions.path
      : referenceDb && localPaths.has(referenceDb)
        ? referenceDb
        : localDatabases[0]?.file;
  if (!databasePath) return null;

  const database = localDatabases.find((item) => item.file === databasePath);
  return {
    source: "local",
    databasePath,
    databaseLabel: database ? database.title || database.filename : null,
    player: currentLocalOptions.player,
    playerName: currentLocalOptions.playerName ?? "",
    color: currentLocalOptions.color,
    start_date: currentLocalOptions.start_date,
    end_date: currentLocalOptions.end_date,
    result: currentLocalOptions.result,
  };
}

function getPrepSearchId(scope: string, fen: string) {
  return `opponent-prep|${scope}|${fen}`;
}

type PrepLastPlayedKind = "played" | "faced";

function getPrepLastPlayedPrefix(kind: PrepLastPlayedKind) {
  return kind === "faced" ? "Last played against" : "Last played";
}

function formatPrepLastPlayedRelative(value: string | null | undefined, kind: PrepLastPlayedKind) {
  const date = parsePrepLastPlayedDate(value);
  const prefix = getPrepLastPlayedPrefix(kind);
  if (!date) return value ? `${prefix} ${value}` : null;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const playedStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const ageDays = Math.max(
    0,
    Math.floor((todayStart.getTime() - playedStart.getTime()) / 86_400_000),
  );

  if (ageDays === 0) return `${prefix} today`;
  if (ageDays === 1) return `${prefix} yesterday`;
  if (ageDays < 365) return `${prefix} ${ageDays} days ago`;

  const years = Math.max(1, Math.floor(ageDays / 365));
  return `${prefix} ${years} year${years === 1 ? "" : "s"} ago`;
}

function formatPrepLastPlayedExactDate(value: string | null | undefined) {
  const date = parsePrepLastPlayedDate(value);
  if (!date) return value?.trim() || null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parsePrepLastPlayedDate(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

function statusColor(status: OpponentPrepMoveRow["status"]) {
  switch (status) {
    case "prepared":
      return "green";
    case "started":
      return "blue";
    case "skipped":
      return "gray";
    case "new":
      return "orange";
  }
}

function statusLabel(status: OpponentPrepMoveRow["status"]) {
  switch (status) {
    case "prepared":
      return "Done";
    case "started":
      return "Started";
    case "skipped":
      return "Skipped";
    case "new":
      return "New";
  }
}

function branchStatsColor(label: OpponentPrepBranchStats["label"]) {
  switch (label) {
    case "Good":
      return "green";
    case "Solid":
      return "teal";
    case "Needs work":
      return "yellow";
    case "Thin":
      return "orange";
    case "No line":
      return "gray";
  }
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

export default memo(OpponentPrepPanel);
