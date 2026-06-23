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
  type OpponentPrepPanelStage,
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
  applyPrepSanMove,
  choosePrepBuilderMoveWithAfterPrep,
  findPrepStraightLineCandidates,
  getCandidateAfterPrepStrengthMap,
  getFenTurn,
  getOpponentPrepCandidateLineImpact,
  getLineSans,
  getOpeningTotal,
  getOpponentPrepBranchKey,
  getOpponentPrepBranchStats,
  getOpponentPrepMoveRows,
  getBestPrepLineReplyImpact,
  getPrepBuilderBranchValue,
  getPrepBuilderEvidenceMinGames,
  getPrepBuilderFocusedReplyLimit,
  getPrepBuilderMoveChoices,
  getPrepBuilderReplyPolicy,
  getPrepBuilderStopReason,
  getPrepBuilderTaskPriority,
  getPrepBuilderUserResponseChildIndex,
  getPrepMoveStrengthMap,
  hasPrepBuilderDatabaseCandidates,
  isPrepStraightLineBadForOpponent,
  normalizePrepBuilderSettings,
  oppositePrepColor,
  pathExists,
  sortOpponentPrepOpenings,
  type PrepBuilderEngineMove,
  type PrepBuilderMoveChoice,
  type PrepBuilderMoveChoiceWithAfterPrep,
  type PrepBuilderSettings,
  type PrepColor,
  type PrepMoveStrength,
  type PrepStraightLineCandidate,
  type PrepStraightLineSearchMode,
  type OpponentPrepBranchStats,
  type OpponentPrepLineImpact,
  type OpponentPrepMoveRow,
} from "@/utils/opponentPrep";
import { createTab, getTabWorkspaceKey, saveToFile } from "@/utils/tabs";
import { parsePGN } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { getTreeStructureHash, type TreeState } from "@/utils/treeReducer";
import { queryLichessCloudMoves } from "@/utils/lichess/api";
import { unwrap } from "@/utils/unwrap";
import { BoundedMap } from "@/utils/boundedCache";
import { DatabasePerspectiveControls } from "../database/DatabasePerspectiveControls";
import PlanCoachInline, { type PlanCoachInlineRequest } from "../plan/PlanCoachInline";

const DEFAULT_PREP_MIN_GAMES = 2;
const DEFAULT_PREP_MOVE_LIMIT = 8;
const MAX_PREP_MOVE_LIMIT = 20;
const PREP_STRENGTH_MOVE_POOL_LIMIT = MAX_PREP_MOVE_LIMIT;
const PREP_STRENGTH_ENGINE_CACHE_VERSION = "v3";
const AFTER_PREP_PROJECTION_CONCURRENCY = 3;
const PREP_COACH_SCAN_LIMIT = 12;
const PREP_BUILDER_AFTER_PREP_SCAN_LIMIT = 10;
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
const MAX_PREP_MOVE_CACHE_ENTRIES = 240;
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

type OpponentBranchPrepProjection = {
  responseMove: string;
  label: string;
  strength: PrepMoveStrength;
  lineImpact: OpponentPrepLineImpact | null;
};

type PrepSortDirection = "asc" | "desc";
type OpponentPrepSortColumn =
  | "move"
  | "strength"
  | "afterPrep"
  | "games"
  | "results"
  | "prep"
  | "state";
type CandidatePrepSortColumn = "move" | "strength" | "afterPrep" | "games" | "results";
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
  { value: "afterPrep", label: "After prep strength" },
  { value: "results", label: "Results" },
  { value: "prep", label: "Prep coverage" },
  { value: "state", label: "State" },
  { value: "move", label: "Move" },
];
const PREP_CANDIDATE_SORT_OPTIONS: { value: CandidatePrepSortColumn; label: string }[] = [
  { value: "strength", label: "Smart strength" },
  { value: "afterPrep", label: "After prep strength" },
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

type PrepGamePlanStep = {
  actor: "user" | "opponent";
  move: string;
  line: string[];
  games: number | null;
  share: number | null;
  strength: number | null;
  afterPrep: number | null;
  engineCp: number | null;
  engineCpLoss: number | null;
  engineSource: PrepBuilderEngineMove["source"] | null;
  databaseScore: number | null;
  engineUnsafe: boolean;
  note: string;
};

type PrepGamePlanReply = {
  positionLine: string[];
  opponentMove: string;
  responseMove: string | null;
  games: number;
  share: number;
  opponentScore: number;
  afterPrep: number | null;
  responseStrength: number | null;
  responseEngineCp: number | null;
  responseEngineCpLoss: number | null;
  responseEngineSource: PrepBuilderEngineMove["source"] | null;
  responseDatabaseScore: number | null;
  responseDetail: string | null;
  priority: number;
  note: string;
};

type PrepGamePlanBrief = {
  generatedAt: number;
  startLine: string[];
  mainLine: PrepGamePlanStep[];
  replies: PrepGamePlanReply[];
  insights: string[];
  checkedPositions: number;
  sourceLabel: string;
  maxEngineCpLoss: number;
};

type PrepBuilderAfterPrepSelection = PrepBuilderMoveChoiceWithAfterPrep & {
  row: PrepCandidateMoveRow | null;
};

type PrepCoachCandidateStatus = "safe" | "unsafe" | "no-safe-answer" | "thin" | "skipped";

type PrepCoachCandidateEvidence = {
  id: string;
  kind: "your-move" | "opponent-move";
  status: PrepCoachCandidateStatus;
  move: string;
  line: string[];
  games: number;
  share: number;
  surfaceScore: number;
  surfaceScoreLabel: string;
  strength: PrepMoveStrength | null;
  afterPrepStrength: PrepMoveStrength | null;
  afterPrepSource: "projection" | "none";
  likelyOpponentMove: string | null;
  responseMove: string | null;
  responseDetail: string | null;
  engineUnsafe: boolean;
  exclusionReason: string | null;
  priority: number;
};

type PrepCoachReportBriefBase = {
  generatedAt: number;
  rootFen: string;
  startLine: string[];
  sourceLabel: string;
  userColor: PrepColor;
  opponentColor: PrepColor;
  maxEngineCpLoss: number;
  checkedPositions: number;
  candidates: PrepCoachCandidateEvidence[];
};

type PrepCoachReportBrief = PrepCoachReportBriefBase & {
  request: PlanCoachInlineRequest;
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
  const underBoardStage = prep.panelStage ?? "setup";
  const setUnderBoardStage = useCallback(
    (panelStage: OpponentPrepPanelStage) => {
      setPrep((current) =>
        current.panelStage === panelStage
          ? current
          : {
              ...current,
              panelStage,
            },
      );
    },
    [setPrep],
  );
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
  const [gamePlanBrief, setGamePlanBrief] = useState<PrepGamePlanBrief | null>(null);
  const [prepCoachReportBrief, setPrepCoachReportBrief] = useState<PrepCoachReportBrief | null>(
    null,
  );
  const [prepCoachReportRunning, setPrepCoachReportRunning] = useState(false);
  const [prepCoachAutoRunKey, setPrepCoachAutoRunKey] = useState<string | null>(null);
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
    setMoveTableSort(
      getDefaultPrepMoveTableSortState({
        opponent: prepSortDefaults.opponent,
        candidate: prepSortDefaults.candidate,
      }),
    );
  }, [currentFen, prepSortDefaults.candidate, prepSortDefaults.opponent]);
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
  }, [configReady, setUnderBoardStage, underBoard]);

  useEffect(() => {
    if (!currentSearchId) return undefined;

    return () => {
      void cancelDatabaseSearch(currentSearchId);
    };
  }, [currentSearchId]);

  useEffect(() => {
    setStraightLineResult(null);
    setStraightLineStatus(null);
    setGamePlanBrief(null);
    setPrepCoachReportBrief(null);
    setPrepCoachAutoRunKey(null);
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

      const multipv = getPrepBuilderEngineMultipv(settings);
      const lichessMoves = await queryLichessCloudMoves(fen, multipv).catch(() => null);
      if (lichessMoves?.length) {
        return mergePrepBuilderEngineMoves(
          lichessMoves.map<PrepBuilderEngineMove>((move, index) => ({
            san: move.san,
            scoreCpForSide:
              move.scoreCpForWhite === null
                ? null
                : userColor === "black"
                  ? -move.scoreCpForWhite
                  : move.scoreCpForWhite,
            rank: index + 1,
            source: move.source,
          })),
        );
      }

      return [];
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
  const strengthOpenings = useMemo(
    () =>
      sortOpponentPrepOpenings(currentOpenings ?? [], prep.minGames, PREP_STRENGTH_MOVE_POOL_LIMIT),
    [currentOpenings, prep.minGames],
  );
  const strengthSide = opponentToMove ? prep.color : userColor;
  const strengthEngineMultipv = getPrepBuilderEngineMultipv(builderSettings);
  const strengthEngineKey =
    showTrainingStage && configReady && builderSettings.useCloudEngine && strengthRows.length > 0
      ? [
          "opponent-prep-strength-engine",
          PREP_STRENGTH_ENGINE_CACHE_VERSION,
          currentFen,
          strengthSide,
          strengthEngineMultipv,
        ]
      : null;
  const { data: strengthEngineMoves, isLoading: strengthLoading } = useSWR(strengthEngineKey, () =>
    loadPrepBuilderEngineMoves(currentFen, strengthSide, builderSettings),
  );
  const strengthByMove = useMemo(
    () =>
      getPrepMoveStrengthMap({
        openings: strengthOpenings,
        engineMoves: strengthEngineMoves ?? [],
        side: strengthSide,
        settings: builderSettings,
      }),
    [builderSettings, strengthEngineMoves, strengthOpenings, strengthSide],
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
  const [candidateLineImpactByKey, setCandidateLineImpactByKey] = useState<
    Record<string, OpponentPrepLineImpact>
  >({});
  const [candidateLineImpactLoading, setCandidateLineImpactLoading] = useState(false);
  const [branchPrepProjectionByKey, setBranchPrepProjectionByKey] = useState<
    Record<string, OpponentBranchPrepProjection>
  >({});
  const [branchPrepProjectionLoading, setBranchPrepProjectionLoading] = useState(false);

  useEffect(() => {
    if (!configReady || !showTrainingStage || opponentToMove || candidateRows.length === 0) {
      setCandidateLineImpactByKey({});
      setCandidateLineImpactLoading(false);
      return undefined;
    }

    let cancelled = false;
    const entries = new Map<string, OpponentPrepLineImpact>();
    const publish = () => {
      if (!cancelled) setCandidateLineImpactByKey(Object.fromEntries(entries));
    };

    setCandidateLineImpactByKey({});
    setCandidateLineImpactLoading(true);

    const run = async () => {
      await runAfterPrepProjectionJobs(
        candidateRows,
        AFTER_PREP_PROJECTION_CONCURRENCY,
        async (row) => {
          const impact = await getOpponentPrepCandidateLineImpact({
            fen: currentFen,
            row,
            opponentColor: prep.color,
            loadOpenings: loadOpeningsForFen,
            loadEngineMoves: loadPrepBuilderEngineMoves,
            minGames: prep.minGames,
            moveLimit: prep.moveLimit,
            settings: builderSettings,
          }).catch(() => null);
          if (!impact || cancelled) return;

          entries.set(row.key, impact);
          publish();
        },
      );

      if (cancelled) return;
      setCandidateLineImpactLoading(false);
    };

    void run().catch(() => {
      if (!cancelled) {
        setCandidateLineImpactLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    builderSettings,
    candidateRows,
    configReady,
    currentFen,
    loadOpeningsForFen,
    loadPrepBuilderEngineMoves,
    opponentToMove,
    prep.color,
    prep.minGames,
    prep.moveLimit,
    showTrainingStage,
  ]);

  useEffect(() => {
    if (!configReady || !showTrainingStage || !opponentToMove || currentRows.length === 0) {
      setBranchPrepProjectionByKey({});
      setBranchPrepProjectionLoading(false);
      return undefined;
    }

    let cancelled = false;
    const entries = new Map<string, OpponentBranchPrepProjection>();
    const publish = () => {
      if (!cancelled) setBranchPrepProjectionByKey(Object.fromEntries(entries));
    };

    setBranchPrepProjectionByKey({});
    setBranchPrepProjectionLoading(true);

    const run = async () => {
      await runAfterPrepProjectionJobs(
        currentRows,
        AFTER_PREP_PROJECTION_CONCURRENCY,
        async (row) => {
          const projection = await getOpponentBranchPrepProjection({
            fen: currentFen,
            row,
            userColor,
            loadOpenings: loadOpeningsForFen,
            loadEngineMoves: loadPrepBuilderEngineMoves,
            minGames: prep.minGames,
            moveLimit: prep.moveLimit,
            settings: builderSettings,
          }).catch(() => null);
          if (!projection || cancelled) return;

          entries.set(row.key, projection);
          publish();
        },
      );

      if (!cancelled) setBranchPrepProjectionLoading(false);
    };

    void run().catch(() => {
      if (!cancelled) {
        setBranchPrepProjectionLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    builderSettings,
    configReady,
    currentFen,
    currentRows,
    loadOpeningsForFen,
    loadPrepBuilderEngineMoves,
    opponentToMove,
    prep.color,
    prep.minGames,
    prep.moveLimit,
    showTrainingStage,
    userColor,
  ]);
  const branchAfterPrepStrengthByMove = useMemo(() => {
    if (!opponentToMove) {
      return new Map<string, PrepMoveStrength>();
    }

    const savedLineStrengths = branchStatsByKey
      ? getAfterPrepStrengthMap({
          openings: strengthOpenings,
          engineMoves: strengthEngineMoves ?? [],
          side: prep.color,
          settings: builderSettings,
          getImpact: (opening) =>
            branchStatsByKey[getOpponentPrepBranchKey(currentFen, opening.move)]
              ?.preparedLineImpact ?? null,
          getAfterScore: getPreparedLineImpactComparisonScore,
        })
      : new Map<string, PrepMoveStrength>();

    if (!branchPrepProjectionByKey) {
      return savedLineStrengths;
    }

    const result = new Map(savedLineStrengths);
    for (const row of currentRows) {
      const moveKey = normalizePrepBuilderSan(row.move);
      if (result.has(moveKey)) continue;

      const projection = branchPrepProjectionByKey[row.key];
      if (projection) {
        result.set(moveKey, projection.strength);
      }
    }

    return result;
  }, [
    branchStatsByKey,
    branchPrepProjectionByKey,
    builderSettings,
    currentFen,
    currentRows,
    opponentToMove,
    prep.color,
    strengthEngineMoves,
    strengthOpenings,
  ]);
  const candidateAfterPrepStrengthByMove = useMemo(
    () =>
      !opponentToMove
        ? getCandidateAfterPrepStrengthMap({
            openings: strengthOpenings,
            currentFen,
            candidateLineImpactByKey,
          })
        : new Map<string, PrepMoveStrength>(),
    [candidateLineImpactByKey, currentFen, opponentToMove, strengthOpenings],
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
  }, [configReady, setRootHere, setUnderBoardStage]);

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

  const choosePrepBuilderAfterPrepMove = useCallback(
    async ({
      fen,
      opponentOpenings,
      referenceOpenings,
      engineMoves,
      userSide,
      settings,
      minGames,
    }: {
      fen: string;
      opponentOpenings: Opening[];
      referenceOpenings: Opening[];
      engineMoves: PrepBuilderEngineMove[];
      userSide: PrepColor;
      settings: PrepBuilderSettings;
      minGames: number;
    }): Promise<PrepBuilderAfterPrepSelection | null> => {
      const choices = getPrepBuilderMoveChoices({
        opponentOpenings,
        referenceOpenings,
        engineMoves,
        userColor: userSide,
        settings,
        minGames,
      });
      if (choices.length === 0) return null;

      const rows = getPrepCandidateRows({
        fen,
        openings: opponentOpenings,
        minGames,
        moveLimit: Math.max(settings.opponentMoveLimit, getPrepBuilderAfterPrepScanLimit(settings)),
      });
      const rowByMove = new Map(
        rows.map((row) => [normalizePrepBuilderSan(row.move), row] as const),
      );
      const scanLimit = Math.min(choices.length, getPrepBuilderAfterPrepScanLimit(settings));
      const projectedChoices = await Promise.all(
        choices.slice(0, scanLimit).map(async (choice) => {
          const row = rowByMove.get(normalizePrepBuilderSan(choice.move)) ?? null;
          const lineImpact = row
            ? await getOpponentPrepCandidateLineImpact({
                fen,
                row,
                opponentColor: prep.color,
                loadOpenings: loadOpeningsForFen,
                loadEngineMoves: loadPrepBuilderEngineMoves,
                minGames,
                moveLimit: settings.opponentMoveLimit,
                settings,
              }).catch(() => null)
            : null;

          return {
            choice,
            row,
            lineImpact,
            afterPrepStrength: lineImpact?.continuationLineStrength ?? null,
          } satisfies PrepBuilderAfterPrepSelection;
        }),
      );

      const selected = choosePrepBuilderMoveWithAfterPrep(projectedChoices);
      if (selected) return selected as PrepBuilderAfterPrepSelection;

      return {
        choice: choices[0],
        row: rowByMove.get(normalizePrepBuilderSan(choices[0].move)) ?? null,
        lineImpact: null,
        afterPrepStrength: null,
      };
    },
    [loadOpeningsForFen, loadPrepBuilderEngineMoves, prep.color],
  );

  const buildPrepGamePlanBrief = useCallback(
    async (settings: PrepBuilderSettings, safeRootPath: number[]) => {
      const state = store.getState();
      if (!pathExists(state.root, safeRootPath)) return null;

      const startNode = state.getNode(safeRootPath);
      if (!startNode) return null;

      const userSide = oppositePrepColor(prep.color);
      const startLine = getLineSans(state.root, safeRootPath);
      const mainLine: PrepGamePlanStep[] = [];
      const replies: PrepGamePlanReply[] = [];
      const replyKeys = new Set<string>();
      const maxPly = settings.size === "deep" ? 14 : settings.size === "quick" ? 8 : 10;
      let fen = startNode.fen;
      let line = [...startLine];
      let branchShare = 1;
      let checkedPositions = 0;
      let rootDatabaseGames: number | null = null;

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

      for (let ply = 0; ply < maxPly && !builderCancelRef.current; ply += 1) {
        const turn = getFenTurn(fen);

        if (turn === userSide) {
          checkedPositions += 1;
          const evidenceMinGames = getEvidenceMinGames(ply);
          const [opponentOpenings, referenceOpenings, engineMoves] = await Promise.all([
            loadOpeningsForFen(fen, settings.opponentMoveLimit).catch(() => []),
            loadLichessAllOpeningsForFen(fen, settings).catch(() => []),
            loadPrepBuilderEngineMoves(fen, userSide, settings).catch(() => []),
          ]);
          rememberRootDatabaseGames(opponentOpenings);

          const selection = await choosePrepBuilderAfterPrepMove({
            fen,
            opponentOpenings,
            referenceOpenings,
            engineMoves,
            userSide,
            settings,
            minGames: evidenceMinGames,
          });
          if (!selection) break;

          const { choice, row: candidateRow, lineImpact } = selection;
          const nextFen = applyPrepSanMove(fen, choice.move);
          if (!nextFen) break;

          const nextLine = [...line, choice.move];
          mainLine.push({
            actor: "user",
            move: choice.move,
            line: nextLine,
            games: choice.opponentGames || candidateRow?.total || null,
            share: candidateRow?.share ?? choice.opponentShare,
            strength: choice.score,
            afterPrep: lineImpact?.continuationLineStrength?.score ?? null,
            engineCp: choice.engineCp,
            engineCpLoss: choice.engineCpLoss,
            engineSource: choice.engineSource,
            databaseScore: choice.databaseScore,
            engineUnsafe: false,
            note: formatPrepGamePlanUserNote(choice, lineImpact),
          });
          fen = nextFen;
          line = nextLine;
          continue;
        }

        if (turn !== prep.color) break;

        checkedPositions += 1;
        const replyPolicy = getPrepBuilderReplyPolicy({
          branchShare,
          settings,
        });
        const evidenceMinGames = getEvidenceMinGames(ply + 1);
        const openings = await loadOpeningsForFen(
          fen,
          getPrepBuilderBranchSearchMoveLimit(settings),
        ).catch(() => []);
        rememberRootDatabaseGames(openings);
        const availableGames = getPlayableGames(openings);
        const stopReason = getPrepBuilderStopReason({
          branchShare,
          depthShare: branchShare,
          ply,
          availableGames,
          minGames: evidenceMinGames,
          settings,
        });
        if (stopReason) break;

        const sortedOpenings = sortOpponentPrepOpenings(
          openings,
          evidenceMinGames,
          replyPolicy.moveLimit,
        );
        const rowTotalGames = sortedOpenings.reduce(
          (sum, opening) => sum + getOpeningTotal(opening),
          0,
        );
        const rows = sortedOpenings
          .map<OpponentPrepMoveRow>((opening) => {
            const key = getOpponentPrepBranchKey(fen, opening.move);
            return {
              ...opening,
              key,
              uci: null,
              total: getOpeningTotal(opening),
              share: rowTotalGames > 0 ? getOpeningTotal(opening) / rowTotalGames : 0,
              childIndex: null,
              status: prep.skippedBranches[key] ? "skipped" : "new",
            };
          })
          .filter(
            (row) =>
              row.status !== "skipped" &&
              row.total >= evidenceMinGames &&
              row.share * 100 >= replyPolicy.minMoveShare,
          );
        if (rows.length === 0) break;

        const focusedLimit = getPrepBuilderFocusedReplyLimit({
          branchShare,
          settings,
        });
        const scanLimit = Math.max(focusedLimit * 2, Math.min(8, replyPolicy.moveLimit));
        const ranked = [];

        for (const row of rows.slice(0, scanLimit)) {
          const projection = await getOpponentBranchPrepProjection({
            fen,
            row,
            userColor: userSide,
            loadOpenings: loadOpeningsForFen,
            loadEngineMoves: loadPrepBuilderEngineMoves,
            minGames: evidenceMinGames,
            moveLimit: settings.opponentMoveLimit,
            settings,
          }).catch(() => null);
          const opponentScore = getPrepResultScore(row, prep.color);
          const userSurfaceScore = getPrepResultScore(row, userSide);
          const afterPrep = projection?.strength.score ?? null;
          ranked.push({
            row,
            projection,
            opponentScore,
            afterPrep,
            priority: getPrepGamePlanReplyPriority({
              row,
              branchShare,
              opponentScore,
              userSurfaceScore,
              afterPrep,
            }),
          });
        }

        ranked.sort(
          (a, b) =>
            b.priority - a.priority ||
            b.row.share - a.row.share ||
            b.row.total - a.row.total ||
            a.row.move.localeCompare(b.row.move),
        );
        const main = ranked[0];
        if (!main) break;

        for (const item of ranked.slice(0, Math.min(focusedLimit, 5))) {
          const key = `${line.join(" ")}|${item.row.move}`;
          if (replyKeys.has(key)) continue;
          replyKeys.add(key);
          replies.push({
            positionLine: [...line],
            opponentMove: item.row.move,
            responseMove: item.projection?.responseMove ?? null,
            games: item.row.total,
            share: item.row.share,
            opponentScore: item.opponentScore,
            afterPrep: item.afterPrep,
            responseStrength: item.projection?.strength.score ?? null,
            responseEngineCp: item.projection?.strength.engineCp ?? null,
            responseEngineCpLoss: item.projection?.strength.engineCpLoss ?? null,
            responseEngineSource: item.projection?.strength.engineSource ?? null,
            responseDatabaseScore: item.projection?.strength.databaseScore ?? null,
            responseDetail: item.projection?.strength.detail ?? null,
            priority: item.priority,
            note: formatPrepGamePlanReplyNote(item.afterPrep, item.opponentScore),
          });
        }

        const nextFen = applyPrepSanMove(fen, main.row.move);
        if (!nextFen) break;
        const nextLine = [...line, main.row.move];
        mainLine.push({
          actor: "opponent",
          move: main.row.move,
          line: nextLine,
          games: main.row.total,
          share: main.row.share,
          strength: Math.round(main.opponentScore * 100),
          afterPrep: main.afterPrep,
          engineCp: main.projection?.strength.engineCp ?? null,
          engineCpLoss: main.projection?.strength.engineCpLoss ?? null,
          engineSource: main.projection?.strength.engineSource ?? null,
          databaseScore: main.projection?.strength.databaseScore ?? null,
          engineUnsafe: main.projection?.strength.engineUnsafe ?? false,
          note: formatPrepGamePlanOpponentNote(main.afterPrep, main.opponentScore),
        });
        fen = nextFen;
        line = nextLine;
        branchShare *= main.row.share;
      }

      return {
        generatedAt: Date.now(),
        startLine,
        mainLine,
        replies: replies
          .sort(
            (a, b) =>
              b.priority - a.priority ||
              b.share - a.share ||
              b.games - a.games ||
              a.opponentMove.localeCompare(b.opponentMove),
          )
          .slice(0, settings.size === "quick" ? 5 : 7),
        insights: getPrepGamePlanInsights(mainLine, replies, settings),
        checkedPositions,
        sourceLabel: getPrepGamePlanSourceLabel({
          prepMode,
          prepSource,
          databaseLabel: selectedDatabaseLabel,
          playerName: prep.playerName,
        }),
        maxEngineCpLoss: settings.maxEngineCpLoss,
      } satisfies PrepGamePlanBrief;
    },
    [
      choosePrepBuilderAfterPrepMove,
      loadLichessAllOpeningsForFen,
      loadOpeningsForFen,
      loadPrepBuilderEngineMoves,
      prep.playerName,
      prep.color,
      prep.skippedBranches,
      prepMode,
      prepSource,
      selectedDatabaseLabel,
      store,
    ],
  );

  const buildPrepCoachReportBrief = useCallback(
    async (settings: PrepBuilderSettings, safeRootPath: number[]) => {
      const state = store.getState();
      if (!pathExists(state.root, safeRootPath)) return null;

      const startNode = state.getNode(safeRootPath);
      if (!startNode) return null;

      const userSide = oppositePrepColor(prep.color);
      const startLine = getLineSans(state.root, safeRootPath);
      const sourceLabel = getPrepGamePlanSourceLabel({
        prepMode,
        prepSource,
        databaseLabel: selectedDatabaseLabel,
        playerName: prep.playerName,
      });
      const turn = getFenTurn(startNode.fen);
      const candidates: PrepCoachCandidateEvidence[] = [];
      const scanLimit = getPrepCoachScanLimit(settings);
      let checkedPositions = 1;
      let rootDatabaseGames: number | null = null;

      const getEvidenceMinGames = (ply: number) =>
        getPrepBuilderEvidenceMinGames({
          settings,
          rootGames: rootDatabaseGames,
          ply,
        });

      if (turn === userSide) {
        const [opponentOpenings, engineMoves] = await Promise.all([
          loadOpeningsForFen(startNode.fen, settings.opponentMoveLimit).catch(() => []),
          loadPrepBuilderEngineMoves(startNode.fen, userSide, settings).catch(() => []),
        ]);
        rootDatabaseGames = getPlayablePrepGames(opponentOpenings);
        const minGames = getEvidenceMinGames(0);
        const rows = getPrepCandidateRows({
          fen: startNode.fen,
          openings: opponentOpenings,
          minGames,
          moveLimit: Math.max(settings.opponentMoveLimit, scanLimit),
        }).slice(0, scanLimit);
        const strengthByMove = getPrepMoveStrengthMap({
          openings: sortOpponentPrepOpenings(
            opponentOpenings,
            minGames,
            PREP_STRENGTH_MOVE_POOL_LIMIT,
          ),
          engineMoves,
          side: userSide,
          settings,
        });

        for (const [index, row] of rows.entries()) {
          const moveKey = normalizePrepBuilderSan(row.move);
          const strength = strengthByMove.get(moveKey) ?? null;
          const impact = await getOpponentPrepCandidateLineImpact({
            fen: startNode.fen,
            row,
            opponentColor: prep.color,
            loadOpenings: loadOpeningsForFen,
            loadEngineMoves: loadPrepBuilderEngineMoves,
            minGames,
            moveLimit: settings.opponentMoveLimit,
            settings,
          }).catch(() => null);
          checkedPositions += 1;

          const continuationStrength = impact?.continuationLineStrength ?? null;
          const afterPrepStrength = continuationStrength;
          const engineUnsafe = Boolean(
            strength?.engineUnsafe || continuationStrength?.engineUnsafe,
          );
          const exclusionReason = engineUnsafe
            ? `Max CP Drop gate: this move is over the configured ${settings.maxEngineCpLoss} cp loss when local eval evidence is available.`
            : null;
          const status: PrepCoachCandidateStatus = exclusionReason
            ? "unsafe"
            : strength
              ? "safe"
              : "thin";
          const continuationMoves = impact?.continuationMoves ?? [];

          candidates.push({
            id: `C${index + 1}`,
            kind: "your-move",
            status,
            move: row.move,
            line: [...startLine, row.move, ...continuationMoves],
            games: row.total,
            share: row.share,
            surfaceScore: getPrepResultScore(row, userSide),
            surfaceScoreLabel: `${getPrepColorLabel(userSide)} database score`,
            strength,
            afterPrepStrength,
            afterPrepSource: continuationStrength ? "projection" : "none",
            likelyOpponentMove: impact?.opponentReplyMove ?? null,
            responseMove: impact?.userResponseMove ?? null,
            responseDetail: impact
              ? candidateLineImpactTooltip(impact, prepMode === "general")
              : null,
            engineUnsafe,
            exclusionReason,
            priority: getPrepCoachCandidatePriority({
              status,
              games: row.total,
              share: row.share,
              surfaceScore: getPrepResultScore(row, userSide),
              strength,
              afterPrepStrength,
            }),
          });
        }
      } else if (turn === prep.color) {
        const openings = await loadOpeningsForFen(
          startNode.fen,
          getPrepBuilderBranchSearchMoveLimit(settings),
        ).catch(() => []);
        rootDatabaseGames = getPlayablePrepGames(openings);
        const minGames = getEvidenceMinGames(0);
        const sortedOpenings = sortOpponentPrepOpenings(openings, minGames, scanLimit);
        const rowTotalGames = sortedOpenings.reduce(
          (sum, opening) => sum + getOpeningTotal(opening),
          0,
        );
        const strengthByMove = getPrepMoveStrengthMap({
          openings: sortedOpenings,
          side: prep.color,
          settings,
        });

        for (const [index, opening] of sortedOpenings.slice(0, scanLimit).entries()) {
          const key = getOpponentPrepBranchKey(startNode.fen, opening.move);
          const row: OpponentPrepMoveRow = {
            ...opening,
            key,
            uci: null,
            total: getOpeningTotal(opening),
            share: rowTotalGames > 0 ? getOpeningTotal(opening) / rowTotalGames : 0,
            childIndex: null,
            status: prep.skippedBranches[key] ? "skipped" : "new",
          };
          const projection =
            row.status === "skipped"
              ? null
              : await getOpponentBranchPrepProjection({
                  fen: startNode.fen,
                  row,
                  userColor: userSide,
                  loadOpenings: loadOpeningsForFen,
                  loadEngineMoves: loadPrepBuilderEngineMoves,
                  minGames,
                  moveLimit: settings.opponentMoveLimit,
                  settings,
                }).catch(() => null);
          checkedPositions += 1;

          const strength = strengthByMove.get(normalizePrepBuilderSan(row.move)) ?? null;
          const responseStrength = projection?.strength ?? null;
          const opponentScore = getPrepResultScore(row, prep.color);
          const userSurfaceScore = getPrepResultScore(row, userSide);
          const engineUnsafe = Boolean(responseStrength?.engineUnsafe);
          const exclusionReason =
            row.status === "skipped"
              ? "This branch is marked skipped in prep."
              : engineUnsafe
                ? `Max CP Drop gate: the available answer is over the configured ${settings.maxEngineCpLoss} cp loss.`
                : !projection
                  ? "No safe answer was found from the supplied database/eval evidence."
                  : null;
          const status: PrepCoachCandidateStatus =
            row.status === "skipped"
              ? "skipped"
              : engineUnsafe
                ? "unsafe"
                : projection
                  ? "safe"
                  : "no-safe-answer";

          candidates.push({
            id: `C${index + 1}`,
            kind: "opponent-move",
            status,
            move: row.move,
            line: [
              ...startLine,
              row.move,
              ...(projection?.responseMove ? [projection.responseMove] : []),
            ],
            games: row.total,
            share: row.share,
            surfaceScore: opponentScore,
            surfaceScoreLabel:
              prepMode === "general" ? "source-side surface score" : "opponent surface score",
            strength,
            afterPrepStrength: responseStrength,
            afterPrepSource: responseStrength ? "projection" : "none",
            likelyOpponentMove: row.move,
            responseMove: projection?.responseMove ?? null,
            responseDetail: projection?.strength.detail ?? null,
            engineUnsafe,
            exclusionReason,
            priority: getPrepGamePlanReplyPriority({
              row,
              branchShare: 1,
              opponentScore,
              userSurfaceScore,
              afterPrep: responseStrength?.score ?? null,
            }),
          });
        }
      }

      const sortedCandidates = candidates.sort(
        (a, b) =>
          b.priority - a.priority ||
          getPrepCoachStatusSort(b.status) - getPrepCoachStatusSort(a.status) ||
          b.share - a.share ||
          b.games - a.games ||
          a.move.localeCompare(b.move),
      );
      const briefBase: PrepCoachReportBriefBase = {
        generatedAt: Date.now(),
        rootFen: startNode.fen,
        startLine,
        sourceLabel,
        userColor: userSide,
        opponentColor: prep.color,
        maxEngineCpLoss: settings.maxEngineCpLoss,
        checkedPositions,
        candidates: sortedCandidates,
      };

      return {
        ...briefBase,
        request: buildPrepCoachReportRequest({
          brief: briefBase,
          settings,
          general: prepMode === "general",
        }),
      } satisfies PrepCoachReportBrief;
    },
    [
      loadOpeningsForFen,
      loadPrepBuilderEngineMoves,
      prep.color,
      prep.playerName,
      prep.skippedBranches,
      prepMode,
      prepSource,
      selectedDatabaseLabel,
      store,
    ],
  );

  const runPrepBuilder = useCallback(async () => {
    if (!configReady || builderRunning) return;

    const settings = normalizePrepBuilderSettings(prep.builder);
    const userSide = oppositePrepColor(prep.color);
    const safetyPositionLimit = getPrepBuilderSafetyPositionLimit(settings.size);
    builderCancelRef.current = false;
    setBuilderRunning(true);
    setBuilderNeedsSave(false);
    setGamePlanBrief(null);
    setPrepCoachReportBrief(null);
    setPrepCoachAutoRunKey(null);
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

      const selection = await choosePrepBuilderAfterPrepMove({
        fen: node.fen,
        opponentOpenings,
        referenceOpenings,
        engineMoves,
        userSide,
        settings,
        minGames: evidenceMinGames,
      });

      if (!selection) {
        stoppedLines += 1;
        updateStatus("No supported database move");
        return null;
      }

      const { choice } = selection;
      const child = addMoveWithComment(
        task.path,
        choice.move,
        formatPrepBuilderChoiceComment(choice, selection.afterPrepStrength),
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
      updateStatus("Building game plan", true);
      const brief = await buildPrepGamePlanBrief(settings, safeRootPath);
      if (brief && !builderCancelRef.current) {
        setGamePlanBrief(brief);
      }
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
            a.ply - b.ply ||
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

          const focusedLimit = getPrepBuilderFocusedReplyLimit({
            branchShare: task.depthShare,
            settings,
          });
          const rankedRows = rows
            .map((row) => {
              const nextBranchShare = task.branchShare * row.share;
              const nextDepthShare = Math.min(task.depthShare, row.share);
              const nextBranchValue = getPrepBuilderBranchValue({
                opening: row,
                userColor: userSide,
                settings,
              });
              const nextPly = task.ply + 1;
              return {
                row,
                nextBranchShare,
                nextDepthShare,
                nextBranchValue,
                nextPly,
                priority: getPrepBuilderTaskPriority({
                  branchShare: nextBranchShare,
                  branchValue: nextBranchValue,
                  ply: nextPly,
                  settings,
                }),
              };
            })
            .sort(
              (a, b) =>
                b.priority - a.priority ||
                b.row.share - a.row.share ||
                b.row.total - a.row.total ||
                a.row.move.localeCompare(b.row.move),
            )
            .slice(0, focusedLimit);

          const nextTasks: PrepBuilderQueueItem[] = [];
          for (const rankedRow of rankedRows) {
            if (builderCancelRef.current) break;

            const { row, nextBranchShare, nextDepthShare, nextBranchValue, nextPly } = rankedRow;
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
    buildPrepGamePlanBrief,
    builderRunning,
    choosePrepBuilderAfterPrepMove,
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

  const playGamePlanLine = useCallback(
    (moves: string[]) => {
      if (!gamePlanBrief) return;

      clearMovePreview();
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      state.goToMove(safeRootPath);
      for (const move of moves.slice(gamePlanBrief.startLine.length)) {
        store.getState().makeMove({ payload: move });
      }
    },
    [clearMovePreview, gamePlanBrief, prep.rootPath, store],
  );

  const playPrepCoachReportLine = useCallback(
    (moves: string[]) => {
      if (!prepCoachReportBrief) return;

      clearMovePreview();
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      state.goToMove(safeRootPath);
      for (const move of moves.slice(prepCoachReportBrief.startLine.length)) {
        store.getState().makeMove({ payload: move });
      }
    },
    [clearMovePreview, prep.rootPath, prepCoachReportBrief, store],
  );

  const runPrepCoachReport = useCallback(async () => {
    if (!configReady || builderRunning || prepCoachReportRunning) return;

    const settings = normalizePrepBuilderSettings(prep.builder);
    setPrepCoachReportRunning(true);
    setBuilderStatus((current) => ({
      phase: "Checking coach evidence",
      addedMoves: current?.addedMoves ?? 0,
      visitedPositions: current?.visitedPositions ?? 0,
      stoppedLines: current?.stoppedLines ?? 0,
    }));

    try {
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      const brief = await buildPrepCoachReportBrief(settings, safeRootPath);

      if (!brief || brief.candidates.length === 0) {
        notifications.show({
          title: "No coach report yet",
          message: "No database/eval candidates were found from this prep start.",
          color: "yellow",
        });
        return;
      }

      setPrepCoachReportBrief(brief);
      setPrepCoachAutoRunKey(`prep-coach-report-${Date.now()}`);
    } catch (error) {
      notifications.show({
        title: "Coach report failed",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setPrepCoachReportRunning(false);
    }
  }, [
    buildPrepCoachReportBrief,
    builderRunning,
    configReady,
    prep.builder,
    prep.rootPath,
    prepCoachReportRunning,
    store,
  ]);

  const prepCoachReportCacheKey = useMemo(
    () =>
      prepCoachReportBrief
        ? JSON.stringify({
            scope: "independent-prep-coach-report",
            generatedAt: prepCoachReportBrief.generatedAt,
            source: prepCoachReportBrief.sourceLabel,
            line: prepCoachReportBrief.startLine.join(" "),
            candidates: prepCoachReportBrief.candidates.map((candidate) => [
              candidate.id,
              candidate.status,
              candidate.line.join(" "),
              candidate.strength?.score ?? null,
              candidate.afterPrepStrength?.score ?? null,
            ]),
          })
        : "independent-prep-coach-report-empty",
    [prepCoachReportBrief],
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
                  max={MAX_PREP_MOVE_LIMIT}
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
              <Tooltip label="Ask the AI coach to choose a prep line from database, strength, eval, and after-prep evidence">
                <Button
                  variant="default"
                  size={controlSize}
                  leftSection={<IconSparkles size="0.95rem" />}
                  disabled={!configReady || builderRunning}
                  loading={prepCoachReportRunning}
                  onClick={() => void runPrepCoachReport()}
                >
                  Coach report
                </Button>
              </Tooltip>
              <Tooltip
                label={
                  canRunStraightLine
                    ? "Find a high-confidence line where this player keeps reaching a position that is good for your prep side"
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
                userColor={userColor}
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
              userColor={userColor}
              onPlay={playStraightLineResult}
              onClear={() => {
                setStraightLineResult(null);
                setStraightLineStatus(null);
              }}
            />
          ) : null}
          {prepCoachReportBrief ? (
            <PrepCoachReportPanel
              brief={prepCoachReportBrief}
              cacheKey={prepCoachReportCacheKey}
              autoRunKey={prepCoachAutoRunKey}
              onPlayLine={playPrepCoachReportLine}
              onClear={() => {
                setPrepCoachReportBrief(null);
                setPrepCoachAutoRunKey(null);
              }}
            />
          ) : null}
          {gamePlanBrief ? (
            <PrepGamePlanBriefPanel
              brief={gamePlanBrief}
              general={prepMode === "general"}
              userColor={userColor}
              onPlayLine={playGamePlanLine}
              onClear={() => {
                setGamePlanBrief(null);
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
              branchPrepProjectionByKey={branchPrepProjectionByKey}
              strengthByMove={strengthByMove}
              afterPrepStrengthByMove={branchAfterPrepStrengthByMove}
              strengthLoading={strengthLoading}
              afterPrepLoading={strengthLoading || branchPrepProjectionLoading}
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
              afterPrepStrengthByMove={candidateAfterPrepStrengthByMove}
              strengthLoading={strengthLoading}
              afterPrepLoading={strengthLoading || candidateLineImpactLoading}
              candidateLineImpactByKey={candidateLineImpactByKey}
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
  branchPrepProjectionByKey,
  strengthByMove,
  afterPrepStrengthByMove,
  strengthLoading,
  afterPrepLoading,
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
  branchPrepProjectionByKey?: Record<string, OpponentBranchPrepProjection>;
  strengthByMove: Map<string, PrepMoveStrength>;
  afterPrepStrengthByMove: Map<string, PrepMoveStrength>;
  strengthLoading: boolean;
  afterPrepLoading: boolean;
  sort: PrepSortState<OpponentPrepSortColumn>;
  onSort: (column: OpponentPrepSortColumn) => void;
}) {
  const textSize = dense ? "xs" : "sm";
  const sortedRows = useMemo(
    () =>
      sortOpponentPrepTableRows(
        rows,
        sort,
        branchStatsByKey,
        resultSide,
        strengthByMove,
        afterPrepStrengthByMove,
      ),
    [afterPrepStrengthByMove, branchStatsByKey, resultSide, rows, sort, strengthByMove],
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
            style={{ width: dense ? 78 : 104 }}
          />
          <SortablePrepTh
            label="After prep"
            column="afterPrep"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 88 : 118 }}
          />
          <SortablePrepTh
            label="Games"
            column="games"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 70 : 92 }}
          />
          <SortablePrepTh
            label="Results"
            column="results"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 160 : 230 }}
          />
          <SortablePrepTh
            label="Prep"
            column="prep"
            sort={sort}
            onSort={onSort}
            style={{ width: dense ? 96 : 132 }}
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
        {sortedRows.map((row) => {
          const lineImpact = branchStatsByKey?.[row.key]?.preparedLineImpact ?? null;
          const projection = branchPrepProjectionByKey?.[row.key] ?? null;
          const moveKey = normalizePrepBuilderSan(row.move);
          const afterPrepStrength = afterPrepStrengthByMove.get(moveKey);
          const projectionContext = projection
            ? branchPrepProjectionTooltipLines(projection, general)
            : [];

          return (
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
                <PrepAfterStrengthCell
                  strength={afterPrepStrength}
                  label={lineImpact ? "Saved line" : projection?.label}
                  summary={
                    !lineImpact && projection
                      ? `${projection.label} ${projection.strength.score}: projected from the best available prep reply after this ${general ? "source" : "opponent"} move.`
                      : undefined
                  }
                  context={
                    lineImpact
                      ? preparedLineImpactTooltipLines(lineImpact, general)
                      : projection
                        ? projectionContext
                        : []
                  }
                  loading={afterPrepLoading}
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
          );
        })}
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
  afterPrepStrengthByMove,
  strengthLoading,
  afterPrepLoading,
  candidateLineImpactByKey,
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
  afterPrepStrengthByMove: Map<string, PrepMoveStrength>;
  strengthLoading: boolean;
  afterPrepLoading: boolean;
  candidateLineImpactByKey?: Record<string, OpponentPrepLineImpact>;
  sort: PrepSortState<CandidatePrepSortColumn>;
  onSort: (column: CandidatePrepSortColumn) => void;
}) {
  const textSize = dense ? "xs" : "sm";
  const colorLabel = userColor === "white" ? "White" : "Black";
  const sortedRows = useMemo(
    () =>
      sortCandidatePrepTableRows(rows, sort, userColor, strengthByMove, afterPrepStrengthByMove),
    [afterPrepStrengthByMove, rows, sort, userColor, strengthByMove],
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
              style={{ width: dense ? 78 : 104 }}
            />
            <SortablePrepTh
              label="After prep"
              column="afterPrep"
              sort={sort}
              onSort={onSort}
              style={{ width: dense ? 88 : 118 }}
            />
            <SortablePrepTh
              label="Games"
              column="games"
              sort={sort}
              onSort={onSort}
              style={{ width: dense ? 70 : 92 }}
            />
            <SortablePrepTh
              label="WDL"
              column="results"
              sort={sort}
              onSort={onSort}
              style={{ width: dense ? 170 : 260 }}
            />
            <Table.Th style={{ width: dense ? 64 : 82 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sortedRows.map((row) => {
            const lineImpact = candidateLineImpactByKey?.[row.key];
            const moveKey = normalizePrepBuilderSan(row.move);
            const rowStrength = strengthByMove.get(moveKey);
            const afterPrepStrength = afterPrepStrengthByMove.get(moveKey);
            const continuationStrength = lineImpact?.continuationLineStrength ?? null;
            const continuationIsShown = Boolean(lineImpact && continuationStrength);

            return (
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
                  <PrepStrengthCell strength={rowStrength} loading={strengthLoading} />
                </Table.Td>
                <Table.Td>
                  <PrepAfterStrengthCell
                    strength={afterPrepStrength}
                    label={
                      lineImpact && continuationIsShown
                        ? formatCandidateAfterPrepLabel(lineImpact)
                        : ""
                    }
                    context={
                      lineImpact && continuationIsShown
                        ? [candidateLineImpactTooltip(lineImpact, general)]
                        : []
                    }
                    loading={afterPrepLoading}
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
            );
          })}
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
    value === "afterPrep" ||
    value === "games" ||
    value === "results" ||
    value === "prep" ||
    value === "state"
  );
}

function isCandidatePrepSortColumn(value: unknown): value is CandidatePrepSortColumn {
  return (
    value === "move" ||
    value === "strength" ||
    value === "afterPrep" ||
    value === "games" ||
    value === "results"
  );
}

function sortOpponentPrepTableRows(
  rows: OpponentPrepMoveRow[],
  sort: PrepSortState<OpponentPrepSortColumn>,
  branchStatsByKey: Record<string, OpponentPrepBranchStats> | undefined,
  resultSide: "white" | "black",
  strengthByMove: Map<string, PrepMoveStrength>,
  afterPrepStrengthByMove: Map<string, PrepMoveStrength>,
) {
  return [...rows].sort((a, b) => {
    const diff = compareOpponentPrepRows(
      a,
      b,
      sort.column,
      branchStatsByKey,
      resultSide,
      strengthByMove,
      afterPrepStrengthByMove,
    );
    return withPrepSortDirection(diff, sort.direction) || comparePrepRowsDefault(a, b);
  });
}

function sortCandidatePrepTableRows(
  rows: PrepCandidateMoveRow[],
  sort: PrepSortState<CandidatePrepSortColumn>,
  resultSide: "white" | "black",
  strengthByMove: Map<string, PrepMoveStrength>,
  afterPrepStrengthByMove: Map<string, PrepMoveStrength>,
) {
  return [...rows].sort((a, b) => {
    const diff = compareCandidatePrepRows(
      a,
      b,
      sort.column,
      resultSide,
      strengthByMove,
      afterPrepStrengthByMove,
    );
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
  afterPrepStrengthByMove: Map<string, PrepMoveStrength>,
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

  return compareCandidatePrepRows(
    a,
    b,
    column,
    resultSide,
    strengthByMove,
    afterPrepStrengthByMove,
  );
}

function compareCandidatePrepRows(
  a: Pick<Opening, "move" | "white" | "draw" | "black"> & { total: number },
  b: Pick<Opening, "move" | "white" | "draw" | "black"> & { total: number },
  column: CandidatePrepSortColumn | Exclude<OpponentPrepSortColumn, "prep" | "state">,
  resultSide: "white" | "black",
  strengthByMove: Map<string, PrepMoveStrength>,
  afterPrepStrengthByMove: Map<string, PrepMoveStrength>,
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

  if (column === "afterPrep") {
    return (
      getPrepStrengthSortScore(a.move, afterPrepStrengthByMove) -
      getPrepStrengthSortScore(b.move, afterPrepStrengthByMove)
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

async function runAfterPrepProjectionJobs<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        if (item === undefined) break;
        await worker(item);
      }
    }),
  );
}

function buildPrepCoachReportRequest({
  brief,
  general,
  settings,
}: {
  brief: PrepCoachReportBriefBase;
  general: boolean;
  settings: PrepBuilderSettings;
}): PlanCoachInlineRequest {
  const userLabel = getPrepColorLabel(brief.userColor);
  const sourceLabel = general ? "source side" : "opponent";
  const safeCandidates = brief.candidates.filter((candidate) => candidate.status === "safe");
  const blockedCandidates = brief.candidates.filter((candidate) => candidate.status !== "safe");

  return {
    fen: brief.rootFen,
    sideToMove:
      getFenTurn(brief.rootFen) === brief.userColor ? `${userLabel} / prep side` : sourceLabel,
    surface: "Independent prep coach report",
    subjectKind: "prep line selection",
    title: `Independent coach prep report for ${brief.sourceLabel}`,
    summary: [
      `Pre-game prep report for ${userLabel}. Choose the single best prep line yourself from the safe candidates below; the prep builder has not selected the line for you.`,
      `Hard constraint: Max CP Drop is ${brief.maxEngineCpLoss} cp. Candidates marked unsafe, skipped, thin, or no-safe-answer are evidence only and must not be recommended.`,
      "Use After-prep projection as the primary score when it is available; normal blended Strength is only the first-move fallback.",
      "Output natural language only. Start with the chosen line, then explain why it is best, the replies to know, risks, and what to memorize before the game.",
      `Strength mode ${settings.mode}; cloud eval ${settings.useCloudEngine ? "on" : "off"}.`,
    ].join(" "),
    planLines:
      safeCandidates.length > 0
        ? safeCandidates
            .slice(0, 8)
            .map((candidate) =>
              [
                `${candidate.id}: ${formatPrepCoachCandidateLine(candidate, brief.startLine)}`,
                `status safe`,
                candidate.responseMove ? `answer/follow-up ${candidate.responseMove}` : null,
                `strength ${candidate.strength?.score ?? "n/a"}`,
                `after-prep ${candidate.afterPrepStrength?.score ?? "n/a"} (${candidate.afterPrepSource})`,
              ]
                .filter((part): part is string => Boolean(part))
                .join("; "),
            )
        : ["No safe candidate was found under the current Max CP Drop and evidence settings."],
    stats: [
      `Prep source: ${brief.sourceLabel}.`,
      `Preparing as ${userLabel}; ${sourceLabel} colour is ${brief.opponentColor}.`,
      `Checked positions: ${brief.checkedPositions}.`,
      `Safe candidates: ${safeCandidates.length}; evidence-only candidates: ${blockedCandidates.length}.`,
      `Builder size: ${settings.size}; opponent move limit ${settings.opponentMoveLimit}; min games ${settings.minOpponentGames}; min reply share ${settings.minOpponentMoveShare}%.`,
      `Max CP Drop: ${brief.maxEngineCpLoss} cp. Treat this as a hard safety constraint.`,
    ],
    evidence: [
      ...brief.candidates.slice(0, 14).map(formatPrepCoachCandidateForCoach),
      ...blockedCandidates
        .slice(0, 5)
        .map(
          (candidate) =>
            `Evidence-only ${candidate.id}: ${candidate.exclusionReason ?? getPrepCoachStatusLabel(candidate.status)}.`,
        ),
    ],
  };
}

function getPlayablePrepGames(openings: Opening[]) {
  return openings.reduce(
    (sum, opening) =>
      opening.move === "*" || opening.move === "Total" ? sum : sum + getOpeningTotal(opening),
    0,
  );
}

function getPrepCoachScanLimit(settings: PrepBuilderSettings) {
  if (settings.size === "quick") return Math.min(8, PREP_COACH_SCAN_LIMIT);
  if (settings.size === "deep") return PREP_COACH_SCAN_LIMIT;
  return 10;
}

function getPrepBuilderAfterPrepScanLimit(settings: PrepBuilderSettings) {
  if (settings.size === "quick") return Math.min(6, PREP_BUILDER_AFTER_PREP_SCAN_LIMIT);
  if (settings.size === "deep") return PREP_BUILDER_AFTER_PREP_SCAN_LIMIT;
  return 8;
}

function getPrepCoachCandidatePriority({
  status,
  games,
  share,
  surfaceScore,
  strength,
  afterPrepStrength,
}: {
  status: PrepCoachCandidateStatus;
  games: number;
  share: number;
  surfaceScore: number;
  strength: PrepMoveStrength | null;
  afterPrepStrength: PrepMoveStrength | null;
}) {
  const statusBoost = getPrepCoachStatusSort(status) * 1000;
  const hasAfterPrep = afterPrepStrength !== null;
  const strengthScore = hasAfterPrep
    ? afterPrepStrength.score
    : Math.min(strength?.score ?? surfaceScore * 100, 35);
  const confidence = Math.min(1, Math.log10(games + 1) / 3);

  return (
    statusBoost +
    (hasAfterPrep ? 1000 : 0) +
    strengthScore * 1.35 +
    share * 100 * 0.6 +
    confidence * 12
  );
}

function getPrepCoachStatusSort(status: PrepCoachCandidateStatus) {
  switch (status) {
    case "safe":
      return 4;
    case "thin":
      return 3;
    case "no-safe-answer":
      return 2;
    case "skipped":
      return 1;
    case "unsafe":
      return 0;
  }
}

function getPrepCoachStatusLabel(status: PrepCoachCandidateStatus) {
  switch (status) {
    case "safe":
      return "Safe";
    case "unsafe":
      return "Unsafe";
    case "no-safe-answer":
      return "No answer";
    case "thin":
      return "Thin";
    case "skipped":
      return "Skipped";
  }
}

function getPrepCoachStatusColor(status: PrepCoachCandidateStatus) {
  switch (status) {
    case "safe":
      return "teal";
    case "unsafe":
      return "red";
    case "no-safe-answer":
      return "yellow";
    case "thin":
      return "gray";
    case "skipped":
      return "gray";
  }
}

function getPrepGamePlanReplyPriority({
  row,
  branchShare,
  opponentScore,
  userSurfaceScore,
  afterPrep,
}: {
  row: OpponentPrepMoveRow;
  branchShare: number;
  opponentScore: number;
  userSurfaceScore: number;
  afterPrep: number | null;
}) {
  const reach = branchShare * row.share * 100;
  const danger = opponentScore * 100;
  const prepSwing = afterPrep === null ? 0 : Math.max(0, afterPrep - userSurfaceScore * 100);
  const confidence = Math.min(1, Math.log10(row.total + 1) / 2);

  return reach * 1.25 + danger * 0.45 + prepSwing * 1.1 + confidence * 8;
}

function formatPrepGamePlanUserNote(
  choice: PrepBuilderMoveChoice,
  impact: OpponentPrepLineImpact | null,
) {
  const parts = [`Strength ${choice.score}`];
  if (impact?.continuationLineStrength) {
    parts.push(`after prep ${impact.continuationLineStrength.score}`);
  }
  if (choice.opponentGames > 0) {
    parts.push(`${formatNumber(choice.opponentGames)} games`);
  }
  return [...parts, ...choice.reasons.slice(0, 2)].join(" - ");
}

function formatPrepCoachCandidateLine(
  candidate: PrepCoachCandidateEvidence,
  startLine: string[] = [],
) {
  const visible = candidate.line.slice(startLine.length);
  if (visible.length > 0) return visible.join(" ");
  return candidate.move;
}

function formatPrepCoachCandidateShortEvidence(candidate: PrepCoachCandidateEvidence) {
  const metrics = [
    `${candidate.surfaceScoreLabel} ${formatPrepCoachPercent(candidate.surfaceScore)}`,
    candidate.afterPrepStrength ? `after-prep ${candidate.afterPrepStrength.score}` : null,
    candidate.likelyOpponentMove ? `reply ${candidate.likelyOpponentMove}` : null,
    candidate.responseMove ? `answer ${candidate.responseMove}` : null,
    candidate.exclusionReason,
  ];

  return metrics.filter((part): part is string => Boolean(part)).join("; ");
}

function formatPrepCoachCandidateForCoach(candidate: PrepCoachCandidateEvidence) {
  const actor = candidate.kind === "your-move" ? "prep-side candidate" : "opponent/source move";
  const metrics = [
    `${candidate.id}: ${actor} ${candidate.move}`,
    `status ${getPrepCoachStatusLabel(candidate.status)}`,
    `line ${candidate.line.join(" ")}`,
    `${formatNumber(candidate.games)} games`,
    `${formatPrepGamePlanShare(candidate.share)} share`,
    `${candidate.surfaceScoreLabel} ${formatPrepCoachPercent(candidate.surfaceScore)}`,
    candidate.strength
      ? `blended strength ${candidate.strength.score}`
      : "blended strength unavailable",
    candidate.afterPrepStrength
      ? `after-prep ${candidate.afterPrepStrength.score} (${candidate.afterPrepSource})`
      : "after-prep unavailable",
    candidate.likelyOpponentMove ? `likely reply ${candidate.likelyOpponentMove}` : null,
    candidate.responseMove ? `answer/follow-up ${candidate.responseMove}` : null,
    formatPrepCoachEngineEvidence({
      engineCp: candidate.afterPrepStrength?.engineCp ?? candidate.strength?.engineCp ?? null,
      engineCpLoss:
        candidate.afterPrepStrength?.engineCpLoss ?? candidate.strength?.engineCpLoss ?? null,
      engineSource:
        candidate.afterPrepStrength?.engineSource ?? candidate.strength?.engineSource ?? null,
      engineUnsafe: candidate.engineUnsafe,
    }),
    candidate.exclusionReason ? `do not recommend: ${candidate.exclusionReason}` : null,
    candidate.responseDetail,
  ];

  return metrics.filter((part): part is string => Boolean(part)).join("; ");
}

function formatPrepCoachEngineEvidence({
  engineCp,
  engineCpLoss,
  engineSource,
  engineUnsafe,
}: {
  engineCp: number | null;
  engineCpLoss: number | null;
  engineSource: PrepBuilderEngineMove["source"] | null;
  engineUnsafe: boolean;
}) {
  if (engineCpLoss === null) return "engine evidence unavailable";
  const source = getPrepGamePlanEngineSourceLabel(engineSource);
  const cp = engineCp === null ? "" : ` (${engineCp > 0 ? "+" : ""}${Math.round(engineCp)} cp)`;
  return `${source}: ${Math.round(engineCpLoss)} cp drop${cp}${
    engineUnsafe ? "; engine-unsafe and excluded" : ""
  }`;
}

function getPrepGamePlanEngineSourceLabel(source: PrepBuilderEngineMove["source"] | null) {
  if (source === "local-lichess") return "Local eval";
  if (source === "lichess") return "Local eval";
  if (source === "chessdb") return "External eval";
  return "Engine";
}

function formatPrepCoachPercent(score: number) {
  return `${Math.round(score * 100)}%`;
}

function formatPrepGamePlanOpponentNote(afterPrep: number | null, opponentScore: number) {
  const score = Math.round(opponentScore * 100);
  if (afterPrep !== null) {
    return `Opponent scores ${score} before your answer; after prep projects ${afterPrep}.`;
  }
  return `Opponent scores ${score}; keep this reply on the radar.`;
}

function formatPrepGamePlanReplyNote(afterPrep: number | null, opponentScore: number) {
  const score = Math.round(opponentScore * 100);
  if (afterPrep !== null) return `Answer projects ${afterPrep} after their ${score} surface score.`;
  return `Surface danger ${score}; no projected answer score was found.`;
}

function getPrepGamePlanInsights(
  mainLine: PrepGamePlanStep[],
  replies: PrepGamePlanReply[],
  settings: PrepBuilderSettings,
) {
  const insights: string[] = [];
  const firstUserMove = mainLine.find((step) => step.actor === "user");
  const topReply = replies[0];
  const bestSwingReply = replies
    .filter((reply) => reply.afterPrep !== null)
    .sort(
      (a, b) =>
        b.afterPrep! - b.opponentScore * 100 - (a.afterPrep! - a.opponentScore * 100) ||
        b.share - a.share,
    )[0];

  if (firstUserMove) {
    insights.push(
      `Main recommendation: ${firstUserMove.move} at strength ${firstUserMove.strength ?? "n/a"}${
        firstUserMove.afterPrep !== null ? `, after prep ${firstUserMove.afterPrep}` : ""
      }.`,
    );
  }

  if (topReply) {
    insights.push(
      `Highest-alert reply: ${topReply.opponentMove} from ${formatPrepGamePlanShare(
        topReply.share,
      )} of games; answer ${topReply.responseMove ?? "not found"}.`,
    );
  }

  if (bestSwingReply && bestSwingReply.afterPrep !== null) {
    insights.push(
      `Best prep swing: ${bestSwingReply.opponentMove} -> ${
        bestSwingReply.responseMove ?? "answer not found"
      } projects ${bestSwingReply.afterPrep} after their ${Math.round(
        bestSwingReply.opponentScore * 100,
      )} surface score.`,
    );
  }

  if (insights.length === 0) {
    insights.push(
      settings.useCloudEngine
        ? "No clear practical swing was found from the current source."
        : "No clear practical swing was found without local eval evidence.",
    );
  }

  return insights;
}

function getPrepGamePlanSourceLabel({
  prepMode,
  prepSource,
  databaseLabel,
  playerName,
}: {
  prepMode: "player" | "general";
  prepSource: OpponentPrepState["source"];
  databaseLabel: string | null | undefined;
  playerName: string;
}) {
  const source =
    prepSource === "lch_all"
      ? "Lichess All"
      : prepSource === "lch_master"
        ? "Lichess Masters"
        : databaseLabel || "local prep database";
  const player = playerName.trim();

  if (prepMode === "player" && player) return `${player} from ${source}`;
  return source;
}

async function getOpponentBranchPrepProjection({
  fen,
  row,
  userColor,
  loadOpenings,
  loadEngineMoves,
  minGames,
  moveLimit,
  settings,
}: {
  fen: string;
  row: OpponentPrepMoveRow;
  userColor: PrepColor;
  loadOpenings: (fen: string) => Promise<Opening[]>;
  loadEngineMoves: (
    fen: string,
    userColor: PrepColor,
    settings: PrepBuilderSettings,
  ) => Promise<PrepBuilderEngineMove[]>;
  minGames: number;
  moveLimit: number;
  settings: PrepBuilderSettings;
}): Promise<OpponentBranchPrepProjection | null> {
  const branchFen = applyPrepSanMove(fen, row.move);
  if (!branchFen || getFenTurn(branchFen) !== userColor) return null;

  const replies = sortOpponentPrepOpenings(await loadOpenings(branchFen), minGames, moveLimit);
  const engineMoves = settings.useCloudEngine
    ? await loadEngineMoves(branchFen, userColor, settings).catch(() => [])
    : [];
  if (replies.length === 0 && engineMoves.length === 0) return null;

  const best = getBestPrepLineReplyImpact({
    replies,
    engineMoves,
    userColor,
    settings,
  });
  const baseStrength = best?.lineStrength ?? best?.strength ?? null;
  if (!best || !baseStrength) return null;

  const label = `After ${best.move}`;
  return {
    responseMove: best.move,
    label,
    strength: withBranchProjectionStrengthDetail(baseStrength, label, row.move),
    lineImpact: null,
  };
}

function withBranchProjectionStrengthDetail(
  strength: PrepMoveStrength,
  label: string,
  opponentMove: string,
): PrepMoveStrength {
  return {
    ...strength,
    detail: `${label}: best available prep-side reply after ${opponentMove}.\n\n${strength.detail}`,
  };
}

function getAfterPrepStrengthMap({
  openings,
  engineMoves,
  side,
  settings,
  getImpact,
  getAfterScore,
}: {
  openings: Opening[];
  engineMoves: PrepBuilderEngineMove[];
  side: PrepColor;
  settings: PrepBuilderSettings;
  getImpact: (opening: Opening) => OpponentPrepLineImpact | null;
  getAfterScore: (impact: OpponentPrepLineImpact) => number;
}) {
  const impactedMoves = new Set<string>();
  const afterPrepOpenings = openings.map((opening) => {
    const impact = getImpact(opening);
    if (!impact) return opening;

    impactedMoves.add(normalizePrepBuilderSan(opening.move));
    const score = clampPrepScore(getAfterScore(impact));
    const total = getAfterPrepImpactGames(impact, score) ?? getOpeningTotal(opening);
    return createOpeningFromSideScore({
      move: opening.move,
      side,
      score,
      total,
      lastPlayed: opening.lastPlayed,
    });
  });

  const fullMap = getPrepMoveStrengthMap({
    openings: afterPrepOpenings,
    engineMoves,
    side,
    settings,
  });
  return new Map([...fullMap].filter(([move]) => impactedMoves.has(move)));
}

function createOpeningFromSideScore({
  move,
  side,
  score,
  total,
  lastPlayed,
}: {
  move: string;
  side: PrepColor;
  score: number;
  total: number;
  lastPlayed?: string | null;
}): Opening {
  const safeTotal = Math.max(1, Math.round(total));
  const sideWins = Math.max(0, Math.min(safeTotal, Math.round(score * safeTotal)));
  const sideLosses = safeTotal - sideWins;

  return {
    move,
    white: side === "white" ? sideWins : sideLosses,
    draw: 0,
    black: side === "black" ? sideWins : sideLosses,
    lastPlayed,
  };
}

function getAfterPrepImpactGames(impact: OpponentPrepLineImpact, score: number) {
  if (
    impact.continuationUserScore !== null &&
    impact.continuationGames !== null &&
    Math.abs(score - impact.continuationUserScore) < 0.001
  ) {
    return impact.continuationGames;
  }

  if (
    impact.userResponseScore !== null &&
    impact.userResponseGames !== null &&
    Math.abs(score - impact.userResponseScore) < 0.001
  ) {
    return impact.userResponseGames;
  }

  if (
    impact.opponentReplyScore !== null &&
    impact.opponentReplyGames !== null &&
    Math.abs(score - impact.opponentReplyScore) < 0.001
  ) {
    return impact.opponentReplyGames;
  }

  const userScoreForOpponent = 1 - score;
  if (
    impact.opponentReplyScore !== null &&
    impact.opponentReplyGames !== null &&
    Math.abs(userScoreForOpponent - impact.opponentReplyScore) < 0.001
  ) {
    return impact.opponentReplyGames;
  }

  return impact.userGames;
}

function clampPrepScore(value: number) {
  return Math.max(0, Math.min(1, value));
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

function PrepAfterStrengthCell({
  strength,
  label,
  summary,
  context = [],
  loading,
}: {
  strength?: PrepMoveStrength;
  label?: string;
  summary?: string;
  context?: string[];
  loading: boolean;
}) {
  if (!strength) {
    return (
      <Text size="xs" c="dimmed">
        {loading ? "Checking" : "-"}
      </Text>
    );
  }

  const tooltip = [
    summary ??
      `${label || "After prep"} ${strength.score}: recalculated with your conditional prep line.`,
    ...context,
    strength.detail,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <Tooltip label={tooltip} multiline w={320}>
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
        {label ? (
          <Text size="xs" c="teal" fw={700} truncate>
            {label}
          </Text>
        ) : null}
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

function PrepCoachReportPanel({
  brief,
  cacheKey,
  autoRunKey,
  onPlayLine,
  onClear,
}: {
  brief: PrepCoachReportBrief;
  cacheKey: string;
  autoRunKey: string | null;
  onPlayLine: (moves: string[]) => void;
  onClear: () => void;
}) {
  const safeCandidates = brief.candidates.filter((candidate) => candidate.status === "safe");
  const visibleCandidates = [
    ...safeCandidates,
    ...brief.candidates.filter((candidate) => candidate.status !== "safe"),
  ].slice(0, 6);
  const userLabel = getPrepColorLabel(brief.userColor);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  return (
    <Alert color="blue" variant="light" mt="xs">
      <Stack gap={8}>
        <Group justify="space-between" gap="xs" wrap="wrap">
          <Group gap={6} wrap="wrap">
            <Text size="sm" fw={700}>
              Coach report
            </Text>
            <Badge color="blue" variant="light">
              {userLabel}
            </Badge>
            <Badge variant="light">{safeCandidates.length} safe candidates</Badge>
            <Badge variant="light">{brief.checkedPositions} checked</Badge>
          </Group>
          <Tooltip label="Clear coach report">
            <ActionIcon variant="subtle" size="sm" onClick={onClear}>
              <IconX size="0.9rem" />
            </ActionIcon>
          </Tooltip>
        </Group>

        <PlanCoachInline
          request={brief.request}
          cacheKey={cacheKey}
          disabled={brief.candidates.length === 0}
          actionLabel="Write report"
          refreshLabel="Refresh report"
          autoRunKey={autoRunKey}
          modelOverride="gemini-3.1-pro-preview"
          loadingLabel="Writing natural-language report with Gemini 3.1 Pro..."
        />

        <Group justify="space-between" gap="xs" wrap="wrap">
          <Text size="xs" c="dimmed">
            Evidence packet sent to the coach
          </Text>
          <Button
            variant="subtle"
            size="compact-xs"
            rightSection={
              evidenceOpen ? <IconChevronUp size="0.85rem" /> : <IconChevronDown size="0.85rem" />
            }
            onClick={() => setEvidenceOpen((open) => !open)}
          >
            {evidenceOpen ? "Hide evidence" : "Show evidence"}
          </Button>
        </Group>

        <Collapse in={evidenceOpen}>
          <Table
            withTableBorder
            horizontalSpacing="xs"
            verticalSpacing={4}
            style={{ tableLayout: "fixed" }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: "34%" }}>Line</Table.Th>
                <Table.Th style={{ width: "18%" }}>Status</Table.Th>
                <Table.Th style={{ width: "16%" }}>Strength</Table.Th>
                <Table.Th>Evidence</Table.Th>
                <Table.Th style={{ width: 54 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visibleCandidates.map((candidate) => (
                <Table.Tr key={candidate.id}>
                  <Table.Td>
                    <Text size="sm" fw={700} style={{ wordBreak: "break-word" }}>
                      {formatPrepCoachCandidateLine(candidate, brief.startLine)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {formatPrepGamePlanShare(candidate.share)} / {formatNumber(candidate.games)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      variant="light"
                      color={getPrepCoachStatusColor(candidate.status)}
                    >
                      {getPrepCoachStatusLabel(candidate.status)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {candidate.strength ? `Now ${candidate.strength.score}` : "Now -"}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {candidate.afterPrepStrength
                        ? `After ${candidate.afterPrepStrength.score}`
                        : "After -"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={2}>
                      {formatPrepCoachCandidateShortEvidence(candidate)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="Play candidate line">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={candidate.line.length <= brief.startLine.length}
                        onClick={() => onPlayLine(candidate.line)}
                      >
                        <IconPlayerPlay size="0.95rem" />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Collapse>
      </Stack>
    </Alert>
  );
}

function PrepGamePlanBriefPanel({
  brief,
  general,
  userColor,
  onPlayLine,
  onClear,
}: {
  brief: PrepGamePlanBrief;
  general: boolean;
  userColor: PrepColor;
  onPlayLine: (moves: string[]) => void;
  onClear: () => void;
}) {
  const mainMoves = brief.mainLine.map((step) => step.move);
  const fullMainLine = brief.mainLine.at(-1)?.line ?? brief.startLine;
  const opponentLabel = general ? "Source" : "Opponent";
  const userLabel = userColor === "white" ? "White" : "Black";

  return (
    <Alert color="teal" variant="light" mt="xs">
      <Stack gap={8}>
        <Group justify="space-between" gap="xs" wrap="wrap">
          <Group gap={6} wrap="wrap">
            <Text size="sm" fw={700}>
              Game plan
            </Text>
            <Badge color="teal" variant="light">
              {userLabel}
            </Badge>
            <Badge variant="light">{brief.checkedPositions} checked</Badge>
          </Group>
          <Group gap={4} wrap="nowrap">
            {mainMoves.length > 0 ? (
              <Button
                variant="default"
                size="xs"
                leftSection={<IconPlayerPlay size="0.85rem" />}
                onClick={() => onPlayLine(fullMainLine)}
              >
                Play main
              </Button>
            ) : null}
            <Tooltip label="Clear game plan">
              <ActionIcon variant="subtle" size="sm" onClick={onClear}>
                <IconX size="0.9rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Stack gap={3}>
          {brief.insights.slice(0, 3).map((insight) => (
            <Text key={insight} size="xs">
              {insight}
            </Text>
          ))}
        </Stack>

        <Box>
          <Text size="xs" c="dimmed">
            Main route
          </Text>
          <Text size="sm" fw={700} style={{ wordBreak: "break-word" }}>
            {mainMoves.length > 0 ? mainMoves.join(" ") : "No supported route found"}
          </Text>
        </Box>

        {brief.replies.length > 0 ? (
          <Table
            withTableBorder
            horizontalSpacing="xs"
            verticalSpacing={4}
            style={{ tableLayout: "fixed" }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: "22%" }}>{opponentLabel}</Table.Th>
                <Table.Th style={{ width: "22%" }}>Answer</Table.Th>
                <Table.Th>Why</Table.Th>
                <Table.Th style={{ width: 54 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {brief.replies.map((reply) => {
                const line = [
                  ...reply.positionLine,
                  reply.opponentMove,
                  ...(reply.responseMove ? [reply.responseMove] : []),
                ];
                return (
                  <Table.Tr key={`${reply.positionLine.join(" ")}|${reply.opponentMove}`}>
                    <Table.Td>
                      <Text size="sm" fw={700}>
                        {reply.opponentMove}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {formatPrepGamePlanShare(reply.share)} / {formatNumber(reply.games)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={700}>
                        {reply.responseMove ?? "-"}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {reply.positionLine.length > brief.startLine.length
                          ? `after ${reply.positionLine.slice(brief.startLine.length).join(" ")}`
                          : "from start"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{reply.note}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="Play this answer">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          disabled={!reply.responseMove}
                          onClick={() => onPlayLine(line)}
                        >
                          <IconPlayerPlay size="0.95rem" />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        ) : null}
      </Stack>
    </Alert>
  );
}

function PrepStraightLineSettingsButton({
  controlSize,
  mode,
  minShare,
  minCp,
  maxPly,
  userColor,
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
  userColor: PrepColor;
  onModeChange: (value: PrepStraightLineSearchMode) => void;
  onMinShareChange: (value: number) => void;
  onMinCpChange: (value: number) => void;
  onMaxPlyChange: (value: number) => void;
}) {
  const userColorLabel = getPrepColorLabel(userColor);

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
          <Tooltip label="Strict finds rare railroad lines; Venom finds repeated positions that are good for your prep side">
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
          <Tooltip
            label={
              mode === "venom"
                ? `Venom requires their habitual move to reach this engine edge for ${userColorLabel}.`
                : `Strict requires the final searched position to reach this engine edge for ${userColorLabel}.`
            }
          >
            <NumberInput
              label={`Min ${userColorLabel} edge`}
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
  userColor,
  onPlay,
  onClear,
}: {
  result: PrepStraightLineSearchResult | null;
  status: PrepStraightLineStatus | null;
  running: boolean;
  qualifies: boolean;
  mode: PrepStraightLineSearchMode;
  minCp: number;
  userColor: PrepColor;
  onPlay: () => void;
  onClear: () => void;
}) {
  const opponentSteps = result?.steps.filter((step) => step.actor === "opponent") ?? [];
  const resultCp = result?.bestOpportunityCpForUser ?? null;
  const userColorLabel = getPrepColorLabel(userColor);
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
                  {formatPrepStraightLineEval(resultCp)} for {userColorLabel}
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
                  ? `Engine target met: habitual position reaches at least ${formatPrepStraightLineEval(minCp)} for ${userColorLabel}.`
                  : `Engine target met: final edge is at least ${formatPrepStraightLineEval(minCp)} for ${userColorLabel}.`
                : mode === "venom"
                  ? `Best habit position is below the ${formatPrepStraightLineEval(minCp)} ${userColorLabel} target; try a lower habit rate, deeper search, or a later prep start.`
                  : `Best line is below the ${formatPrepStraightLineEval(minCp)} ${userColorLabel} target; try a lower forced rate, deeper search, or a later prep start.`}
              {result.leafBestMove ? ` Best next move: ${result.leafBestMove}.` : ""}
              {mode === "venom" && result.targetMove && result.targetPositionCpForUser !== null
                ? ` Venom point: after ${result.targetMove}, the position is ${formatPrepStraightLineEval(result.targetPositionCpForUser)} for ${userColorLabel}.`
                : ""}
            </Text>
            {opponentSteps.length > 0 ? (
              <Group gap={4} wrap="wrap">
                {opponentSteps.slice(0, 6).map((step, index) => (
                  <Badge key={`${step.fen}-${step.move}-${index}`} variant="outline" color="orange">
                    {step.move} {formatPrepStraightLineShare(step.share ?? 0)}
                    {step.total !== null ? ` / ${formatNumber(step.total)}` : ""}
                    {step.engineCpForUser !== null
                      ? `, ${formatPrepStraightLineEval(step.engineCpForUser)} for ${userColorLabel}`
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

function formatPrepGamePlanShare(share: number) {
  const percent = Math.max(0, Math.min(1, share)) * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function getPrepColorLabel(color: PrepColor) {
  return color === "white" ? "White" : "Black";
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
  const lineImpact = stats.preparedLineImpact;
  const lineImpactScore = lineImpact ? getPreparedLineImpactComparisonScore(lineImpact) : null;

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
        <Text size="xs" c={lineImpact ? "teal" : "dimmed"} fw={lineImpact ? 700 : 400} truncate>
          {lineImpact && lineImpactScore !== null
            ? `Prep helps: opp score ${formatPrepScorePercent(lineImpact.surfaceScore)} -> ${formatPrepScorePercent(lineImpactScore)}`
            : `${Math.round(stats.replyCoverage * 100)}% replies - ${stats.depthPly} ply`}
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
    ...preparedLineImpactTooltipLines(stats.preparedLineImpact),
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

function preparedLineImpactTooltipLines(impact: OpponentPrepLineImpact | null, general = false) {
  if (!impact) return [];

  const sourceSide = general ? "source side" : "opponent";
  const lines = [
    `Prepared line helps: ${sourceSide} score drops by ${formatPrepScorePointDrop(impact.scoreDrop)}.`,
    `Surface: ${sourceSide} scored ${formatPrepScorePercent(impact.surfaceScore)} from ${formatNumber(impact.surfaceGames)} games after this move.`,
    `After your ${impact.userMove}: ${sourceSide} scored ${formatPrepScorePercent(impact.userScore)} from ${formatNumber(impact.userGames)} games (${formatPrepScorePercent(impact.userShare)} of this branch).`,
  ];

  if (
    impact.opponentReplyMove &&
    impact.opponentReplyScore !== null &&
    impact.opponentReplyGames !== null &&
    impact.opponentReplyShare !== null
  ) {
    lines.push(
      `${general ? "Source side's" : "Their"} usual next ${impact.opponentReplyMove}: ${formatPrepScorePercent(impact.opponentReplyShare)} of replies, ${sourceSide} scored ${formatPrepScorePercent(impact.opponentReplyScore)} from ${formatNumber(impact.opponentReplyGames)} games.`,
    );
  }

  return lines;
}

function branchPrepProjectionTooltipLines(
  projection: OpponentBranchPrepProjection,
  general: boolean,
) {
  const sourceLabel = general ? "source move" : "opponent move";
  const lines = [
    `Projected reply: ${projection.responseMove}. This is scored from the position after the ${sourceLabel}, even if no line has been saved.`,
  ];

  if (projection.lineImpact) {
    lines.push(candidateLineImpactTooltip(projection.lineImpact, general));
  }

  return lines.filter(Boolean);
}

function candidateLineImpactTooltip(impact: OpponentPrepLineImpact, general = false) {
  if (impact.continuationMoves.length === 0) {
    return "";
  }

  const sourceSide = general ? "source side" : "opponent";
  const prepSide = general ? "prep side" : "your side";
  const lines = [
    `Nearby prep line after ${impact.userMove}: ${impact.continuationMoves.join(" ")}.`,
  ];

  if (impact.continuationStrengthScore !== null) {
    lines.push(
      `Future move strength: ${impact.continuationStrengthScore} for the prep-side reply in that line.`,
    );
  }

  if (impact.continuationLineScore !== null) {
    lines.push(
      `Projected line value: ${impact.continuationLineScore}, capped by the actual future WDL/eval so a locally best bad position is not overrated.`,
    );
  }

  if (impact.continuationUserScore !== null && impact.continuationGames !== null) {
    lines.push(
      `Database evidence there: ${prepSide} scores ${formatPrepScorePercent(impact.continuationUserScore)} over ${formatNumber(impact.continuationGames)} games, compared with ${sourceSide} ${formatPrepScorePercent(impact.surfaceScore)} over ${formatNumber(impact.surfaceGames)} after ${impact.userMove}.`,
    );
  }

  if (
    impact.opponentReplyMove &&
    impact.opponentReplyScore !== null &&
    impact.opponentReplyGames !== null &&
    impact.opponentReplyShare !== null
  ) {
    lines.push(
      `First ${sourceSide} reply ${impact.opponentReplyMove}: ${formatPrepScorePercent(impact.opponentReplyShare)} of replies, ${sourceSide} scored ${formatPrepScorePercent(impact.opponentReplyScore)} over ${formatNumber(impact.opponentReplyGames)} games.`,
    );
  }

  if (impact.continuationDepthPly > 2) {
    lines.push(
      `Deeper strength is discounted by depth and ${sourceSide} path frequency, so it will not override a stronger near-term signal by itself.`,
    );
  }

  return lines.join("\n");
}

function formatCandidateAfterPrepLabel(impact: OpponentPrepLineImpact) {
  if (impact.continuationMoves.length > 0) {
    const visibleMoves = impact.continuationMoves.slice(0, 2).join(" ");
    const suffix = impact.continuationMoves.length > 2 ? " ..." : "";
    return `After ${visibleMoves}${suffix}`;
  }
  if (impact.opponentReplyMove) return `After ${impact.opponentReplyMove}`;
  return "After prep";
}

function getPreparedLineImpactComparisonScore(impact: OpponentPrepLineImpact) {
  if (
    impact.opponentReplyScore !== null &&
    impact.opponentReplyShare !== null &&
    impact.opponentReplyShare >= 0.4 &&
    impact.surfaceScore - impact.opponentReplyScore >= 0.12
  ) {
    return impact.opponentReplyScore;
  }

  return impact.userScore;
}

function formatPrepScorePercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatPrepScorePointDrop(value: number) {
  return `${Math.round(value * 100)} points`;
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
  switch (source) {
    case "local-lichess":
      return 0;
    case "lichess":
      return 1;
    case "chessdb":
      return 2;
  }
}

function formatPrepBuilderChoiceComment(
  choice: PrepBuilderMoveChoice,
  afterPrepStrength?: PrepMoveStrength | null,
) {
  const reasons = choice.reasons.map((reason) => `${reason}.`);
  if (afterPrepStrength) {
    reasons.unshift(`After prep: ${afterPrepStrength.score}.`);
  }
  return reasons.join(" ");
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
  return Math.max(PREP_STRENGTH_MOVE_POOL_LIMIT, Math.min(100, moveLimit));
}

function getPrepBuilderBranchSearchMoveLimit(settings: PrepBuilderSettings) {
  return Math.max(100, settings.opponentMoveLimit);
}

function getPrepBuilderEngineMultipv(settings: PrepBuilderSettings) {
  return Math.max(3, Math.min(8, settings.opponentMoveLimit + 3));
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
