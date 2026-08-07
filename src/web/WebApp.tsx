import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@/styles/global.css";

import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Collapse,
  Code,
  createTheme,
  Group,
  Loader,
  MantineProvider,
  MultiSelect,
  NumberInput,
  Popover,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications, Notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconArrowsSort,
  IconBook,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronsLeft,
  IconChevronsRight,
  IconChess,
  IconCloudDownload,
  IconCpu,
  IconDatabase,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconPinned,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconSwitchVertical,
  IconTarget,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { isNormal, makeSquare, parseSquare, parseUci } from "chessops";
import { chessgroundDests } from "chessops/compat";
import { INITIAL_FEN } from "chessops/fen";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { positionFromFen } from "@/utils/chessops";
import { formatMoveThinkTime } from "@/utils/clock";
import { getDefaultAiCoachQuestion } from "@/utils/aiCoachParity";
import {
  COACH_MODEL_SELECT_DATA,
  COACH_MODEL_STORAGE_KEY,
  COACH_REASONING_STORAGE_KEY,
  formatCoachModelSelection,
  getCoachModelDefinition,
  getCoachReasoningSelectData,
  normalizeCoachModelId,
  normalizeCoachReasoningEffort,
  type CoachModelId,
  type CoachReasoningEffort,
} from "@/utils/coachModels";
import { getWinChance, normalizeScore } from "@/utils/score";
import {
  loadSharedLichessCredential,
  saveSharedLichessCredential,
} from "@/utils/sharedLichessAuth";
import {
  normalizePrepBuilderSettings,
  type PrepBuilderEngineMove,
  type PrepBuilderSettings,
} from "@/utils/opponentPrep";
import DatabaseFolderSelect from "@/components/common/DatabaseFolderSelect";
import classes from "./WebApp.module.css";
import {
  askWebChessCoach,
  createWebCoachReviewRecord,
  getDefaultWebCoachScope,
  getWebChessCoachHealth,
  getWebChessCoachProgress,
  getWebCoachBookHeading,
  getWebCoachBookPdfUrl,
  getWebCoachContextKey,
  getWebCoachLineContextKey,
  getWebCoachMoves,
  getWebCoachStorageKey,
  getSavedWebCoachReviewStatus,
  linkWebCoachGameMoves,
  makeWebCoachMovetext,
  persistWebCoachReviewInState,
  rebaseWebCoachReviewLineContext,
  restoreWebCoachReview,
  saveWebCoachReview,
  webCoachLineMatchesSourceGame,
  type RestoredWebCoachReview,
  type WebCoachBookPassage,
  type WebCoachCategory,
  type WebChessCoachHealth,
  type WebChessCoachProgress,
  type WebChessCoachResponse,
} from "./chessCoach";
import {
  DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS,
  DEFAULT_WEB_MASTERS_EXPLORER_OPTIONS,
  fetchWebExplorerMoveStats,
  normalizeWebLichessExplorerOptions,
  normalizeWebMastersExplorerOptions,
  WEB_LICHESS_EXPLORER_RATINGS,
  WEB_LICHESS_EXPLORER_SPEEDS,
  type WebDatabaseExplorerSource,
  type WebExplorerOptions,
  type WebLichessExplorerOptions,
  type WebMastersExplorerOptions,
} from "./explorer";
import {
  filterWebDatabasesByHostedAvailability,
  filterWebSourceDatabases,
  getWebDatabaseHostedPathFromSourceStorageValue,
  getWebDatabaseSourceStorageValue,
  getReusableHostedDatabaseImport,
  mergeImportedWebDatabases,
  needsHostedDatabaseRefresh,
  resolveWebDatabaseSourceId,
} from "./databaseSync";
import {
  getHostedDatabasePositionIndexManifest,
  fetchHostedDatabasePositionMoves,
  type WebHostedPositionMove,
} from "./hostedDatabaseIndex";
import {
  getHostedRawFileUrl,
  getHostedDatabaseFolders,
  getHostedPgnFilesInPath,
  getHostedWebLibrary,
  getHostedWebLibraryPath,
  getHostedWebLibraryScope,
  readHostedPgnFolder,
  readHostedPgnFile,
  type WebHostedDatabaseFolder,
  type WebHostedFileEntry,
  type WebHostedFileListResponse,
  type WebHostedFolderReadProgress,
  type WebHostedLibrary,
} from "./hostedFiles";
import type {
  WebBoardState,
  WebCoachReviewRecord,
  WebColor,
  WebCompanionState,
  WebDatabase,
  WebEngineLine,
  WebGame,
  WebImportResult,
  WebLocalGameFilters,
  WebLocalResultFilter,
  WebPrepCandidateSortColumn,
  WebPrepLineMove,
  WebPrepMode,
  WebPrepMoveSortDefaults,
  WebPrepOpponentSortColumn,
  WebPrepSource,
  WebPrepTemporarySource,
  WebPrepWorkspace,
} from "./model";
import { getWebMovePanelBranchLine, getWebMovePanelDisplayLines } from "./movePanel";
import {
  fetchWebOnlineGames,
  getWebOnlineImportTitle,
  getWebOnlineRangeLabel,
  getWebOnlineSourceLabel,
  type WebOnlineImportedGame,
  type WebOnlineImportMode,
  type WebOnlineRangePreset,
  type WebOnlineSource,
} from "./onlineImport";
import {
  completeWebLichessLoginIfPresent,
  startWebLichessLogin,
  WEB_LICHESS_TOKEN_STORAGE_KEY,
} from "./lichessAuth";
import { queryWebLichessCloudEngineMoves } from "./lichessCloud";
import {
  getWebLiveReplayProgress,
  getWebLiveReplayStep,
  type WebLiveReplayProgress,
} from "./liveReplay";
import {
  collectGamesForSources,
  findFirstWebPrepOpponentBranch,
  findWebPrepBranchStart,
  getFirstOpenPrepStat,
  getWebDatabaseGamesForPosition,
  getWebDatabaseMoveStats,
  getWebHostedPositionMoveStats,
  getGamesForWebPrepSource,
  getDatabasePlayerCounts,
  filterWebGamesByLocalFilters,
  getWebDatabaseTitlePlayerName,
  getNextOpenPrepStat,
  getWebPrepBranchCoverageStats,
  getWebPrepMoveKey,
  getWebPrepMoveStats,
  getWebPrepStrengthSideForFen,
  sortWebDatabaseMoveStats,
  type WebPrepBranchCoverageStats,
  type WebPrepBranchStart,
  type WebDatabaseStatsSort,
  type WebDatabasePositionGame,
  type WebPrepMoveStat,
} from "./prepIndex";
import {
  applyWebPrepModeChange,
  applyWebPrepSourceChange,
  isWebPrepCandidateSortColumn,
  isWebPrepOpponentSortColumn,
  getWebPrepSelectedLocalSourceId,
  getWebPrepWorkspacePatchFromSelection,
  getWebPrepWorkspaceName,
  normalizeWebPrepMoveSortDefaults,
  WEB_PREP_CANDIDATE_SORT_OPTIONS,
  WEB_PREP_OPPONENT_SORT_OPTIONS,
  type WebPrepSetupSelection,
} from "./prepSettings";
import {
  formatWebDate,
  getFenColor,
  getWebGameReplayTiming,
  normalizeWebFen,
  oppositeWebColor,
  parsePgnDatabase,
  playSanMove,
  playUciMove,
  webGameToLine,
  webGameToRootLines,
} from "./pgn";
import {
  createEmptyWebBoardState,
  createEmptyWebState,
  loadWebState,
  saveWebState,
} from "./storage";
import {
  getWebBoardPlayerLabels,
  getWebBoardSourceTitle,
  type WebBoardPlayerLabel,
} from "./boardTitle";
import { formatWebEngineScore } from "./engineScore";
import OnlineGameAnalysisPanel from "./OnlineGameAnalysisPanel";
import StatsWorkspace from "./StatsWorkspace";
import { getWebOnlineAnalysisTitle, getWebOnlinePlayerColor } from "./onlineAnalysis";
import { analyzeWithWebStockfish18, stopWebStockfish18Search } from "./stockfishEngine";

type ViewMode = "board" | "stats" | "files";
type BoardPanelMode = "moves" | "online" | "database" | "prep" | "engine" | "coach";
type WebHostedPgnImportHandler = (entry: WebHostedFileEntry) => Promise<WebImportResult | null>;
type WebHostedFolderImportHandler = (
  library: WebHostedLibrary,
  path: string,
  options?: WebHostedFolderImportOptions,
) => Promise<WebImportResult | null>;
type WebHostedFolderImportOptions = {
  openFirstGame?: boolean;
  onProgress?: (progress: WebHostedFolderReadProgress | null) => void;
};
type WebOnlineImportHandler = (request: {
  source: WebOnlineSource;
  username: string;
  mode: WebOnlineImportMode;
  count: number;
  range: WebOnlineRangePreset;
  saveDatabase?: boolean;
  setProgress: (progress: number | null) => void;
}) => Promise<WebImportResult | null>;
type WebOnlineAnalysisHandler = (game: WebOnlineImportedGame) => Promise<WebGame | null>;
type WebPrepBranchStatus = "new" | "started" | "prepared" | "skipped";
type WebPrepSortDirection = "asc" | "desc";
type WebPrepSortColumn = WebPrepOpponentSortColumn;
type WebPrepSortState<TColumn extends WebPrepSortColumn = WebPrepSortColumn> = {
  column: TColumn;
  direction: WebPrepSortDirection;
};

const WEB_LICHESS_ALL_SOURCE_VALUE = "web-source:lichess-all";
const WEB_LICHESS_MASTERS_SOURCE_VALUE = "web-source:lichess-masters";
const WEB_TEMPORARY_PREP_SOURCE_VALUE = "web-source:temporary-prep";
const WEB_DATABASE_PANEL_SOURCE_STORAGE_KEY = "en-croissant-web-database-panel-source";
const WEB_DATABASE_PANEL_LOCAL_STORAGE_KEY = "en-croissant-web-database-panel-local-source";
const WEB_DATABASE_PANEL_PLAYER_STORAGE_KEY = "en-croissant-web-database-panel-player";
const WEB_DATABASE_PANEL_COLOR_STORAGE_KEY = "en-croissant-web-database-panel-color";
const WEB_DATABASE_PANEL_START_DATE_STORAGE_KEY = "en-croissant-web-database-panel-start-date";
const WEB_DATABASE_PANEL_END_DATE_STORAGE_KEY = "en-croissant-web-database-panel-end-date";
const WEB_DATABASE_PANEL_RESULT_STORAGE_KEY = "en-croissant-web-database-panel-result";
const WEB_DATABASE_PANEL_VIEW_STORAGE_KEY = "en-croissant-web-database-panel-view";
const WEB_DATABASE_PANEL_SORT_STORAGE_KEY = "en-croissant-web-database-panel-sort";
const WEB_DATABASE_PANEL_STRENGTH_STORAGE_KEY = "en-croissant-web-database-panel-strength";
const WEB_DATABASE_PANEL_STAGE_STORAGE_KEY = "en-croissant-web-database-panel-stage";
const WEB_LICHESS_EXPLORER_OPTIONS_STORAGE_KEY = "en-croissant-web-lichess-explorer-options";
const WEB_MASTERS_EXPLORER_OPTIONS_STORAGE_KEY = "en-croissant-web-masters-explorer-options";
const WEB_PREP_SETUP_STORAGE_KEY = "en-croissant-web-prep-setup";
const WEB_ENGINE_PANEL_SETTINGS_STORAGE_KEY = "en-croissant-web-engine-panel-settings";
const WEB_DATABASE_STATS_SORT_OPTIONS: { label: string; value: WebDatabaseStatsSort }[] = [
  { label: "Blended strength", value: "strengthHigh" },
  { label: "Blended weakness", value: "strengthLow" },
  { label: "Engine strength", value: "engineHigh" },
  { label: "Engine weakness", value: "engineLow" },
  { label: "Best WDL", value: "wdlHigh" },
  { label: "Worst WDL", value: "wdlLow" },
  { label: "Most played", value: "games" },
  { label: "Fewest played", value: "gamesLow" },
  { label: "Most recent", value: "recent" },
  { label: "Oldest played", value: "oldest" },
  { label: "Highest score", value: "scoreHigh" },
  { label: "Lowest score", value: "scoreLow" },
  { label: "Move", value: "move" },
  { label: "Move descending", value: "moveDesc" },
];
type WebPrepSortSelectOption<TColumn extends WebPrepSortColumn = WebPrepSortColumn> = {
  label: string;
  value: string;
  sort: WebPrepSortState<TColumn>;
};
const WEB_PREP_STARTED_OPPONENT_SORT_OPTIONS: WebPrepSortSelectOption<WebPrepOpponentSortColumn>[] =
  [
    {
      label: "Blended strength",
      value: "strength:desc",
      sort: { column: "strength", direction: "desc" },
    },
    {
      label: "Blended weakness",
      value: "strength:asc",
      sort: { column: "strength", direction: "asc" },
    },
    { label: "Most played", value: "games:desc", sort: { column: "games", direction: "desc" } },
    { label: "Fewest played", value: "games:asc", sort: { column: "games", direction: "asc" } },
    {
      label: "Best results",
      value: "results:desc",
      sort: { column: "results", direction: "desc" },
    },
    { label: "Worst results", value: "results:asc", sort: { column: "results", direction: "asc" } },
    { label: "Best covered", value: "prep:desc", sort: { column: "prep", direction: "desc" } },
    { label: "Needs prep", value: "prep:asc", sort: { column: "prep", direction: "asc" } },
    { label: "Open first", value: "state:desc", sort: { column: "state", direction: "desc" } },
    { label: "Move A-Z", value: "move:asc", sort: { column: "move", direction: "asc" } },
    { label: "Move Z-A", value: "move:desc", sort: { column: "move", direction: "desc" } },
  ];
const WEB_PREP_STARTED_CANDIDATE_SORT_OPTIONS: WebPrepSortSelectOption<WebPrepCandidateSortColumn>[] =
  [
    {
      label: "Blended strength",
      value: "strength:desc",
      sort: { column: "strength", direction: "desc" },
    },
    {
      label: "Blended weakness",
      value: "strength:asc",
      sort: { column: "strength", direction: "asc" },
    },
    { label: "Most played", value: "games:desc", sort: { column: "games", direction: "desc" } },
    { label: "Fewest played", value: "games:asc", sort: { column: "games", direction: "asc" } },
    { label: "Best WDL", value: "results:desc", sort: { column: "results", direction: "desc" } },
    { label: "Worst WDL", value: "results:asc", sort: { column: "results", direction: "asc" } },
    { label: "Move A-Z", value: "move:asc", sort: { column: "move", direction: "asc" } },
    { label: "Move Z-A", value: "move:desc", sort: { column: "move", direction: "desc" } },
  ];
const DEFAULT_WEB_PREP_MIN_GAMES = 1;
const DEFAULT_WEB_PREP_MOVE_LIMIT = 12;
const WEB_ENGINE_ARROW_LARGE_BRUSH = 11;
const WEB_ENGINE_ARROW_MEDIUM_BRUSH = 7.5;
const WEB_ENGINE_ARROW_SMALL_BRUSH = 4;
const WEB_ENGINE_ARROW_WIN_CHANCE_LIMIT = 10;
const WEB_ENGINE_ARROW_COLOR = { strong: "blue", pale: "paleBlue" } as const;

type WebEnginePanelSettings = {
  enabled: boolean;
  useCloud: boolean;
  multipv: number;
  depth: number;
  infinite: boolean;
};

const DEFAULT_WEB_ENGINE_PANEL_SETTINGS: WebEnginePanelSettings = {
  enabled: false,
  useCloud: false,
  multipv: 3,
  depth: 14,
  infinite: false,
};

type WebPrepStoredSetup = {
  mode: WebPrepMode;
  source: WebPrepSource;
  sourceId: string | null;
  sourceRef?: string | null;
  opponent: string;
  userColor: WebColor;
  startDate?: string;
  endDate?: string;
  result: WebLocalResultFilter;
  minGames: number;
  moveLimit: number;
  builder: Partial<PrepBuilderSettings>;
  sortDefaults: WebPrepMoveSortDefaults;
};

const DEFAULT_WEB_PREP_SETUP: WebPrepStoredSetup = {
  mode: "player",
  source: "local",
  sourceId: null,
  sourceRef: null,
  opponent: "",
  userColor: "white",
  result: "any",
  minGames: DEFAULT_WEB_PREP_MIN_GAMES,
  moveLimit: DEFAULT_WEB_PREP_MOVE_LIMIT,
  builder: {
    mode: "practical",
    useCloudEngine: true,
    useLichessAll: false,
  },
  sortDefaults: {
    opponent: "games",
    candidate: "strength",
  },
};

const theme = createTheme({
  primaryColor: "blue",
  colors: {
    dark: [
      "#C1C2C5",
      "#A6A7AB",
      "#909296",
      "#5c5f66",
      "#373A40",
      "#2C2E33",
      "#25262b",
      "#1A1B1E",
      "#141517",
      "#101113",
    ],
  },
});

export default function WebApp() {
  const [state, setState] = useState<WebCompanionState>(() => createEmptyWebState());
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<ViewMode>("board");
  const [boardPanelMode, setBoardPanelMode] = useState<BoardPanelMode>("moves");
  const [importing, setImporting] = useState(false);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [lichessToken, setLichessToken] = usePersistentString(WEB_LICHESS_TOKEN_STORAGE_KEY, "");
  const lichessTokenAtStartup = useRef(lichessToken);
  const saveReady = useRef(false);
  const coachMigrationStarted = useRef(false);

  useEffect(() => {
    void loadWebState()
      .then((saved) => {
        setState(saved);
        setSelectedDatabaseId(saved.databases[0]?.id ?? null);
        setLoaded(true);
      })
      .catch((error) => {
        console.error(error);
        setLoaded(true);
        notifications.show({
          title: "Storage unavailable",
          message: "The web companion opened without saved browser data.",
          color: "red",
        });
      });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!saveReady.current) {
      saveReady.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveWebState(state).catch((error) => {
        console.error(error);
        notifications.show({
          title: "Save failed",
          message: "Browser storage rejected the latest change.",
          color: "red",
        });
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [loaded, state]);

  useEffect(() => {
    if (!loaded || coachMigrationStarted.current) return;
    coachMigrationStarted.current = true;
    const newestByGame = new Map<string, WebCoachReviewRecord>();
    const candidates = [
      state.board.coachReview,
      ...Object.values(state.gamesByDatabase).flatMap((games) =>
        games.map((game) => game.coachReview),
      ),
    ];
    for (const review of candidates) {
      if (!review) continue;
      const storageKey = getWebCoachStorageKey(review.lineContextKey);
      const previous = newestByGame.get(storageKey);
      if (!previous || review.savedAt > previous.savedAt) newestByGame.set(storageKey, review);
    }
    if (newestByGame.size === 0) return;
    void (async () => {
      for (const [storageKey, review] of newestByGame) {
        try {
          await saveWebCoachReview(review, storageKey);
        } catch (migrationError) {
          console.error("Could not migrate a saved coach review to the PC.", migrationError);
        }
      }
    })();
  }, [loaded, state]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}web-sw.js`).catch((error) => {
      console.warn("Web companion service worker registration failed", error);
    });
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const result = await completeWebLichessLoginIfPresent();
        if (result.status === "complete") {
          if (active) setLichessToken(result.token);
          await saveSharedLichessCredential(result.token);
          notifications.show({
            title: "Lichess connected",
            message: "This Lichess sign-in is now shared permanently with your apps.",
            color: "green",
          });
          return;
        }
        if (result.status === "error") {
          notifications.show({
            title: "Lichess login failed",
            message: result.message,
            color: "red",
          });
          return;
        }

        const shared = await loadSharedLichessCredential();
        if (shared) {
          if (active) setLichessToken(shared.token);
          return;
        }

        const existingToken = lichessTokenAtStartup.current.trim();
        if (existingToken) await saveSharedLichessCredential(existingToken);
      } catch (error) {
        console.warn("Shared Lichess sign-in is temporarily unavailable.", error);
      }
    })();

    return () => {
      active = false;
    };
  }, [setLichessToken]);

  const activePrep = useMemo(
    () => state.prepWorkspaces.find((prep) => prep.id === state.activePrepId) ?? null,
    [state.activePrepId, state.prepWorkspaces],
  );
  const loadGameOnBoard = useCallback(
    (game: WebGame, options: { cursor?: number; orientation?: WebColor } = {}) => {
      setState((current) => ({
        ...current,
        activePrepId: null,
        board: {
          orientation: options.orientation ?? "white",
          startFen: game.moves[0]?.fenBefore ?? INITIAL_FEN,
          line: webGameToLine(game),
          cursor: clampCursor(options.cursor ?? game.moves.length, game.moves.length),
          sourceTitle: getWebBoardSourceTitle(game, current.databases),
          sourceDatabaseId: game.databaseId,
          sourceGameId: game.id,
          sourceComments: game.comments ?? [],
        },
      }));
      setSelectedDatabaseId(game.databaseId);
      setSelectedGameId(game.id);
      setView("board");
    },
    [],
  );

  const openEmptyBoard = useCallback(() => {
    setState((current) => ({
      ...current,
      activePrepId: null,
      board: {
        ...createEmptyWebBoardState(),
        sourceTitle: "Analysis board",
      },
    }));
    setSelectedGameId(null);
    setView("board");
  }, []);

  const addImportedDatabases = useCallback(
    (imported: WebImportResult[]) => {
      setState((current) => mergeImportedWebDatabases(current, imported));
      setSelectedDatabaseId(imported[0]?.database.id ?? selectedDatabaseId);
    },
    [selectedDatabaseId],
  );

  const importPgnText = useCallback(
    async ({
      name,
      pgn,
      notificationTitle,
      notificationMessage,
      databasePatch,
      openFirstGame = true,
    }: {
      name: string;
      pgn: string;
      notificationTitle: string;
      notificationMessage?: (result: WebImportResult) => string;
      databasePatch?: Partial<WebDatabase>;
      openFirstGame?: boolean;
    }) => {
      const parsed = parsePgnDatabase(name, pgn);
      const imported: WebImportResult = {
        ...parsed,
        database: {
          ...parsed.database,
          sourceKind: "source",
          ...databasePatch,
        },
      };
      addImportedDatabases([imported]);
      if (openFirstGame && imported.games[0]) {
        window.setTimeout(() => loadGameOnBoard(imported.games[0]), 0);
      }

      notifications.show({
        title: notificationTitle,
        message:
          notificationMessage?.(imported) ?? `${pluralWeb(imported.games.length, "game")} ready.`,
        color: "green",
      });

      return imported;
    },
    [addImportedDatabases, loadGameOnBoard],
  );

  const importOnlineGameForAnalysis = useCallback<WebOnlineAnalysisHandler>(
    async (onlineGame) => {
      const title = getWebOnlineAnalysisTitle(onlineGame);
      const imported = await importPgnText({
        name: title,
        pgn: onlineGame.pgn,
        notificationTitle: "Game ready to analyze",
        notificationMessage: () =>
          `${getWebOnlineSourceLabel(onlineGame.source)} ${onlineGame.username} opened with Stockfish.`,
        databasePatch: {
          sourceKind: "opened-file",
        },
        openFirstGame: false,
      });
      const game = imported.games[0];
      if (!game) throw new Error("This online game did not contain readable moves.");

      loadGameOnBoard(game, {
        cursor: 0,
        orientation: getWebOnlinePlayerColor(onlineGame),
      });
      return game;
    },
    [importPgnText, loadGameOnBoard],
  );

  const importFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setImporting(true);

      try {
        const imported: WebImportResult[] = [];
        for (const file of Array.from(files)) {
          const text = await file.text();
          const parsed = parsePgnDatabase(file.name, text);
          imported.push({
            ...parsed,
            database: {
              ...parsed.database,
              sourceKind: parsed.games.length === 1 ? "opened-file" : "source",
            },
          });
        }

        addImportedDatabases(imported);
        const firstGame = imported[0]?.games[0];
        if (firstGame) {
          window.setTimeout(() => loadGameOnBoard(firstGame), 0);
        }

        notifications.show({
          title: "PGN opened",
          message: `${pluralWeb(
            imported.reduce((sum, result) => sum + result.games.length, 0),
            "game",
          )} ready.`,
          color: "green",
        });
      } catch (error) {
        console.error(error);
        notifications.show({
          title: "Import failed",
          message: "The selected PGN could not be parsed.",
          color: "red",
        });
      } finally {
        setImporting(false);
      }
    },
    [addImportedDatabases, loadGameOnBoard],
  );

  const importHostedPgn = useCallback(
    async (entry: WebHostedFileEntry) => {
      setImporting(true);
      try {
        const file = await readHostedPgnFile(entry);
        const imported = await importPgnText({
          name: file.filename,
          pgn: file.content,
          notificationTitle: "Hosted file opened",
          notificationMessage: (imported) =>
            `${pluralWeb(imported.games.length, "game")} opened from ${file.filename}.`,
          databasePatch: {
            sourceKind: "opened-file",
            hostedFilePath: entry.path,
          },
        });
        return imported;
      } catch (error) {
        console.error(error);
        notifications.show({
          title: "Could not open file",
          message: error instanceof Error ? error.message : "The hosted file could not be read.",
          color: "red",
        });
      } finally {
        setImporting(false);
      }
      return null;
    },
    [importPgnText],
  );

  const importHostedFolder = useCallback(
    async (library: WebHostedLibrary, path: string, options: WebHostedFolderImportOptions = {}) => {
      setImporting(true);
      try {
        const hostedFiles = getHostedPgnFilesInPath(library, path);
        if (hostedFiles.length === 0) {
          throw new Error("This hosted folder does not contain PGN files.");
        }
        const reusableImport = getReusableHostedDatabaseImport({
          state,
          hostedPath: path,
          files: hostedFiles,
        });
        if (reusableImport) {
          notifications.show({
            title: "Hosted database already loaded",
            message: `${reusableImport.database.name} is ready to use.`,
            color: "blue",
          });
          return reusableImport;
        }

        const folder = await readHostedPgnFolder(library, path, (progress) => {
          options.onProgress?.(progress);
        });
        const latestHostedUpdate = Math.max(...hostedFiles.map((file) => file.lastModified), 0);
        const imported = await importPgnText({
          name: folder.filename,
          pgn: folder.content,
          notificationTitle: "Hosted database opened",
          notificationMessage: (imported) =>
            `${pluralWeb(imported.games.length, "game")} loaded from ${pluralWeb(
              folder.files.length,
              "hosted PGN",
            )}.`,
          databasePatch: {
            hostedPath: folder.path,
            hostedUpdatedAt: latestHostedUpdate,
          },
          openFirstGame: options.openFirstGame ?? true,
        });
        return imported;
      } catch (error) {
        console.error(error);
        notifications.show({
          title: "Could not open folder",
          message: error instanceof Error ? error.message : "The hosted folder could not be read.",
          color: "red",
        });
      } finally {
        options.onProgress?.(null);
        setImporting(false);
      }
      return null;
    },
    [importPgnText, state.databases, state.gamesByDatabase],
  );

  const openHostedDatabaseSource = useCallback(
    async (library: WebHostedLibrary, path: string, options: WebHostedFolderImportOptions = {}) => {
      setImporting(true);
      try {
        const hostedFiles = getHostedPgnFilesInPath(library, path);
        if (hostedFiles.length === 0) {
          throw new Error("This hosted folder does not contain PGN files.");
        }

        const reusableImport = getReusableHostedDatabaseImport({
          state,
          hostedPath: path,
          files: hostedFiles,
        });
        if (reusableImport) {
          notifications.show({
            title: "Hosted database already loaded",
            message: `${reusableImport.database.name} is ready to use.`,
            color: "blue",
          });
          return reusableImport;
        }

        const manifest = await getHostedDatabasePositionIndexManifest(path);
        if (!manifest) {
          return await importHostedFolder(library, path, options);
        }

        const normalizedPath = normalizeHostedDatabasePath(path);
        const latestHostedUpdate = Math.max(...hostedFiles.map((file) => file.lastModified), 0);
        const name = getHostedDatabaseLeafLabel(normalizedPath);
        const now = Date.now();
        const imported: WebImportResult = {
          database: {
            id: createHostedDatabaseId(normalizedPath),
            name: `${name}.pgn`,
            sourceKind: "source",
            hostedPath: normalizedPath,
            hostedLazy: true,
            hostedUpdatedAt: latestHostedUpdate,
            importedAt: now,
            updatedAt: now,
            gameCount: manifest.gameCount,
            sizeBytes: hostedFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
            latestDate: manifest.latestDate ?? null,
            playerNames: [],
          },
          games: [],
          warnings: [],
        };

        addImportedDatabases([imported]);
        notifications.show({
          title: "Hosted database ready",
          message: `${formatDatabasePickerLabel(imported.database.name)} will lazy-load one board position at a time.`,
          color: "green",
        });
        return imported;
      } catch (error) {
        console.error(error);
        notifications.show({
          title: "Could not open database",
          message:
            error instanceof Error ? error.message : "The hosted database could not be read.",
          color: "red",
        });
      } finally {
        options.onProgress?.(null);
        setImporting(false);
      }
      return null;
    },
    [addImportedDatabases, importHostedFolder, state],
  );

  const importOnlineGames = useCallback(
    async ({
      source,
      username,
      mode,
      count,
      range,
      saveDatabase = true,
      setProgress,
    }: Parameters<WebOnlineImportHandler>[0]) => {
      setImporting(true);
      setProgress(0);
      try {
        const games = await fetchWebOnlineGames({
          source,
          username,
          mode,
          count,
          range,
          onProgress: (loaded, expected) => {
            const denominator = expected && expected > 0 ? expected : count;
            setProgress(Math.min(100, Math.round((loaded / denominator) * 100)));
          },
        });
        if (games.length === 0) {
          throw new Error(
            `${getWebOnlineSourceLabel(source)} did not return public PGNs for ${username}.`,
          );
        }

        const title = getWebOnlineImportTitle({ source, username, mode, count, range });
        const pgn = games.map((game) => game.pgn.trim()).join("\n\n");
        const imported = saveDatabase
          ? await importPgnText({
              name: `${title}.pgn`,
              pgn,
              notificationTitle: "Online games imported",
              notificationMessage: (imported) =>
                `${pluralWeb(
                  imported.games.length,
                  `${getWebOnlineSourceLabel(source)} game`,
                )} ready for ${username}.`,
            })
          : parsePgnDatabase(`${title}.pgn`, pgn);
        if (!saveDatabase) {
          notifications.show({
            title: "Prep source ready",
            message: `${pluralWeb(
              imported.games.length,
              `${getWebOnlineSourceLabel(source)} game`,
            )} ${imported.games.length === 1 ? "is" : "are"} available for this prep.`,
            color: "green",
          });
        }
        setProgress(100);
        return imported;
      } catch (error) {
        console.error(error);
        notifications.show({
          title: "Online import failed",
          message: error instanceof Error ? error.message : "Could not import public online games.",
          color: "red",
        });
      } finally {
        setImporting(false);
        window.setTimeout(() => setProgress(null), 700);
      }
      return null;
    },
    [importPgnText],
  );

  return (
    <MantineProvider defaultColorScheme="dark" theme={theme}>
      <Notifications />
      <Box className={classes.shell}>
        <Box className={classes.header}>
          <Box className={classes.headerInner}>
            <Box className={classes.brand}>
              <Group gap="xs" wrap="nowrap">
                <IconChess className={classes.brandIcon} size={24} />
                <Title order={3} className={classes.brandTitle} lh={1.1}>
                  En Croissant
                </Title>
              </Group>
            </Box>
            <Group className={classes.headerActions} justify="flex-end" gap="xs" wrap="nowrap">
              <SegmentedControl
                aria-label="Workspace"
                className={classes.headerNav}
                size="xs"
                value={
                  view === "files"
                    ? "files"
                    : view === "stats"
                      ? "stats"
                      : boardPanelMode === "online"
                        ? "online"
                        : "board"
                }
                onChange={(value) => {
                  if (value === "files" || value === "stats") {
                    setView(value);
                    return;
                  }

                  setView("board");
                  setBoardPanelMode(value === "online" ? "online" : "moves");
                }}
                data={[
                  { value: "board", label: "Board" },
                  { value: "stats", label: "Stats" },
                  { value: "files", label: "Files" },
                  { value: "online", label: "Online" },
                ]}
              />
              <Button
                aria-label="Import PGN files"
                className={classes.headerImportButton}
                color="blue"
                component="label"
                title="Import PGN files"
                size="xs"
                leftSection={<IconUpload size={15} />}
                loading={importing}
                variant="light"
              >
                Import
                <input
                  hidden
                  multiple
                  type="file"
                  accept=".pgn,application/x-chess-pgn,text/plain"
                  onChange={(event) => {
                    void importFiles(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
              </Button>
            </Group>
          </Box>
        </Box>

        <main className={classes.main}>
          {!loaded ? (
            <Center h="60svh">
              <Stack align="center" gap="xs">
                <Loader />
                <Text size="sm" c="dimmed">
                  Opening web workspace
                </Text>
              </Stack>
            </Center>
          ) : view === "board" ? (
            <BoardWorkspace
              state={state}
              setState={setState}
              activePrep={activePrep}
              importHostedFolder={openHostedDatabaseSource}
              importOnlineGameForAnalysis={importOnlineGameForAnalysis}
              importOnlineGames={importOnlineGames}
              loadGameOnBoard={loadGameOnBoard}
              onStartBlankBoard={openEmptyBoard}
              lichessToken={lichessToken}
              panelMode={boardPanelMode}
              setPanelMode={setBoardPanelMode}
            />
          ) : view === "stats" ? (
            <StatsWorkspace lichessToken={lichessToken} />
          ) : (
            <FilesWorkspace
              importHostedPgn={importHostedPgn}
              importHostedFolder={importHostedFolder}
            />
          )}
        </main>
      </Box>
    </MantineProvider>
  );
}

function BoardWorkspace({
  state,
  setState,
  activePrep,
  importHostedFolder,
  importOnlineGameForAnalysis,
  importOnlineGames,
  loadGameOnBoard,
  onStartBlankBoard,
  lichessToken,
  panelMode,
  setPanelMode,
}: {
  state: WebCompanionState;
  setState: Dispatch<SetStateAction<WebCompanionState>>;
  activePrep: WebPrepWorkspace | null;
  importHostedFolder: WebHostedFolderImportHandler;
  importOnlineGameForAnalysis: WebOnlineAnalysisHandler;
  importOnlineGames: WebOnlineImportHandler;
  loadGameOnBoard: (game: WebGame) => void;
  onStartBlankBoard: () => void;
  lichessToken: string;
  panelMode: BoardPanelMode;
  setPanelMode: Dispatch<SetStateAction<BoardPanelMode>>;
}) {
  const [onlineAnalysisRequestId, setOnlineAnalysisRequestId] = useState(0);
  const [coachReviewRunning, setCoachReviewRunning] = useState(false);
  const [engineArrowAnalysis, setEngineArrowAnalysis] = useState<{
    fen: string;
    lines: WebEngineLine[];
  } | null>(null);
  const [liveReplay, setLiveReplay] = useState(false);
  const [liveReplayRemainingMs, setLiveReplayRemainingMs] = useState<number | null>(null);
  const liveReplayTimeoutRef = useRef<number | null>(null);
  const liveReplayTickRef = useRef<number | null>(null);
  const board = state.board ?? createEmptyWebBoardState();
  const baseOrientation = activePrep?.userColor ?? board.orientation;
  const [orientationOverride, setOrientationOverride] = useState<WebColor | null>(null);
  useEffect(() => {
    setOrientationOverride(null);
  }, [activePrep?.id, baseOrientation, board.sourceDatabaseId, board.sourceGameId, board.startFen]);
  const activeLine = activePrep?.line ?? board.line;
  const startFen = activePrep?.startFen ?? board.startFen;
  const cursor = clampCursor(board.cursor, activeLine.length);
  const currentFen = fenAtCursor(activeLine, cursor, startFen);
  const currentLine = activeLine.slice(0, cursor);
  const upcomingEngineFens = useMemo(
    () => activeLine.slice(cursor, cursor + 3).map((move) => move.fenAfter),
    [activeLine, cursor],
  );
  const sourceGame = useMemo(() => {
    if (activePrep || !board.sourceDatabaseId || !board.sourceGameId) return null;
    return (
      (state.gamesByDatabase[board.sourceDatabaseId] ?? []).find(
        (game) => game.id === board.sourceGameId,
      ) ?? null
    );
  }, [activePrep, board.sourceDatabaseId, board.sourceGameId, state.gamesByDatabase]);
  const liveReplayTiming = useMemo(
    () => (sourceGame ? getWebGameReplayTiming(sourceGame) : {}),
    [sourceGame],
  );
  const liveReplayStep = useMemo(
    () =>
      getWebLiveReplayStep({
        line: activeLine,
        cursor,
        timing: liveReplayTiming,
      }),
    [activeLine, cursor, liveReplayTiming],
  );
  const initialLiveReplayStep = useMemo(
    () =>
      getWebLiveReplayStep({
        line: activeLine,
        cursor: 0,
        timing: liveReplayTiming,
      }),
    [activeLine, liveReplayTiming],
  );
  const liveReplayCurrentMoveElapsedMs =
    liveReplay && liveReplayStep && liveReplayRemainingMs !== null
      ? liveReplayStep.delayMs - liveReplayRemainingMs
      : 0;
  const liveReplayProgress = useMemo(
    () =>
      getWebLiveReplayProgress({
        line: activeLine,
        cursor,
        timing: liveReplayTiming,
        currentMoveElapsedMs: liveReplayCurrentMoveElapsedMs,
      }),
    [activeLine, cursor, liveReplayCurrentMoveElapsedMs, liveReplayTiming],
  );
  const clearLiveReplayTimers = useCallback(() => {
    if (liveReplayTimeoutRef.current !== null) {
      window.clearTimeout(liveReplayTimeoutRef.current);
      liveReplayTimeoutRef.current = null;
    }
    if (liveReplayTickRef.current !== null) {
      window.clearInterval(liveReplayTickRef.current);
      liveReplayTickRef.current = null;
    }
  }, []);
  const stopLiveReplay = useCallback(() => {
    clearLiveReplayTimers();
    setLiveReplay(false);
    setLiveReplayRemainingMs(null);
  }, [clearLiveReplayTimers]);

  useEffect(() => {
    if (!liveReplay) {
      clearLiveReplayTimers();
      setLiveReplayRemainingMs(null);
      return;
    }
    if (!liveReplayStep) {
      stopLiveReplay();
      return;
    }

    clearLiveReplayTimers();
    const deadline = window.performance.now() + liveReplayStep.delayMs;
    setLiveReplayRemainingMs(liveReplayStep.delayMs);
    liveReplayTickRef.current = window.setInterval(() => {
      setLiveReplayRemainingMs(Math.max(0, deadline - window.performance.now()));
    }, 100);
    liveReplayTimeoutRef.current = window.setTimeout(() => {
      clearLiveReplayTimers();
      setLiveReplayRemainingMs(0);
      setState((current) => {
        const currentBoard = {
          ...createEmptyWebBoardState(),
          ...current.board,
        };
        return {
          ...current,
          board: {
            ...currentBoard,
            cursor: clampCursor(currentBoard.cursor + 1, currentBoard.line.length),
          },
        };
      });
    }, liveReplayStep.delayMs);

    return clearLiveReplayTimers;
  }, [clearLiveReplayTimers, liveReplay, liveReplayStep, setState, stopLiveReplay]);

  useEffect(() => {
    return () => {
      clearLiveReplayTimers();
    };
  }, [clearLiveReplayTimers]);

  useEffect(() => {
    stopLiveReplay();
  }, [activeLine, sourceGame?.id, stopLiveReplay]);
  const coachFallbackSourceIdentity = sourceGame
    ? null
    : activePrep
      ? `prep:${activePrep.id}`
      : board.sourceGameId
        ? `game:${board.sourceGameId}`
        : board.sourceDatabaseId
          ? `database:${board.sourceDatabaseId}:${board.sourceTitle ?? ""}`
          : null;
  const coachLineContextKey = useMemo(
    () =>
      getWebCoachLineContextKey(sourceGame, activeLine, currentFen, coachFallbackSourceIdentity),
    [activeLine, coachFallbackSourceIdentity, currentFen, sourceGame],
  );
  const persistedCoachReview = sourceGame?.coachReview ?? board.coachReview ?? null;
  const sourceRootLines = useMemo(
    () => (sourceGame ? webGameToRootLines(sourceGame) : []),
    [sourceGame],
  );
  const prepRootPly = activePrep ? clampCursor(activePrep.rootPly ?? 0, activeLine.length) : 0;
  const prepRootFen = fenAtCursor(activeLine, prepRootPly, startFen);
  const prepRootLine = activeLine.slice(0, prepRootPly);
  const prepBranchStart = activePrep
    ? findWebPrepBranchStart({
        line: activeLine,
        rootPly: prepRootPly,
        rootFen: prepRootFen,
        userColor: activePrep.userColor,
        currentPly: cursor,
      })
    : null;
  const prepBranchPly = prepBranchStart?.branchPly ?? prepRootPly;
  const prepBranchFen =
    activePrep && prepBranchStart ? fenAtCursor(activeLine, prepBranchPly, startFen) : null;
  const prepMinGames = activePrep?.minGames ?? DEFAULT_WEB_PREP_MIN_GAMES;
  const prepMoveLimit = activePrep?.moveLimit ?? DEFAULT_WEB_PREP_MOVE_LIMIT;
  const prepGames = useMemo(
    () => getGamesForWebPrepSource({ gamesByDatabase: state.gamesByDatabase, prep: activePrep }),
    [activePrep, state.gamesByDatabase],
  );
  const [prepEngineMoves, setPrepEngineMoves] = useState<PrepBuilderEngineMove[]>([]);
  const [prepRootEngineMoves, setPrepRootEngineMoves] = useState<PrepBuilderEngineMove[]>([]);
  const prepStatsBase = useMemo(
    () =>
      getWebPrepMoveStats({ games: prepGames, prep: activePrep, fen: currentFen })
        .filter((stat) => stat.total >= prepMinGames)
        .slice(0, prepMoveLimit),
    [activePrep, currentFen, prepGames, prepMinGames, prepMoveLimit],
  );
  const prepRootStatsBase = useMemo(
    () =>
      activePrep && prepBranchFen
        ? getWebPrepMoveStats({ games: prepGames, prep: activePrep, fen: prepBranchFen })
            .filter((stat) => stat.total >= prepMinGames)
            .slice(0, prepMoveLimit)
        : [],
    [activePrep, prepBranchFen, prepGames, prepMoveLimit, prepMinGames],
  );
  const prepStats = useMemo(
    () =>
      getWebPrepMoveStats({
        games: prepGames,
        prep: activePrep,
        fen: currentFen,
        engineMoves: prepEngineMoves,
      })
        .filter((stat) => stat.total >= prepMinGames)
        .slice(0, prepMoveLimit),
    [activePrep, currentFen, prepEngineMoves, prepGames, prepMinGames, prepMoveLimit],
  );
  const prepRootStats = useMemo(
    () =>
      activePrep && prepBranchFen
        ? getWebPrepMoveStats({
            games: prepGames,
            prep: activePrep,
            fen: prepBranchFen,
            engineMoves: prepRootEngineMoves,
          })
            .filter((stat) => stat.total >= prepMinGames)
            .slice(0, prepMoveLimit)
        : [],
    [activePrep, prepBranchFen, prepGames, prepMoveLimit, prepMinGames, prepRootEngineMoves],
  );
  const handleEngineAnalysisLinesChange = useCallback((fen: string, lines: WebEngineLine[]) => {
    // Keep the previous score available while the next position is waiting on
    // cache/live analysis. Arrows remain FEN-scoped below, so stale moves are
    // never drawn on the new position.
    if (lines.length > 0) setEngineArrowAnalysis({ fen, lines });
  }, []);
  const engineArrowShapes = useMemo(
    () =>
      engineArrowAnalysis?.fen === currentFen
        ? getWebEngineArrowShapes(engineArrowAnalysis.lines, currentFen)
        : [],
    [currentFen, engineArrowAnalysis],
  );

  useEffect(() => {
    const settings = normalizeWebPrepStrengthSettings(activePrep?.builder);
    if (!activePrep || !settings.useCloudEngine || prepStatsBase.length === 0) {
      setPrepEngineMoves([]);
      return;
    }

    const controller = new AbortController();
    let active = true;
    void queryWebLichessCloudEngineMoves({
      fen: currentFen,
      side: getWebPrepStrengthSideForFen(currentFen, activePrep.userColor),
      moves: prepStatsBase.map((stat) => stat.move),
      multipv: prepStatsBase.length,
      signal: controller.signal,
    })
      .then((moves) => {
        if (active) setPrepEngineMoves(moves);
      })
      .catch(() => {
        if (active) setPrepEngineMoves([]);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [activePrep, currentFen, prepStatsBase]);

  useEffect(() => {
    const settings = normalizeWebPrepStrengthSettings(activePrep?.builder);
    if (
      !activePrep ||
      !prepBranchFen ||
      !settings.useCloudEngine ||
      prepRootStatsBase.length === 0
    ) {
      setPrepRootEngineMoves([]);
      return;
    }

    const controller = new AbortController();
    let active = true;
    void queryWebLichessCloudEngineMoves({
      fen: prepBranchFen,
      side: getWebPrepStrengthSideForFen(prepBranchFen, activePrep.userColor),
      moves: prepRootStatsBase.map((stat) => stat.move),
      multipv: prepRootStatsBase.length,
      signal: controller.signal,
    })
      .then((moves) => {
        if (active) setPrepRootEngineMoves(moves);
      })
      .catch(() => {
        if (active) setPrepRootEngineMoves([]);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [activePrep, prepBranchFen, prepRootStatsBase]);
  const turnColor = getFenColor(currentFen);
  const boardTitle = activePrep
    ? prepBoardTitle(activePrep)
    : (board.sourceTitle ?? (state.databases.length > 0 ? "Analysis board" : "Board"));

  const updateBoard = (patch: Partial<WebBoardState>) => {
    setState((current) => ({
      ...current,
      board: {
        ...createEmptyWebBoardState(),
        ...current.board,
        ...patch,
      },
    }));
  };

  const setCursor = (nextCursor: number) => {
    stopLiveReplay();
    updateBoard({ cursor: clampCursor(nextCursor, activeLine.length) });
  };

  const canGoToPreviousMove = cursor > 0;
  const canGoToNextMove = cursor < activeLine.length;
  const goToPreviousMove = () => {
    if (canGoToPreviousMove) setCursor(cursor - 1);
  };
  const goToNextMove = () => {
    if (canGoToNextMove) setCursor(cursor + 1);
  };

  const updateActivePrep = (updater: (prep: WebPrepWorkspace) => WebPrepWorkspace) => {
    if (!activePrep) return;
    setState((current) => ({
      ...current,
      prepWorkspaces: current.prepWorkspaces.map((prep) =>
        prep.id === activePrep.id ? updater(prep) : prep,
      ),
    }));
  };

  const chooseMovePanelLine = (nextLine: WebPrepLineMove[], nextCursor = nextLine.length) => {
    const cursor = clampCursor(nextCursor, nextLine.length);

    if (activePrep) {
      updateActivePrep((prep) => ({
        ...prep,
        line: nextLine,
        rootPly: Math.min(prep.rootPly ?? 0, nextLine.length),
        updatedAt: Date.now(),
      }));
      updateBoard({
        cursor,
        sourceTitle: prepBoardTitle(activePrep),
        sourceDatabaseId: null,
        sourceGameId: null,
      });
      return;
    }

    updateBoard({
      line: nextLine,
      cursor,
      sourceTitle: board.sourceTitle ?? "Analysis board",
    });
  };

  const appendMoveAtCursor = (
    san: string,
    uci: string | null,
    fenAfter: string,
    sourceCursor = cursor,
  ) => {
    const fenBefore = fenAtCursor(activeLine, sourceCursor, startFen);
    const actor =
      activePrep && getFenColor(fenBefore) === activePrep.userColor ? "user" : "opponent";
    const move: WebPrepLineMove = {
      fenBefore,
      fenAfter,
      san,
      uci,
      actor,
    };

    if (activePrep) {
      const nextLine = [...activeLine.slice(0, sourceCursor), move];
      updateActivePrep((prep) => ({
        ...prep,
        line: nextLine,
        rootPly: Math.min(prep.rootPly ?? 0, nextLine.length),
        updatedAt: Date.now(),
      }));
      updateBoard({
        cursor: nextLine.length,
        sourceTitle: prepBoardTitle(activePrep),
        sourceDatabaseId: null,
        sourceGameId: null,
      });
      return;
    }

    const nextLine = [...activeLine.slice(0, sourceCursor), move];
    updateBoard({
      line: nextLine,
      cursor: nextLine.length,
      sourceTitle: board.sourceTitle ?? "Analysis board",
    });
  };

  const appendMove = (san: string, uci: string | null, fenAfter: string) => {
    appendMoveAtCursor(san, uci, fenAfter, cursor);
  };

  const playMove = (stat: WebPrepMoveStat) => {
    const played = playSanMove(currentFen, stat.move);
    if (!played) return;
    appendMove(played.san, played.uci, played.fenAfter);
  };

  const playEngineMove = (uci: string) => {
    const played = playUciMove(currentFen, uci);
    if (!played) return;
    appendMove(played.san, played.uci, played.fenAfter);
  };

  const analyzeOnlineGame = async (onlineGame: WebOnlineImportedGame) => {
    const game = await importOnlineGameForAnalysis(onlineGame);
    if (!game) return;
    setPanelMode("engine");
    setOnlineAnalysisRequestId((requestId) => requestId + 1);
  };

  const playMoveFromPrepRoot = (stat: WebPrepMoveStat) => {
    if (!prepBranchFen) return;
    const played = playSanMove(prepBranchFen, stat.move);
    if (!played) return;
    appendMoveAtCursor(played.san, played.uci, played.fenAfter, prepBranchPly);
  };

  const handleBoardMove = (uci: string) => {
    stopLiveReplay();
    const played = playUciMove(currentFen, uci);
    if (!played) return;
    appendMove(played.san, played.uci, played.fenAfter);
  };

  const canStartLiveReplay = Boolean(
    liveReplayStep ||
    (cursor === activeLine.length && activeLine.length > 0 && initialLiveReplayStep),
  );
  const toggleLiveReplay = () => {
    if (liveReplay) {
      stopLiveReplay();
      return;
    }
    if (!canStartLiveReplay) return;
    if (!liveReplayStep) {
      updateBoard({ cursor: 0 });
    }
    setLiveReplay(true);
  };

  const activeLastMove = cursor > 0 ? (activeLine[cursor - 1]?.uci ?? null) : null;
  const orientation = orientationOverride ?? baseOrientation;
  const isViewingFile = !activePrep && Boolean(board.sourceDatabaseId || board.sourceGameId);
  const boardPlayers = sourceGame ? getWebBoardPlayerLabels(sourceGame, orientation) : null;
  const flipBoard = () => {
    setOrientationOverride((current) => oppositeWebColor(current ?? baseOrientation));
  };
  const resetBoard = () => {
    setOrientationOverride(null);
    if (activePrep) {
      setCursor(prepRootPly);
    } else if (isViewingFile) {
      setCursor(0);
    } else {
      onStartBlankBoard();
    }
  };

  return (
    <Box className={classes.phoneBoard}>
      <Box className={classes.boardHeader}>
        {!boardPlayers ? (
          <Box className={classes.boardHeaderTitle}>
            <Title order={2} className={classes.truncateTitle} title={boardTitle}>
              {boardTitle}
            </Title>
          </Box>
        ) : null}
        <Group className={classes.boardHeaderActions} gap={6} wrap="nowrap">
          <Badge
            aria-label={`${turnColor === "white" ? "White" : "Black"} to move`}
            className={classes.turnBadge}
            color="gray"
            variant="light"
          >
            <span className={classes.turnDot} data-color={turnColor} />
            {turnColor === "white" ? "White" : "Black"}
            <span className={classes.turnSuffix}> to move</span>
          </Badge>
          <Tooltip label="Reset board">
            <ActionIcon
              aria-label="Reset board"
              className={classes.boardHeaderAction}
              color="gray"
              onClick={resetBoard}
              radius="md"
              size="md"
              variant="subtle"
            >
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Flip board">
            <ActionIcon
              aria-label="Flip board"
              className={classes.boardHeaderAction}
              color="gray"
              onClick={flipBoard}
              radius="md"
              size="md"
              variant="subtle"
            >
              <IconSwitchVertical size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>

      <Box className={classes.boardPlayerStack}>
        {boardPlayers ? <BoardPlayerRow player={boardPlayers.top} /> : null}
        <WebChessboard
          fen={currentFen}
          orientation={orientation}
          lastMoveUci={activeLastMove}
          engineArrowShapes={engineArrowShapes}
          engineScore={engineArrowAnalysis?.lines[0]?.score ?? null}
          onMove={handleBoardMove}
          canGoToPreviousMove={canGoToPreviousMove}
          canGoToNextMove={canGoToNextMove}
          onPreviousMove={goToPreviousMove}
          onNextMove={goToNextMove}
        />
        {boardPlayers ? <BoardPlayerRow player={boardPlayers.bottom} /> : null}
      </Box>

      <BoardMoveControls
        currentMove={cursor}
        totalMoves={activeLine.length}
        canGoToPreviousMove={canGoToPreviousMove}
        canGoToNextMove={canGoToNextMove}
        onFirstMove={() => setCursor(0)}
        onLastMove={() => setCursor(activeLine.length)}
        onPreviousMove={goToPreviousMove}
        onNextMove={goToNextMove}
        liveReplay={liveReplay}
        liveReplayStepSeconds={liveReplayStep?.moveTimeSeconds ?? null}
        liveReplayRemainingMs={liveReplayRemainingMs}
        liveReplayProgress={liveReplayProgress}
        canStartLiveReplay={canStartLiveReplay}
        onToggleLiveReplay={toggleLiveReplay}
      />

      <BoardStartActions activeMode={panelMode} onChooseMode={setPanelMode} />

      <Box className={classes.underBoardPanel}>
        <Box className={classes.underBoardContent}>
          {/* Keep one engine instance mounted across every panel so changing
              tabs cannot abort an active PC search. */}
          <EngineUnderBoardPanel
            analysisRequestId={onlineAnalysisRequestId}
            compact={panelMode !== "engine"}
            currentFen={currentFen}
            upcomingFens={upcomingEngineFens}
            onAnalysisLinesChange={handleEngineAnalysisLinesChange}
            onPlayMove={playEngineMove}
            suspended={coachReviewRunning}
          />

          {panelMode !== "engine" ? (
            <Box className={classes.underBoardTabContent}>
              {panelMode === "moves" ? (
                <MovesUnderBoardPanel
                  line={activeLine}
                  cursor={cursor}
                  setCursor={setCursor}
                  rootLines={sourceRootLines}
                  onChooseLine={chooseMovePanelLine}
                  sourceComments={activePrep ? [] : (board.sourceComments ?? [])}
                />
              ) : panelMode === "online" ? (
                <OnlineGameAnalysisPanel onAnalyzeGame={analyzeOnlineGame} />
              ) : panelMode === "database" ? (
                <DatabaseUnderBoardPanel
                  currentFen={currentFen}
                  databases={state.databases}
                  gamesByDatabase={state.gamesByDatabase}
                  importHostedFolder={importHostedFolder}
                  onPlayMove={playMove}
                  onOpenSourceGame={loadGameOnBoard}
                  lichessToken={lichessToken}
                />
              ) : panelMode === "prep" ? (
                <PrepUnderBoardPanel
                  state={state}
                  setState={setState}
                  activePrep={activePrep}
                  currentFen={currentFen}
                  stats={prepStats}
                  branchFen={prepBranchFen}
                  branchStart={prepBranchStart}
                  rootStats={prepRootStats}
                  currentLine={currentLine}
                  rootLine={prepRootLine}
                  isInsidePrepLine={!activePrep || cursor >= prepRootPly}
                  onPlayMove={playMove}
                  onPlayRootMove={playMoveFromPrepRoot}
                  onOpenSourceGame={loadGameOnBoard}
                  importHostedFolder={importHostedFolder}
                  importOnlineGames={importOnlineGames}
                  lichessToken={lichessToken}
                />
              ) : (
                <CoachUnderBoardPanel
                  key={coachLineContextKey}
                  sourceGame={sourceGame}
                  fallbackSourceIdentity={coachFallbackSourceIdentity}
                  line={activeLine}
                  currentFen={currentFen}
                  currentLines={
                    engineArrowAnalysis?.fen === currentFen ? engineArrowAnalysis.lines : []
                  }
                  defaultPlayerColor={orientation}
                  persistedReview={persistedCoachReview}
                  onPersistReview={(review) =>
                    setState((current) =>
                      persistWebCoachReviewInState(
                        current,
                        {
                          sourceDatabaseId: activePrep ? null : board.sourceDatabaseId,
                          sourceGameId: activePrep ? null : board.sourceGameId,
                        },
                        review,
                      ),
                    )
                  }
                  onSelectPly={(ply) => setCursor(Math.min(activeLine.length, Math.max(0, ply)))}
                  onReviewRunningChange={setCoachReviewRunning}
                />
              )}
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}

function BoardPlayerRow({ player }: { player: WebBoardPlayerLabel }) {
  return (
    <Box
      className={classes.boardPlayerRow}
      aria-label={`${player.name}, ${player.color}${player.rating ? `, rated ${player.rating}` : ""}`}
    >
      <span className={classes.boardPlayerColor} data-color={player.color} aria-hidden="true" />
      <Text className={classes.boardPlayerName} fw={700} size="sm" title={player.name}>
        {player.name}
      </Text>
      {player.rating ? (
        <Text className={classes.boardPlayerRating} c="dimmed" size="xs">
          {player.rating}
        </Text>
      ) : null}
    </Box>
  );
}

function BoardMoveControls({
  currentMove,
  totalMoves,
  canGoToPreviousMove,
  canGoToNextMove,
  onFirstMove,
  onLastMove,
  onPreviousMove,
  onNextMove,
  liveReplay,
  liveReplayStepSeconds,
  liveReplayRemainingMs,
  liveReplayProgress,
  canStartLiveReplay,
  onToggleLiveReplay,
}: {
  currentMove: number;
  totalMoves: number;
  canGoToPreviousMove: boolean;
  canGoToNextMove: boolean;
  onFirstMove: () => void;
  onLastMove: () => void;
  onPreviousMove: () => void;
  onNextMove: () => void;
  liveReplay: boolean;
  liveReplayStepSeconds: number | null;
  liveReplayRemainingMs: number | null;
  liveReplayProgress: WebLiveReplayProgress | null;
  canStartLiveReplay: boolean;
  onToggleLiveReplay: () => void;
}) {
  const nextMoveSeconds =
    liveReplay && liveReplayRemainingMs !== null
      ? liveReplayRemainingMs / 1000
      : liveReplayStepSeconds;
  const liveReplayTooltip = liveReplay
    ? `Pause live replay${
        nextMoveSeconds !== null ? ` - next move in ${formatMoveThinkTime(nextMoveSeconds)}` : ""
      }`
    : canStartLiveReplay
      ? `Watch at recorded game pace${
          nextMoveSeconds !== null ? ` - next move in ${formatMoveThinkTime(nextMoveSeconds)}` : ""
        }`
      : "Live replay needs recorded move times";
  const gameTimeLeftLabel = liveReplayProgress
    ? formatMoveThinkTime(liveReplayProgress.remainingMs / 1000)
    : "";

  return (
    <Stack className={classes.boardReplayControls} gap={3}>
      <Group
        aria-label={`Move ${currentMove} of ${totalMoves}`}
        className={classes.boardMoveControls}
        gap={2}
        justify="center"
        role="navigation"
        wrap="nowrap"
      >
        <Tooltip label="First move">
          <ActionIcon
            aria-label="First move"
            className={classes.boardMoveButton}
            disabled={!canGoToPreviousMove}
            onClick={onFirstMove}
            radius="xl"
            size="sm"
            variant="subtle"
          >
            <IconChevronsLeft size={17} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Previous move">
          <ActionIcon
            aria-label="Previous move"
            className={classes.boardMoveButton}
            disabled={!canGoToPreviousMove}
            onClick={onPreviousMove}
            radius="xl"
            size="sm"
            variant="subtle"
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={liveReplayTooltip}>
          <ActionIcon
            aria-disabled={!liveReplay && !canStartLiveReplay}
            aria-label={liveReplay ? "Pause live replay" : "Start live replay at recorded pace"}
            aria-pressed={liveReplay}
            className={classes.boardReplayButton}
            data-active={liveReplay}
            data-disabled={!liveReplay && !canStartLiveReplay}
            onClick={onToggleLiveReplay}
            radius="xl"
            size="sm"
            variant="subtle"
          >
            {liveReplay ? <IconPlayerPause size={17} /> : <IconPlayerPlay size={17} />}
          </ActionIcon>
        </Tooltip>
        <Text aria-live="polite" className={classes.boardMoveCount} component="span">
          {currentMove === 0 ? "Start" : `${currentMove} / ${totalMoves}`}
        </Text>
        <Tooltip label="Next move">
          <ActionIcon
            aria-label="Next move"
            className={classes.boardMoveButton}
            disabled={!canGoToNextMove}
            onClick={onNextMove}
            radius="xl"
            size="sm"
            variant="subtle"
          >
            <IconChevronRight size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Last move">
          <ActionIcon
            aria-label="Last move"
            className={classes.boardMoveButton}
            disabled={!canGoToNextMove}
            onClick={onLastMove}
            radius="xl"
            size="sm"
            variant="subtle"
          >
            <IconChevronsRight size={17} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {liveReplay && liveReplayProgress ? (
        <Box className={classes.boardReplayProgress}>
          <Group gap="xs" justify="space-between" wrap="nowrap">
            <Text className={classes.boardReplayStatus} component="span">
              Recorded pace
            </Text>
            <Text className={classes.boardReplayStatus} component="span">
              {gameTimeLeftLabel} left
            </Text>
          </Group>
          <Progress
            aria-label="Live replay game progress"
            color="blue"
            radius="xs"
            size={3}
            value={liveReplayProgress.value}
          />
        </Box>
      ) : null}
    </Stack>
  );
}

function BoardStartActions({
  activeMode,
  onChooseMode,
}: {
  activeMode: BoardPanelMode;
  onChooseMode: (mode: BoardPanelMode) => void;
}) {
  return (
    <Group
      aria-label="Board tools"
      className={classes.boardStartActions}
      gap={2}
      grow
      role="tablist"
    >
      <Button
        aria-label="Moves"
        aria-selected={activeMode === "moves"}
        className={classes.boardModeTab}
        data-active={activeMode === "moves"}
        role="tab"
        size="xs"
        variant="subtle"
        leftSection={<IconPlayerPlay size={14} />}
        onClick={() => onChooseMode("moves")}
      >
        <span>Moves</span>
      </Button>
      <Button
        aria-label="Database"
        aria-selected={activeMode === "database"}
        className={classes.boardModeTab}
        data-active={activeMode === "database"}
        role="tab"
        size="xs"
        variant="subtle"
        leftSection={<IconDatabase size={14} />}
        onClick={() => onChooseMode("database")}
      >
        <span className={classes.boardTabLabelLong}>Database</span>
        <span className={classes.boardTabLabelShort}>DB</span>
      </Button>
      <Button
        aria-label="Prep"
        aria-selected={activeMode === "prep"}
        className={classes.boardModeTab}
        data-active={activeMode === "prep"}
        role="tab"
        size="xs"
        variant="subtle"
        leftSection={<IconTarget size={14} />}
        onClick={() => onChooseMode("prep")}
      >
        <span>Prep</span>
      </Button>
      <Button
        aria-label="Engine"
        aria-selected={activeMode === "engine"}
        className={classes.boardModeTab}
        data-active={activeMode === "engine"}
        role="tab"
        size="xs"
        variant="subtle"
        leftSection={<IconCpu size={14} />}
        onClick={() => onChooseMode("engine")}
      >
        <span>Engine</span>
      </Button>
      <Button
        aria-label="Coach"
        aria-selected={activeMode === "coach"}
        className={classes.boardModeTab}
        data-active={activeMode === "coach"}
        role="tab"
        size="xs"
        variant="subtle"
        leftSection={<IconSparkles size={14} />}
        onClick={() => onChooseMode("coach")}
      >
        <span>Coach</span>
      </Button>
    </Group>
  );
}

function CoachUnderBoardPanel({
  sourceGame,
  fallbackSourceIdentity,
  line,
  currentFen,
  currentLines,
  defaultPlayerColor,
  persistedReview,
  onPersistReview,
  onSelectPly,
  onReviewRunningChange,
}: {
  sourceGame: WebGame | null;
  fallbackSourceIdentity: string | null;
  line: WebPrepLineMove[];
  currentFen: string;
  currentLines: WebEngineLine[];
  defaultPlayerColor: WebColor;
  persistedReview: WebCoachReviewRecord | null | undefined;
  onPersistReview: (review: WebCoachReviewRecord) => void;
  onSelectPly: (ply: number) => void;
  onReviewRunningChange: (running: boolean) => void;
}) {
  const lineContextKey = useMemo(
    () => getWebCoachLineContextKey(sourceGame, line, currentFen, fallbackSourceIdentity),
    [currentFen, fallbackSourceIdentity, line, sourceGame],
  );
  const restoredReview = useMemo(
    () => restoreWebCoachReview(persistedReview, { lineContextKey, currentFen }),
    [currentFen, lineContextKey, persistedReview],
  );
  const [health, setHealth] = useState<WebChessCoachHealth | null>(null);
  const [healthError, setHealthError] = useState("");
  const [storedCoachModel, setStoredCoachModel] = useState<CoachModelId>(() => {
    try {
      return normalizeCoachModelId(window.localStorage.getItem(COACH_MODEL_STORAGE_KEY));
    } catch {
      return normalizeCoachModelId(null);
    }
  });
  const coachModel = getCoachModelDefinition(storedCoachModel);
  const [storedReasoningEffort, setStoredReasoningEffort] = useState<CoachReasoningEffort>(() => {
    try {
      return normalizeCoachReasoningEffort(
        coachModel,
        window.localStorage.getItem(COACH_REASONING_STORAGE_KEY),
      );
    } catch {
      return coachModel.defaultReasoningEffort;
    }
  });
  const reasoningEffort = normalizeCoachReasoningEffort(coachModel, storedReasoningEffort);
  const selectedProviderHealth = health?.providers?.[coachModel.provider];
  const selectedModelAvailable = selectedProviderHealth
    ? selectedProviderHealth.available
    : coachModel.provider === "openai"
      ? Boolean(health?.modelAvailable)
      : false;
  const [playerColor, setPlayerColor] = useState<WebColor>(
    restoredReview?.playerColor ?? defaultPlayerColor,
  );
  const [scope, setScope] = useState<"position" | "whole-game">(
    restoredReview?.scope ?? getDefaultWebCoachScope(sourceGame, line),
  );
  const [question, setQuestion] = useState(
    restoredReview?.question ?? getDefaultWebCoachQuestion(sourceGame, line),
  );
  const [response, setResponse] = useState<WebChessCoachResponse | null>(
    restoredReview?.response ?? null,
  );
  const [responseContextKey, setResponseContextKey] = useState<string | null>(
    restoredReview?.contextKey ?? null,
  );
  const [responseLineContextKey, setResponseLineContextKey] = useState<string | null>(
    restoredReview?.lineContextKey ?? null,
  );
  const [savedReviewAt, setSavedReviewAt] = useState<number | null>(
    restoredReview?.savedAt ?? null,
  );
  const [savedOnPc, setSavedOnPc] = useState(false);
  const [persistenceError, setPersistenceError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [backgroundReviewRunning, setBackgroundReviewRunning] = useState(false);
  const [progress, setProgress] = useState<WebChessCoachProgress | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(
    restoredReview?.response.categories[0]?.id ?? null,
  );
  const healthRequestRef = useRef<AbortController | null>(null);
  const coachRequestRef = useRef<AbortController | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const savedReviewRef = useRef<RestoredWebCoachReview | null>(restoredReview);
  const persistReviewRef = useRef(onPersistReview);
  persistReviewRef.current = onPersistReview;
  const coachContextKey = useMemo(
    () => getWebCoachContextKey(lineContextKey, scope, playerColor, currentFen),
    [currentFen, lineContextKey, playerColor, scope],
  );
  const coachStorageKey = useMemo(() => getWebCoachStorageKey(lineContextKey), [lineContextKey]);
  const currentCoachContextRef = useRef(coachContextKey);
  currentCoachContextRef.current = coachContextKey;
  const previousCoachContextRef = useRef(coachContextKey);

  const loadHealth = useCallback(() => {
    if (healthRequestRef.current) return healthRequestRef.current;
    const controller = new AbortController();
    healthRequestRef.current = controller;
    setHealthError("");
    void getWebChessCoachHealth(controller.signal)
      .then((nextHealth) => {
        setHealth(nextHealth);
        if (nextHealth.ok) setError("");
      })
      .catch((healthFailure) => {
        if (controller.signal.aborted) return;
        setHealth(null);
        setHealthError(
          healthFailure instanceof Error ? healthFailure.message : "The PC coach is unreachable.",
        );
      })
      .finally(() => {
        if (healthRequestRef.current === controller) healthRequestRef.current = null;
      });
    return controller;
  }, []);

  const showSavedReview = useCallback((review: RestoredWebCoachReview, onPc = false) => {
    savedReviewRef.current = review;
    setPlayerColor(review.playerColor);
    setScope(review.scope);
    setQuestion(review.question);
    setResponse(review.response);
    setResponseContextKey(review.contextKey);
    setResponseLineContextKey(review.lineContextKey);
    setSavedReviewAt(review.savedAt);
    setSavedOnPc(onPc);
    setPersistenceError("");
    setActiveCategoryId(review.response.categories[0]?.id ?? null);
  }, []);

  const clearCoachReview = useCallback(() => {
    coachRequestRef.current?.abort();
    coachRequestRef.current = null;
    if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
    setLoading(false);
    setBackgroundReviewRunning(false);
    setProgress(null);
    setResponse(null);
    setResponseContextKey(null);
    setResponseLineContextKey(null);
    setSavedReviewAt(null);
    setSavedOnPc(false);
    setActiveCategoryId(null);
    setError("");
    onReviewRunningChange(false);
  }, [onReviewRunningChange]);

  useEffect(() => {
    loadHealth();
    return () => {
      healthRequestRef.current?.abort();
      coachRequestRef.current?.abort();
      if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current);
      onReviewRunningChange(false);
    };
  }, [loadHealth, onReviewRunningChange]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COACH_MODEL_STORAGE_KEY, coachModel.id);
      window.localStorage.setItem(COACH_REASONING_STORAGE_KEY, reasoningEffort);
    } catch {
      // Private browsing can deny storage; the in-memory selection still works.
    }
  }, [coachModel.id, reasoningEffort]);

  useEffect(() => {
    if (health?.corpusAvailable && selectedModelAvailable) return;
    const retryId = window.setInterval(loadHealth, 5000);
    return () => window.clearInterval(retryId);
  }, [health?.corpusAvailable, loadHealth, selectedModelAvailable]);

  useEffect(() => {
    savedReviewRef.current = restoredReview;
  }, [restoredReview]);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | null = null;
    const retrySavedReviewSync = () => {
      if (controller.signal.aborted) return;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void synchronizeSavedReview(), 5000);
    };
    const synchronizeSavedReview = async () => {
      try {
        const status = await getSavedWebCoachReviewStatus(coachStorageKey, controller.signal);
        if (controller.signal.aborted) return;
        setPersistenceError("");
        setBackgroundReviewRunning(status.pending);
        if (status.pending && status.progress) setProgress(status.progress);
        const stored = status.review;
        const rebasedStoredReview = stored
          ? rebaseWebCoachReviewLineContext(stored, lineContextKey)
          : null;
        const remoteReview = restoreWebCoachReview(rebasedStoredReview, {
          lineContextKey,
          currentFen,
        });
        const localReview = savedReviewRef.current;
        if (remoteReview && (!localReview || remoteReview.savedAt >= localReview.savedAt)) {
          persistReviewRef.current(remoteReview);
          showSavedReview(remoteReview, true);
        } else if (localReview && !status.pending) {
          await saveWebCoachReview(localReview, coachStorageKey);
          if (!controller.signal.aborted) {
            setSavedOnPc(true);
            setPersistenceError("");
          }
        }
        if (status.pending && !controller.signal.aborted) {
          retrySavedReviewSync();
        } else if (!loading) {
          setProgress(null);
        }
      } catch (loadError) {
        if (
          controller.signal.aborted ||
          (loadError instanceof DOMException && loadError.name === "AbortError")
        ) {
          return;
        }
        setPersistenceError("PC review sync was interrupted. Retrying automatically.");
        retrySavedReviewSync();
      }
    };
    void synchronizeSavedReview();
    return () => {
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [coachStorageKey, currentFen, lineContextKey, loading, showSavedReview]);

  useEffect(() => {
    if (previousCoachContextRef.current === coachContextKey) return;
    previousCoachContextRef.current = coachContextKey;
    clearCoachReview();
    if (restoredReview?.contextKey === coachContextKey) showSavedReview(restoredReview);
  }, [clearCoachReview, coachContextKey, restoredReview, showSavedReview]);

  const sourceLineIsUnchanged = useMemo(
    () => webCoachLineMatchesSourceGame(sourceGame, line),
    [line, sourceGame],
  );
  const coachMoves = useMemo(
    () => getWebCoachMoves(sourceLineIsUnchanged ? (sourceGame?.moves ?? null) : null, line),
    [line, sourceGame?.moves, sourceLineIsUnchanged],
  );
  const pgn = sourceLineIsUnchanged
    ? (sourceGame?.pgn ?? makeWebCoachMovetext(line))
    : makeWebCoachMovetext(line);
  const visibleResponse =
    response && responseContextKey === coachContextKey && responseLineContextKey === lineContextKey
      ? response
      : null;
  const canAsk = Boolean(
    question.trim() &&
    health?.corpusAvailable &&
    selectedModelAvailable &&
    !loading &&
    !backgroundReviewRunning,
  );

  async function askCoach() {
    if (!canAsk) return;
    coachRequestRef.current?.abort();
    if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current);
    const controller = new AbortController();
    const requestId = createWebCoachRequestId();
    const submittedContextKey = coachContextKey;
    const submittedLineContextKey = lineContextKey;
    const submittedQuestion = question.trim();
    const submittedScope = scope;
    const submittedPlayerColor = playerColor;
    const submittedModel = coachModel.id;
    const submittedReasoningEffort = reasoningEffort;
    coachRequestRef.current = controller;
    onReviewRunningChange(true);
    stopWebStockfish18Search();
    setLoading(true);
    setBackgroundReviewRunning(false);
    setProgress({
      requestId,
      phase: "queued",
      label: "Stopping the board engine and preparing the PC review...",
      completed: 0,
      total: 0,
    });
    setError("");
    setResponse(null);
    setResponseContextKey(null);
    setResponseLineContextKey(null);
    setSavedReviewAt(null);
    setActiveCategoryId(null);
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      if (controller.signal.aborted) return;
      let progressFetchRunning = false;
      const pollProgress = async () => {
        if (progressFetchRunning || controller.signal.aborted) return;
        progressFetchRunning = true;
        try {
          const nextProgress = await getWebChessCoachProgress(requestId, controller.signal);
          if (!controller.signal.aborted) setProgress(nextProgress);
        } catch {
          // The POST may not have registered its progress record yet.
        } finally {
          progressFetchRunning = false;
        }
      };
      progressTimerRef.current = window.setInterval(() => void pollProgress(), 750);
      const result = await askWebChessCoach({
        question: submittedQuestion,
        requestId,
        pgn,
        playerColor,
        scope,
        currentFen,
        moves: coachMoves,
        currentLines,
        model: submittedModel,
        reasoningEffort: submittedReasoningEffort,
        persistence: {
          storageKey: coachStorageKey,
          contextKey: submittedContextKey,
          lineContextKey: submittedLineContextKey,
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted || currentCoachContextRef.current !== submittedContextKey) {
        return;
      }
      const savedReview = createWebCoachReviewRecord({
        contextKey: submittedContextKey,
        lineContextKey: submittedLineContextKey,
        scope: submittedScope,
        playerColor: submittedPlayerColor,
        question: submittedQuestion,
        response: result,
      });
      let persistedOnPc = false;
      try {
        await saveWebCoachReview(savedReview, coachStorageKey);
        persistedOnPc = true;
        setPersistenceError("");
      } catch (saveError) {
        setPersistenceError(
          saveError instanceof Error
            ? `The answer is visible, but the PC could not save it: ${saveError.message}`
            : "The answer is visible, but the PC could not save it.",
        );
      }
      onPersistReview(savedReview);
      const normalizedSavedReview = restoreWebCoachReview(savedReview, {
        lineContextKey: submittedLineContextKey,
        currentFen,
      });
      if (normalizedSavedReview) savedReviewRef.current = normalizedSavedReview;
      if (currentCoachContextRef.current !== submittedContextKey) return;
      setResponse(result);
      setResponseContextKey(submittedContextKey);
      setResponseLineContextKey(submittedLineContextKey);
      setSavedReviewAt(savedReview.savedAt);
      setSavedOnPc(persistedOnPc);
      setActiveCategoryId(result.categories[0]?.id ?? null);
    } catch (coachError) {
      if (controller.signal.aborted) return;
      setError(coachError instanceof Error ? coachError.message : "The PC coach failed.");
      if (savedReviewRef.current?.contextKey === submittedContextKey) {
        showSavedReview(savedReviewRef.current, savedOnPc);
      }
      void loadHealth();
    } finally {
      if (coachRequestRef.current === controller) {
        coachRequestRef.current = null;
        if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
        setLoading(false);
        setProgress(null);
        onReviewRunningChange(false);
      }
    }
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap="xs">
          <IconBook size={18} />
          <Text fw={700}>AI Chess Coach</Text>
          {health?.corpusAvailable ? (
            <Badge color="teal" variant="light">
              {health.bookCount} books
            </Badge>
          ) : null}
          {currentLines.length > 0 ? <Badge variant="outline">live engine</Badge> : null}
        </Group>
        <Button size="compact-xs" variant="subtle" onClick={() => loadHealth()}>
          Check PC
        </Button>
      </Group>

      {healthError ? (
        <Box className={classes.coachNotice} data-tone="error">
          <Text size="sm">{healthError}</Text>
        </Box>
      ) : health && (!health.corpusAvailable || !selectedModelAvailable) ? (
        <Box className={classes.coachNotice} data-tone="warning">
          <Text size="sm" fw={600}>
            {!health.corpusAvailable
              ? "The PC book corpus is unavailable."
              : selectedProviderHealth?.message ||
                (coachModel.provider === "gemini"
                  ? selectedProviderHealth?.installed
                    ? "Antigravity needs its one-time Google sign-in."
                    : "The PC needs the Antigravity CLI installed for Gemini models."
                  : (selectedProviderHealth?.installed ?? health.modelInstalled)
                    ? health.modelAvailability === "usage-limited"
                      ? health.modelMessage ||
                        "OpenAI Codex has reached its usage limit. Add credits or try again later."
                      : "OpenAI Codex needs its one-time ChatGPT sign-in."
                    : "The PC needs the OpenAI Codex app or CLI installed.")}
          </Text>
          <Text size="xs" c="dimmed">
            Stockfish remains available; Coach enables automatically when the PC dependency is
            ready.
          </Text>
        </Box>
      ) : null}

      {persistenceError ? (
        <Box className={classes.coachNotice} data-tone="warning">
          <Text size="sm">{persistenceError}</Text>
        </Box>
      ) : null}

      {backgroundReviewRunning && !loading ? (
        <Box className={classes.coachNotice}>
          <Text size="sm" fw={600}>
            {progress?.label || "This review is continuing on the PC."}
          </Text>
          <Text size="xs" c="dimmed">
            You can close this app. The completed answer will be saved on the PC and restored here.
          </Text>
        </Box>
      ) : null}

      <Group grow gap="xs" align="flex-end">
        <Select
          size="xs"
          label="Model"
          value={coachModel.id}
          data={COACH_MODEL_SELECT_DATA}
          allowDeselect={false}
          searchable
          disabled={loading || backgroundReviewRunning}
          onChange={(value) => {
            const nextModelId = normalizeCoachModelId(value);
            const nextModel = getCoachModelDefinition(nextModelId);
            setStoredCoachModel(nextModelId);
            setStoredReasoningEffort(normalizeCoachReasoningEffort(nextModel, reasoningEffort));
          }}
        />
        <Select
          size="xs"
          label="Reasoning"
          value={reasoningEffort}
          data={getCoachReasoningSelectData(coachModel)}
          allowDeselect={false}
          disabled={loading || backgroundReviewRunning}
          onChange={(value) =>
            setStoredReasoningEffort(normalizeCoachReasoningEffort(coachModel, value))
          }
        />
      </Group>

      <Group grow gap="xs">
        <SegmentedControl
          size="xs"
          value={playerColor}
          onChange={(value) => setPlayerColor(value === "black" ? "black" : "white")}
          data={[
            { value: "white", label: "I'm White" },
            { value: "black", label: "I'm Black" },
          ]}
        />
        <SegmentedControl
          size="xs"
          value={scope}
          onChange={(value) => setScope(value === "position" ? "position" : "whole-game")}
          data={[
            { value: "whole-game", label: "Review game" },
            { value: "position", label: "Position" },
          ]}
        />
      </Group>

      <Textarea
        autosize
        minRows={3}
        maxRows={7}
        value={question}
        onChange={(event) => setQuestion(event.currentTarget.value)}
        placeholder="Ask what went wrong, what to play, or which lesson to study..."
        disabled={loading}
      />
      <Button
        leftSection={loading ? <Loader size="xs" /> : <IconSparkles size={16} />}
        disabled={!canAsk}
        loading={loading}
        onClick={() => void askCoach()}
      >
        {scope === "whole-game" ? "Review with books" : "Ask Coach"}
      </Button>
      {loading ? (
        <Box className={classes.coachNotice}>
          <Text size="sm" fw={600}>
            {progress?.label || "Building your PC-first game review..."}
          </Text>
          <Progress
            value={
              progress && progress.total > 0
                ? Math.min(100, (progress.completed / progress.total) * 100)
                : 100
            }
            animated={!progress || progress.total === 0}
            mt="xs"
          />
          {progress && progress.total > 0 ? (
            <Text size="xs" c="dimmed" mt={4}>
              {progress.completed} of {progress.total}
            </Text>
          ) : null}
          <Stack gap={3} mt="xs" className={classes.coachProgressSteps}>
            <Text size="xs">
              1. Gemini 3.1 Pro reads the PGN without Stockfish or book evidence.
            </Text>
            <Text size="xs">
              2. PC verifies the cached opening through its first gap and checks one boundary.
            </Text>
            <Text size="xs">3. {coachModel.label} chooses the relevant books and chapters.</Text>
            <Text size="xs">4. Gemini 3.6 Flash specialists draft the topic tabs.</Text>
            <Text size="xs">5. Chessops verifies every board line before the final edit.</Text>
            <Text size="xs">You can close the app; the PC will finish and save this review.</Text>
          </Stack>
        </Box>
      ) : null}
      {error ? (
        <Box className={classes.coachNotice} data-tone="error">
          <Text size="sm">{error}</Text>
        </Box>
      ) : null}

      {visibleResponse ? (
        <Stack gap="sm">
          <Box className={classes.coachOverview}>
            <Text size="xs" fw={700} tt="uppercase" c="teal" mb={4}>
              Game overview
            </Text>
            <Box className={classes.coachAnswer}>
              <CoachInteractiveMarkdown
                content={visibleResponse.overview}
                gameMoves={coachMoves}
                orientation={playerColor}
                onSelectPly={onSelectPly}
              />
            </Box>
          </Box>
          {visibleResponse.coachTeam?.qualitativeModel ? (
            <Box className={classes.coachTeamStrip}>
              <Text size="xs" fw={650}>
                Human pass: Gemini 3.1 Pro
              </Text>
              <Text size="xs" c="dimmed">
                {visibleResponse.coachTeam.specialistCount} Gemini 3.6 Flash specialists · final
                edit by{" "}
                {formatCoachModelSelection(visibleResponse.model, visibleResponse.reasoningEffort)}{" "}
                · legal moves verified
              </Text>
            </Box>
          ) : null}
          <Group gap="xs">
            <Badge variant="light">
              {formatCoachModelSelection(visibleResponse.model, visibleResponse.reasoningEffort)}
            </Badge>
            {savedReviewAt ? (
              <Badge
                color="green"
                variant="light"
                title={`Saved ${new Date(savedReviewAt).toLocaleString()}`}
              >
                {savedOnPc ? "Saved on PC" : "Saved on this phone"} ·{" "}
                {formatWebCoachSavedTime(savedReviewAt)}
              </Badge>
            ) : null}
            {visibleResponse.analysisCoverage.totalPositions > 0 ? (
              <Badge variant="outline">
                {visibleResponse.analysisCoverage.uniquePositions} opening positions checked
              </Badge>
            ) : visibleResponse.criticalMoments.length > 0 ? (
              <Badge variant="outline">
                {visibleResponse.criticalMoments.length} critical moments
              </Badge>
            ) : null}
            {visibleResponse.analysisCoverage.cloudHits > 0 ? (
              <Badge color="blue" variant="outline">
                {visibleResponse.analysisCoverage.cloudHits} cloud evals
              </Badge>
            ) : null}
            {visibleResponse.analysisCoverage.liveAnalyses > 0 ? (
              <Badge color="cyan" variant="outline">
                {visibleResponse.analysisCoverage.liveAnalyses} fresh PC evals
              </Badge>
            ) : null}
            {visibleResponse.analysisCoverage.skippedPositions ? (
              <Badge color="gray" variant="outline">
                {visibleResponse.analysisCoverage.skippedPositions} later positions skipped
              </Badge>
            ) : null}
            <Badge color="teal" variant="outline">
              {visibleResponse.bookPassages.length} book passages
            </Badge>
          </Group>
          {visibleResponse.analysisCoverage.failed > 0 ? (
            <Box className={classes.coachNotice} data-tone="warning">
              <Text size="xs">
                {visibleResponse.analysisCoverage.failed} position
                {visibleResponse.analysisCoverage.failed === 1 ? "" : "s"} could not be checked by
                the PC. Treat conclusions around those moves with care.
              </Text>
            </Box>
          ) : null}
          {visibleResponse.categories.length > 0 ? (
            <Tabs
              value={activeCategoryId ?? visibleResponse.categories[0].id}
              onChange={setActiveCategoryId}
              keepMounted={false}
              variant="pills"
            >
              <Box className={classes.coachTabsScroller}>
                <Tabs.List className={classes.coachTabsList}>
                  {visibleResponse.categories.map((category) => (
                    <Tabs.Tab value={category.id} key={category.id} className={classes.coachTab}>
                      {category.label}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Box>
              {visibleResponse.categories.map((category) => (
                <Tabs.Panel value={category.id} key={category.id} pt="sm">
                  <CoachCategoryPanel
                    category={category}
                    bookPassages={visibleResponse.bookPassages}
                    gameMoves={coachMoves}
                    orientation={playerColor}
                    onSelectPly={(ply) => {
                      if (
                        responseContextKey !== coachContextKey ||
                        responseLineContextKey !== lineContextKey ||
                        ply < 0 ||
                        ply > line.length
                      ) {
                        return;
                      }
                      onSelectPly(ply);
                    }}
                  />
                </Tabs.Panel>
              ))}
            </Tabs>
          ) : visibleResponse.bookPassages.length > 0 ? (
            <Stack gap="xs">
              <Text size="sm" fw={700}>
                From your library
              </Text>
              {visibleResponse.bookPassages.map((passage) => (
                <CoachBookSourceCard key={passage.chunkId} passage={passage} />
              ))}
            </Stack>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

function CoachInteractiveMarkdown({
  content,
  gameMoves,
  orientation,
  onSelectPly,
}: {
  content: string;
  gameMoves: ReturnType<typeof getWebCoachMoves>;
  orientation: WebColor;
  onSelectPly: (ply: number) => void;
}) {
  const [selectedPly, setSelectedPly] = useState<number | null>(null);
  const linkedContent = useMemo(
    () => linkWebCoachGameMoves(content, gameMoves),
    [content, gameMoves],
  );

  useEffect(() => {
    setSelectedPly(null);
  }, [content, gameMoves]);

  return (
    <>
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const match = href?.match(/^#coach-ply-(\d+)$/);
            if (!match) return <a href={href}>{children}</a>;
            const ply = Number(match[1]);
            return (
              <button
                type="button"
                className={classes.coachMoveLink}
                onClick={() => {
                  setSelectedPly(ply);
                  onSelectPly(ply);
                }}
              >
                {children}
              </button>
            );
          },
        }}
      >
        {linkedContent}
      </ReactMarkdown>
      {selectedPly !== null ? (
        <CoachLineDiagram
          moves={gameMoves}
          initialCursor={Math.min(selectedPly, gameMoves.length)}
          orientation={orientation}
          label={
            "Position after " +
            formatCoachPlyLabel(
              selectedPly,
              gameMoves.find((move) => Number(move.ply) === selectedPly)?.san || "",
            )
          }
        />
      ) : null}
    </>
  );
}

function CoachCategoryPanel({
  category,
  bookPassages,
  gameMoves,
  orientation,
  onSelectPly,
}: {
  category: WebCoachCategory;
  bookPassages: WebCoachBookPassage[];
  gameMoves: ReturnType<typeof getWebCoachMoves>;
  orientation: WebColor;
  onSelectPly: (ply: number) => void;
}) {
  const passageById = new Map(bookPassages.map((passage) => [passage.chunkId, passage]));
  const references = category.bookReferences.flatMap((reference) => {
    const passage = passageById.get(reference.chunkId);
    return passage ? [{ reference, passage }] : [];
  });

  return (
    <Stack gap="sm">
      {category.summary ? (
        <Box className={classes.coachSummary}>
          <CoachInteractiveMarkdown
            content={category.summary}
            gameMoves={gameMoves}
            orientation={orientation}
            onSelectPly={onSelectPly}
          />
        </Box>
      ) : null}
      {category.explanation ? (
        <Box className={classes.coachAnswer}>
          <CoachInteractiveMarkdown
            content={category.explanation}
            gameMoves={gameMoves}
            orientation={orientation}
            onSelectPly={onSelectPly}
          />
        </Box>
      ) : null}

      {category.verifiedLines.length > 0 ? (
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Plans on the board
          </Text>
          {category.verifiedLines.map((line, index) => (
            <CoachVerifiedLineCard
              key={`${line.startPly}-${line.title}-${index}`}
              line={line}
              orientation={orientation}
            />
          ))}
        </Stack>
      ) : null}

      {category.positions.length > 0 ? (
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Key positions
          </Text>
          {category.positions.map((position, index) => (
            <Box key={`${position.ply}-${index}`} className={classes.coachPositionCard}>
              <Group justify="space-between" gap="xs" align="flex-start" wrap="nowrap">
                <Box miw={0}>
                  <Text size="sm" fw={650}>
                    {position.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatCoachPlyLabel(position.ply, position.san)}
                  </Text>
                </Box>
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<IconTarget size={12} />}
                  onClick={() => onSelectPly(position.ply)}
                >
                  Show
                </Button>
              </Group>
              <Box mt={6} className={classes.coachPositionText}>
                <CoachInteractiveMarkdown
                  content={position.explanation}
                  gameMoves={gameMoves}
                  orientation={orientation}
                  onSelectPly={onSelectPly}
                />
              </Box>
              {position.engineEvidence ? (
                <Box className={classes.coachPositionText} mt={5}>
                  <Text size="xs" c="blue.2" fw={650}>
                    Accuracy check
                  </Text>
                  <CoachInteractiveMarkdown
                    content={position.engineEvidence}
                    gameMoves={gameMoves}
                    orientation={orientation}
                    onSelectPly={onSelectPly}
                  />
                </Box>
              ) : null}
              {position.betterPlan ? (
                <Box className={classes.coachPositionText} mt={5}>
                  <Text size="xs" fw={650}>
                    Better plan
                  </Text>
                  <CoachInteractiveMarkdown
                    content={position.betterPlan}
                    gameMoves={gameMoves}
                    orientation={orientation}
                    onSelectPly={onSelectPly}
                  />
                </Box>
              ) : null}
              <CoachLineDiagram
                moves={gameMoves}
                initialCursor={Math.min(position.ply, gameMoves.length)}
                orientation={orientation}
                label={`Game position after ${formatCoachPlyLabel(position.ply, position.san)}`}
              />
            </Box>
          ))}
        </Stack>
      ) : null}

      {references.length > 0 ? (
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            From your library
          </Text>
          {references.map(({ reference, passage }) => (
            <CoachBookSourceCard
              key={passage.chunkId}
              passage={passage}
              whyItMatters={reference.whyItMatters}
              positionPly={reference.positionPly}
              orientation={orientation}
              onSelectPly={onSelectPly}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function CoachBookSourceCard({
  passage,
  whyItMatters,
  positionPly,
  orientation = "white",
  onSelectPly,
}: {
  passage: WebCoachBookPassage;
  whyItMatters?: string;
  positionPly?: number | null;
  orientation?: WebColor;
  onSelectPly?: (ply: number) => void;
}) {
  return (
    <Box className={classes.coachSourceCard}>
      <Group justify="space-between" gap="xs" align="flex-start" wrap="nowrap">
        <Box miw={0}>
          <Text size="sm" fw={650}>
            {getWebCoachBookHeading(passage)}
          </Text>
          <Text size="xs" c="dimmed">
            {passage.author}
          </Text>
        </Box>
        {passage.sourceUrl ? (
          <Button
            component="a"
            href={getWebCoachBookPdfUrl(passage)}
            target="_blank"
            rel="noreferrer"
            size="compact-xs"
            variant="subtle"
            leftSection={<IconExternalLink size={12} />}
          >
            PDF
          </Button>
        ) : null}
      </Group>
      {whyItMatters ? (
        <Text size="xs" mt={6} fw={550}>
          {whyItMatters}
        </Text>
      ) : null}
      {passage.excerpt ? (
        <Text size="xs" mt={6} lineClamp={5}>
          {passage.excerpt}
        </Text>
      ) : null}
      {passage.openingLines.map((line) => (
        <Box key={line.lineId} className={classes.coachBookLine}>
          <Text size="xs" fw={650}>
            Exact book line ·{" "}
            {line.playedMoveMatched
              ? `your ${line.playedSan || line.playedUci} follows the cited line`
              : `the book gives ${line.bookMoveSan} where you played ${
                  line.playedSan || line.playedUci
                }`}
            {line.sharedPlies > 1 ? ` · ${line.sharedPlies} matching plies` : ""}
          </Text>
          <Text size="xs" c="dimmed" mt={3}>
            {line.pgn}
          </Text>
          <CoachLineDiagram
            moves={line.moves}
            initialCursor={Math.min(line.matchedBookMoveIndex + 1, line.moves.length)}
            orientation={orientation}
            label={`${passage.title} · ${line.citation || passage.citation}`}
          />
        </Box>
      ))}
      <Group gap="xs" mt={4} justify="space-between" align="center">
        <Text size="xs" c="dimmed">
          {passage.citation}
        </Text>
        {positionPly && onSelectPly ? (
          <Button size="compact-xs" variant="subtle" onClick={() => onSelectPly(positionPly)}>
            See position
          </Button>
        ) : null}
      </Group>
    </Box>
  );
}

function CoachVerifiedLineCard({
  line,
  orientation,
}: {
  line: WebCoachCategory["verifiedLines"][number];
  orientation: WebColor;
}) {
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    setCursor(0);
  }, [line]);

  return (
    <Box className={classes.coachVerifiedLine}>
      <Text size="sm" fw={650}>
        {line.title}
      </Text>
      {line.purpose ? (
        <Text size="xs" c="dimmed" mt={2}>
          {line.purpose}
        </Text>
      ) : null}
      <Group gap={5} mt="xs" wrap="wrap">
        {line.moves.map((move, index) => {
          const ply = line.startPly + index + 1;
          return (
            <button
              type="button"
              key={line.startPly + "-" + index + "-" + move.uci}
              className={classes.coachVariationMove}
              data-active={cursor === index + 1 || undefined}
              onClick={() => setCursor(index + 1)}
            >
              {formatCoachPlyLabel(ply, move.san)}
            </button>
          );
        })}
      </Group>
      <CoachLineDiagram
        moves={line.moves}
        initialCursor={cursor}
        orientation={orientation}
        label={line.title}
        startPly={line.startPly}
      />
    </Box>
  );
}

type CoachDiagramMove = {
  san: string;
  uci?: string | null;
  fenBefore: string;
  fenAfter: string;
};

function CoachLineDiagram({
  moves,
  initialCursor,
  orientation,
  label,
  startPly = 0,
}: {
  moves: CoachDiagramMove[];
  initialCursor: number;
  orientation: WebColor;
  label: string;
  startPly?: number;
}) {
  const [cursor, setCursor] = useState(() => Math.max(0, Math.min(initialCursor, moves.length)));
  const boardRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const boundedCursor = Math.max(0, Math.min(cursor, moves.length));
  const fen =
    boundedCursor === 0
      ? moves[0]?.fenBefore || INITIAL_FEN
      : moves[boundedCursor - 1]?.fenAfter || INITIAL_FEN;
  const lastMoveUci = boundedCursor > 0 ? moves[boundedCursor - 1]?.uci || null : null;
  const nextMoveUci = boundedCursor < moves.length ? moves[boundedCursor]?.uci || null : null;
  const config = useMemo(
    () => ({
      fen,
      orientation,
      coordinates: true,
      lastMove: getLastMove(lastMoveUci),
      movable: {
        free: false,
        color: undefined,
        showDests: false,
      },
      draggable: { enabled: false },
      selectable: { enabled: false },
      drawable: {
        enabled: false,
        visible: true,
        autoShapes: getCoachDiagramArrow(nextMoveUci),
      },
      animation: { enabled: true },
    }),
    [fen, lastMoveUci, nextMoveUci, orientation],
  );
  const initialConfigRef = useRef(config);

  useEffect(() => {
    setCursor(Math.max(0, Math.min(initialCursor, moves.length)));
  }, [initialCursor, moves]);

  useEffect(() => {
    const element = boardRef.current;
    if (!element || apiRef.current) return;
    const api = Chessground(element, initialConfigRef.current);
    apiRef.current = api;
    return () => {
      api.destroy();
      if (apiRef.current === api) apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.set(config);
  }, [config]);

  if (moves.length === 0) return null;
  const currentMove = boundedCursor > 0 ? moves[boundedCursor - 1] : null;
  const nextMove = boundedCursor < moves.length ? moves[boundedCursor] : null;

  return (
    <Box className={classes.coachDiagram}>
      <Text size="xs" c="dimmed" mb={5} lineClamp={2}>
        {label}
      </Text>
      <Box ref={boardRef} className={`${classes.boardMount} ${classes.coachDiagramBoard}`} />
      <Group justify="center" gap="xs" mt={7} wrap="nowrap">
        <ActionIcon
          variant="light"
          aria-label="Previous diagram move"
          disabled={boundedCursor === 0}
          onClick={() => setCursor((value) => Math.max(0, value - 1))}
        >
          <IconChevronLeft size={17} />
        </ActionIcon>
        <Text size="xs" ta="center" className={classes.coachDiagramMove}>
          {currentMove
            ? formatCoachPlyLabel(startPly + boundedCursor, currentMove.san)
            : startPly > 0
              ? "After ply " + startPly
              : "Starting position"}
          {nextMove
            ? " · next " + formatCoachPlyLabel(startPly + boundedCursor + 1, nextMove.san)
            : " · end of line"}
        </Text>
        <ActionIcon
          variant="light"
          aria-label="Next diagram move"
          disabled={boundedCursor >= moves.length}
          onClick={() => setCursor((value) => Math.min(moves.length, value + 1))}
        >
          <IconChevronRight size={17} />
        </ActionIcon>
      </Group>
    </Box>
  );
}

function getCoachDiagramArrow(uci: string | null): DrawShape[] {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return [];
  return [
    {
      orig: uci.slice(0, 2) as Key,
      dest: uci.slice(2, 4) as Key,
      brush: "blue",
    },
  ];
}

function formatCoachPlyLabel(ply: number, san: string) {
  const moveNumber = Math.ceil(ply / 2);
  return `${moveNumber}${ply % 2 === 0 ? "..." : "."}${san ? ` ${san}` : ""}`;
}

function getDefaultWebCoachQuestion(sourceGame: WebGame | null, line: WebPrepLineMove[]) {
  return getDefaultAiCoachQuestion(getDefaultWebCoachScope(sourceGame, line));
}

function formatWebCoachSavedTime(savedAt: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(savedAt));
}

function createWebCoachRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `coach-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function MovesUnderBoardPanel({
  line,
  cursor,
  setCursor,
  rootLines,
  onChooseLine,
  sourceComments,
}: {
  line: WebPrepLineMove[];
  cursor: number;
  setCursor: (cursor: number) => void;
  rootLines: WebPrepLineMove[][];
  onChooseLine: (line: WebPrepLineMove[], cursor?: number) => void;
  sourceComments: string[];
}) {
  const displayLines = getWebMovePanelDisplayLines(line, rootLines);
  const primaryLine = displayLines[0] ?? [];
  const rootAlternatives = displayLines.slice(1);

  const moveListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const current = moveListRef.current?.querySelector('[data-current="true"]');
    if (current instanceof HTMLElement) {
      current.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [cursor, line]);

  const renderLine = (
    moves: WebPrepLineMove[],
    parentLine: WebPrepLineMove[],
    keyPrefix: string,
    depth: number,
  ) =>
    moves.map((move, index) => {
      const beforeMoveLine = [...parentLine, ...moves.slice(0, index)];
      const lineToMove = [...beforeMoveLine, move];
      const fullBranchLine = getWebMovePanelBranchLine(parentLine, moves);
      const annotations = move.annotations ?? [];
      const startingComments = move.startingComments ?? [];
      const comments = move.comments ?? [];
      const variations = move.variations ?? [];
      const hasNotes = startingComments.length > 0 || comments.length > 0;
      const isOnActiveLine = webLineStartsWith(line, lineToMove);
      const isCurrent = isOnActiveLine && cursor === lineToMove.length;
      const moveKey = `${keyPrefix}-${index}-${move.san}-${move.fenAfter}`;

      return (
        <Fragment key={moveKey}>
          <Box className={classes.moveEntry} data-annotated={hasNotes ? "true" : undefined}>
            {startingComments.map((comment, commentIndex) => (
              <Text
                key={`before-${commentIndex}`}
                size="xs"
                className={`${classes.moveComment} ${classes.moveStartingComment}`}
              >
                {comment}
              </Text>
            ))}
            <button
              className={classes.movePill}
              data-current={isCurrent}
              type="button"
              onClick={() => {
                if (isOnActiveLine) {
                  setCursor(lineToMove.length);
                  return;
                }
                onChooseLine(fullBranchLine, lineToMove.length);
              }}
            >
              {formatMovePrefix(move, index === 0)}
              {move.san}
              {annotations.map((annotation, annotationIndex) => (
                <span key={`${annotation}-${annotationIndex}`} className={classes.moveGlyph}>
                  {annotation}
                </span>
              ))}
            </button>
            {comments.map((comment, commentIndex) => (
              <Text key={`after-${commentIndex}`} size="xs" className={classes.moveComment}>
                {comment}
              </Text>
            ))}
          </Box>
          {variations.map((variation, variationIndex) => (
            <Box
              key={`${moveKey}-variation-${variationIndex}`}
              className={classes.moveVariationGroup}
              style={{ marginLeft: `${Math.min(depth + 1, 3) * 0.45}rem` }}
            >
              <Box className={classes.moveVariationLine}>
                {renderLine(
                  variation,
                  lineToMove,
                  `${moveKey}-variation-${variationIndex}`,
                  depth + 1,
                )}
              </Box>
            </Box>
          ))}
        </Fragment>
      );
    });

  return (
    <Stack gap="xs">
      {sourceComments.length > 0 && (
        <Box className={classes.moveRootComments}>
          {sourceComments.map((comment, index) => (
            <Text key={`root-comment-${index}`} size="xs" className={classes.moveComment}>
              {comment}
            </Text>
          ))}
        </Box>
      )}
      <Box ref={moveListRef} className={classes.moveList}>
        {displayLines.length === 0 ? (
          <Text size="sm" c="dimmed">
            Play a move to begin
          </Text>
        ) : (
          <>
            {primaryLine.length > 0 ? renderLine(primaryLine, [], "main", 0) : null}
            {rootAlternatives.map((variation, variationIndex) => (
              <Box
                key={`root-variation-${variationIndex}`}
                className={classes.moveVariationGroup}
                data-root="true"
              >
                <Box className={classes.moveVariationLine}>
                  {renderLine(variation, [], `root-variation-${variationIndex}`, 0)}
                </Box>
              </Box>
            ))}
          </>
        )}
      </Box>
    </Stack>
  );
}

function formatMovePrefix(move: WebPrepLineMove, isFirstInRenderedLine: boolean) {
  const fields = move.fenBefore.trim().split(/\s+/);
  const moveNumber = Number.parseInt(fields[5] ?? "", 10);
  const label = Number.isFinite(moveNumber) && moveNumber > 0 ? moveNumber : null;
  if (getFenColor(move.fenBefore) === "white") return label ? `${label}. ` : "";
  return isFirstInRenderedLine && label ? `${label}... ` : "";
}

function webLineStartsWith(line: WebPrepLineMove[], prefix: WebPrepLineMove[]) {
  if (prefix.length > line.length) return false;
  return prefix.every((move, index) => webMovesMatch(move, line[index]));
}

function webMovesMatch(left: WebPrepLineMove, right: WebPrepLineMove | undefined) {
  if (!right) return false;
  return (
    left.san === right.san && left.fenBefore === right.fenBefore && left.fenAfter === right.fenAfter
  );
}

type WebDatabasePanelSource = "local" | WebDatabaseExplorerSource;
type WebDatabasePanelView = "stats" | "games" | "options";

function DatabaseUnderBoardPanel({
  currentFen,
  databases,
  gamesByDatabase,
  importHostedFolder,
  onPlayMove,
  onOpenSourceGame,
  lichessToken,
}: {
  currentFen: string;
  databases: WebDatabase[];
  gamesByDatabase: Record<string, WebGame[]>;
  importHostedFolder: WebHostedFolderImportHandler;
  onPlayMove: (stat: WebPrepMoveStat) => void;
  onOpenSourceGame: (game: WebGame) => void;
  lichessToken: string;
}) {
  const [storedSource, setStoredSource] = usePersistentString(
    WEB_DATABASE_PANEL_SOURCE_STORAGE_KEY,
    "local",
  );
  const source = isWebDatabasePanelSource(storedSource) ? storedSource : "local";
  const [storedView, setStoredView] = usePersistentString(
    WEB_DATABASE_PANEL_VIEW_STORAGE_KEY,
    "stats",
  );
  const databaseView = isWebDatabasePanelView(storedView) ? storedView : "stats";
  const [storedPanelStage, setStoredPanelStage] = usePersistentString(
    WEB_DATABASE_PANEL_STAGE_STORAGE_KEY,
    "setup",
  );
  const databaseStarted = storedPanelStage === "moves";
  const visibleDatabaseView = databaseStarted ? "stats" : databaseView;
  const [storedStatsSort, setStoredStatsSort] = usePersistentString(
    WEB_DATABASE_PANEL_SORT_STORAGE_KEY,
    "games",
  );
  const databaseStatsSort = isWebDatabaseStatsSort(storedStatsSort) ? storedStatsSort : "games";
  const [databaseStrengthSettings, setDatabaseStrengthSettings] = usePersistentJson(
    WEB_DATABASE_PANEL_STRENGTH_STORAGE_KEY,
    normalizeWebPrepStrengthSettings(null),
    normalizeWebPrepStrengthSettings,
  );
  const [selectedLocalIdValue, setSelectedLocalIdValue] = usePersistentString(
    WEB_DATABASE_PANEL_LOCAL_STORAGE_KEY,
    "",
  );
  const selectedLocalStoredHostedPath = useMemo(
    () => getWebDatabaseHostedPathFromSourceStorageValue(selectedLocalIdValue),
    [selectedLocalIdValue],
  );
  const [localPlayerName, setLocalPlayerName] = usePersistentString(
    WEB_DATABASE_PANEL_PLAYER_STORAGE_KEY,
    "",
  );
  const [localColorValue, setLocalColorValue] = usePersistentString(
    WEB_DATABASE_PANEL_COLOR_STORAGE_KEY,
    "white",
  );
  const localColor: WebColor = localColorValue === "black" ? "black" : "white";
  const [localStartDate, setLocalStartDate] = usePersistentString(
    WEB_DATABASE_PANEL_START_DATE_STORAGE_KEY,
    "",
  );
  const [localEndDate, setLocalEndDate] = usePersistentString(
    WEB_DATABASE_PANEL_END_DATE_STORAGE_KEY,
    "",
  );
  const [localResultValue, setLocalResultValue] = usePersistentString(
    WEB_DATABASE_PANEL_RESULT_STORAGE_KEY,
    "any",
  );
  const localResult = normalizeWebLocalResultFilter(localResultValue);
  const [loadingLocalSource, setLoadingLocalSource] = useState<string | null>(null);
  const [loadingLocalProgress, setLoadingLocalProgress] =
    useState<WebHostedFolderReadProgress | null>(null);
  const refreshingLocalPathRef = useRef<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [onlineStats, setOnlineStats] = useState<WebPrepMoveStat[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const { lichessOptions, setLichessOptions, mastersOptions, setMastersOptions, explorerOptions } =
    useWebExplorerOptions();
  const hostedDatabases = useHostedDatabaseFolders();
  const hostedDatabaseLibraryReady = Boolean(hostedDatabases.library?.manifest);
  const selectableDatabases = useMemo(
    () =>
      filterWebSourceDatabases(
        filterWebDatabasesByHostedAvailability({
          databases,
          hostedFolders: hostedDatabases.folders,
          hostedLibraryReady: hostedDatabaseLibraryReady,
        }),
      ),
    [databases, hostedDatabaseLibraryReady, hostedDatabases.folders],
  );
  const selectedLocalId = useMemo(
    () => resolveWebDatabaseSourceId(selectedLocalIdValue, selectableDatabases),
    [selectableDatabases, selectedLocalIdValue],
  );
  const sourceOptions = useMemo(
    () =>
      getWebDatabaseSelectData({
        databases: selectableDatabases,
        hostedFolders: hostedDatabases.folders,
      }),
    [hostedDatabases.folders, selectableDatabases],
  );
  const hasLocalChoices = selectableDatabases.length > 0 || hostedDatabases.folders.length > 0;
  const selectedLocalDatabase = useMemo(
    () => selectableDatabases.find((database) => database.id === selectedLocalId) ?? null,
    [selectableDatabases, selectedLocalId],
  );
  const isSelectedLocalLazy = Boolean(
    selectedLocalDatabase?.hostedLazy && selectedLocalDatabase.hostedPath,
  );
  const selectedLocalHostedPath =
    selectedLocalDatabase?.hostedPath ?? selectedLocalStoredHostedPath;
  const selectedLocalHostedFolder = useMemo(
    () =>
      selectedLocalHostedPath
        ? (hostedDatabases.folders.find((folder) => folder.path === selectedLocalHostedPath) ??
          null)
        : null,
    [hostedDatabases.folders, selectedLocalHostedPath],
  );
  const selectedLocalPickerValue = selectedLocalDatabase?.hostedPath
    ? hostedDatabaseValue(selectedLocalDatabase.hostedPath)
    : selectedLocalHostedFolder
      ? hostedDatabaseValue(selectedLocalHostedFolder.path)
      : selectedLocalId;
  const localGames = useMemo(
    () =>
      selectedLocalId && !isSelectedLocalLazy
        ? collectGamesForSources(gamesByDatabase, [selectedLocalId])
        : [],
    [gamesByDatabase, isSelectedLocalLazy, selectedLocalId],
  );
  const selectedDatabasePlayers = useMemo(() => getDatabasePlayerCounts(localGames), [localGames]);
  const trimmedLocalPlayerName = localPlayerName.trim();
  const localFilters = useMemo<WebLocalGameFilters>(
    () => ({
      startDate: localStartDate || undefined,
      endDate: localEndDate || undefined,
      result: localResult,
    }),
    [localEndDate, localResult, localStartDate],
  );
  const [localEngineMoves, setLocalEngineMoves] = useState<PrepBuilderEngineMove[]>([]);
  const [localLazyMoves, setLocalLazyMoves] = useState<WebHostedPositionMove[]>([]);
  const [localLazyLoading, setLocalLazyLoading] = useState(false);
  const [localLazyError, setLocalLazyError] = useState<string | null>(null);
  // Lazy hosted databases cannot filter by player (the perspective controls
  // are hidden), so a remembered player name must not flip their perspective.
  const localLazySide =
    trimmedLocalPlayerName && !isSelectedLocalLazy ? localColor : getFenColor(currentFen);
  const localLazyStatsBase = useMemo(
    () =>
      isSelectedLocalLazy
        ? getWebHostedPositionMoveStats({
            moves: localLazyMoves,
            fen: currentFen,
            side: localLazySide,
            strengthSettings: databaseStrengthSettings,
          })
        : [],
    [currentFen, databaseStrengthSettings, isSelectedLocalLazy, localLazyMoves, localLazySide],
  );
  const localLazyStats = useMemo(
    () =>
      isSelectedLocalLazy
        ? getWebHostedPositionMoveStats({
            moves: localLazyMoves,
            fen: currentFen,
            side: localLazySide,
            strengthSettings: databaseStrengthSettings,
            engineMoves: localEngineMoves,
          })
        : [],
    [
      currentFen,
      databaseStrengthSettings,
      isSelectedLocalLazy,
      localEngineMoves,
      localLazyMoves,
      localLazySide,
    ],
  );
  const eagerLocalStatsBase = useMemo(
    () =>
      getWebDatabaseMoveStats({
        games: localGames,
        fen: currentFen,
        filters: localFilters,
        perspective: trimmedLocalPlayerName
          ? {
              playerName: trimmedLocalPlayerName,
              color: localColor,
            }
          : null,
        strengthSettings: databaseStrengthSettings,
      }),
    [
      currentFen,
      databaseStrengthSettings,
      localColor,
      localFilters,
      localGames,
      trimmedLocalPlayerName,
    ],
  );
  const eagerLocalStats = useMemo(
    () =>
      getWebDatabaseMoveStats({
        games: localGames,
        fen: currentFen,
        filters: localFilters,
        perspective: trimmedLocalPlayerName
          ? {
              playerName: trimmedLocalPlayerName,
              color: localColor,
            }
          : null,
        strengthSettings: databaseStrengthSettings,
        engineMoves: localEngineMoves,
      }),
    [
      currentFen,
      databaseStrengthSettings,
      localColor,
      localEngineMoves,
      localFilters,
      localGames,
      trimmedLocalPlayerName,
    ],
  );
  const localStatsBase = isSelectedLocalLazy ? localLazyStatsBase : eagerLocalStatsBase;
  const localStats = isSelectedLocalLazy ? localLazyStats : eagerLocalStats;
  const localPositionGames = useMemo(
    () =>
      isSelectedLocalLazy
        ? []
        : getWebDatabaseGamesForPosition({
            games: localGames,
            fen: currentFen,
            filters: localFilters,
            perspective: trimmedLocalPlayerName
              ? {
                  playerName: trimmedLocalPlayerName,
                  color: localColor,
                }
              : null,
          }),
    [currentFen, isSelectedLocalLazy, localColor, localFilters, localGames, trimmedLocalPlayerName],
  );

  useEffect(() => {
    if (source !== "local" || !isSelectedLocalLazy || !selectedLocalDatabase?.hostedPath) {
      setLocalLazyMoves([]);
      setLocalLazyLoading(false);
      setLocalLazyError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLocalLazyLoading(true);
    setLocalLazyError(null);

    void fetchHostedDatabasePositionMoves({
      hostedPath: selectedLocalDatabase.hostedPath,
      fen: currentFen,
      signal: controller.signal,
    })
      .then((moves) => {
        if (active) setLocalLazyMoves(moves);
      })
      .catch((error) => {
        if (!active) return;
        setLocalLazyMoves([]);
        setLocalLazyError(
          error instanceof Error ? error.message : "Could not load this database position.",
        );
      })
      .finally(() => {
        if (active) setLocalLazyLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [currentFen, isSelectedLocalLazy, refreshKey, selectedLocalDatabase?.hostedPath, source]);

  useEffect(() => {
    setSelectedLocalIdValue((current) => {
      if (resolveWebDatabaseSourceId(current, selectableDatabases)) return current;
      const hostedPath = getWebDatabaseHostedPathFromSourceStorageValue(current);
      if (
        hostedPath &&
        (hostedDatabases.loading ||
          !hostedDatabases.library ||
          hostedDatabases.folders.some((folder) => folder.path === hostedPath))
      ) {
        return current;
      }
      const firstDatabase = selectableDatabases[0] ?? null;
      return firstDatabase ? getWebDatabaseSourceStorageValue(firstDatabase) : "";
    });
  }, [
    hostedDatabases.folders,
    hostedDatabases.library,
    hostedDatabases.loading,
    selectableDatabases,
    setSelectedLocalIdValue,
  ]);

  const setSource = (nextSource: WebDatabasePanelSource) => {
    setStoredSource(nextSource);
  };

  const setSelectedLocalId = (nextSourceId: string | null) => {
    const database = selectableDatabases.find((candidate) => candidate.id === nextSourceId) ?? null;
    setSelectedLocalIdValue(database ? getWebDatabaseSourceStorageValue(database) : "");
  };

  const refreshHostedLocalDatabase = useCallback(
    async (folder: WebHostedDatabaseFolder) => {
      if (!hostedDatabases.library) return null;
      setLoadingLocalSource(folder.label);
      setLoadingLocalProgress(null);
      try {
        const imported = await importHostedFolder(hostedDatabases.library, folder.path, {
          openFirstGame: false,
          onProgress: setLoadingLocalProgress,
        });
        if (imported) setSelectedLocalIdValue(getWebDatabaseSourceStorageValue(imported.database));
        return imported;
      } finally {
        setLoadingLocalProgress(null);
        setLoadingLocalSource(null);
      }
    },
    [hostedDatabases.library, importHostedFolder, setSelectedLocalIdValue],
  );

  const chooseLocalDatabase = async (value: string | null) => {
    if (!value) {
      setSelectedLocalId(null);
      return;
    }

    if (!isHostedDatabaseValue(value)) {
      const database = selectableDatabases.find((candidate) => candidate.id === value) ?? null;
      const hostedFolder = database?.hostedPath
        ? (hostedDatabases.folders.find((folder) => folder.path === database.hostedPath) ?? null)
        : null;
      if (
        needsHostedDatabaseRefresh({
          database,
          games: database ? (gamesByDatabase[database.id] ?? []) : [],
          hostedFolder,
        }) &&
        hostedFolder
      ) {
        await refreshHostedLocalDatabase(hostedFolder);
        return;
      }

      setSelectedLocalId(value);
      return;
    }

    const folderPath = hostedDatabasePathFromValue(value);
    const folder = hostedDatabases.folders.find((candidate) => candidate.path === folderPath);
    if (!folder || !hostedDatabases.library) return;
    const database = databases.find((candidate) => candidate.hostedPath === folder.path) ?? null;
    if (
      database &&
      !needsHostedDatabaseRefresh({
        database,
        games: gamesByDatabase[database.id] ?? [],
        hostedFolder: folder,
      })
    ) {
      setSelectedLocalIdValue(getWebDatabaseSourceStorageValue(database));
      return;
    }
    await refreshHostedLocalDatabase(folder);
  };

  useEffect(() => {
    if (
      source !== "local" ||
      !selectedLocalHostedFolder ||
      !hostedDatabases.library ||
      loadingLocalSource
    ) {
      return;
    }

    if (
      !needsHostedDatabaseRefresh({
        database: selectedLocalDatabase,
        games: localGames,
        hostedFolder: selectedLocalHostedFolder,
      }) &&
      selectedLocalDatabase
    ) {
      return;
    }

    if (refreshingLocalPathRef.current === selectedLocalHostedFolder.path) return;
    refreshingLocalPathRef.current = selectedLocalHostedFolder.path;
    void refreshHostedLocalDatabase(selectedLocalHostedFolder).finally(() => {
      refreshingLocalPathRef.current = null;
    });
  }, [
    hostedDatabases.library,
    loadingLocalSource,
    localGames,
    refreshHostedLocalDatabase,
    selectedLocalDatabase,
    selectedLocalHostedFolder,
    source,
  ]);

  useEffect(() => {
    const settings = normalizeWebPrepStrengthSettings(databaseStrengthSettings);
    if (source !== "local" || !settings.useCloudEngine || localStatsBase.length === 0) {
      setLocalEngineMoves([]);
      return;
    }

    const controller = new AbortController();
    let active = true;
    void queryWebLichessCloudEngineMoves({
      fen: currentFen,
      side: trimmedLocalPlayerName && !isSelectedLocalLazy ? localColor : getFenColor(currentFen),
      moves: localStatsBase.map((stat) => stat.move),
      multipv: localStatsBase.length,
      signal: controller.signal,
    })
      .then((moves) => {
        if (active) setLocalEngineMoves(moves);
      })
      .catch(() => {
        if (active) setLocalEngineMoves([]);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    currentFen,
    databaseStrengthSettings,
    isSelectedLocalLazy,
    localColor,
    localStatsBase,
    source,
    trimmedLocalPlayerName,
  ]);

  useEffect(() => {
    if (source === "local") return;
    if (!lichessToken.trim()) {
      setOnlineStats([]);
      setOnlineError(null);
      setOnlineLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setOnlineLoading(true);
    setOnlineError(null);

    void fetchWebExplorerMoveStats({
      source,
      fen: currentFen,
      token: lichessToken,
      options: explorerOptions,
      strengthSettings: databaseStrengthSettings,
      signal: controller.signal,
    })
      .then((stats) => {
        if (!active) return;
        setOnlineStats(stats);
      })
      .catch((error) => {
        if (!active) return;
        setOnlineStats([]);
        setOnlineError(
          error instanceof Error ? error.message : "Could not query Lichess explorer.",
        );
      })
      .finally(() => {
        if (active) setOnlineLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [currentFen, databaseStrengthSettings, explorerOptions, lichessToken, refreshKey, source]);

  const stats = source === "local" ? localStats : onlineStats;
  const sortedStats = useMemo(
    () => sortWebDatabaseMoveStats(stats, databaseStatsSort),
    [databaseStatsSort, stats],
  );
  const matchCount =
    visibleDatabaseView === "games" && source === "local" && !isSelectedLocalLazy
      ? localPositionGames.length
      : stats.reduce((sum, stat) => sum + stat.total, 0);
  const localSourceLabel =
    trimmedLocalPlayerName && selectedLocalDatabase && !isSelectedLocalLazy
      ? `${trimmedLocalPlayerName} as ${localColor} in ${selectedLocalDatabase.name}`
      : (selectedLocalDatabase?.name ?? "Local database");
  const sourceLabel = source === "local" ? localSourceLabel : getExplorerSourceLabel(source);
  const selectedDatabaseBadgeLabel = selectedLocalDatabase
    ? formatDatabasePickerLabel(selectedLocalDatabase.name)
    : selectedLocalHostedFolder
      ? getHostedDatabaseLeafLabel(selectedLocalHostedFolder.path)
      : "";
  const databaseCanStart =
    source === "local"
      ? Boolean(selectedLocalId) && !loadingLocalSource && !localLazyLoading
      : Boolean(lichessToken.trim()) && !onlineLoading;
  const startDatabaseMoves = () => {
    setStoredView("stats");
    setStoredPanelStage("moves");
  };

  const databaseContent =
    source === "local" && loadingLocalSource ? (
      <Center h={150}>
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            {formatHostedLoadProgress(loadingLocalSource, loadingLocalProgress)}
          </Text>
        </Stack>
      </Center>
    ) : source === "local" && isSelectedLocalLazy && localLazyLoading ? (
      <Center h={150}>
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            Loading one position from {sourceLabel}
          </Text>
        </Stack>
      </Center>
    ) : source === "local" && isSelectedLocalLazy && localLazyError ? (
      <UnderBoardEmpty
        icon={<IconDatabase size={30} />}
        title="Position index unavailable"
        text={localLazyError}
      />
    ) : source !== "local" && !lichessToken.trim() ? (
      <UnderBoardEmpty
        icon={<IconDatabase size={30} />}
        title={`${sourceLabel} locked`}
        text="Sign in to use this source."
      />
    ) : onlineLoading && source !== "local" ? (
      <Center h={150}>
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            Querying {sourceLabel}
          </Text>
        </Stack>
      </Center>
    ) : onlineError && source !== "local" ? (
      <UnderBoardEmpty
        icon={<IconDatabase size={30} />}
        title="Explorer unavailable"
        text={onlineError}
      />
    ) : visibleDatabaseView === "options" ? (
      source === "local" && selectedLocalId && isSelectedLocalLazy ? (
        <UnderBoardEmpty
          icon={<IconDatabase size={30} />}
          title="Lazy synced source"
          text="This database is queried one position at a time on phone, so player/date/result filters need a full PGN import."
        />
      ) : source === "local" && selectedLocalId ? (
        <WebDatabaseOptionsPanel
          sourceLabel={sourceLabel}
          startDate={localStartDate}
          endDate={localEndDate}
          result={localResult}
          onStartDateChange={setLocalStartDate}
          onEndDateChange={setLocalEndDate}
          onResultChange={(result) => setLocalResultValue(result)}
        />
      ) : source !== "local" ? (
        <WebExplorerOptionsPanel
          source={source}
          lichessOptions={lichessOptions}
          mastersOptions={mastersOptions}
          onLichessOptionsChange={setLichessOptions}
          onMastersOptionsChange={setMastersOptions}
        />
      ) : null
    ) : visibleDatabaseView === "games" ? (
      source === "local" && selectedLocalId && isSelectedLocalLazy ? (
        <UnderBoardEmpty
          icon={<IconDatabase size={30} />}
          title="No game samples"
          text="This synced database is lazy-loaded for move stats. Open the PGN from Files if you need individual source games on phone."
        />
      ) : source === "local" && selectedLocalId ? (
        <WebDatabaseGamesList games={localPositionGames} onOpenGame={onOpenSourceGame} />
      ) : source !== "local" ? (
        <UnderBoardEmpty
          icon={<IconDatabase size={30} />}
          title="No game samples"
          text={`${sourceLabel} move stats are available here; sample games are not downloaded on phone yet.`}
        />
      ) : null
    ) : source === "local" && !hasLocalChoices ? (
      <UnderBoardEmpty
        icon={<IconDatabase size={30} />}
        title="No local databases"
        text={
          hostedDatabases.loading
            ? "Loading hosted database list."
            : "Import PGNs or wait for the phone-site sync."
        }
      />
    ) : source === "local" && !selectedLocalId ? (
      <UnderBoardEmpty
        icon={<IconDatabase size={30} />}
        title="Pick a database"
        text="Choose one synced source."
      />
    ) : stats.length === 0 ? (
      <UnderBoardEmpty
        icon={<IconDatabase size={30} />}
        title="No moves here"
        text={`${sourceLabel} has no games at this position.`}
      />
    ) : (
      <CompactMoveTable
        stats={sortedStats}
        showState={false}
        emptyLabel="No database moves"
        onPlayMove={onPlayMove}
        onOpenSourceGame={source === "local" && !isSelectedLocalLazy ? onOpenSourceGame : undefined}
      />
    );

  return (
    <Stack gap={databaseStarted ? 4 : 6}>
      {!databaseStarted ? (
        <Stack gap={6} className={classes.databaseSetup}>
          <Group
            justify="space-between"
            gap={6}
            align="center"
            wrap="wrap"
            className={classes.databaseSetupHeader}
          >
            <Group gap={6} wrap="wrap" className={classes.databaseSetupTitle}>
              <Text fw={700} size="sm">
                Database
              </Text>
              <Badge variant="light" size="sm">
                {source === "local" ? "Local" : getExplorerSourceLabel(source)}
              </Badge>
              {source === "local" && selectedDatabaseBadgeLabel ? (
                <Badge variant="light" size="sm">
                  {selectedDatabaseBadgeLabel}
                </Badge>
              ) : null}
              {visibleDatabaseView !== "options" ? (
                <Badge color="gray" variant="light" size="sm">
                  {formatCount(matchCount)} matches
                </Badge>
              ) : null}
            </Group>
            <Button
              size="xs"
              leftSection={<IconPlayerPlay size={14} />}
              disabled={!databaseCanStart}
              onClick={startDatabaseMoves}
            >
              Start
            </Button>
          </Group>

          <Group gap={6} align="center" wrap="wrap" className={classes.databaseSetupControls}>
            <SegmentedControl
              aria-label="Database source"
              size="xs"
              value={source}
              onChange={(value) => setSource(value as WebDatabasePanelSource)}
              data={[
                { value: "local", label: "Local" },
                { value: "lichess-all", label: "Lichess All" },
                { value: "lichess-masters", label: "Lichess Masters" },
              ]}
            />
            {source === "local" ? (
              <>
                <DatabaseFolderSelect
                  size="xs"
                  value={selectedLocalPickerValue}
                  onChange={(value) => void chooseLocalDatabase(value)}
                  data={sourceOptions}
                  placeholder={hasLocalChoices ? "Choose database" : "No local databases"}
                  allowDeselect={false}
                  loading={Boolean(loadingLocalSource)}
                  loadingLabel={loadingLocalSource ? `Loading ${loadingLocalSource}` : undefined}
                  flex="1 1 11rem"
                  minWidth="11rem"
                />
                {selectedLocalId && !isSelectedLocalLazy ? (
                  <WebDatabasePerspectiveControls
                    playerName={localPlayerName}
                    playerOptions={selectedDatabasePlayers}
                    color={localColor}
                    onPlayerNameChange={setLocalPlayerName}
                    onColorChange={(color) => setLocalColorValue(color)}
                    playerFlex="1 1 10rem"
                    colorWidth={trimmedLocalPlayerName ? 236 : 132}
                  />
                ) : null}
              </>
            ) : (
              <>
                <WebLichessAccessControls token={lichessToken} signedInLabel="Lichess saved" />
                <ActionIcon
                  aria-label="Refresh Lichess explorer"
                  onClick={() => setRefreshKey((key) => key + 1)}
                  disabled={!lichessToken.trim()}
                  loading={onlineLoading}
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </>
            )}
          </Group>

          <Group
            justify="space-between"
            gap={6}
            align="center"
            wrap="wrap"
            className={classes.databaseSetupControls}
          >
            <SegmentedControl
              aria-label="Database view"
              size="xs"
              value={databaseView}
              onChange={(value) => setStoredView(value as WebDatabasePanelView)}
              data={[
                { value: "stats", label: "Stats" },
                { value: "games", label: "Games" },
                { value: "options", label: "Options" },
              ]}
            />
            {databaseView === "stats" ? (
              <Group gap={6} wrap="wrap" justify="flex-end">
                <WebPrepStrengthSettingsButton
                  builderSettings={databaseStrengthSettings}
                  updateBuilderSettings={(patch) =>
                    setDatabaseStrengthSettings((current) =>
                      normalizeWebPrepStrengthSettings({ ...current, ...patch }),
                    )
                  }
                  buttonLabel="Strength"
                />
                <Select
                  aria-label="Database move sort"
                  size="xs"
                  value={databaseStatsSort}
                  data={WEB_DATABASE_STATS_SORT_OPTIONS}
                  onChange={(value) =>
                    setStoredStatsSort((value as WebDatabaseStatsSort | null) ?? "games")
                  }
                  allowDeselect={false}
                  w={154}
                />
              </Group>
            ) : null}
          </Group>

          {source === "local" && loadingLocalSource ? (
            <Group gap="xs" wrap="nowrap">
              <Loader size="xs" />
              <Text size="xs" c="dimmed" truncate>
                {formatHostedLoadProgress(loadingLocalSource, loadingLocalProgress)}
              </Text>
            </Group>
          ) : source === "local" && isSelectedLocalLazy && localLazyLoading ? (
            <Group gap="xs" wrap="nowrap">
              <Loader size="xs" />
              <Text size="xs" c="dimmed" truncate>
                Loading {sourceLabel} position
              </Text>
            </Group>
          ) : null}
        </Stack>
      ) : null}

      {databaseStarted ? (
        <Box className={classes.databaseStartedMoves}>
          <Group gap={4} wrap="nowrap" justify="flex-end" className={classes.startedMovesToolbar}>
            <Select
              aria-label="Database move sort"
              className={classes.startedSortSelect}
              size="xs"
              value={databaseStatsSort}
              data={WEB_DATABASE_STATS_SORT_OPTIONS}
              onChange={(value) =>
                setStoredStatsSort((value as WebDatabaseStatsSort | null) ?? "games")
              }
              allowDeselect={false}
              leftSection={<IconArrowsSort size={14} />}
              comboboxProps={{ withinPortal: true }}
            />
            <Tooltip label="Return to database settings">
              <ActionIcon
                aria-label="Return to database settings"
                size="sm"
                variant="filled"
                color="dark"
                onClick={() => setStoredPanelStage("setup")}
              >
                <IconX size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {databaseContent}
        </Box>
      ) : null}
    </Stack>
  );
}

type WebEnginePanelStatus = "idle" | "loading" | "running" | "complete" | "error";

function EngineNumberStepper({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const safeValue = clampWholeNumber(value, min, max, value);
  const updateValue = (delta: number) => {
    onChange(clampWholeNumber(safeValue + delta, min, max, safeValue));
  };

  return (
    <Box className={classes.engineStepControl}>
      <Text size="xs" c="dimmed" className={classes.engineStepLabel}>
        {label}
      </Text>
      <Box
        className={classes.engineStepShell}
        aria-label={`${label} ${safeValue}`}
        aria-disabled={disabled || undefined}
      >
        <Text className={classes.engineStepValue} aria-live="polite">
          {safeValue}
        </Text>
        <Box className={classes.engineStepButtons}>
          <ActionIcon
            aria-label={`Increase ${label.toLowerCase()}`}
            className={classes.engineStepButton}
            disabled={disabled || safeValue >= max}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => updateValue(1)}
            radius={0}
            size="xs"
            variant="subtle"
          >
            <IconChevronUp size={12} />
          </ActionIcon>
          <ActionIcon
            aria-label={`Decrease ${label.toLowerCase()}`}
            className={classes.engineStepButton}
            disabled={disabled || safeValue <= min}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => updateValue(-1)}
            radius={0}
            size="xs"
            variant="subtle"
          >
            <IconChevronDown size={12} />
          </ActionIcon>
        </Box>
      </Box>
    </Box>
  );
}

function EngineUnderBoardPanel({
  analysisRequestId,
  compact = false,
  currentFen,
  upcomingFens,
  onAnalysisLinesChange,
  onPlayMove,
  suspended = false,
}: {
  analysisRequestId?: number;
  compact?: boolean;
  currentFen: string;
  upcomingFens: string[];
  onAnalysisLinesChange: (fen: string, lines: WebEngineLine[]) => void;
  onPlayMove: (uci: string) => void;
  suspended?: boolean;
}) {
  const [settings, setSettings] = usePersistentJson(
    WEB_ENGINE_PANEL_SETTINGS_STORAGE_KEY,
    DEFAULT_WEB_ENGINE_PANEL_SETTINGS,
    normalizeWebEnginePanelSettings,
  );
  const [stockfishLines, setStockfishLines] = useState<WebEngineLine[]>([]);
  const [status, setStatus] = useState<WebEnginePanelStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const updateSettings = (patch: Partial<WebEnginePanelSettings>) => {
    setSettings((current) => normalizeWebEnginePanelSettings({ ...current, ...patch }));
  };

  useEffect(() => {
    if (!analysisRequestId) return;
    setSettings((current) =>
      current.enabled ? current : normalizeWebEnginePanelSettings({ ...current, enabled: true }),
    );
  }, [analysisRequestId, setSettings]);

  useEffect(() => {
    if (!settings.enabled || suspended) {
      stopWebStockfish18Search();
      setStatus("idle");
      setError(null);
      setStockfishLines([]);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setStatus("running");
    setError(null);
    setStockfishLines([]);

    void analyzeWithWebStockfish18({
      fen: currentFen,
      multipv: settings.multipv,
      depth: settings.depth,
      infinite: settings.infinite,
      prefetchFens: upcomingFens,
      signal: controller.signal,
      onUpdate: (lines) => {
        if (!active) return;
        setStockfishLines(lines);
        setStatus("running");
      },
    })
      .then((lines) => {
        if (!active) return;
        setStockfishLines(lines);
        setStatus("complete");
      })
      .catch((engineError) => {
        if (!active || isAbortError(engineError)) return;
        setStockfishLines([]);
        setStatus("error");
        setError(engineError instanceof Error ? engineError.message : "Stockfish 18 failed.");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    currentFen,
    settings.depth,
    settings.enabled,
    settings.infinite,
    settings.multipv,
    suspended,
    upcomingFens,
  ]);

  const displayLines = stockfishLines;
  useEffect(() => {
    onAnalysisLinesChange(currentFen, settings.enabled && !suspended ? displayLines : []);
  }, [currentFen, displayLines, onAnalysisLinesChange, settings.enabled, suspended]);

  useEffect(() => {
    return () => onAnalysisLinesChange(currentFen, []);
  }, [currentFen, onAnalysisLinesChange]);

  const topLine = displayLines[0] ?? null;
  const analysisEnabled = settings.enabled && !suspended;
  const progress = getWebEngineProgress({
    enabled: analysisEnabled,
    status,
    lines: displayLines,
    targetDepth: settings.infinite ? 70 : settings.depth,
  });
  const headerStatus = getWebEngineHeaderStatus({
    enabled: analysisEnabled,
    status,
    topLine,
  });
  const liveLineSpeed = topLine ? formatWebEngineNodeSpeed(topLine.nps) : null;
  const nodeCount = topLine ? formatWebEngineNodeCount(topLine.nodes) : null;
  const analysisSource = topLine ? getWebEngineSourceLabel(topLine) : "Stockfish";
  const compactEngineMeta = getWebCompactEngineMeta({
    enabled: analysisEnabled,
    topLine,
    nodeCount,
    liveLineSpeed,
  });

  if (compact) {
    return (
      <Box className={classes.compactEnginePanel} data-enabled={analysisEnabled}>
        <Group
          className={classes.compactEngineHeader}
          gap="xs"
          justify="space-between"
          wrap="nowrap"
        >
          <Group gap={6} wrap="nowrap" miw={0}>
            <IconCpu className={classes.compactEngineIcon} size={16} />
            <Text className={classes.compactEngineTitle} fw={700} size="xs" truncate>
              {analysisSource}
            </Text>
          </Group>
          <Group className={classes.compactEngineHeaderRight} gap={6} wrap="nowrap">
            {compactEngineMeta ? (
              <Text
                aria-label={compactEngineMeta.accessibleLabel}
                className={classes.compactEngineMeta}
                size="xs"
                c="dimmed"
                title={compactEngineMeta.accessibleLabel}
              >
                {compactEngineMeta.label}
              </Text>
            ) : null}
            <Switch
              aria-label="Toggle Stockfish 18 analysis"
              checked={settings.enabled}
              onChange={(event) => updateSettings({ enabled: event.currentTarget.checked })}
              size="xs"
            />
          </Group>
        </Group>

        {settings.enabled ? (
          suspended ? (
            <Text className={classes.compactEngineMessage} size="xs" c="dimmed" lineClamp={1}>
              Paused while Coach reviews the game
            </Text>
          ) : error ? (
            <Text className={classes.compactEngineMessage} size="xs" c="red" lineClamp={1}>
              {error}
            </Text>
          ) : displayLines.length > 0 ? (
            <Box className={classes.compactEngineLines}>
              {displayLines.slice(0, 3).map((line) => {
                const firstMove = line.uciMoves[0] ?? null;
                const pv =
                  line.sanMoves.length > 0
                    ? line.sanMoves.slice(0, 5).join(" ")
                    : line.uciMoves.slice(0, 5).join(" ");
                return (
                  <button
                    key={`${line.source}-${line.multipv}`}
                    type="button"
                    className={classes.compactEngineLine}
                    disabled={!firstMove}
                    onClick={() => firstMove && onPlayMove(firstMove)}
                    aria-label={`Play compact engine line ${line.multipv}`}
                  >
                    <span className={classes.compactEngineLineEval}>
                      {formatWebEngineScore(line.score)}
                    </span>
                    <span className={classes.compactEngineLineMoves} title={pv || undefined}>
                      {pv || "-"}
                    </span>
                  </button>
                );
              })}
            </Box>
          ) : (
            <Group className={classes.compactEngineMessage} gap={6} wrap="nowrap">
              <Loader size={11} />
              <Text size="xs" c="dimmed" truncate>
                Waiting for the first PC line
              </Text>
            </Group>
          )
        ) : null}
      </Box>
    );
  }

  return (
    <Box className={classes.enginePanelShell}>
      <Box className={classes.enginePanelHeader}>
        <ActionIcon
          className={classes.enginePanelToggle}
          aria-label={
            suspended
              ? "Stockfish 18 paused while Coach reviews"
              : settings.enabled
                ? "Pause Stockfish 18"
                : "Start Stockfish 18"
          }
          variant={analysisEnabled ? "filled" : "subtle"}
          color={analysisEnabled ? "blue" : "gray"}
          onClick={() => updateSettings({ enabled: !settings.enabled })}
        >
          {analysisEnabled ? <IconPlayerPause size={17} /> : <IconPlayerPlay size={17} />}
        </ActionIcon>

        <Box className={classes.enginePanelTitleArea}>
          <Group gap={6} wrap="nowrap" miw={0}>
            <Text fw={700} size="sm" truncate>
              Stockfish 18
            </Text>
            {suspended && settings.enabled ? (
              <Code className={classes.enginePanelCode}>Coach review</Code>
            ) : headerStatus ? (
              <Code className={classes.enginePanelCode} c={engineStatusTextColor(status)}>
                {headerStatus}
              </Code>
            ) : null}
          </Group>
        </Box>

        <Group className={classes.enginePanelHeaderRight} gap={8} wrap="nowrap">
          <Box className={classes.enginePanelMetric}>
            <Text size="xs" c="dimmed">
              Eval
            </Text>
            <Text size="sm" fw={800}>
              {topLine ? formatWebEngineScore(topLine.score) : "--"}
            </Text>
          </Box>
          <Box className={classes.enginePanelMetric}>
            <Text size="xs" c="dimmed">
              Depth
            </Text>
            <Text size="sm" fw={800}>
              {topLine?.depth ? topLine.depth : "--"}
            </Text>
          </Box>
          <Box className={classes.enginePanelMetric}>
            <Text size="xs" c="dimmed">
              Nodes
            </Text>
            <Text size="sm" fw={800} title={topLine?.nodes?.toLocaleString()}>
              {nodeCount ?? "--"}
            </Text>
          </Box>
          <Box className={classes.enginePanelMetric}>
            <Text size="xs" c="dimmed">
              NPS
            </Text>
            <Text size="sm" fw={800}>
              {liveLineSpeed ? liveLineSpeed.replace(" NPS", "") : "--"}
            </Text>
          </Box>
          <ActionIcon.Group>
            <Tooltip label="Engine settings">
              <ActionIcon
                aria-label="Engine settings"
                variant={settingsOpen ? "light" : "subtle"}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <IconSettings size={16} />
              </ActionIcon>
            </Tooltip>
          </ActionIcon.Group>
        </Group>
      </Box>

      <Collapse in={settingsOpen}>
        <Box className={classes.enginePanelSettings}>
          <Group gap="xs" grow className={classes.engineSettingsRow}>
            <EngineNumberStepper
              label="Lines"
              value={settings.multipv}
              min={1}
              max={8}
              disabled={!settings.enabled}
              onChange={(multipv) => updateSettings({ multipv })}
            />
            <EngineNumberStepper
              label="Depth"
              value={settings.depth}
              min={6}
              max={70}
              disabled={!settings.enabled || settings.infinite}
              onChange={(depth) => updateSettings({ depth })}
            />
            <Box className={classes.engineStepControl}>
              <Text size="xs" c="dimmed" className={classes.engineStepLabel}>
                Search
              </Text>
              <Button
                aria-label="Toggle infinite-depth analysis"
                aria-pressed={settings.infinite}
                disabled={!settings.enabled}
                onClick={() => updateSettings({ infinite: !settings.infinite })}
                size="compact-sm"
                variant={settings.infinite ? "filled" : "light"}
              >
                {settings.infinite ? "Infinite on" : "Infinite depth"}
              </Button>
            </Box>
          </Group>
        </Box>
      </Collapse>

      <Progress value={progress} radius={0} size={3} color={status === "error" ? "red" : "blue"} />
      <EngineLineTable
        enabled={settings.enabled}
        error={error}
        lines={displayLines}
        settings={settings}
        onPlayMove={onPlayMove}
      />
    </Box>
  );
}

function EngineLineTable({
  enabled,
  error,
  lines,
  settings,
  onPlayMove,
}: {
  enabled: boolean;
  error: string | null;
  lines: WebEngineLine[];
  settings: WebEnginePanelSettings;
  onPlayMove: (uci: string) => void;
}) {
  if (!enabled) {
    return (
      <Box className={classes.enginePanelMessage}>
        <IconCpu size={26} />
        <Text size="sm" fw={700}>
          Inactive engine
        </Text>
        <Text size="xs" c="dimmed">
          Press play to start Stockfish 18 analysis.
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box className={classes.enginePanelMessage}>
        <IconCpu size={26} />
        <Text size="sm" fw={700}>
          Engine unavailable
        </Text>
        <Text size="xs" c="dimmed">
          {error}
        </Text>
      </Box>
    );
  }

  if (lines.length === 0) {
    const rows = Array.from({ length: Math.max(1, Math.min(settings.multipv, 4)) });
    return (
      <Box className={classes.enginePanelBody}>
        <Table className={classes.engineAnalysisTable} withRowBorders={false}>
          <Table.Tbody>
            {rows.map((_, index) => (
              <Table.Tr key={`engine-skeleton-${index}`}>
                <Table.Td className={classes.engineAnalysisScoreCell}>
                  <Skeleton height={15} width={44} radius="sm" />
                  <Skeleton height={10} width={24} mt={6} radius="sm" />
                </Table.Td>
                <Table.Td>
                  <Skeleton height={14} width={`${75 - index * 10}%`} radius="sm" />
                  <Skeleton height={10} width="36%" mt={7} radius="sm" />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" className={classes.enginePanelLoadingText}>
          Waiting for Stockfish lines from this position
        </Text>
      </Box>
    );
  }

  return (
    <Box className={classes.enginePanelBody}>
      <Table className={classes.engineAnalysisTable} withRowBorders={false}>
        <Table.Tbody>
          {lines.map((line) => {
            const firstMove = line.uciMoves[0] ?? null;
            const pv = line.sanMoves.length > 0 ? line.sanMoves.join(" ") : line.uciMoves.join(" ");
            const speed = formatWebEngineNodeSpeed(line.nps);
            const nodes = formatWebEngineNodeCount(line.nodes);
            return (
              <Table.Tr key={`${line.source}-${line.multipv}`}>
                <Table.Td className={classes.engineAnalysisScoreCell}>
                  <Text size="sm" fw={800} className={classes.engineAnalysisScore}>
                    {formatWebEngineScore(line.score)}
                  </Text>
                  <Text size="xs" c="dimmed" className={classes.engineAnalysisRank}>
                    #{line.multipv}
                  </Text>
                </Table.Td>
                <Table.Td className={classes.engineAnalysisLineCell}>
                  <button
                    type="button"
                    className={classes.engineAnalysisMoveButton}
                    disabled={!firstMove}
                    onClick={() => firstMove && onPlayMove(firstMove)}
                    aria-label={`Play engine line ${line.multipv}`}
                  >
                    {pv || "-"}
                  </button>
                  <Group gap={5} wrap="nowrap" className={classes.engineAnalysisMeta}>
                    <Code className={classes.enginePanelCode}>{getWebEngineSourceLabel(line)}</Code>
                    <Text size="xs" c="dimmed">
                      d{line.depth || "?"}
                    </Text>
                    {nodes ? (
                      <Text size="xs" c="dimmed" truncate title={line.nodes?.toLocaleString()}>
                        {nodes} nodes
                      </Text>
                    ) : null}
                    {speed ? (
                      <Text size="xs" c="dimmed" truncate>
                        {speed}
                      </Text>
                    ) : null}
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Box>
  );
}

function PrepUnderBoardPanel({
  state,
  setState,
  activePrep,
  currentFen,
  stats,
  branchFen,
  branchStart,
  rootStats,
  currentLine,
  rootLine,
  isInsidePrepLine,
  onPlayMove,
  onPlayRootMove,
  onOpenSourceGame,
  importHostedFolder,
  importOnlineGames,
  lichessToken,
}: {
  state: WebCompanionState;
  setState: Dispatch<SetStateAction<WebCompanionState>>;
  activePrep: WebPrepWorkspace | null;
  currentFen: string;
  stats: WebPrepMoveStat[];
  branchFen: string | null;
  branchStart: WebPrepBranchStart | null;
  rootStats: WebPrepMoveStat[];
  currentLine: WebPrepLineMove[];
  rootLine: WebPrepLineMove[];
  isInsidePrepLine: boolean;
  onPlayMove: (stat: WebPrepMoveStat) => void;
  onPlayRootMove: (stat: WebPrepMoveStat) => void;
  onOpenSourceGame: (game: WebGame) => void;
  importHostedFolder: WebHostedFolderImportHandler;
  importOnlineGames: WebOnlineImportHandler;
  lichessToken: string;
}) {
  const [storedPrepSetup, setStoredPrepSetup] = usePersistentJson(
    WEB_PREP_SETUP_STORAGE_KEY,
    DEFAULT_WEB_PREP_SETUP,
    normalizeWebPrepStoredSetup,
  );
  const [opponent, setOpponent] = useState(storedPrepSetup.opponent);
  const [userColor, setUserColor] = useState<WebColor>(storedPrepSetup.userColor);
  const [prepMode, setPrepMode] = useState<WebPrepMode>(storedPrepSetup.mode);
  const [prepSource, setPrepSource] = useState<WebPrepSource>(storedPrepSetup.source);
  const [prepStartDate, setPrepStartDate] = useState(storedPrepSetup.startDate ?? "");
  const [prepEndDate, setPrepEndDate] = useState(storedPrepSetup.endDate ?? "");
  const [prepResult, setPrepResult] = useState<WebLocalResultFilter>(storedPrepSetup.result);
  const [sourceId, setSourceId] = useState<string | null>(
    () =>
      resolveWebDatabaseSourceId(
        storedPrepSetup.sourceRef ?? storedPrepSetup.sourceId,
        state.databases,
      ) ??
      state.databases[0]?.id ??
      null,
  );
  const [minGames, setMinGames] = useState(storedPrepSetup.minGames);
  const [moveLimit, setMoveLimit] = useState(storedPrepSetup.moveLimit);
  const [draftBuilderSettings, setDraftBuilderSettings] = useState<Partial<PrepBuilderSettings>>(
    storedPrepSetup.builder,
  );
  const [draftTemporarySource, setDraftTemporarySource] = useState<WebPrepTemporarySource | null>(
    null,
  );
  const [sourcesOpen] = useState(true);
  const [loadingPrepSource, setLoadingPrepSource] = useState<string | null>(null);
  const [loadingPrepProgress, setLoadingPrepProgress] =
    useState<WebHostedFolderReadProgress | null>(null);
  const refreshingPrepPathRef = useRef<string | null>(null);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineSource, setOnlineSource] = useState<WebOnlineSource>("chesscom");
  const [onlineUsername, setOnlineUsername] = useState("");
  const [onlineMode, setOnlineMode] = useState<WebOnlineImportMode>("count");
  const [onlineCount, setOnlineCount] = useState(50);
  const [onlineRange, setOnlineRange] = useState<WebOnlineRangePreset>("3m");
  const [onlineSaveDatabase, setOnlineSaveDatabase] = useState(true);
  const [onlinePreviewLoading, setOnlinePreviewLoading] = useState(false);
  const [onlinePreviewText, setOnlinePreviewText] = useState("");
  const [onlineProgress, setOnlineProgress] = useState<number | null>(null);
  const [onlinePrepStats, setOnlinePrepStats] = useState<WebPrepMoveStat[]>([]);
  const [onlinePrepLoading, setOnlinePrepLoading] = useState(false);
  const [onlinePrepError, setOnlinePrepError] = useState<string | null>(null);
  const [onlineRootPrepStats, setOnlineRootPrepStats] = useState<WebPrepMoveStat[]>([]);
  const [onlineRootPrepLoading, setOnlineRootPrepLoading] = useState(false);
  const [lazyPrepMoves, setLazyPrepMoves] = useState<WebHostedPositionMove[]>([]);
  const [lazyRootPrepMoves, setLazyRootPrepMoves] = useState<WebHostedPositionMove[]>([]);
  const [lazyPrepEngineMoves, setLazyPrepEngineMoves] = useState<PrepBuilderEngineMove[]>([]);
  const [lazyRootPrepEngineMoves, setLazyRootPrepEngineMoves] = useState<PrepBuilderEngineMove[]>(
    [],
  );
  const [lazyPrepLoading, setLazyPrepLoading] = useState(false);
  const [lazyRootPrepLoading, setLazyRootPrepLoading] = useState(false);
  const [lazyPrepError, setLazyPrepError] = useState<string | null>(null);
  const [explorerOptionsOpen, setExplorerOptionsOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [prepSort, setPrepSort] = useState<WebPrepSortState>(
    () => getDefaultWebPrepSortState(storedPrepSetup.sortDefaults).opponent,
  );
  const [prepCandidateSort, setPrepCandidateSort] = useState<
    WebPrepSortState<WebPrepCandidateSortColumn>
  >(() => getDefaultWebPrepSortState(storedPrepSetup.sortDefaults).candidate);
  const { lichessOptions, setLichessOptions, mastersOptions, setMastersOptions, explorerOptions } =
    useWebExplorerOptions();
  const hostedDatabases = useHostedDatabaseFolders();
  const hostedDatabaseLibraryReady = Boolean(hostedDatabases.library?.manifest);
  const selectableDatabases = useMemo(
    () =>
      filterWebSourceDatabases(
        filterWebDatabasesByHostedAvailability({
          databases: state.databases,
          hostedFolders: hostedDatabases.folders,
          hostedLibraryReady: hostedDatabaseLibraryReady,
        }),
        state.prepWorkspaces.flatMap((prep) => prep.sourceIds),
      ),
    [hostedDatabaseLibraryReady, hostedDatabases.folders, state.databases, state.prepWorkspaces],
  );
  const sourceOptions = useMemo(
    () =>
      getWebDatabaseSelectData({
        databases: selectableDatabases,
        hostedFolders: hostedDatabases.folders,
        includeOnline: true,
        temporarySource: activePrep?.temporarySource ?? draftTemporarySource,
      }),
    [
      activePrep?.temporarySource,
      draftTemporarySource,
      hostedDatabases.folders,
      selectableDatabases,
    ],
  );
  const selectedPrepMode = activePrep?.mode ?? prepMode;
  const selectedPrepSource = activePrep?.source ?? prepSource;
  const selectedTemporarySource = activePrep?.temporarySource ?? draftTemporarySource;
  const selectedPrepSourceId = getWebPrepSelectedLocalSourceId({
    activePrep,
    selectedSource: selectedPrepSource,
    draftSourceId: sourceId,
  });
  const draftPrepStoredHostedPath = useMemo(
    () =>
      !activePrep && selectedPrepSource === "local"
        ? getWebDatabaseHostedPathFromSourceStorageValue(storedPrepSetup.sourceRef)
        : null,
    [activePrep, selectedPrepSource, storedPrepSetup.sourceRef],
  );
  const activePrepSourceId = selectedPrepSource === "local" ? selectedPrepSourceId : null;
  const activePrepSourceDatabase =
    selectableDatabases.find((database) => database.id === activePrepSourceId) ?? null;
  const selectedPrepSourceIsLazy = Boolean(
    selectedPrepSource === "local" &&
    activePrepSourceDatabase?.hostedLazy &&
    activePrepSourceDatabase.hostedPath,
  );
  const selectedPrepHostedPath = activePrepSourceDatabase?.hostedPath ?? draftPrepStoredHostedPath;
  const selectedPrepHostedFolder = useMemo(
    () =>
      selectedPrepHostedPath
        ? (hostedDatabases.folders.find((folder) => folder.path === selectedPrepHostedPath) ?? null)
        : null,
    [hostedDatabases.folders, selectedPrepHostedPath],
  );
  const selectedPrepSourceValue =
    selectedPrepSource === "lichess-all"
      ? WEB_LICHESS_ALL_SOURCE_VALUE
      : selectedPrepSource === "lichess-masters"
        ? WEB_LICHESS_MASTERS_SOURCE_VALUE
        : selectedPrepSource === "temporary"
          ? WEB_TEMPORARY_PREP_SOURCE_VALUE
          : activePrepSourceDatabase?.hostedPath
            ? hostedDatabaseValue(activePrepSourceDatabase.hostedPath)
            : selectedPrepHostedFolder
              ? hostedDatabaseValue(selectedPrepHostedFolder.path)
              : selectedPrepSourceId;
  const activePrepSourceGames =
    activePrepSourceDatabase && !selectedPrepSourceIsLazy
      ? (state.gamesByDatabase[activePrepSourceDatabase.id] ?? [])
      : [];
  const selectedPrepSourceGames =
    selectedPrepSource === "temporary"
      ? (selectedTemporarySource?.games ?? [])
      : activePrepSourceGames;
  const activePrepHostedFolder = selectedPrepHostedFolder;
  const selectedMinGames = activePrep?.minGames ?? minGames;
  const selectedMoveLimit = activePrep?.moveLimit ?? moveLimit;
  const selectedPrepStartDate = activePrep?.startDate ?? prepStartDate;
  const selectedPrepEndDate = activePrep?.endDate ?? prepEndDate;
  const selectedPrepResult = normalizeWebLocalResultFilter(activePrep?.result ?? prepResult);
  const selectedPrepLocalFilters = useMemo<WebLocalGameFilters>(
    () => ({
      startDate: selectedPrepStartDate || undefined,
      endDate: selectedPrepEndDate || undefined,
      result: selectedPrepResult,
    }),
    [selectedPrepEndDate, selectedPrepResult, selectedPrepStartDate],
  );
  const selectedPrepFilteredSourceGames = useMemo(
    () =>
      selectedPrepSource === "local"
        ? filterWebGamesByLocalFilters(selectedPrepSourceGames, selectedPrepLocalFilters)
        : selectedPrepSourceGames,
    [selectedPrepLocalFilters, selectedPrepSource, selectedPrepSourceGames],
  );
  const selectedPrepDatabasePlayers = useMemo(
    () => getDatabasePlayerCounts(selectedPrepFilteredSourceGames),
    [selectedPrepFilteredSourceGames],
  );
  const selectedBuilderSettings = useMemo(
    () => normalizeWebPrepStrengthSettings(activePrep?.builder ?? draftBuilderSettings),
    [activePrep?.builder, draftBuilderSettings],
  );
  const selectedPrepSortDefaults = useMemo(
    () =>
      normalizeWebPrepMoveSortDefaults(activePrep?.sortDefaults ?? storedPrepSetup.sortDefaults),
    [activePrep?.sortDefaults, storedPrepSetup.sortDefaults],
  );
  const selectedPlayerColor = oppositeWebColor(activePrep?.userColor ?? userColor);
  const selectedOpponentName = activePrep?.opponent ?? opponent;
  const trimmedSelectedOpponentName = selectedOpponentName.trim();
  const sourceReady =
    selectedPrepSource === "local"
      ? Boolean(activePrepSourceId)
      : selectedPrepSource === "temporary"
        ? Boolean(selectedTemporarySource)
        : Boolean(lichessToken.trim());
  const targetReady = selectedPrepMode === "general" || trimmedSelectedOpponentName.length >= 3;
  const configReady = sourceReady && targetReady;
  const selectedSourceLabel =
    selectedPrepSource === "temporary"
      ? selectedTemporarySource
        ? `${formatDatabasePickerLabel(selectedTemporarySource.name)} (unsaved)`
        : "Unsaved prep source"
      : selectedPrepSource === "lichess-all"
        ? "Lichess All"
        : selectedPrepSource === "lichess-masters"
          ? "Lichess Masters"
          : activePrepSourceDatabase
            ? formatDatabasePickerLabel(activePrepSourceDatabase.name)
            : (sourceOptions
                .flatMap((group) => group.items)
                .find((item) => item.value === selectedPrepSourceValue)?.label ?? null);
  const lazyPrepStatsBase = useMemo(
    () =>
      activePrep && selectedPrepSourceIsLazy
        ? getWebHostedPositionMoveStats({
            moves: lazyPrepMoves,
            fen: currentFen,
            side: activePrep.userColor,
            sourceLabel: getWebPrepSourceLabelForFen(currentFen, activePrep.userColor),
            strengthSide: getWebPrepStrengthSideForFen(currentFen, activePrep.userColor),
            strengthSettings: activePrep.builder,
          })
        : [],
    [activePrep, currentFen, lazyPrepMoves, selectedPrepSourceIsLazy],
  );
  const lazyPrepStats = useMemo(
    () =>
      activePrep && selectedPrepSourceIsLazy
        ? getWebHostedPositionMoveStats({
            moves: lazyPrepMoves,
            fen: currentFen,
            side: activePrep.userColor,
            sourceLabel: getWebPrepSourceLabelForFen(currentFen, activePrep.userColor),
            strengthSide: getWebPrepStrengthSideForFen(currentFen, activePrep.userColor),
            strengthSettings: activePrep.builder,
            engineMoves: lazyPrepEngineMoves,
          })
        : [],
    [activePrep, currentFen, lazyPrepEngineMoves, lazyPrepMoves, selectedPrepSourceIsLazy],
  );
  const lazyRootPrepStatsBase = useMemo(
    () =>
      activePrep && selectedPrepSourceIsLazy && branchFen
        ? getWebHostedPositionMoveStats({
            moves: lazyRootPrepMoves,
            fen: branchFen,
            side: activePrep.userColor,
            sourceLabel: getWebPrepSourceLabelForFen(branchFen, activePrep.userColor),
            strengthSide: getWebPrepStrengthSideForFen(branchFen, activePrep.userColor),
            strengthSettings: activePrep.builder,
          })
        : [],
    [activePrep, branchFen, lazyRootPrepMoves, selectedPrepSourceIsLazy],
  );
  const lazyRootPrepStats = useMemo(
    () =>
      activePrep && selectedPrepSourceIsLazy && branchFen
        ? getWebHostedPositionMoveStats({
            moves: lazyRootPrepMoves,
            fen: branchFen,
            side: activePrep.userColor,
            sourceLabel: getWebPrepSourceLabelForFen(branchFen, activePrep.userColor),
            strengthSide: getWebPrepStrengthSideForFen(branchFen, activePrep.userColor),
            strengthSettings: activePrep.builder,
            engineMoves: lazyRootPrepEngineMoves,
          })
        : [],
    [activePrep, branchFen, lazyRootPrepEngineMoves, lazyRootPrepMoves, selectedPrepSourceIsLazy],
  );
  const displayedStats =
    activePrep && isOnlinePrepSource(selectedPrepSource)
      ? onlinePrepStats.filter((stat) => stat.total >= selectedMinGames).slice(0, selectedMoveLimit)
      : activePrep && selectedPrepSourceIsLazy
        ? lazyPrepStats.filter((stat) => stat.total >= selectedMinGames).slice(0, selectedMoveLimit)
        : stats;
  const displayedRootStats =
    activePrep && isOnlinePrepSource(selectedPrepSource)
      ? onlineRootPrepStats
          .filter((stat) => stat.total >= selectedMinGames)
          .slice(0, selectedMoveLimit)
      : activePrep && selectedPrepSourceIsLazy
        ? lazyRootPrepStats
            .filter((stat) => stat.total >= selectedMinGames)
            .slice(0, selectedMoveLimit)
        : rootStats;
  const activeBranch = useMemo(
    () =>
      activePrep && branchStart
        ? (branchStart.activeBranch ??
          findFirstWebPrepOpponentBranch(currentLine, branchStart.branchPly, activePrep.userColor))
        : null,
    [activePrep, branchStart, currentLine],
  );
  const activeBranchSourceGame = useMemo(() => {
    if (
      !activePrep ||
      !activeBranch ||
      isOnlinePrepSource(selectedPrepSource) ||
      selectedPrepSourceIsLazy
    )
      return null;
    const branchMoveStats = getWebPrepMoveStats({
      games: selectedPrepSourceGames,
      prep: activePrep,
      fen: activeBranch.move.fenBefore,
      maxExamples: 1,
    });
    return branchMoveStats.find((stat) => stat.key === activeBranch.key)?.examples[0] ?? null;
  }, [
    activeBranch,
    activePrep,
    selectedPrepSource,
    selectedPrepSourceGames,
    selectedPrepSourceIsLazy,
  ]);
  const openRootStats = activePrep
    ? displayedRootStats.filter((stat) => !activePrep.skippedMoves?.[stat.key])
    : displayedRootStats;
  const commonOpenStat = activePrep
    ? getFirstOpenPrepStat(openRootStats, activePrep.preparedMoves)
    : null;
  const setupOpen = !activePrep || (activePrep.panelStage ?? "train") === "setup";
  const showSetupStage = setupOpen;
  const showTrainingStage = Boolean(activePrep) && !setupOpen;
  const opponentToMove = activePrep
    ? getFenColor(currentFen) === oppositeWebColor(activePrep.userColor)
    : false;
  const startedMoveKeys = useMemo(
    () =>
      new Set((activePrep?.line ?? []).map((move) => getWebPrepMoveKey(move.fenBefore, move.san))),
    [activePrep?.line],
  );
  const preparedCount = displayedStats.filter(
    (stat) =>
      getWebPrepBranchStatus(
        stat,
        activePrep?.preparedMoves,
        activePrep?.skippedMoves,
        startedMoveKeys,
      ) === "prepared",
  ).length;
  const startedCount = displayedStats.filter(
    (stat) =>
      getWebPrepBranchStatus(
        stat,
        activePrep?.preparedMoves,
        activePrep?.skippedMoves,
        startedMoveKeys,
      ) === "started",
  ).length;
  const skippedCount = displayedStats.filter(
    (stat) =>
      getWebPrepBranchStatus(
        stat,
        activePrep?.preparedMoves,
        activePrep?.skippedMoves,
        startedMoveKeys,
      ) === "skipped",
  ).length;
  const shownGamesCount = displayedStats.reduce((sum, stat) => sum + stat.total, 0);
  const branchStatsByKey = useMemo<Record<string, WebPrepBranchCoverageStats>>(() => {
    if (!activePrep || !opponentToMove) return {};
    return Object.fromEntries(
      displayedStats.map((stat) => [
        stat.key,
        getWebPrepBranchCoverageStats({
          line: activePrep.line,
          branchPly: currentLine.length,
          row: stat,
          games: selectedPrepSourceGames,
          prep: activePrep,
          minGames: selectedMinGames,
          moveLimit: selectedMoveLimit,
          preparedMoves: activePrep.preparedMoves,
          skippedMoves: activePrep.skippedMoves ?? {},
          startedMoveKeys,
        }),
      ]),
    );
  }, [
    activePrep,
    currentLine.length,
    displayedStats,
    opponentToMove,
    selectedMinGames,
    selectedMoveLimit,
    selectedPrepSourceGames,
    startedMoveKeys,
  ]);
  const rootStartLabel =
    rootLine.length > 0 ? rootLine.map((move) => move.san).join(" ") : "game start";
  const firstLocalSourceId = selectableDatabases[0]?.id ?? null;
  const currentPrepSetupSelection: WebPrepSetupSelection = {
    mode: selectedPrepMode,
    source: selectedPrepSource,
    sourceId: selectedPrepSourceId,
    temporarySource: selectedTemporarySource ?? null,
    opponent: activePrep?.opponent ?? opponent,
    userColor: activePrep?.userColor ?? userColor,
    firstLocalSourceId,
  };
  const startedPrepSortOptions = opponentToMove
    ? WEB_PREP_STARTED_OPPONENT_SORT_OPTIONS
    : WEB_PREP_STARTED_CANDIDATE_SORT_OPTIONS;
  const startedPrepSortValue = getWebPrepSortSelectValue(
    opponentToMove ? prepSort : prepCandidateSort,
  );
  const updateStartedPrepSort = (value: string | null) => {
    if (opponentToMove) {
      const nextSort = getWebPrepSortFromSelect(value, WEB_PREP_STARTED_OPPONENT_SORT_OPTIONS);
      if (nextSort) setPrepSort(nextSort);
      return;
    }

    const nextSort = getWebPrepSortFromSelect(value, WEB_PREP_STARTED_CANDIDATE_SORT_OPTIONS);
    if (nextSort) setPrepCandidateSort(nextSort);
  };

  const persistPrepSetupSelection = (selection: WebPrepSetupSelection) => {
    const selectedDatabase =
      selection.source === "local" && selection.sourceId
        ? (state.databases.find((database) => database.id === selection.sourceId) ?? null)
        : null;
    setStoredPrepSetup((current) =>
      normalizeWebPrepStoredSetup({
        ...current,
        mode: selection.mode,
        source: selection.source === "temporary" ? "local" : selection.source,
        sourceId: selection.source === "local" ? selection.sourceId : current.sourceId,
        sourceRef: selectedDatabase
          ? getWebDatabaseSourceStorageValue(selectedDatabase)
          : current.sourceRef,
        opponent: selection.opponent,
        userColor: selection.userColor,
      }),
    );
  };

  useEffect(() => {
    setSourceId((current) => {
      if (current && selectableDatabases.some((database) => database.id === current)) {
        return current;
      }
      const storedSourceId = resolveWebDatabaseSourceId(
        storedPrepSetup.sourceRef ?? storedPrepSetup.sourceId,
        selectableDatabases,
      );
      if (storedSourceId) return storedSourceId;
      const storedHostedPath = getWebDatabaseHostedPathFromSourceStorageValue(
        storedPrepSetup.sourceRef,
      );
      if (
        storedHostedPath &&
        (hostedDatabases.loading ||
          !hostedDatabases.library ||
          hostedDatabases.folders.some((folder) => folder.path === storedHostedPath))
      ) {
        return null;
      }
      return selectableDatabases[0]?.id ?? null;
    });
  }, [
    hostedDatabases.folders,
    hostedDatabases.library,
    hostedDatabases.loading,
    selectableDatabases,
    storedPrepSetup.sourceId,
    storedPrepSetup.sourceRef,
  ]);

  useEffect(() => {
    const nextSort = getDefaultWebPrepSortState(selectedPrepSortDefaults);
    setPrepSort(nextSort.opponent);
    setPrepCandidateSort(nextSort.candidate);
  }, [
    activePrep?.id,
    currentFen,
    selectedPrepSortDefaults.candidate,
    selectedPrepSortDefaults.opponent,
  ]);

  useEffect(() => {
    if (onlineUsername || !activePrep?.opponent) return;
    setOnlineUsername(activePrep.opponent);
  }, [activePrep?.opponent, onlineUsername]);

  useEffect(() => {
    if (onlineMode !== "range") {
      setOnlinePreviewText("");
      return;
    }
    setOnlinePreviewText(
      `Imports every public PGN in ${getWebOnlineRangeLabel(onlineRange).toLowerCase()}.`,
    );
  }, [onlineMode, onlineRange]);

  useEffect(() => {
    if (!activePrep || !isOnlinePrepSource(selectedPrepSource)) {
      setOnlinePrepStats([]);
      setOnlineRootPrepStats([]);
      setOnlinePrepError(null);
      setOnlinePrepLoading(false);
      setOnlineRootPrepLoading(false);
      return;
    }

    if (!lichessToken.trim()) {
      setOnlinePrepStats([]);
      setOnlineRootPrepStats([]);
      setOnlinePrepError("Sign in to Lichess or paste a token to use this prep source.");
      setOnlinePrepLoading(false);
      setOnlineRootPrepLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setOnlinePrepLoading(true);
    setOnlineRootPrepLoading(true);
    setOnlinePrepError(null);

    const currentRequest = fetchWebExplorerMoveStats({
      source: selectedPrepSource,
      fen: currentFen,
      token: lichessToken,
      options: explorerOptions,
      strengthSettings: activePrep.builder,
      signal: controller.signal,
    });
    const rootRequest =
      branchFen && normalizeWebFen(branchFen) === normalizeWebFen(currentFen)
        ? currentRequest
        : branchFen
          ? fetchWebExplorerMoveStats({
              source: selectedPrepSource,
              fen: branchFen,
              token: lichessToken,
              options: explorerOptions,
              strengthSettings: activePrep.builder,
              signal: controller.signal,
            })
          : Promise.resolve<WebPrepMoveStat[]>([]);

    void currentRequest
      .then((nextStats) => {
        if (active) setOnlinePrepStats(nextStats);
      })
      .catch((error) => {
        if (!active) return;
        setOnlinePrepStats([]);
        setOnlinePrepError(
          error instanceof Error ? error.message : "Could not query this Lichess prep source.",
        );
      })
      .finally(() => {
        if (active) setOnlinePrepLoading(false);
      });

    void rootRequest
      .then((nextStats) => {
        if (active) setOnlineRootPrepStats(nextStats);
      })
      .catch(() => {
        if (active) setOnlineRootPrepStats([]);
      })
      .finally(() => {
        if (active) setOnlineRootPrepLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // Depend on the prep identity and builder settings, not the whole prep
    // object: done/skip/note taps replace the prep object and would otherwise
    // abort and refetch the explorer queries on every tap.
  }, [
    activePrep?.id,
    activePrep?.builder,
    branchFen,
    currentFen,
    explorerOptions,
    lichessToken,
    selectedPrepSource,
  ]);

  useEffect(() => {
    if (!activePrep || !selectedPrepSourceIsLazy || !activePrepSourceDatabase?.hostedPath) {
      setLazyPrepMoves([]);
      setLazyRootPrepMoves([]);
      setLazyPrepError(null);
      setLazyPrepLoading(false);
      setLazyRootPrepLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLazyPrepLoading(true);
    setLazyRootPrepLoading(Boolean(branchFen));
    setLazyPrepError(null);

    const currentRequest = fetchHostedDatabasePositionMoves({
      hostedPath: activePrepSourceDatabase.hostedPath,
      fen: currentFen,
      signal: controller.signal,
    });
    const rootRequest =
      branchFen && normalizeWebFen(branchFen) === normalizeWebFen(currentFen)
        ? currentRequest
        : branchFen
          ? fetchHostedDatabasePositionMoves({
              hostedPath: activePrepSourceDatabase.hostedPath,
              fen: branchFen,
              signal: controller.signal,
            })
          : Promise.resolve<WebHostedPositionMove[]>([]);

    void currentRequest
      .then((moves) => {
        if (active) setLazyPrepMoves(moves);
      })
      .catch((error) => {
        if (!active) return;
        setLazyPrepMoves([]);
        setLazyPrepError(
          error instanceof Error ? error.message : "Could not load this prep position.",
        );
      })
      .finally(() => {
        if (active) setLazyPrepLoading(false);
      });

    void rootRequest
      .then((moves) => {
        if (active) setLazyRootPrepMoves(moves);
      })
      .catch(() => {
        if (active) setLazyRootPrepMoves([]);
      })
      .finally(() => {
        if (active) setLazyRootPrepLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    activePrep?.id,
    activePrepSourceDatabase?.hostedPath,
    branchFen,
    currentFen,
    selectedPrepSourceIsLazy,
  ]);

  useEffect(() => {
    const settings = normalizeWebPrepStrengthSettings(activePrep?.builder);
    if (
      !activePrep ||
      !selectedPrepSourceIsLazy ||
      !settings.useCloudEngine ||
      lazyPrepStatsBase.length === 0
    ) {
      setLazyPrepEngineMoves([]);
      return;
    }

    const controller = new AbortController();
    let active = true;
    void queryWebLichessCloudEngineMoves({
      fen: currentFen,
      side: getWebPrepStrengthSideForFen(currentFen, activePrep.userColor),
      moves: lazyPrepStatsBase.map((stat) => stat.move),
      multipv: lazyPrepStatsBase.length,
      signal: controller.signal,
    })
      .then((moves) => {
        if (active) setLazyPrepEngineMoves(moves);
      })
      .catch(() => {
        if (active) setLazyPrepEngineMoves([]);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [activePrep, currentFen, lazyPrepStatsBase, selectedPrepSourceIsLazy]);

  useEffect(() => {
    const settings = normalizeWebPrepStrengthSettings(activePrep?.builder);
    if (
      !activePrep ||
      !branchFen ||
      !selectedPrepSourceIsLazy ||
      !settings.useCloudEngine ||
      lazyRootPrepStatsBase.length === 0
    ) {
      setLazyRootPrepEngineMoves([]);
      return;
    }

    const controller = new AbortController();
    let active = true;
    void queryWebLichessCloudEngineMoves({
      fen: branchFen,
      side: getWebPrepStrengthSideForFen(branchFen, activePrep.userColor),
      moves: lazyRootPrepStatsBase.map((stat) => stat.move),
      multipv: lazyRootPrepStatsBase.length,
      signal: controller.signal,
    })
      .then((moves) => {
        if (active) setLazyRootPrepEngineMoves(moves);
      })
      .catch(() => {
        if (active) setLazyRootPrepEngineMoves([]);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [activePrep, branchFen, lazyRootPrepStatsBase, selectedPrepSourceIsLazy]);

  const createPrep = () => {
    const now = Date.now();
    const trimmedOpponent = opponent.trim();
    const selectedSourceId = prepSource === "local" ? sourceId : null;
    const selectedTemporarySource = prepSource === "temporary" ? draftTemporarySource : null;
    const prep: WebPrepWorkspace = {
      id: `prep-${now.toString(36)}`,
      name: getWebPrepWorkspaceName({ mode: prepMode, opponent: trimmedOpponent }),
      mode: prepMode,
      source: prepSource,
      opponent: trimmedOpponent,
      userColor,
      sourceIds: selectedSourceId
        ? [selectedSourceId]
        : selectedTemporarySource
          ? [selectedTemporarySource.id]
          : [],
      temporarySource: selectedTemporarySource,
      startDate: prepStartDate || undefined,
      endDate: prepEndDate || undefined,
      result: prepResult,
      minGames,
      moveLimit,
      builder: getWebPrepStrengthSettingsPatch(selectedBuilderSettings, {}),
      sortDefaults: selectedPrepSortDefaults,
      startFen: INITIAL_FEN,
      rootPly: currentLine.length,
      line: currentLine,
      notesByFen: {},
      preparedMoves: {},
      skippedMoves: {},
      panelStage: "train",
      createdAt: now,
      updatedAt: now,
    };

    setState((current) => ({
      ...current,
      prepWorkspaces: [prep, ...current.prepWorkspaces],
      activePrepId: prep.id,
      board: {
        ...current.board,
        cursor: currentLine.length,
        sourceTitle: prepBoardTitle(prep),
        sourceDatabaseId: null,
        sourceGameId: null,
      },
    }));
    setDraftTemporarySource(null);
  };

  const updateActivePrep = (updater: (prep: WebPrepWorkspace) => WebPrepWorkspace) => {
    if (!activePrep) return;
    setState((current) => ({
      ...current,
      prepWorkspaces: current.prepWorkspaces.map((prep) =>
        prep.id === activePrep.id ? updater(prep) : prep,
      ),
    }));
  };

  const markMoveDone = (stat: WebPrepMoveStat) => {
    updateActivePrep((prep) => ({
      ...prep,
      preparedMoves: {
        ...prep.preparedMoves,
        [stat.key]: prep.preparedMoves[stat.key] || Date.now(),
      },
      skippedMoves: omitRecordKey(prep.skippedMoves ?? {}, stat.key),
      updatedAt: Date.now(),
    }));
  };

  const skipMove = (stat: WebPrepMoveStat) => {
    updateActivePrep((prep) => ({
      ...prep,
      preparedMoves: omitRecordKey(prep.preparedMoves, stat.key),
      skippedMoves: {
        ...(prep.skippedMoves ?? {}),
        [stat.key]: prep.skippedMoves?.[stat.key] || Date.now(),
      },
      updatedAt: Date.now(),
    }));
  };

  const playCommonMove = () => {
    if (!activePrep || !branchStart) {
      notifications.show({
        title: "Choose your move first",
        message: "Play into the prep line before asking for the opponent's common move.",
        color: "yellow",
      });
      return;
    }
    if (!commonOpenStat) {
      notifications.show({
        title: "No common move",
        message: "This prep source has no unprepared common move from the prep start.",
        color: "yellow",
      });
      return;
    }
    onPlayRootMove(commonOpenStat);
  };

  const doneAndNext = () => {
    if (!activePrep || !branchStart) {
      notifications.show({
        title: "Choose your reply first",
        message: "Play into the prep line before cycling their replies.",
        color: "yellow",
      });
      return;
    }

    const branchKey = activeBranch?.key;
    if (!branchKey) {
      notifications.show({
        title: "Choose your reply first",
        message: "Play into the prep line before cycling their replies.",
        color: "yellow",
      });
      return;
    }

    const nextPreparedMoves = {
      ...activePrep.preparedMoves,
      [branchKey]: activePrep.preparedMoves[branchKey] || Date.now(),
    };
    if (!activePrep.preparedMoves[branchKey]) {
      updateActivePrepSettings({
        preparedMoves: nextPreparedMoves,
        skippedMoves: omitRecordKey(activePrep.skippedMoves ?? {}, branchKey),
      });
    }

    const nextStat = getNextOpenPrepStat(openRootStats, nextPreparedMoves, branchKey);
    if (!nextStat) {
      notifications.show({
        title: "Prep line covered",
        message: "No unprepared move is left in Show top.",
        color: "green",
      });
      return;
    }

    window.setTimeout(() => onPlayRootMove(nextStat), 0);
  };

  const goToActiveChoice = () => {
    if (!activeBranch) return;
    setState((current) => ({
      ...current,
      board: {
        ...current.board,
        cursor: activeBranch.ply,
      },
    }));
  };

  const updateNote = (value: string) => {
    const fenKey = normalizeWebFen(currentFen);
    updateActivePrep((prep) => ({
      ...prep,
      notesByFen: {
        ...prep.notesByFen,
        [fenKey]: value,
      },
      updatedAt: Date.now(),
    }));
  };

  const updateActivePrepSettings = (patch: Partial<WebPrepWorkspace>) => {
    updateActivePrep((prep) => ({
      ...prep,
      ...patch,
      updatedAt: Date.now(),
    }));
  };

  const applyDraftPrepSetupSelection = (selection: WebPrepSetupSelection) => {
    setPrepMode(selection.mode);
    setPrepSource(selection.source);
    setSourceId(selection.sourceId);
    setDraftTemporarySource(selection.temporarySource);
    setOpponent(selection.opponent);
    setUserColor(selection.userColor);
    persistPrepSetupSelection(selection);
  };

  const applyPrepSetupSelection = (selection: WebPrepSetupSelection) => {
    persistPrepSetupSelection(selection);
    if (activePrep) {
      updateActivePrepSettings(getWebPrepWorkspacePatchFromSelection(activePrep, selection));
      return;
    }

    applyDraftPrepSetupSelection(selection);
  };

  const setActivePrepRootHere = () => {
    if (!activePrep) return;
    updateActivePrepSettings({
      rootPly: currentLine.length,
      preparedMoves: {},
      skippedMoves: {},
    });
  };

  const resetActivePrepToStart = () => {
    const rootCursor = activePrep ? (activePrep.rootPly ?? 0) : 0;
    setState((current) => ({
      ...current,
      board: {
        ...current.board,
        cursor: clampCursor(rootCursor, current.board.line.length),
      },
    }));
  };

  const clearActivePrepMarks = () => {
    if (!activePrep) return;
    updateActivePrepSettings({
      preparedMoves: {},
      skippedMoves: {},
    });
  };

  const updatePrepMode = (mode: WebPrepMode) => {
    applyPrepSetupSelection(applyWebPrepModeChange(currentPrepSetupSelection, mode));
  };

  const updatePrepMinGames = (value: number) => {
    const next = Math.max(1, Math.min(999, Math.round(value || DEFAULT_WEB_PREP_MIN_GAMES)));
    setStoredPrepSetup((current) => normalizeWebPrepStoredSetup({ ...current, minGames: next }));
    if (activePrep) updateActivePrepSettings({ minGames: next });
    else setMinGames(next);
  };

  const updatePrepMoveLimit = (value: number) => {
    const next = Math.max(1, Math.min(20, Math.round(value || DEFAULT_WEB_PREP_MOVE_LIMIT)));
    setStoredPrepSetup((current) => normalizeWebPrepStoredSetup({ ...current, moveLimit: next }));
    if (activePrep) updateActivePrepSettings({ moveLimit: next });
    else setMoveLimit(next);
  };

  const updatePrepStartDate = (value: string) => {
    const next = normalizeWebDateFilter(value) ?? "";
    setStoredPrepSetup((current) => normalizeWebPrepStoredSetup({ ...current, startDate: next }));
    if (activePrep) updateActivePrepSettings({ startDate: next || undefined });
    else setPrepStartDate(next);
  };

  const updatePrepEndDate = (value: string) => {
    const next = normalizeWebDateFilter(value) ?? "";
    setStoredPrepSetup((current) => normalizeWebPrepStoredSetup({ ...current, endDate: next }));
    if (activePrep) updateActivePrepSettings({ endDate: next || undefined });
    else setPrepEndDate(next);
  };

  const updatePrepResult = (value: WebLocalResultFilter) => {
    const next = normalizeWebLocalResultFilter(value);
    setStoredPrepSetup((current) => normalizeWebPrepStoredSetup({ ...current, result: next }));
    if (activePrep) updateActivePrepSettings({ result: next });
    else setPrepResult(next);
  };

  const updatePrepBuilderSettings = (patch: Partial<PrepBuilderSettings>) => {
    setStoredPrepSetup((current) =>
      normalizeWebPrepStoredSetup({
        ...current,
        builder: getWebPrepStrengthSettingsPatch(current.builder, patch),
      }),
    );
    if (activePrep) {
      updateActivePrepSettings({
        builder: getWebPrepStrengthSettingsPatch(activePrep.builder, patch),
      });
      return;
    }

    setDraftBuilderSettings((current) => getWebPrepStrengthSettingsPatch(current, patch));
  };

  const updatePrepSortDefaults = (patch: Partial<WebPrepMoveSortDefaults>) => {
    const next = normalizeWebPrepMoveSortDefaults({
      ...selectedPrepSortDefaults,
      ...patch,
    });
    setStoredPrepSetup((current) =>
      normalizeWebPrepStoredSetup({ ...current, sortDefaults: next }),
    );
    if (activePrep) {
      updateActivePrepSettings({ sortDefaults: next });
    }
  };

  const updatePrepOpponent = (value: string) => {
    setStoredPrepSetup((current) => normalizeWebPrepStoredSetup({ ...current, opponent: value }));
    if (activePrep) updateActivePrepSettings({ opponent: value });
    else setOpponent(value);
  };

  const updatePrepUserColor = (value: WebColor) => {
    setStoredPrepSetup((current) => normalizeWebPrepStoredSetup({ ...current, userColor: value }));
    if (activePrep) updateActivePrepSettings({ userColor: value });
    else setUserColor(value);
  };

  // Autofill the opponent only once per selected source; refilling whenever
  // the field becomes empty made it impossible to clear and retype a name.
  const autofilledOpponentSourceRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedPrepMode !== "player" || selectedPrepSource !== "local") return;
    if (!activePrepSourceId || selectedPrepDatabasePlayers.length === 0) return;
    if (autofilledOpponentSourceRef.current === activePrepSourceId) return;
    autofilledOpponentSourceRef.current = activePrepSourceId;
    if (trimmedSelectedOpponentName) return;

    const defaultPlayer = selectedPrepDatabasePlayers[0];
    const labelPlayer =
      getWebDatabaseTitlePlayerName(activePrepSourceDatabase?.name, defaultPlayer.name) ??
      defaultPlayer.name;
    if (!labelPlayer.trim()) return;

    updatePrepOpponent(labelPlayer);
  }, [
    activePrepSourceDatabase?.name,
    activePrepSourceId,
    selectedPrepDatabasePlayers,
    selectedPrepMode,
    selectedPrepSource,
    trimmedSelectedOpponentName,
  ]);

  const updateActivePrepSource = (nextSource: WebPrepSource, nextSourceId: string | null) => {
    applyPrepSetupSelection(
      applyWebPrepSourceChange(currentPrepSetupSelection, nextSource, nextSourceId),
    );
  };

  const attachImportedDatabase = (database: WebDatabase) => {
    setStoredPrepSetup((current) =>
      normalizeWebPrepStoredSetup({
        ...current,
        source: "local",
        sourceId: database.id,
        sourceRef: getWebDatabaseSourceStorageValue(database),
      }),
    );
    applyPrepSetupSelection(
      applyWebPrepSourceChange(currentPrepSetupSelection, "local", database.id),
    );
  };

  const refreshHostedPrepDatabase = async (folder: WebHostedDatabaseFolder) => {
    if (!hostedDatabases.library) return null;
    setLoadingPrepSource(folder.label);
    setLoadingPrepProgress(null);
    try {
      const imported = await importHostedFolder(hostedDatabases.library, folder.path, {
        openFirstGame: false,
        onProgress: setLoadingPrepProgress,
      });
      if (imported) attachImportedDatabase(imported.database);
      return imported;
    } finally {
      setLoadingPrepProgress(null);
      setLoadingPrepSource(null);
    }
  };

  const choosePrepSource = async (value: string | null) => {
    if (!value) {
      if (activePrep) updateActivePrepSource("local", null);
      else {
        setPrepSource("local");
        setSourceId(null);
      }
      return;
    }

    if (value === WEB_LICHESS_ALL_SOURCE_VALUE || value === WEB_LICHESS_MASTERS_SOURCE_VALUE) {
      const nextSource: WebPrepSource =
        value === WEB_LICHESS_ALL_SOURCE_VALUE ? "lichess-all" : "lichess-masters";
      updateActivePrepSource(nextSource, null);
      return;
    }

    if (value === WEB_TEMPORARY_PREP_SOURCE_VALUE) {
      const temporarySource = activePrep?.temporarySource ?? draftTemporarySource;
      if (temporarySource) {
        applyPrepSetupSelection(
          applyWebPrepSourceChange(currentPrepSetupSelection, "temporary", null, temporarySource),
        );
      }
      return;
    }

    if (!isHostedDatabaseValue(value)) {
      const database = selectableDatabases.find((candidate) => candidate.id === value) ?? null;
      const hostedFolder = database?.hostedPath
        ? (hostedDatabases.folders.find((folder) => folder.path === database.hostedPath) ?? null)
        : null;
      if (
        needsHostedDatabaseRefresh({
          database,
          games: database ? (state.gamesByDatabase[database.id] ?? []) : [],
          hostedFolder,
        }) &&
        hostedFolder
      ) {
        await refreshHostedPrepDatabase(hostedFolder);
        return;
      }

      updateActivePrepSource("local", value);
      return;
    }

    const folderPath = hostedDatabasePathFromValue(value);
    const folder = hostedDatabases.folders.find((candidate) => candidate.path === folderPath);
    if (!folder || !hostedDatabases.library) return;
    const database =
      state.databases.find((candidate) => candidate.hostedPath === folder.path) ?? null;
    if (
      database &&
      !needsHostedDatabaseRefresh({
        database,
        games: state.gamesByDatabase[database.id] ?? [],
        hostedFolder: folder,
      })
    ) {
      updateActivePrepSource("local", database.id);
      return;
    }
    await refreshHostedPrepDatabase(folder);
  };

  useEffect(() => {
    if (
      selectedPrepSource !== "local" ||
      !activePrepHostedFolder ||
      !hostedDatabases.library ||
      loadingPrepSource
    ) {
      return;
    }

    if (
      !needsHostedDatabaseRefresh({
        database: activePrepSourceDatabase,
        games: activePrepSourceGames,
        hostedFolder: activePrepHostedFolder,
      }) &&
      activePrepSourceDatabase
    ) {
      return;
    }

    if (refreshingPrepPathRef.current === activePrepHostedFolder.path) return;
    refreshingPrepPathRef.current = activePrepHostedFolder.path;
    void refreshHostedPrepDatabase(activePrepHostedFolder).finally(() => {
      refreshingPrepPathRef.current = null;
    });
  }, [
    activePrepHostedFolder,
    activePrepSourceDatabase,
    activePrepSourceGames,
    hostedDatabases.library,
    loadingPrepSource,
    selectedPrepSource,
  ]);

  const attachTemporaryPrepSource = (imported: WebImportResult) => {
    const now = Date.now();
    const temporarySource: WebPrepTemporarySource = {
      id: imported.database.id,
      name: imported.database.name,
      gameCount: imported.games.length,
      importedAt: imported.database.importedAt,
      updatedAt: now,
      games: imported.games,
    };

    if (activePrep) {
      applyPrepSetupSelection(
        applyWebPrepSourceChange(currentPrepSetupSelection, "temporary", null, temporarySource),
      );
      return;
    }

    applyDraftPrepSetupSelection(
      applyWebPrepSourceChange(currentPrepSetupSelection, "temporary", null, temporarySource),
    );
  };

  const previewOnlineImportCount = async () => {
    const username = onlineUsername.trim();
    if (!username) return;
    setOnlinePreviewLoading(true);
    setOnlinePreviewText("");
    try {
      const games = await fetchWebOnlineGames({
        source: onlineSource,
        username,
        mode: "count",
        count: onlineCount,
        range: onlineRange,
        onProgress: undefined,
      });
      if (games.length === 0) {
        setOnlinePreviewText("No public PGNs found for that player.");
        return;
      }
      const oldest = Math.min(...games.map((game) => game.playedAt).filter(Boolean));
      const oldestLabel = Number.isFinite(oldest)
        ? formatWebDate(new Date(oldest).toISOString())
        : "";
      setOnlinePreviewText(
        `${games.length} public game${games.length === 1 ? "" : "s"} found${
          oldestLabel ? `; range goes back to ${oldestLabel}` : ""
        }.`,
      );
    } catch (error) {
      setOnlinePreviewText(
        error instanceof Error ? error.message : "Could not preview this online import.",
      );
    } finally {
      setOnlinePreviewLoading(false);
    }
  };

  const runOnlineImport = () => {
    const username = onlineUsername.trim();
    if (!username) return;
    void importOnlineGames({
      source: onlineSource,
      username,
      mode: onlineMode,
      count: onlineCount,
      range: onlineRange,
      saveDatabase: onlineSaveDatabase,
      setProgress: setOnlineProgress,
    }).then((imported) => {
      if (!imported) return;
      if (onlineSaveDatabase) attachImportedDatabase(imported.database);
      else attachTemporaryPrepSource(imported);
    });
  };

  return (
    <Stack gap="sm">
      {showSetupStage ? (
        <Group justify="space-between" align="center" gap="xs" wrap="wrap">
          <Group gap="xs" wrap="wrap">
            <Text fw={700} size="sm">
              {selectedPrepMode === "general" ? "Opening prep" : "Opponent prep"}
            </Text>
            {selectedSourceLabel ? (
              <Badge variant="light" size="sm">
                {selectedSourceLabel}
              </Badge>
            ) : null}
            {selectedPrepMode === "general" ? (
              <Badge color="teal" variant="light" size="sm">
                You as {activePrep?.userColor ?? userColor}
              </Badge>
            ) : (activePrep?.opponent ?? opponent).trim() ? (
              <Badge color="orange" variant="light" size="sm">
                {(activePrep?.opponent ?? opponent).trim()} as {selectedPlayerColor}
              </Badge>
            ) : null}
          </Group>
          <Group gap={4} wrap="wrap" justify="flex-end">
            <Button
              size="xs"
              leftSection={<IconPlayerPlay size={14} />}
              disabled={!configReady}
              onClick={() => {
                if (activePrep) {
                  updateActivePrepSettings({ panelStage: "train" });
                } else {
                  createPrep();
                }
              }}
            >
              Start prep
            </Button>
            {activePrep ? (
              <>
                <Tooltip label="Use the current board position as the prep start">
                  <Button
                    size="compact-xs"
                    variant="default"
                    leftSection={<IconTarget size={14} />}
                    onClick={setActivePrepRootHere}
                  >
                    Start here
                  </Button>
                </Tooltip>
                <Tooltip label="Go back to the prep starting position">
                  <ActionIcon
                    aria-label="Go back to prep start"
                    size="sm"
                    variant="default"
                    onClick={resetActivePrepToStart}
                  >
                    <IconArrowBackUp size={15} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Clear manual done and skipped marks">
                  <ActionIcon
                    aria-label="Clear prep marks"
                    size="sm"
                    variant="default"
                    disabled={
                      Object.keys(activePrep.preparedMoves).length === 0 &&
                      Object.keys(activePrep.skippedMoves ?? {}).length === 0
                    }
                    onClick={clearActivePrepMarks}
                  >
                    <IconRefresh size={15} />
                  </ActionIcon>
                </Tooltip>
              </>
            ) : null}
          </Group>
        </Group>
      ) : null}

      {showSetupStage ? (
        <>
          <Group align="flex-end" gap="xs" wrap="wrap">
            <SegmentedControl
              aria-label="Prep target"
              data={[
                { value: "player", label: "Player" },
                { value: "general", label: "General" },
              ]}
              value={selectedPrepMode}
              onChange={(value) => updatePrepMode(value as WebPrepMode)}
              size="xs"
            />
            <DatabaseFolderSelect
              data={sourceOptions}
              value={selectedPrepSourceValue}
              onChange={(value) => void choosePrepSource(value)}
              placeholder="Prep source"
              size="xs"
              label="Prep source"
              flex="1 1 14rem"
              minWidth="14rem"
              allowDeselect={false}
              loading={Boolean(loadingPrepSource)}
              loadingLabel={loadingPrepSource ? `Loading ${loadingPrepSource}` : undefined}
            />
            <Button
              size="compact-xs"
              variant={onlineOpen ? "light" : "default"}
              leftSection={<IconCloudDownload size={14} />}
              onClick={() => setOnlineOpen((open) => !open)}
            >
              Import
            </Button>
            <WebPrepStrengthSettingsButton
              builderSettings={selectedBuilderSettings}
              updateBuilderSettings={updatePrepBuilderSettings}
            />
            <Tooltip label="Tune prep table sort defaults and strength scoring">
              <Button
                size="compact-xs"
                variant={builderOpen ? "light" : "default"}
                leftSection={<IconArrowsSort size={14} />}
                onClick={() => setBuilderOpen((open) => !open)}
              >
                Builder
              </Button>
            </Tooltip>
          </Group>

          <Collapse in={builderOpen}>
            <Group gap="xs" wrap="wrap" align="flex-end" className={classes.prepToolBox}>
              <SegmentedControl
                aria-label="Prep strength mode"
                data={[
                  { value: "smart", label: "Smart" },
                  { value: "engine", label: "Engine" },
                  { value: "practical", label: "Practical" },
                ]}
                value={selectedBuilderSettings.mode}
                onChange={(value) =>
                  updatePrepBuilderSettings({ mode: value as PrepBuilderSettings["mode"] })
                }
                size="xs"
              />
              <Select
                label={selectedPrepMode === "general" ? "Source move sort" : "Their move sort"}
                value={selectedPrepSortDefaults.opponent}
                data={WEB_PREP_OPPONENT_SORT_OPTIONS}
                onChange={(value) => {
                  if (isWebPrepOpponentSortColumn(value)) {
                    updatePrepSortDefaults({ opponent: value });
                  }
                }}
                size="xs"
                w={150}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
              <Select
                label="Your move sort"
                value={selectedPrepSortDefaults.candidate}
                data={WEB_PREP_CANDIDATE_SORT_OPTIONS}
                onChange={(value) => {
                  if (isWebPrepCandidateSortColumn(value)) {
                    updatePrepSortDefaults({ candidate: value });
                  }
                }}
                size="xs"
                w={150}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
              <NumberInput
                label="Engine blend"
                suffix="%"
                value={selectedBuilderSettings.engineWeight}
                onChange={(value) =>
                  updatePrepBuilderSettings({
                    engineWeight: Math.max(0, Math.min(100, Number(value) || 0)),
                  })
                }
                min={0}
                max={100}
                step={5}
                size="xs"
                w={112}
                aria-label="Smart mode engine blend"
              />
              <NumberInput
                label="Max CP drop"
                suffix=" cp"
                value={selectedBuilderSettings.maxEngineCpLoss}
                onChange={(value) =>
                  updatePrepBuilderSettings({
                    maxEngineCpLoss: Math.max(0, Math.min(300, Number(value) || 0)),
                  })
                }
                min={0}
                max={300}
                step={5}
                size="xs"
                w={112}
                aria-label="Maximum engine centipawn drop"
              />
            </Group>
          </Collapse>

          <Collapse in={sourcesOpen && !onlineOpen}>
            <Stack gap="xs" className={classes.prepToolBox}>
              {loadingPrepSource ? (
                <Group gap="xs" wrap="nowrap">
                  <Loader size="xs" />
                  <Text size="xs" c="dimmed" truncate>
                    {formatHostedLoadProgress(loadingPrepSource, loadingPrepProgress)}
                  </Text>
                </Group>
              ) : null}
              <Group gap="xs" wrap="wrap" align="flex-end">
                {selectedPrepMode === "player" ? (
                  <WebDatabasePerspectiveControls
                    playerName={selectedOpponentName}
                    playerOptions={selectedPrepDatabasePlayers}
                    color={selectedPlayerColor}
                    onPlayerNameChange={updatePrepOpponent}
                    onColorChange={(color) => updatePrepUserColor(oppositeWebColor(color))}
                    disabled={!sourceReady}
                    playerFlex="1 1 10rem"
                    colorWidth={trimmedSelectedOpponentName ? 236 : 132}
                  />
                ) : (
                  <SegmentedControl
                    aria-label="Your prep side"
                    size="xs"
                    value={activePrep?.userColor ?? userColor}
                    onChange={(value) => updatePrepUserColor(value as WebColor)}
                    data={[
                      { value: "white", label: "I'm white" },
                      { value: "black", label: "I'm black" },
                    ]}
                    w={220}
                  />
                )}
                <NumberInput
                  label="Min games"
                  value={selectedMinGames}
                  onChange={(value) => updatePrepMinGames(Number(value))}
                  min={1}
                  max={999}
                  step={1}
                  size="xs"
                  w={100}
                  aria-label="Minimum games"
                />
                <NumberInput
                  label="Show top"
                  value={selectedMoveLimit}
                  onChange={(value) => updatePrepMoveLimit(Number(value))}
                  min={1}
                  max={20}
                  step={1}
                  size="xs"
                  w={100}
                  aria-label="Top opponent moves to show"
                />
              </Group>
              {isOnlinePrepSource(selectedPrepSource) ? (
                <Group gap="xs" align="flex-end" wrap="wrap">
                  <WebLichessAccessControls token={lichessToken} signedInLabel="Lichess saved" />
                  <Button
                    size="compact-xs"
                    variant={explorerOptionsOpen ? "light" : "default"}
                    leftSection={<IconSettings size={14} />}
                    onClick={() => setExplorerOptionsOpen((open) => !open)}
                  >
                    Filters
                  </Button>
                </Group>
              ) : selectedPrepSource === "temporary" && selectedTemporarySource ? (
                <Badge key={selectedTemporarySource.id} size="xs" variant="light" color="violet">
                  {formatDatabasePickerLabel(selectedTemporarySource.name)} -{" "}
                  {selectedTemporarySource.gameCount} unsaved
                </Badge>
              ) : activePrepSourceDatabase ? (
                <Badge key={activePrepSourceDatabase.id} size="xs" variant="light">
                  {formatDatabasePickerLabel(activePrepSourceDatabase.name)} -{" "}
                  {activePrepSourceDatabase.gameCount}
                </Badge>
              ) : (
                <Text size="xs" c="dimmed">
                  Pick a source.
                </Text>
              )}
              {selectedPrepSource === "local" && activePrepSourceId && !selectedPrepSourceIsLazy ? (
                <WebLocalFiltersControls
                  startDate={selectedPrepStartDate}
                  endDate={selectedPrepEndDate}
                  result={selectedPrepResult}
                  onStartDateChange={updatePrepStartDate}
                  onEndDateChange={updatePrepEndDate}
                  onResultChange={updatePrepResult}
                />
              ) : null}
              {isOnlinePrepSource(selectedPrepSource) ? (
                <Collapse in={explorerOptionsOpen}>
                  <WebExplorerOptionsPanel
                    source={selectedPrepSource}
                    lichessOptions={lichessOptions}
                    mastersOptions={mastersOptions}
                    onLichessOptionsChange={setLichessOptions}
                    onMastersOptionsChange={setMastersOptions}
                  />
                </Collapse>
              ) : null}
            </Stack>
          </Collapse>

          <Collapse in={onlineOpen}>
            <Stack gap="xs" className={classes.prepToolBox}>
              <Group gap="xs" align="flex-end" wrap="wrap">
                <SegmentedControl
                  aria-label="Online prep source"
                  size="xs"
                  value={onlineSource}
                  onChange={(value) => setOnlineSource(value as WebOnlineSource)}
                  data={[
                    { value: "lichess", label: "Lichess" },
                    { value: "chesscom", label: "Chess.com" },
                  ]}
                />
                <TextInput
                  label="Player"
                  size="xs"
                  placeholder="Username"
                  value={onlineUsername}
                  onChange={(event) => setOnlineUsername(event.currentTarget.value)}
                  style={{ flex: "1 1 9rem" }}
                />
                <SegmentedControl
                  aria-label="Online import scope"
                  size="xs"
                  value={onlineMode}
                  onChange={(value) => setOnlineMode(value as WebOnlineImportMode)}
                  data={[
                    { value: "count", label: "Most recent" },
                    { value: "range", label: "Date range" },
                  ]}
                />
                {onlineMode === "count" ? (
                  <NumberInput
                    label="Games"
                    size="xs"
                    value={onlineCount}
                    min={1}
                    max={300}
                    step={25}
                    onChange={(value) =>
                      setOnlineCount(Math.max(1, Math.min(300, Number(value) || 1)))
                    }
                    w={94}
                  />
                ) : (
                  <Select
                    label="Range"
                    size="xs"
                    value={onlineRange}
                    onChange={(value) =>
                      setOnlineRange((value as WebOnlineRangePreset | null) ?? "3m")
                    }
                    data={[
                      { value: "3m", label: getWebOnlineRangeLabel("3m") },
                      { value: "6m", label: getWebOnlineRangeLabel("6m") },
                      { value: "1y", label: getWebOnlineRangeLabel("1y") },
                      { value: "all", label: getWebOnlineRangeLabel("all") },
                    ]}
                    allowDeselect={false}
                    w={148}
                  />
                )}
                <Button
                  size="xs"
                  leftSection={<IconCloudDownload size={14} />}
                  disabled={!onlineUsername.trim()}
                  onClick={runOnlineImport}
                >
                  Import + use
                </Button>
              </Group>
              <Group gap="xs" wrap="wrap" align="center">
                <Checkbox
                  label="Save database"
                  checked={onlineSaveDatabase}
                  onChange={(event) => setOnlineSaveDatabase(event.currentTarget.checked)}
                  size="xs"
                />
                {onlineMode === "count" ? (
                  <Button
                    variant="default"
                    size="xs"
                    disabled={!onlineUsername.trim()}
                    loading={onlinePreviewLoading}
                    onClick={() => void previewOnlineImportCount()}
                  >
                    Check range
                  </Button>
                ) : (
                  <Badge variant="light">{getWebOnlineRangeLabel(onlineRange)}</Badge>
                )}
                {onlinePreviewText ? (
                  <Text size="xs" c="dimmed" style={{ flex: "1 1 14rem" }}>
                    {onlinePreviewText}
                  </Text>
                ) : null}
              </Group>
              <Group gap="xs" wrap="nowrap">
                {onlineProgress !== null && (
                  <>
                    <Progress value={onlineProgress} size="xs" style={{ flex: 1 }} />
                    <Text size="xs" c="dimmed">
                      {Math.round(onlineProgress)}%
                    </Text>
                  </>
                )}
                {onlineProgress === null && (
                  <Text size="xs" c="dimmed">
                    {onlineSaveDatabase
                      ? `Save ${getWebOnlineSourceLabel(onlineSource)} games to Databases.`
                      : `Use ${getWebOnlineSourceLabel(onlineSource)} games for this prep.`}
                  </Text>
                )}
              </Group>
            </Stack>
          </Collapse>
        </>
      ) : null}

      {showTrainingStage && activePrep ? (
        <Stack gap="xs">
          {onlinePrepLoading && isOnlinePrepSource(selectedPrepSource) ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                Querying {selectedSourceLabel}
              </Text>
            </Group>
          ) : null}
          {onlinePrepError && isOnlinePrepSource(selectedPrepSource) ? (
            <Text size="xs" c="red">
              {onlinePrepError}
            </Text>
          ) : null}
          {lazyPrepLoading && selectedPrepSourceIsLazy ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                Loading one position from {selectedSourceLabel}
              </Text>
            </Group>
          ) : null}
          {lazyPrepError && selectedPrepSourceIsLazy ? (
            <Text size="xs" c="red">
              {lazyPrepError}
            </Text>
          ) : null}
          <Group gap={6} wrap="nowrap">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlayerPlay size={14} />}
              onClick={playCommonMove}
              style={{ flex: "1 1 auto" }}
            >
              Common move
            </Button>
            <Button
              size="xs"
              variant="light"
              color="teal"
              leftSection={<IconCheck size={14} />}
              onClick={doneAndNext}
              style={{ flex: "1 1 auto" }}
            >
              Done + next
            </Button>
          </Group>
          <Box className={classes.prepTrainingMoves}>
            <Group gap={4} wrap="nowrap" justify="flex-end" className={classes.startedMovesToolbar}>
              <Select
                aria-label="Prep move sort"
                className={classes.startedSortSelect}
                size="xs"
                value={startedPrepSortValue}
                data={startedPrepSortOptions.map(({ label, value }) => ({ label, value }))}
                onChange={updateStartedPrepSort}
                allowDeselect={false}
                leftSection={<IconArrowsSort size={14} />}
                comboboxProps={{ withinPortal: true }}
              />
              <Tooltip label="Return to prep settings">
                <ActionIcon
                  aria-label="Return to prep settings"
                  size="sm"
                  variant="filled"
                  color="dark"
                  onClick={() => updateActivePrepSettings({ panelStage: "setup" })}
                >
                  <IconX size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <CompactMoveTable
              stats={displayedStats}
              preparedMoves={activePrep.preparedMoves}
              skippedMoves={activePrep.skippedMoves ?? {}}
              startedMoveKeys={startedMoveKeys}
              branchStatsByKey={branchStatsByKey}
              showState={opponentToMove}
              emptyLabel="No prep moves"
              onPlayMove={onPlayMove}
              onOpenSourceGame={
                isOnlinePrepSource(selectedPrepSource) || selectedPrepSourceIsLazy
                  ? undefined
                  : onOpenSourceGame
              }
              onMarkDone={markMoveDone}
              onSkipMove={skipMove}
              sort={opponentToMove ? prepSort : prepCandidateSort}
              onSort={(column) => {
                if (opponentToMove) {
                  setPrepSort((current) => getNextWebPrepSort(current, column));
                } else if (column !== "prep" && column !== "state") {
                  setPrepCandidateSort((current) => getNextWebPrepSort(current, column));
                }
              }}
            />
          </Box>
        </Stack>
      ) : null}
    </Stack>
  );
}

function WebExplorerOptionsPanel({
  source,
  lichessOptions,
  mastersOptions,
  onLichessOptionsChange,
  onMastersOptionsChange,
}: {
  source: WebDatabaseExplorerSource;
  lichessOptions: WebLichessExplorerOptions;
  mastersOptions: WebMastersExplorerOptions;
  onLichessOptionsChange: Dispatch<SetStateAction<WebLichessExplorerOptions>>;
  onMastersOptionsChange: Dispatch<SetStateAction<WebMastersExplorerOptions>>;
}) {
  const updateLichessOptions = (patch: Partial<WebLichessExplorerOptions>) => {
    onLichessOptionsChange((current) =>
      normalizeWebLichessExplorerOptions({ ...current, ...patch }),
    );
  };
  const updateMastersOptions = (patch: Partial<WebMastersExplorerOptions>) => {
    onMastersOptionsChange((current) =>
      normalizeWebMastersExplorerOptions({ ...current, ...patch }),
    );
  };

  return (
    <Stack gap="xs" className={classes.prepToolBox}>
      {source === "lichess-all" ? (
        <>
          <Group gap="xs" wrap="wrap" align="flex-end">
            <MultiSelect
              label="Time controls"
              size="xs"
              value={lichessOptions.speeds}
              onChange={(values) => {
                if (values.length > 0) {
                  updateLichessOptions({ speeds: values as WebLichessExplorerOptions["speeds"] });
                }
              }}
              data={WEB_LICHESS_EXPLORER_SPEEDS.map((speed) => ({
                value: speed,
                label: formatExplorerSpeed(speed),
              }))}
              clearable={false}
              style={{ flex: "1 1 14rem" }}
            />
            <MultiSelect
              label="Average rating"
              size="xs"
              value={lichessOptions.ratings.map(String)}
              onChange={(values) => {
                const ratings = values
                  .map(Number)
                  .filter((rating): rating is WebLichessExplorerOptions["ratings"][number] =>
                    WEB_LICHESS_EXPLORER_RATINGS.includes(
                      rating as WebLichessExplorerOptions["ratings"][number],
                    ),
                  );
                if (ratings.length > 0) updateLichessOptions({ ratings });
              }}
              data={WEB_LICHESS_EXPLORER_RATINGS.map((rating) => ({
                value: String(rating),
                label: rating === 0 ? "400" : String(rating),
              }))}
              clearable={false}
              style={{ flex: "1 1 12rem" }}
            />
          </Group>
          <Group gap="xs" wrap="wrap" align="flex-end">
            <TextInput
              label="Since"
              size="xs"
              type="month"
              value={lichessOptions.since ?? ""}
              onChange={(event) => updateLichessOptions({ since: event.currentTarget.value })}
              style={{ flex: "1 1 8.5rem" }}
            />
            <TextInput
              label="Until"
              size="xs"
              type="month"
              value={lichessOptions.until ?? ""}
              onChange={(event) => updateLichessOptions({ until: event.currentTarget.value })}
              style={{ flex: "1 1 8.5rem" }}
            />
            <NumberInput
              label="Show moves"
              size="xs"
              min={1}
              max={30}
              step={1}
              value={lichessOptions.moves}
              onChange={(value) =>
                updateLichessOptions({ moves: typeof value === "number" ? value : 12 })
              }
              w={104}
            />
          </Group>
          <Group gap="xs" wrap="wrap" align="flex-end">
            <TextInput
              label="Player"
              size="xs"
              placeholder="Lichess username"
              value={lichessOptions.player ?? ""}
              onChange={(event) => updateLichessOptions({ player: event.currentTarget.value })}
              style={{ flex: "1 1 10rem" }}
            />
            <Select
              label="Color"
              size="xs"
              value={lichessOptions.color}
              onChange={(value) =>
                updateLichessOptions({ color: value === "black" ? "black" : "white" })
              }
              data={[
                { value: "white", label: "White" },
                { value: "black", label: "Black" },
              ]}
              allowDeselect={false}
              w={116}
            />
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => onLichessOptionsChange(DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS)}
            >
              Reset
            </Button>
          </Group>
        </>
      ) : (
        <Group gap="xs" wrap="wrap" align="flex-end">
          <NumberInput
            label="Since"
            size="xs"
            min={1952}
            max={new Date().getFullYear()}
            step={1}
            value={mastersOptions.since ? Number(mastersOptions.since) : ""}
            onChange={(value) =>
              updateMastersOptions({ since: typeof value === "number" ? String(value) : undefined })
            }
            w={108}
          />
          <NumberInput
            label="Until"
            size="xs"
            min={1952}
            max={new Date().getFullYear()}
            step={1}
            value={mastersOptions.until ? Number(mastersOptions.until) : ""}
            onChange={(value) =>
              updateMastersOptions({ until: typeof value === "number" ? String(value) : undefined })
            }
            w={108}
          />
          <NumberInput
            label="Show moves"
            size="xs"
            min={1}
            max={30}
            step={1}
            value={mastersOptions.moves}
            onChange={(value) =>
              updateMastersOptions({ moves: typeof value === "number" ? value : 12 })
            }
            w={112}
          />
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => onMastersOptionsChange(DEFAULT_WEB_MASTERS_EXPLORER_OPTIONS)}
          >
            Reset
          </Button>
        </Group>
      )}
    </Stack>
  );
}

function WebDatabaseOptionsPanel({
  sourceLabel,
  startDate,
  endDate,
  result,
  onStartDateChange,
  onEndDateChange,
  onResultChange,
}: {
  sourceLabel: string;
  startDate: string;
  endDate: string;
  result: WebLocalResultFilter;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onResultChange: (value: WebLocalResultFilter) => void;
}) {
  return (
    <Stack gap="xs" className={classes.prepToolBox}>
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Text fw={700} size="sm">
          Local options
        </Text>
        <Badge variant="light" size="sm">
          {sourceLabel}
        </Badge>
      </Group>
      <WebLocalFiltersControls
        startDate={startDate}
        endDate={endDate}
        result={result}
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
        onResultChange={onResultChange}
      />
    </Stack>
  );
}

function WebDatabaseGamesList({
  games,
  onOpenGame,
}: {
  games: WebDatabasePositionGame[];
  onOpenGame: (game: WebGame) => void;
}) {
  const isPhoneWidth = useMediaQuery("(max-width: 520px)", false, {
    getInitialValueInEffect: false,
  });

  if (games.length === 0) {
    return (
      <UnderBoardEmpty
        icon={<IconFileText size={30} />}
        title="No matching games"
        text="No filtered source games reach this board position."
      />
    );
  }

  return (
    <Table.ScrollContainer minWidth={isPhoneWidth ? 0 : 640}>
      <Table className={classes.compactTable} verticalSpacing={4} highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Game</Table.Th>
            <Table.Th>Result</Table.Th>
            <Table.Th>Reached</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {games.map(({ game, ply, nextMove }) => (
            <Table.Tr key={game.id} style={{ cursor: "pointer" }} onClick={() => onOpenGame(game)}>
              <Table.Td>
                <Text size="sm" fw={700}>
                  {game.white} - {game.black}
                </Text>
                <Text size="xs" c="dimmed">
                  {[formatWebDate(game.date), game.event].filter(Boolean).join(" - ") ||
                    game.databaseName}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge variant="light" size="sm">
                  {game.result}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{nextMove ?? "Start"}</Text>
                <Text size="xs" c="dimmed">
                  Ply {ply}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Tooltip label="Open game">
                  <ActionIcon
                    aria-label="Open game"
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenGame(game);
                    }}
                  >
                    <IconExternalLink size={15} />
                  </ActionIcon>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function WebLichessAccessControls({
  token,
  signedInLabel,
}: {
  token: string;
  signedInLabel: string;
}) {
  const signedIn = Boolean(token.trim());

  if (signedIn) {
    return (
      <Badge color="green" variant="light" style={{ flex: "0 0 auto" }}>
        {signedInLabel}
      </Badge>
    );
  }

  return (
    <Button
      size="xs"
      variant="light"
      leftSection={<IconCloudDownload size={14} />}
      onClick={() => void startWebLichessLogin()}
    >
      Connect Lichess once
    </Button>
  );
}

function WebLocalFiltersControls({
  startDate,
  endDate,
  result,
  onStartDateChange,
  onEndDateChange,
  onResultChange,
}: {
  startDate: string;
  endDate: string;
  result: WebLocalResultFilter;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onResultChange: (value: WebLocalResultFilter) => void;
}) {
  const hasFilters = Boolean(startDate || endDate || result !== "any");

  return (
    <Group gap="xs" wrap="wrap" align="flex-end">
      <TextInput
        label="From"
        size="xs"
        type="date"
        value={normalizeWebDateFilter(startDate) ?? ""}
        onChange={(event) => onStartDateChange(event.currentTarget.value)}
        style={{ flex: "1 1 8.5rem" }}
      />
      <TextInput
        label="To"
        size="xs"
        type="date"
        value={normalizeWebDateFilter(endDate) ?? ""}
        onChange={(event) => onEndDateChange(event.currentTarget.value)}
        style={{ flex: "1 1 8.5rem" }}
      />
      <Select
        label="Result"
        size="xs"
        value={result}
        onChange={(value) => onResultChange(normalizeWebLocalResultFilter(value))}
        data={[
          { value: "any", label: "Any result" },
          { value: "whitewon", label: "White won" },
          { value: "draw", label: "Draw" },
          { value: "blackwon", label: "Black won" },
        ]}
        allowDeselect={false}
        w={132}
      />
      <Button
        size="compact-xs"
        variant="default"
        disabled={!hasFilters}
        onClick={() => {
          onStartDateChange("");
          onEndDateChange("");
          onResultChange("any");
        }}
      >
        Reset filters
      </Button>
    </Group>
  );
}

function WebDatabasePerspectiveControls({
  playerName,
  playerOptions,
  color,
  onPlayerNameChange,
  onColorChange,
  disabled = false,
  size = "xs",
  playerFlex = "0 1 10rem",
  colorWidth = 132,
}: {
  playerName: string;
  playerOptions: ReturnType<typeof getDatabasePlayerCounts>;
  color: WebColor;
  onPlayerNameChange: (playerName: string) => void;
  onColorChange: (color: WebColor) => void;
  disabled?: boolean;
  size?: "xs" | "sm";
  playerFlex?: string;
  colorWidth?: number;
}) {
  const trimmedPlayerName = playerName.trim();
  const playerData = useMemo(
    () => playerOptions.slice(0, 80).map((player) => player.name),
    [playerOptions],
  );
  const colorOptions = trimmedPlayerName
    ? [
        {
          value: "white",
          label: <WebPlayerColorLabel playerName={trimmedPlayerName} color="white" />,
        },
        {
          value: "black",
          label: <WebPlayerColorLabel playerName={trimmedPlayerName} color="black" />,
        },
      ]
    : [
        { value: "white", label: "White" },
        { value: "black", label: "Black" },
      ];

  return (
    <Group gap={4} wrap="nowrap" style={{ flex: "1 1 auto", minWidth: 0 }}>
      <Tooltip label="Filter this database to one player's games">
        <div style={{ flex: playerFlex, minWidth: 0 }}>
          <Autocomplete
            label="Username"
            value={playerName}
            data={playerData}
            onChange={onPlayerNameChange}
            leftSection={<IconSearch size="1rem" />}
            placeholder={disabled ? "Choose database" : "All players"}
            size={size}
            disabled={disabled}
            limit={8}
          />
        </div>
      </Tooltip>
      <Tooltip
        label={
          trimmedPlayerName
            ? `Only games where ${trimmedPlayerName} had this color`
            : "Only games where that player had this color"
        }
      >
        <SegmentedControl
          aria-label="Database player color"
          size={size}
          data={colorOptions}
          value={color}
          onChange={(value) => onColorChange(value as WebColor)}
          disabled={disabled}
          w={colorWidth}
          styles={
            trimmedPlayerName
              ? {
                  control: {
                    minHeight: size === "sm" ? 42 : 38,
                  },
                  label: {
                    alignItems: "center",
                    display: "flex",
                    height: "100%",
                    justifyContent: "center",
                    minHeight: size === "sm" ? 42 : 38,
                    paddingInline: 4,
                  },
                  innerLabel: {
                    minWidth: 0,
                    width: "100%",
                  },
                }
              : undefined
          }
        />
      </Tooltip>
    </Group>
  );
}

function WebPlayerColorLabel({ playerName, color }: { playerName: string; color: WebColor }) {
  return (
    <span
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        justifyContent: "center",
        lineHeight: 1.05,
        maxWidth: "100%",
        minWidth: 0,
        whiteSpace: "normal",
      }}
    >
      <span
        style={{
          fontSize: "0.82em",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {playerName}
      </span>
      <span style={{ fontSize: "0.78em", opacity: 0.9, whiteSpace: "nowrap" }}>as {color}</span>
    </span>
  );
}

function CompactMoveTable({
  stats,
  showState,
  preparedMoves,
  skippedMoves,
  startedMoveKeys,
  branchStatsByKey,
  emptyLabel,
  onPlayMove,
  onOpenSourceGame,
  onMarkDone,
  onSkipMove,
  sort,
  onSort,
}: {
  stats: WebPrepMoveStat[];
  showState: boolean;
  preparedMoves?: Record<string, number>;
  skippedMoves?: Record<string, number>;
  startedMoveKeys?: Set<string>;
  branchStatsByKey?: Record<string, WebPrepBranchCoverageStats>;
  emptyLabel: string;
  onPlayMove: (stat: WebPrepMoveStat) => void;
  onOpenSourceGame?: (game: WebGame) => void;
  onMarkDone?: (stat: WebPrepMoveStat) => void;
  onSkipMove?: (stat: WebPrepMoveStat) => void;
  sort?: WebPrepSortState;
  onSort?: (column: WebPrepSortColumn) => void;
}) {
  const isPhoneWidth = useMediaQuery("(max-width: 520px)", false, {
    getInitialValueInEffect: false,
  });
  const isPrepTable = Boolean(onMarkDone || onSkipMove || startedMoveKeys);
  const isPrepCandidateTable = isPrepTable && !showState;
  const effectiveSort =
    isPrepCandidateTable && sort && (sort.column === "prep" || sort.column === "state")
      ? getDefaultWebPrepSortState().candidate
      : sort;
  const sortedStats =
    isPrepTable && effectiveSort
      ? sortWebPrepMoveStats(
          stats,
          effectiveSort,
          preparedMoves,
          skippedMoves,
          startedMoveKeys,
          branchStatsByKey,
        )
      : stats;
  const showPhoneMoveRows = isPhoneWidth;

  if (stats.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {emptyLabel}
      </Text>
    );
  }

  if (showPhoneMoveRows) {
    return (
      <Stack gap="xs" className={classes.phonePrepRows}>
        {sortedStats.map((stat) => {
          const status = getWebPrepBranchStatus(stat, preparedMoves, skippedMoves, startedMoveKeys);
          const metaLabel = isPrepTable
            ? formatWebPrepLastPlayedShort(stat.lastPlayed)
            : formatWebDate(stat.lastPlayed) || stat.sourceLabel;
          return (
            <Box
              key={stat.key}
              className={classes.phonePrepRow}
              role="button"
              tabIndex={0}
              onClick={() => onPlayMove(stat)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPlayMove(stat);
                }
              }}
            >
              <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
                <MoveWithInlineWdl
                  stat={stat}
                  meta={metaLabel}
                  variant="phone"
                  statusBadge={
                    showState ? (
                      <Badge color={webPrepStatusColor(status)} variant="light" size="xs">
                        {webPrepStatusLabel(status)}
                      </Badge>
                    ) : null
                  }
                />
                <Group
                  gap={2}
                  justify="flex-end"
                  wrap="nowrap"
                  className={classes.phonePrepActions}
                >
                  {!isPrepCandidateTable && onOpenSourceGame && stat.examples[0] ? (
                    <Tooltip label="Go to game">
                      <ActionIcon
                        aria-label="Go to game"
                        variant="subtle"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenSourceGame(stat.examples[0]);
                        }}
                      >
                        <IconExternalLink size={15} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                  <Tooltip label="Play move">
                    <ActionIcon
                      aria-label="Play this move"
                      variant="subtle"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPlayMove(stat);
                      }}
                    >
                      <IconPlayerPlay size={15} />
                    </ActionIcon>
                  </Tooltip>
                  {showState && onMarkDone ? (
                    <Tooltip label="Mark done">
                      <ActionIcon
                        aria-label="Mark branch done"
                        variant="subtle"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onMarkDone(stat);
                        }}
                      >
                        <IconCheck size={15} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                  {showState && onSkipMove ? (
                    <Tooltip label="Skip">
                      <ActionIcon
                        aria-label="Skip branch"
                        variant="subtle"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSkipMove(stat);
                        }}
                      >
                        <IconX size={15} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                </Group>
              </Group>

              <PhoneMoveStatsLine
                stat={stat}
                branchStats={showState ? branchStatsByKey?.[stat.key] : undefined}
              />
            </Box>
          );
        })}
      </Stack>
    );
  }

  return (
    <Table.ScrollContainer
      minWidth={isPhoneWidth ? 0 : showState ? 760 : isPrepCandidateTable ? 560 : 720}
    >
      <Table className={classes.compactTable} verticalSpacing={showState ? 3 : 4} highlightOnHover>
        <Table.Thead>
          {showState ? (
            <Table.Tr>
              <SortableWebPrepTh label="Move" column="move" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh
                label="Strength"
                column="strength"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableWebPrepTh
                label="Games"
                column="games"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableWebPrepTh
                label="Results"
                column="results"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableWebPrepTh label="Prep" column="prep" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh
                label="State"
                column="state"
                sort={effectiveSort}
                onSort={onSort}
              />
              <Table.Th />
            </Table.Tr>
          ) : isPrepCandidateTable ? (
            <Table.Tr>
              <SortableWebPrepTh label="Move" column="move" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh
                label="Strength"
                column="strength"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableWebPrepTh
                label="Games"
                column="games"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableWebPrepTh
                label="WDL"
                column="results"
                sort={effectiveSort}
                onSort={onSort}
              />
              <Table.Th />
            </Table.Tr>
          ) : (
            <Table.Tr>
              <Table.Th>Move</Table.Th>
              <Table.Th>Blend</Table.Th>
              <Table.Th>Engine</Table.Th>
              <Table.Th>Games</Table.Th>
              <Table.Th>WDL</Table.Th>
              <Table.Th>Last</Table.Th>
              <Table.Th />
            </Table.Tr>
          )}
        </Table.Thead>
        <Table.Tbody>
          {sortedStats.map((stat) => {
            const status = getWebPrepBranchStatus(
              stat,
              preparedMoves,
              skippedMoves,
              startedMoveKeys,
            );
            return (
              <Table.Tr
                key={stat.key}
                style={{ cursor: "pointer" }}
                onClick={() => onPlayMove(stat)}
              >
                <Table.Td>
                  <MoveWithInlineWdl
                    stat={stat}
                    meta={isPrepTable ? formatWebPrepLastPlayed(stat.lastPlayed) : stat.sourceLabel}
                    variant="table"
                  />
                </Table.Td>
                {showState ? (
                  <>
                    <Table.Td>
                      <PrepStrengthCell strength={stat.strength} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatCount(stat.total)}</Text>
                      <Text size="xs" c="dimmed">
                        {formatPercent(stat.share)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <PrepResultBar stat={stat} />
                    </Table.Td>
                    <Table.Td>
                      <PrepBranchStatsCell stats={branchStatsByKey?.[stat.key]} />
                    </Table.Td>
                    <Table.Td>
                      <Badge color={webPrepStatusColor(status)} variant="light" size="sm">
                        {webPrepStatusLabel(status)}
                      </Badge>
                    </Table.Td>
                  </>
                ) : isPrepCandidateTable ? (
                  <>
                    <Table.Td>
                      <PrepStrengthCell strength={stat.strength} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatCount(stat.total)}</Text>
                      <Text size="xs" c="dimmed">
                        {formatPercent(stat.share)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <PrepResultBar stat={stat} />
                    </Table.Td>
                  </>
                ) : (
                  <>
                    <Table.Td>
                      <PrepStrengthCell strength={stat.strength} compact />
                    </Table.Td>
                    <Table.Td>
                      <MoveStrengthEngineCell strength={stat.strength} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatCount(stat.total)}</Text>
                      <Text size="xs" c="dimmed">
                        {formatPercent(stat.share)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <PrepResultBar stat={stat} />
                      <Text size="xs" c="dimmed">
                        Score {formatPercent(stat.scoreForUser)}
                      </Text>
                    </Table.Td>
                    <Table.Td>{formatWebDate(stat.lastPlayed) || "-"}</Table.Td>
                  </>
                )}
                <Table.Td ta="right">
                  <Group gap={2} justify="flex-end" wrap="nowrap">
                    {!isPrepCandidateTable && onOpenSourceGame && stat.examples[0] ? (
                      <Tooltip label="Go to game">
                        <ActionIcon
                          aria-label="Go to game"
                          variant="subtle"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenSourceGame(stat.examples[0]);
                          }}
                        >
                          <IconExternalLink size={15} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                    <Tooltip label="Play this move">
                      <ActionIcon
                        aria-label="Play this move"
                        variant="subtle"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onPlayMove(stat);
                        }}
                      >
                        <IconPlayerPlay size={15} />
                      </ActionIcon>
                    </Tooltip>
                    {showState && onMarkDone ? (
                      <Tooltip label="Mark this branch done">
                        <ActionIcon
                          aria-label="Mark branch done"
                          variant="subtle"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            onMarkDone(stat);
                          }}
                        >
                          <IconCheck size={15} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                    {showState && onSkipMove ? (
                      <Tooltip label="Skip this branch">
                        <ActionIcon
                          aria-label="Skip branch"
                          variant="subtle"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSkipMove(stat);
                          }}
                        >
                          <IconX size={15} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function MoveWithInlineWdl({
  stat,
  meta,
  variant,
  statusBadge,
}: {
  stat: WebPrepMoveStat;
  meta: string | null | undefined;
  variant: "phone" | "table";
  statusBadge?: ReactNode;
}) {
  const isPhone = variant === "phone";
  return (
    <Box className={isPhone ? classes.phonePrepMoveTitle : classes.tableMoveTitle}>
      <Group className={classes.moveWithWdlLine} gap={isPhone ? 6 : 8} wrap="nowrap" align="center">
        <Text
          size={isPhone ? undefined : "sm"}
          fw={isPhone ? 800 : 700}
          className={isPhone ? classes.phonePrepMove : classes.tableMoveText}
        >
          {stat.move}
        </Text>
        <InlineMoveWdlBar stat={stat} variant={variant} />
        {statusBadge}
      </Group>
      {meta ? (
        <Text size="xs" c="dimmed" className={isPhone ? classes.phonePrepMeta : undefined}>
          {meta}
        </Text>
      ) : null}
    </Box>
  );
}

function InlineMoveWdlBar({
  stat,
  variant,
}: {
  stat: Pick<WebPrepMoveStat, "white" | "draw" | "black">;
  variant: "phone" | "table";
}) {
  return (
    <Box
      aria-label={formatCompactWdl(stat)}
      className={`${classes.inlineMoveWdlBar} ${
        variant === "phone" ? classes.phoneInlineMoveWdlBar : classes.tableInlineMoveWdlBar
      }`}
    >
      <PrepResultBar stat={stat} />
    </Box>
  );
}

function SortableWebPrepTh({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: WebPrepSortColumn;
  sort?: WebPrepSortState;
  onSort?: (column: WebPrepSortColumn) => void;
}) {
  const active = sort?.column === column;
  return (
    <Table.Th
      role={onSort ? "button" : undefined}
      tabIndex={onSort ? 0 : undefined}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      style={{ cursor: onSort ? "pointer" : undefined, userSelect: onSort ? "none" : undefined }}
      onClick={() => onSort?.(column)}
      onKeyDown={(event) => {
        if (!onSort) return;
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
            <IconChevronUp size={12} />
          ) : (
            <IconChevronDown size={12} />
          )
        ) : null}
      </Group>
    </Table.Th>
  );
}

function PrepStrengthCell({
  strength,
  compact = false,
}: {
  strength: WebPrepMoveStat["strength"];
  compact?: boolean;
}) {
  if (!strength) {
    return (
      <Text size="xs" c="dimmed">
        -
      </Text>
    );
  }

  return (
    <Tooltip label={strength.detail} multiline w={260}>
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Badge
            color={strength.engineUnsafe ? "yellow" : "teal"}
            variant="light"
            size={compact ? "xs" : "sm"}
          >
            {strength.label}
          </Badge>
          <Text size="xs" fw={700}>
            {strength.score}%
          </Text>
        </Group>
        <Progress
          value={strength.score}
          size={3}
          color={strength.engineUnsafe ? "yellow" : "teal"}
        />
        {!compact ? (
          <>
            <Text size="xs" c="dimmed" lh={1.15}>
              {formatMoveStrengthEngineLine(strength)}
            </Text>
            <Text size="xs" c="dimmed" lh={1.15}>
              {formatMoveStrengthWdlLine(strength)}
            </Text>
          </>
        ) : null}
      </Stack>
    </Tooltip>
  );
}

function PhoneMoveStatsLine({
  stat,
  branchStats,
}: {
  stat: WebPrepMoveStat;
  branchStats?: WebPrepBranchCoverageStats;
}) {
  return (
    <Group className={classes.phonePrepStatLine} gap={6} wrap="nowrap">
      <PhonePrepStrengthSummary strength={stat.strength} />
      <Text size="xs" fw={700} className={classes.phonePrepStatItem}>
        {formatCount(stat.total)} {stat.total === 1 ? "game" : "games"}
      </Text>
      <Text size="xs" c="dimmed" className={classes.phonePrepStatItem}>
        {formatPercent(stat.share)}
      </Text>
      {branchStats ? <PrepBranchStatsCell stats={branchStats} compact /> : null}
    </Group>
  );
}

function PhonePrepStrengthSummary({ strength }: { strength: WebPrepMoveStat["strength"] }) {
  if (!strength) {
    return (
      <Text size="xs" c="dimmed">
        -
      </Text>
    );
  }

  return (
    <Tooltip label={strength.detail} multiline w={260}>
      <Text
        size="xs"
        fw={800}
        c={strength.engineUnsafe ? "yellow.5" : "teal.3"}
        className={classes.phonePrepStatItem}
      >
        Str {strength.score}%
      </Text>
    </Tooltip>
  );
}

function MoveStrengthEngineCell({ strength }: { strength: WebPrepMoveStat["strength"] }) {
  if (!strength) {
    return (
      <Text size="xs" c="dimmed">
        -
      </Text>
    );
  }

  return (
    <Stack gap={1}>
      <Text size="xs" fw={700} c={strength.engineUnsafe ? "yellow.7" : undefined} lh={1.15}>
        {formatMoveStrengthEngineLine(strength)}
      </Text>
      <Text size="xs" c="dimmed" lh={1.15}>
        {formatMoveStrengthWdlLine(strength)}
      </Text>
    </Stack>
  );
}

function formatMoveStrengthEngineLine(
  strength: NonNullable<WebPrepMoveStat["strength"]>,
  short = false,
) {
  if (strength.engineCpLoss === null) {
    return strength.engineCp === null
      ? short
        ? "No engine"
        : "Engine unavailable"
      : formatMoveStrengthCp(strength.engineCp);
  }

  const cp = strength.engineCp === null ? "" : ` (${formatMoveStrengthCp(strength.engineCp)})`;
  if (short) {
    return strength.engineCpLoss <= 0
      ? `Best${cp}`
      : `-${Math.round(strength.engineCpLoss)} cp${cp}`;
  }
  return strength.engineCpLoss <= 0
    ? `Engine best${cp}`
    : `Engine -${Math.round(strength.engineCpLoss)} cp${cp}`;
}

function formatMoveStrengthWdlLine(
  strength: NonNullable<WebPrepMoveStat["strength"]>,
  short = false,
) {
  if (strength.databaseScore === null) return short ? "No WDL" : "WDL unavailable";
  const score = `${(strength.databaseScore * 100).toFixed(1).replace(/\.0$/, "")}%`;
  if (strength.databaseWdlLoss === null || strength.databaseWdlLoss <= 0) {
    return short ? `WDL ${score}` : `WDL best ${score}`;
  }
  return short
    ? `-${formatWdlPointLoss(strength.databaseWdlLoss)} pts (${score})`
    : `WDL -${formatWdlPointLoss(strength.databaseWdlLoss)} pts (${score})`;
}

function formatMoveStrengthCp(value: number) {
  return `${value > 0 ? "+" : ""}${Math.round(value)} cp`;
}

function formatWdlPointLoss(value: number) {
  return (value * 100).toFixed(value >= 0.1 ? 0 : 1).replace(/\.0$/, "");
}

function getWebEngineProgress({
  enabled,
  status,
  lines,
  targetDepth,
}: {
  enabled: boolean;
  status: WebEnginePanelStatus;
  lines: WebEngineLine[];
  targetDepth: number;
}) {
  if (!enabled || status === "idle" || status === "error") return 0;
  if (status === "complete") return 100;
  const reachedDepth = Math.max(0, ...lines.map((line) => line.depth ?? 0));
  if (reachedDepth <= 0) return status === "loading" ? 22 : 35;
  return Math.min(99, Math.max(35, Math.round((reachedDepth / Math.max(1, targetDepth)) * 100)));
}

function getWebEngineHeaderStatus({
  enabled,
  status,
  topLine,
}: {
  enabled: boolean;
  status: WebEnginePanelStatus;
  topLine: WebEngineLine | null;
}) {
  if (!enabled) return "Off";
  if (status === "error") return "Error";
  if (topLine) return getWebEngineSourceLabel(topLine);
  return "Stockfish";
}

function getWebEngineSourceLabel(line: WebEngineLine) {
  if (line.source === "lichess-cloud") return "PC cloud evals";
  if (line.executionLocation === "gaming-pc") return "PC";
  if (line.executionLocation === "phone") return "Local phone";
  return "Stockfish";
}

function getWebCompactEngineMeta({
  enabled,
  topLine,
  nodeCount,
  liveLineSpeed,
}: {
  enabled: boolean;
  topLine: WebEngineLine | null;
  nodeCount: string | null;
  liveLineSpeed: string | null;
}): { label: string; accessibleLabel: string } | null {
  if (!enabled) return null;
  if (!topLine) return { label: "Starting...", accessibleLabel: "Starting engine analysis" };

  const depth = topLine.depth > 0 ? topLine.depth : null;
  if (topLine.source === "lichess-cloud") {
    const depthLabel = depth ? `Depth ${depth}` : "Depth unavailable";
    return { label: depthLabel, accessibleLabel: `PC cloud evals, ${depthLabel.toLowerCase()}` };
  }

  const parts = [
    depth ? `d${depth}` : null,
    nodeCount ? `${nodeCount} nodes` : null,
    liveLineSpeed ? liveLineSpeed.replace(" NPS", " n/s") : null,
  ].filter(Boolean);
  const accessibleParts = [
    depth ? `depth ${depth}` : null,
    topLine.nodes ? `${topLine.nodes.toLocaleString()} total nodes` : null,
    liveLineSpeed,
  ].filter(Boolean);
  return {
    label: parts.join(" | ") || "Starting...",
    accessibleLabel: accessibleParts.join(", ") || "Starting engine analysis",
  };
}

function formatWebEngineNodeCount(value?: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000_000_000) return `${formatCompactEngineNumber(value / 1_000_000_000_000)}T`;
  if (value >= 1_000_000_000) return `${formatCompactEngineNumber(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${formatCompactEngineNumber(value / 1_000_000)}M`;
  if (value >= 1_000) return `${formatCompactEngineNumber(value / 1_000)}k`;
  return Math.round(value).toLocaleString();
}

function formatCompactEngineNumber(value: number) {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$/, "");
}

function formatWebEngineNodeSpeed(value?: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M NPS`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k NPS`;
  return `${Math.round(value)} NPS`;
}

function engineStatusTextColor(status: WebEnginePanelStatus) {
  if (status === "error") return "red";
  if (status === "running" || status === "complete") return "green";
  if (status === "loading") return "blue";
  return "dimmed";
}

function WebPrepStrengthSettingsButton({
  builderSettings,
  updateBuilderSettings,
  buttonLabel = "Strength",
}: {
  builderSettings: PrepBuilderSettings;
  updateBuilderSettings: (patch: Partial<PrepBuilderSettings>) => void;
  buttonLabel?: string;
}) {
  return (
    <Popover width={270} position="bottom-start" shadow="md" withinPortal>
      <Popover.Target>
        <Button variant="default" size="compact-xs" leftSection={<IconSettings size={14} />}>
          {buttonLabel}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Strength
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

function normalizeWebPrepStrengthSettings(settings?: Partial<PrepBuilderSettings> | null) {
  return normalizePrepBuilderSettings({
    ...settings,
    mode: settings?.mode ?? "practical",
    useCloudEngine: true,
    useLichessAll: false,
  });
}

function getWebPrepStrengthSettingsPatch(
  current: Partial<PrepBuilderSettings> | undefined,
  patch: Partial<PrepBuilderSettings>,
): Partial<PrepBuilderSettings> {
  const settings = normalizeWebPrepStrengthSettings({ ...current, ...patch });
  return {
    mode: settings.mode,
    engineWeight: settings.engineWeight,
    maxEngineCpLoss: settings.maxEngineCpLoss,
    useCloudEngine: settings.useCloudEngine,
    useLichessAll: false,
  };
}

function PrepResultBar({ stat }: { stat: Pick<WebPrepMoveStat, "white" | "draw" | "black"> }) {
  const total = stat.white + stat.draw + stat.black;
  const whitePercent = total > 0 ? (stat.white / total) * 100 : 0;
  const drawPercent = total > 0 ? (stat.draw / total) * 100 : 0;
  const blackPercent = total > 0 ? (stat.black / total) * 100 : 0;

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

function formatCompactWdl(stat: Pick<WebPrepMoveStat, "white" | "draw" | "black">) {
  const total = stat.white + stat.draw + stat.black;
  if (total <= 0) return "WDL -";
  const white = Math.round((stat.white / total) * 100);
  const draw = Math.round((stat.draw / total) * 100);
  const black = Math.round((stat.black / total) * 100);
  return `WDL ${white}/${draw}/${black}`;
}

function PrepBranchStatsCell({
  stats,
  compact = false,
}: {
  stats?: WebPrepBranchCoverageStats;
  compact?: boolean;
}) {
  if (!stats) {
    return (
      <Text size="xs" c="dimmed">
        -
      </Text>
    );
  }

  const color = webPrepBranchStatsColor(stats.label);

  if (compact) {
    return (
      <Tooltip label={webPrepBranchStatsTooltip(stats)} multiline w={290}>
        <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
          <Badge color={color} variant="light" size="xs">
            {stats.label}
          </Badge>
          <Text size="xs" fw={700}>
            {stats.score}%
          </Text>
        </Group>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={webPrepBranchStatsTooltip(stats)} multiline w={290}>
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Badge color={color} variant="light" size="sm">
            {stats.label}
          </Badge>
          <Text size="xs" fw={700}>
            {stats.score}%
          </Text>
        </Group>
        <Progress value={stats.score} color={color} size={3} />
        <Text size="xs" c="dimmed" truncate>
          {Math.round(stats.replyCoverage * 100)}% replies - {stats.depthPly} ply
        </Text>
      </Stack>
    </Tooltip>
  );
}

function webPrepBranchStatsTooltip(stats: WebPrepBranchCoverageStats) {
  if (stats.commonReplies <= 0) {
    return stats.depthPly > 0 ? "Line started. No common replies yet." : "No saved line yet.";
  }
  const started = stats.startedReplies > 0 ? `, ${stats.startedReplies} only started` : "";
  const missing =
    stats.missingImportantMoves.length > 0
      ? ` Missing: ${stats.missingImportantMoves.join(", ")}.`
      : "";
  return `${stats.preparedReplies}/${stats.commonReplies} replies done${started}.${missing}`;
}

function webPrepBranchStatsColor(label: WebPrepBranchCoverageStats["label"]) {
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

function getDefaultWebPrepSortState(sortDefaults?: Partial<WebPrepMoveSortDefaults> | null): {
  opponent: WebPrepSortState<WebPrepOpponentSortColumn>;
  candidate: WebPrepSortState<WebPrepCandidateSortColumn>;
} {
  const defaults = normalizeWebPrepMoveSortDefaults(sortDefaults);
  return {
    opponent: {
      column: defaults.opponent,
      direction: getInitialWebPrepSortDirection(defaults.opponent),
    },
    candidate: {
      column: defaults.candidate,
      direction: getInitialWebPrepSortDirection(defaults.candidate),
    },
  };
}

function getInitialWebPrepSortDirection(column: WebPrepSortColumn): WebPrepSortDirection {
  return column === "move" ? "asc" : "desc";
}

function getNextWebPrepSort<TColumn extends WebPrepSortColumn>(
  current: WebPrepSortState<TColumn>,
  column: TColumn,
): WebPrepSortState<TColumn> {
  if (current.column === column) {
    // "state" only exists as "Open first" (desc) in the sort selects; an asc
    // direction would render the toolbar Select blank.
    if (column === "state") return current;
    return {
      column,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }

  return {
    column,
    direction: getInitialWebPrepSortDirection(column),
  };
}

function getWebPrepSortSelectValue(sort: WebPrepSortState) {
  return `${sort.column}:${sort.direction}`;
}

function getWebPrepSortFromSelect<TColumn extends WebPrepSortColumn>(
  value: string | null,
  options: WebPrepSortSelectOption<TColumn>[],
) {
  return options.find((option) => option.value === value)?.sort ?? null;
}

function sortWebPrepMoveStats(
  stats: WebPrepMoveStat[],
  sort: WebPrepSortState,
  preparedMoves: Record<string, number> | undefined,
  skippedMoves: Record<string, number> | undefined,
  startedMoveKeys: Set<string> | undefined,
  branchStatsByKey: Record<string, WebPrepBranchCoverageStats> | undefined,
) {
  return [...stats].sort((a, b) => {
    const diff = compareWebPrepMoveStats(
      a,
      b,
      sort.column,
      preparedMoves,
      skippedMoves,
      startedMoveKeys,
      branchStatsByKey,
    );
    const directed = sort.direction === "asc" ? diff : -diff;
    return (
      directed ||
      b.total - a.total ||
      a.move.localeCompare(b.move, undefined, { sensitivity: "base" })
    );
  });
}

function compareWebPrepMoveStats(
  a: WebPrepMoveStat,
  b: WebPrepMoveStat,
  column: WebPrepSortColumn,
  preparedMoves: Record<string, number> | undefined,
  skippedMoves: Record<string, number> | undefined,
  startedMoveKeys: Set<string> | undefined,
  branchStatsByKey: Record<string, WebPrepBranchCoverageStats> | undefined,
) {
  if (column === "move") {
    return a.move.localeCompare(b.move, undefined, { sensitivity: "base" });
  }
  if (column === "strength") {
    return getWebPrepStrengthSortScore(a) - getWebPrepStrengthSortScore(b);
  }
  if (column === "results") {
    return a.scoreForUser - b.scoreForUser;
  }
  if (column === "prep") {
    return (
      getWebPrepCoverageSortScore(
        a,
        branchStatsByKey,
        preparedMoves,
        skippedMoves,
        startedMoveKeys,
      ) -
      getWebPrepCoverageSortScore(b, branchStatsByKey, preparedMoves, skippedMoves, startedMoveKeys)
    );
  }
  if (column === "state") {
    return (
      getWebPrepStatusSortScore(
        getWebPrepBranchStatus(a, preparedMoves, skippedMoves, startedMoveKeys),
      ) -
      getWebPrepStatusSortScore(
        getWebPrepBranchStatus(b, preparedMoves, skippedMoves, startedMoveKeys),
      )
    );
  }

  return a.total - b.total;
}

function getWebPrepStrengthSortScore(stat: WebPrepMoveStat) {
  return stat.strength?.score ?? -1;
}

function getWebPrepCoverageSortScore(
  stat: WebPrepMoveStat,
  branchStatsByKey: Record<string, WebPrepBranchCoverageStats> | undefined,
  preparedMoves: Record<string, number> | undefined,
  skippedMoves: Record<string, number> | undefined,
  startedMoveKeys: Set<string> | undefined,
) {
  const branchStats = branchStatsByKey?.[stat.key];
  if (branchStats) return branchStats.score;
  const status = getWebPrepBranchStatus(stat, preparedMoves, skippedMoves, startedMoveKeys);
  if (status === "prepared") return 100;
  if (status === "started") return 45;
  if (status === "new") return 0;
  return -1;
}

function getWebPrepStatusSortScore(status: WebPrepBranchStatus) {
  if (status === "new") return 4;
  if (status === "started") return 3;
  if (status === "prepared") return 2;
  return 1;
}

function getWebPrepBranchStatus(
  stat: Pick<WebPrepMoveStat, "key">,
  preparedMoves: Record<string, number> | undefined,
  skippedMoves: Record<string, number> | undefined,
  startedMoveKeys: Set<string> | undefined,
): WebPrepBranchStatus {
  if (preparedMoves?.[stat.key]) return "prepared";
  if (skippedMoves?.[stat.key]) return "skipped";
  if (startedMoveKeys?.has(stat.key)) return "started";
  return "new";
}

function webPrepStatusColor(status: WebPrepBranchStatus) {
  if (status === "prepared") return "green";
  if (status === "started") return "blue";
  if (status === "skipped") return "gray";
  return "orange";
}

function webPrepStatusLabel(status: WebPrepBranchStatus) {
  if (status === "prepared") return "Done";
  if (status === "started") return "Started";
  if (status === "skipped") return "Skipped";
  return "New";
}

function omitRecordKey(record: Record<string, number>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function formatWebPrepLastPlayed(value: string | null | undefined) {
  const label = value ? formatWebDate(value) : "";
  return label ? `Played ${label}` : "-";
}

function formatWebPrepLastPlayedShort(value: string | null | undefined) {
  return value ? formatWebDate(value) || "-" : "-";
}

function FilesWorkspace({
  importHostedPgn,
  importHostedFolder,
}: {
  importHostedPgn: WebHostedPgnImportHandler;
  importHostedFolder: WebHostedFolderImportHandler;
}) {
  return (
    <Box className={classes.filesWorkspace}>
      <HostedFilesPanel importHostedPgn={importHostedPgn} importHostedFolder={importHostedFolder} />
    </Box>
  );
}

function HostedFilesPanel({
  importHostedPgn,
  importHostedFolder,
  preferFolderImport = false,
  embedded = false,
}: {
  importHostedPgn: WebHostedPgnImportHandler;
  importHostedFolder?: WebHostedFolderImportHandler;
  preferFolderImport?: boolean;
  embedded?: boolean;
}) {
  const [library, setLibrary] = useState<WebHostedLibrary | null>(null);
  const [listing, setListing] = useState<WebHostedFileListResponse | null>(null);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const directPgnFilesInPath = useMemo(
    () =>
      listing?.entries.filter(
        (entry): entry is WebHostedFileEntry => entry.type === "file" && entry.extension === "pgn",
      ) ?? [],
    [listing],
  );

  const load = useCallback(
    async (nextPath = path, forceRefresh = false) => {
      setLoading(true);
      try {
        const result = await getHostedWebLibraryPath(nextPath, { forceRefresh });
        setLibrary(result.library);
        setListing(result.listing);
        setPath(nextPath);
      } catch (error) {
        console.error(error);
        setLibrary(null);
        setListing(null);
        notifications.show({
          title: "Hosted files unavailable",
          message:
            error instanceof Error ? error.message : "The published file library did not respond.",
          color: "red",
        });
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  const importFolder = useCallback(
    async (nextPath: string, openFirstGame: boolean) => {
      if (!importHostedFolder) return;
      setLoading(true);
      try {
        const scopedLibrary = await getHostedWebLibraryScope(nextPath);
        await importHostedFolder(scopedLibrary, nextPath, { openFirstGame });
      } catch (error) {
        console.error(error);
        notifications.show({
          title: "Hosted folder unavailable",
          message: error instanceof Error ? error.message : "The hosted folder did not respond.",
          color: "red",
        });
      } finally {
        setLoading(false);
      }
    },
    [importHostedFolder],
  );

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentFolderName = path.split("/").filter(Boolean).at(-1) ?? "Files";

  return (
    <Box
      className={
        embedded
          ? classes.prepToolBox
          : `${classes.panel} ${classes.panelBody} ${classes.filesPanel}`
      }
    >
      <Group className={classes.filesPanelHeader} justify="space-between" gap="xs" mb="md">
        <Group gap="xs" wrap="nowrap" miw={0}>
          {!embedded && listing?.parentPath !== null && (
            <ActionIcon
              aria-label="Back to parent folder"
              className={classes.filesBackButton}
              size="lg"
              variant="subtle"
              onClick={() => void load(listing?.parentPath ?? "")}
            >
              <IconChevronLeft size={24} />
            </ActionIcon>
          )}
          <Box miw={0}>
            <Title order={embedded ? 3 : 2} className={embedded ? undefined : classes.filesTitle}>
              {embedded ? "Hosted files" : currentFolderName}
            </Title>
            <Text
              className={embedded ? undefined : classes.filesSubtitle}
              size="xs"
              c="dimmed"
              truncate
            >
              {path ||
                (library?.manifest
                  ? `${library.manifest.sourceName} · ${formatLibraryDate(library.manifest.generatedAt)}`
                  : "Gaming PC library")}
            </Text>
          </Box>
        </Group>
        <ActionIcon
          aria-label="Refresh files"
          className={embedded ? undefined : classes.filesRefreshButton}
          size={embedded ? "md" : "lg"}
          onClick={() => void load(path, true)}
          loading={loading}
        >
          <IconRefresh size={embedded ? 16 : 20} />
        </ActionIcon>
      </Group>

      {embedded && listing && listing.parentPath !== null && (
        <Group gap="xs" mb="xs" wrap="wrap">
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconArrowBackUp size={14} />}
            onClick={() => void load(listing?.parentPath ?? "")}
          >
            Up
          </Button>
          {library && importHostedFolder && directPgnFilesInPath.length > 0 && (
            <Button
              size="compact-xs"
              leftSection={<IconDatabase size={14} />}
              loading={loading}
              onClick={() => void importFolder(path, !preferFolderImport)}
            >
              Import database
            </Button>
          )}
        </Group>
      )}

      {!embedded &&
        listing?.parentPath !== null &&
        library &&
        importHostedFolder &&
        directPgnFilesInPath.length > 1 && (
          <Button
            className={classes.openAllPgnsButton}
            variant="light"
            leftSection={<IconChess size={18} />}
            loading={loading}
            mb="sm"
            onClick={() => void importFolder(path, true)}
          >
            Open all {directPgnFilesInPath.length} PGNs
          </Button>
        )}

      {library && !library.available && (
        <Text size="sm" c="dimmed">
          No hosted file library is published with this build.
        </Text>
      )}

      {listing && (
        <ScrollArea.Autosize mah={embedded ? 420 : undefined}>
          <Box className={`${classes.itemList} ${embedded ? "" : classes.hostedFileList}`}>
            {listing.entries.map((entry) => (
              <button
                key={`${entry.type}-${entry.path}`}
                className={`${classes.listButton} ${embedded ? "" : classes.hostedFileButton}`}
                type="button"
                onClick={() => {
                  if (entry.type === "directory") {
                    if (
                      preferFolderImport &&
                      importHostedFolder &&
                      entry.directPgnFileCount > 0 &&
                      library
                    ) {
                      void importFolder(entry.path, false);
                      return;
                    }
                    void load(entry.path);
                    return;
                  }
                  if (entry.extension === "pdf") {
                    window.open(getHostedRawFileUrl(entry), "_blank", "noopener,noreferrer");
                    return;
                  }
                  void importHostedPgn(entry);
                }}
              >
                <Group gap={embedded ? "xs" : "sm"} wrap="nowrap">
                  {entry.type === "directory" ? (
                    <IconFolder
                      className={classes.listMainIcon}
                      size={embedded ? 14 : 22}
                      stroke={1.7}
                    />
                  ) : (
                    <IconFileText
                      className={classes.listMainIcon}
                      size={embedded ? 14 : 22}
                      stroke={1.7}
                    />
                  )}
                  {entry.pinned && (
                    <IconPinned className={classes.listPinIcon} size={embedded ? 12 : 15} />
                  )}
                  <Box className={classes.hostedFileText} miw={0}>
                    <Text
                      className={embedded ? undefined : classes.hostedFileName}
                      fw={700}
                      size={embedded ? "xs" : undefined}
                      truncate
                    >
                      {entry.name}
                    </Text>
                    <Text
                      className={embedded ? undefined : classes.hostedFileMeta}
                      size={embedded ? "0.66rem" : undefined}
                      c="dimmed"
                      truncate
                    >
                      {entry.type === "directory"
                        ? entry.pgnFileCount > 0
                          ? pluralWeb(entry.pgnFileCount, "PGN")
                          : "Folder"
                        : `${entry.extension.toUpperCase()} · ${formatBytes(entry.sizeBytes)}`}
                    </Text>
                  </Box>
                  {entry.type === "directory" && !embedded && (
                    <IconChevronRight className={classes.hostedFolderChevron} size={20} />
                  )}
                </Group>
              </button>
            ))}
          </Box>
        </ScrollArea.Autosize>
      )}
    </Box>
  );
}

function WebChessboard({
  fen,
  orientation,
  lastMoveUci,
  engineArrowShapes,
  engineScore,
  onMove,
  canGoToPreviousMove,
  canGoToNextMove,
  onPreviousMove,
  onNextMove,
}: {
  fen: string;
  orientation: WebColor;
  lastMoveUci: string | null;
  engineArrowShapes: DrawShape[];
  engineScore: WebEngineLine["score"] | null;
  onMove: (uci: string) => void;
  canGoToPreviousMove: boolean;
  canGoToNextMove: boolean;
  onPreviousMove: () => void;
  onNextMove: () => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [pendingPromotion, setPendingPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  useBoardTouchGestures(boardRef, {
    canGoToPreviousMove,
    canGoToNextMove,
    onPreviousMove,
    onNextMove,
  });

  const config = useMemo(() => {
    const [position] = positionFromFen(fen);
    const dests = position ? chessgroundDests(position) : new Map();
    const turn = position?.turn;
    const lastMove = getLastMove(lastMoveUci);

    return {
      fen,
      orientation,
      turnColor: turn,
      check: position?.isCheck(),
      coordinates: true,
      lastMove,
      movable: {
        free: false,
        color: turn,
        dests,
        showDests: true,
        events: {
          after(orig: Key, dest: Key) {
            if (boardMoveNeedsPromotion(fen, orig, dest)) {
              setPendingPromotion({ orig, dest });
              return;
            }
            const uci = makeBoardMoveUci(fen, orig, dest);
            if (uci) onMoveRef.current(uci);
          },
        },
      },
      draggable: {
        enabled: true,
      },
      drawable: {
        enabled: true,
        visible: true,
        autoShapes: engineArrowShapes,
      },
      animation: {
        enabled: true,
      },
    };
  }, [engineArrowShapes, fen, lastMoveUci, orientation]);

  const initialConfigRef = useRef(config);

  useEffect(() => {
    const boardElement = boardRef.current;
    if (!boardElement || apiRef.current) return;
    const api = Chessground(boardElement, initialConfigRef.current);
    apiRef.current = api;
    return () => {
      api.destroy();
      if (apiRef.current === api) apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.set(config);
  }, [config]);

  useEffect(() => {
    setPendingPromotion(null);
  }, [fen]);

  const promotionColor = useMemo(() => getFenColor(fen), [fen]);
  const promotionGlyphs: Record<WebPromotionRole, string> =
    promotionColor === "white"
      ? { q: "♕", r: "♖", b: "♗", n: "♘" }
      : { q: "♛", r: "♜", b: "♝", n: "♞" };

  return (
    <Box className={classes.boardArea}>
      <WebBoardEvalBar score={engineScore} orientation={orientation} />
      <Box className={classes.boardSurface}>
        <Box ref={boardRef} className={classes.boardMount} />
        {pendingPromotion && (
          <Box className={classes.promotionOverlay}>
            <Box className={classes.promotionDialog}>
              <Group gap={6} justify="center" wrap="nowrap">
                {(["q", "r", "b", "n"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={classes.promotionChoice}
                    aria-label={`Promote to ${
                      { q: "queen", r: "rook", b: "bishop", n: "knight" }[role]
                    }`}
                    onClick={() => {
                      const uci = makeBoardMoveUci(
                        fen,
                        pendingPromotion.orig,
                        pendingPromotion.dest,
                        role,
                      );
                      setPendingPromotion(null);
                      if (uci) onMoveRef.current(uci);
                    }}
                  >
                    {promotionGlyphs[role]}
                  </button>
                ))}
              </Group>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setPendingPromotion(null);
                  apiRef.current?.set(config);
                }}
              >
                Cancel
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function WebBoardEvalBar({
  score,
  orientation,
}: {
  score: WebEngineLine["score"] | null;
  orientation: WebColor;
}) {
  const progress = score
    ? score.type === "cp"
      ? getWinChance(score.value)
      : score.value > 0
        ? 100
        : 0
    : 50;
  const scoreLabel = score ? formatWebEvalBarScore(score) : "";
  const blackSection = (
    <Box
      key="black"
      className={`${classes.evalBarSection} ${classes.evalBarBlack}`}
      style={{ height: `${100 - progress}%` }}
    >
      {score && score.value <= 0 ? (
        <Text
          className={classes.evalBarLabel}
          c="gray.2"
          style={{ marginTop: orientation === "black" ? "auto" : undefined }}
        >
          {scoreLabel}
        </Text>
      ) : null}
    </Box>
  );
  const whiteSection = (
    <Box
      key="white"
      className={`${classes.evalBarSection} ${classes.evalBarWhite}`}
      style={{ height: `${progress}%` }}
    >
      {score && score.value > 0 ? (
        <Text
          className={classes.evalBarLabel}
          c="dark.8"
          style={{ marginTop: orientation === "white" ? "auto" : undefined }}
        >
          {scoreLabel}
        </Text>
      ) : null}
    </Box>
  );
  const sections =
    orientation === "black" ? [whiteSection, blackSection] : [blackSection, whiteSection];

  return (
    <Tooltip label={score ? formatWebEngineScore(score) : "Engine off"} position="right">
      <Box
        aria-label={score ? `Evaluation ${formatWebEngineScore(score)}` : "Evaluation unavailable"}
        className={classes.evalBar}
        role="img"
      >
        {sections}
      </Box>
    </Tooltip>
  );
}

function formatWebEvalBarScore(score: WebEngineLine["score"]) {
  if (score.type === "mate") return `M${Math.abs(score.value)}`;
  return Math.abs(score.value / 100).toFixed(1);
}

const BOARD_SCROLL_INTENT_PX = 8;
const BOARD_SCROLL_AXIS_BIAS = 1.15;
const BOARD_SWIPE_DISTANCE_PX = 48;
const BOARD_SWIPE_AXIS_BIAS = 1.35;

type BoardTouchNavigation = {
  canGoToPreviousMove: boolean;
  canGoToNextMove: boolean;
  onPreviousMove: () => void;
  onNextMove: () => void;
};

function useBoardTouchGestures(
  boardRef: { current: HTMLDivElement | null },
  navigation: BoardTouchNavigation,
) {
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  useEffect(() => {
    const boardElement = boardRef.current;
    if (!boardElement) return;

    let gesture: {
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      mode: "pending" | "scroll" | "swipe" | "board";
      swipeEligible: boolean;
    } | null = null;

    const resetGesture = () => {
      gesture = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        resetGesture();
        return;
      }

      const touch = event.touches[0];
      const navigationState = navigationRef.current;
      gesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        mode: "pending",
        swipeEligible:
          (navigationState.canGoToPreviousMove || navigationState.canGoToNextMove) &&
          !isChessgroundPieceTarget(event.target),
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (gesture.mode === "pending") {
        if (Math.max(absX, absY) < BOARD_SCROLL_INTENT_PX) return;
        gesture.mode =
          absY > absX * BOARD_SCROLL_AXIS_BIAS
            ? "scroll"
            : gesture.swipeEligible && absX > absY * BOARD_SWIPE_AXIS_BIAS
              ? "swipe"
              : "board";
      }

      if (gesture.mode === "swipe") {
        gesture.lastX = touch.clientX;
        gesture.lastY = touch.clientY;
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (gesture.mode !== "scroll") return;

      const scrollDelta = gesture.lastY - touch.clientY;
      gesture.lastX = touch.clientX;
      gesture.lastY = touch.clientY;
      if (scrollDelta !== 0) scrollPageBy(scrollDelta);

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!gesture) return;

      const completedGesture = gesture;
      resetGesture();

      if (completedGesture.mode !== "swipe") return;

      const touch = event.changedTouches[0];
      const finalX = touch?.clientX ?? completedGesture.lastX;
      const finalY = touch?.clientY ?? completedGesture.lastY;
      const deltaX = finalX - completedGesture.startX;
      const deltaY = finalY - completedGesture.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      if (absX < BOARD_SWIPE_DISTANCE_PX || absX <= absY * BOARD_SWIPE_AXIS_BIAS) return;

      const navigationState = navigationRef.current;
      if (deltaX < 0) {
        if (navigationState.canGoToNextMove) navigationState.onNextMove();
      } else if (navigationState.canGoToPreviousMove) {
        navigationState.onPreviousMove();
      }
    };

    boardElement.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    boardElement.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: false,
    });
    boardElement.addEventListener("touchend", onTouchEnd, {
      capture: true,
      passive: false,
    });
    boardElement.addEventListener("touchcancel", resetGesture, {
      capture: true,
      passive: true,
    });

    return () => {
      boardElement.removeEventListener("touchstart", onTouchStart, { capture: true });
      boardElement.removeEventListener("touchmove", onTouchMove, { capture: true });
      boardElement.removeEventListener("touchend", onTouchEnd, { capture: true });
      boardElement.removeEventListener("touchcancel", resetGesture, { capture: true });
    };
  }, [boardRef]);
}

function isChessgroundPieceTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("piece"));
}

function scrollPageBy(deltaY: number) {
  const scroller = document.scrollingElement;
  if (scroller) {
    scroller.scrollTop += deltaY;
  } else {
    window.scrollBy(0, deltaY);
  }
}

function UnderBoardEmpty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Box className={classes.underBoardEmpty}>
      <Stack align="center" gap={6}>
        {icon}
        <Text fw={700}>{title}</Text>
        <Text size="sm" c="dimmed" ta="center">
          {text}
        </Text>
      </Stack>
    </Box>
  );
}

function getWebEngineArrowShapes(lines: WebEngineLine[], fen: string): DrawShape[] {
  const [position] = positionFromFen(fen);
  if (!position || lines.length === 0) return [];

  const sortedLines = [...lines]
    .filter((line) => line.uciMoves.length > 0)
    .sort((a, b) => a.multipv - b.multipv);
  const bestLine = sortedLines[0];
  if (!bestLine) return [];

  const bestWinChance = getWinChance(normalizeScore(bestLine.score, position.turn));
  const shapes: DrawShape[] = [];
  for (const [index, line] of sortedLines.entries()) {
    const move = parseUci(line.uciMoves[0]);
    if (!move || !isNormal(move) || !position.isLegal(move)) continue;

    const winChance = getWinChance(normalizeScore(line.score, position.turn));
    const winChanceDrop = bestWinChance - winChance;
    if (winChanceDrop >= WEB_ENGINE_ARROW_WIN_CHANCE_LIMIT) continue;

    const from = makeSquare(move.from);
    const to = makeSquare(move.to);
    if (!from || !to || shapes.some((shape) => shape.orig === from && shape.dest === to)) {
      continue;
    }

    shapes.push({
      orig: from as Key,
      dest: to as Key,
      brush: index === 0 ? WEB_ENGINE_ARROW_COLOR.strong : WEB_ENGINE_ARROW_COLOR.pale,
      modifiers: {
        lineWidth: getWebEngineArrowLineWidth(winChanceDrop),
      },
    });
  }

  return shapes;
}

function getWebEngineArrowLineWidth(winChanceDrop: number) {
  if (winChanceDrop < 2.5) return WEB_ENGINE_ARROW_LARGE_BRUSH;
  if (winChanceDrop < 5) return WEB_ENGINE_ARROW_MEDIUM_BRUSH;
  return WEB_ENGINE_ARROW_SMALL_BRUSH;
}

type WebPromotionRole = "q" | "r" | "b" | "n";

function makeBoardMoveUci(fen: string, orig: Key, dest: Key, promotion: WebPromotionRole = "q") {
  const [position] = positionFromFen(fen);
  if (!position || orig === "a0" || dest === "a0") return null;

  const from = parseSquare(orig);
  const to = parseSquare(dest);
  if (from === undefined || to === undefined) return null;

  return `${orig}${dest}${boardMoveNeedsPromotion(fen, orig, dest) ? promotion : ""}`;
}

function boardMoveNeedsPromotion(fen: string, orig: Key, dest: Key) {
  const [position] = positionFromFen(fen);
  if (!position) return false;
  const from = parseSquare(orig);
  if (from === undefined) return false;
  const piece = position.board.get(from);
  return (
    piece?.role === "pawn" &&
    ((piece.color === "white" && dest.endsWith("8")) ||
      (piece.color === "black" && dest.endsWith("1")))
  );
}

function getLastMove(uci: string | null): Key[] | undefined {
  if (!uci) return undefined;
  const move = parseUci(uci);
  if (!move || !isNormal(move)) return undefined;
  return [makeSquare(move.from) as Key, makeSquare(move.to) as Key];
}

function pluralWeb(count: number, noun: string, plural = `${noun}s`) {
  return `${count} ${count === 1 ? noun : plural}`;
}

function fenAtCursor(line: WebPrepLineMove[], cursor: number, startFen = INITIAL_FEN) {
  if (cursor <= 0) return startFen;
  return line[cursor - 1]?.fenAfter ?? startFen;
}

function clampCursor(cursor: number, lineLength: number) {
  return Math.min(Math.max(0, Math.round(cursor || 0)), lineLength);
}

function prepBoardTitle(prep: WebPrepWorkspace) {
  return getWebPrepWorkspaceName(prep);
}

function getExplorerSourceLabel(source: WebDatabaseExplorerSource) {
  return source === "lichess-all" ? "Lichess All" : "Lichess Masters";
}

function isWebDatabasePanelSource(value: string): value is WebDatabasePanelSource {
  return value === "local" || value === "lichess-all" || value === "lichess-masters";
}

function isWebDatabasePanelView(value: string): value is WebDatabasePanelView {
  return value === "stats" || value === "games" || value === "options";
}

function isWebDatabaseStatsSort(value: string): value is WebDatabaseStatsSort {
  return WEB_DATABASE_STATS_SORT_OPTIONS.some((option) => option.value === value);
}

function isOnlinePrepSource(source: WebPrepSource): source is WebDatabaseExplorerSource {
  return source === "lichess-all" || source === "lichess-masters";
}

type WebDatabaseSelectGroup = {
  group: string;
  items: {
    value: string;
    label: string;
    disabled?: boolean;
    detail?: string;
    searchText?: string;
  }[];
};

function getWebDatabaseSelectData({
  databases,
  hostedFolders,
  includeOnline = false,
  temporarySource = null,
}: {
  databases: WebDatabase[];
  hostedFolders: WebHostedDatabaseFolder[];
  includeOnline?: boolean;
  temporarySource?: WebPrepTemporarySource | null;
}): WebDatabaseSelectGroup[] {
  const groups = new Map<string, WebDatabaseSelectGroup["items"]>();
  const addItem = (group: string, item: WebDatabaseSelectGroup["items"][number]) => {
    groups.set(group, [...(groups.get(group) ?? []), item]);
  };

  if (temporarySource) {
    groups.set("Current prep", [
      {
        value: WEB_TEMPORARY_PREP_SOURCE_VALUE,
        label: `${formatDatabasePickerLabel(temporarySource.name)} (${temporarySource.gameCount} unsaved)`,
        detail: `Current prep source - ${formatCount(temporarySource.gameCount)} games`,
        searchText: "current prep temporary unsaved source",
      },
    ]);
  }

  if (includeOnline) {
    groups.set("Online", [
      {
        value: WEB_LICHESS_ALL_SOURCE_VALUE,
        label: "Lichess All",
        detail: "Explorer - saved token reused",
        searchText: "lichess all online explorer",
      },
      {
        value: WEB_LICHESS_MASTERS_SOURCE_VALUE,
        label: "Lichess Masters",
        detail: "Explorer - saved token reused",
        searchText: "lichess masters online explorer",
      },
    ]);
  }

  const hostedFolderByPath = new Map(hostedFolders.map((folder) => [folder.path, folder]));
  for (const database of databases) {
    const folderPath = database.hostedPath ? getHostedDatabaseFolderPath(database.hostedPath) : "";
    const hostedFolder = database.hostedPath ? hostedFolderByPath.get(database.hostedPath) : null;
    const updateAvailable =
      hostedFolder && (database.hostedUpdatedAt ?? 0) < hostedFolder.lastModified;
    addItem(folderPath ? getHostedDatabaseGroupLabel(folderPath) : "Unfiled", {
      value: database.hostedPath ? hostedDatabaseValue(database.hostedPath) : database.id,
      label: formatDatabasePickerLabel(database.name),
      detail: updateAvailable
        ? `Update - ${formatCount(hostedFolder.fileCount)} PGN${
            hostedFolder.fileCount === 1 ? "" : "s"
          } - ${formatBytes(hostedFolder.sizeBytes)}`
        : `Ready - ${formatCount(database.gameCount)} game${database.gameCount === 1 ? "" : "s"}${
            database.sizeBytes ? ` - ${formatBytes(database.sizeBytes)}` : ""
          }`,
      searchText: [
        database.name,
        database.hostedPath,
        database.playerNames.slice(0, 12).join(" "),
        updateAvailable ? "update available refresh sync newer hosted" : null,
        "loaded local synced database",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  for (const folder of hostedFolders) {
    if (databases.some((database) => database.hostedPath === folder.path)) continue;
    const folderPath = getHostedDatabaseFolderPath(folder.path);
    addItem(folderPath ? getHostedDatabaseGroupLabel(folderPath) : "Unfiled", {
      value: hostedDatabaseValue(folder.path),
      label: getHostedDatabaseLeafLabel(folder.path),
      detail: `Tap to load - ${formatCount(folder.fileCount)} PGN${
        folder.fileCount === 1 ? "" : "s"
      } - ${formatBytes(folder.sizeBytes)}`,
      searchText: `${folder.label} ${folder.path} synced hosted fork database not loaded`,
    });
  }

  return Array.from(groups.entries())
    .map(([group, items]) => ({
      group,
      items: items.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }),
      ),
    }))
    .sort((a, b) => {
      if (a.group === "Current prep") return -1;
      if (b.group === "Current prep") return 1;
      if (a.group === "Online") return -1;
      if (b.group === "Online") return 1;
      if (a.group === "Unfiled") return -1;
      if (b.group === "Unfiled") return 1;
      return a.group.localeCompare(b.group, undefined, { sensitivity: "base", numeric: true });
    });
}

function getHostedDatabaseFolderPath(path: string) {
  const parts = normalizeHostedDatabasePathParts(path);
  parts.pop();
  return parts.join("/");
}

function getHostedDatabaseLeafLabel(path: string) {
  return normalizeHostedDatabasePathParts(path).at(-1) ?? path;
}

function getHostedDatabaseGroupLabel(path: string) {
  return normalizeHostedDatabasePathParts(path).join(" / ");
}

function normalizeHostedDatabasePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function createHostedDatabaseId(path: string) {
  const normalized = normalizeHostedDatabasePath(path);
  const slug =
    normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56) || "database";
  return `hosted-${slug}-${hashHostedDatabasePath(normalized)}`;
}

function getWebPrepSourceLabelForFen(fen: string, userColor: WebColor) {
  return getFenColor(fen) === oppositeWebColor(userColor) ? "opponent move" : "reply faced";
}

function normalizeHostedDatabasePathParts(path: string) {
  return normalizeHostedDatabasePath(path)
    .replace(/^Databases\//, "")
    .split("/")
    .filter(Boolean);
}

function formatDatabasePickerLabel(name: string) {
  return name.replace(/\.pgn$/i, "");
}

function formatHostedLoadProgress(
  label: string | null,
  progress: WebHostedFolderReadProgress | null,
) {
  const source = label || "hosted database";
  if (!progress) return `Loading ${source} from synced files`;
  if (progress.total <= 0) return `Loading ${source} from synced files`;
  return `Loading ${source}: ${formatCount(progress.loaded)} / ${formatCount(progress.total)} PGNs`;
}

function formatExplorerSpeed(speed: WebLichessExplorerOptions["speeds"][number]) {
  switch (speed) {
    case "ultraBullet":
      return "UltraBullet";
    case "bullet":
      return "Bullet";
    case "blitz":
      return "Blitz";
    case "rapid":
      return "Rapid";
    case "classical":
      return "Classical";
    case "correspondence":
      return "Correspondence";
  }
}

function useWebExplorerOptions() {
  const [lichessOptions, setLichessOptions] = usePersistentJson(
    WEB_LICHESS_EXPLORER_OPTIONS_STORAGE_KEY,
    DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS,
    normalizeWebLichessExplorerOptions,
  );
  const [mastersOptions, setMastersOptions] = usePersistentJson(
    WEB_MASTERS_EXPLORER_OPTIONS_STORAGE_KEY,
    DEFAULT_WEB_MASTERS_EXPLORER_OPTIONS,
    normalizeWebMastersExplorerOptions,
  );
  const explorerOptions = useMemo<WebExplorerOptions>(
    () => ({
      lichess: lichessOptions,
      masters: mastersOptions,
    }),
    [lichessOptions, mastersOptions],
  );

  return {
    lichessOptions,
    setLichessOptions,
    mastersOptions,
    setMastersOptions,
    explorerOptions,
  };
}

function useHostedDatabaseFolders() {
  const [library, setLibrary] = useState<WebHostedLibrary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLibrary(await getHostedWebLibrary());
    } catch (loadError) {
      console.error(loadError);
      setLibrary(null);
      setError(
        loadError instanceof Error ? loadError.message : "The hosted database list did not load.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const folders = useMemo(() => (library ? getHostedDatabaseFolders(library) : []), [library]);

  return {
    library,
    folders,
    loading,
    error,
    refresh: load,
  };
}

function hostedDatabaseValue(path: string) {
  return `hosted-db:${normalizeHostedDatabasePath(path)}`;
}

function isHostedDatabaseValue(value: string) {
  return value.startsWith("hosted-db:");
}

function hostedDatabasePathFromValue(value: string) {
  return normalizeHostedDatabasePath(value.replace(/^hosted-db:/, ""));
}

function hashHostedDatabasePath(path: string) {
  let hash = 5381;
  for (let index = 0; index < path.length; index += 1) {
    hash = Math.imul(hash, 33) ^ path.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function normalizeWebPrepStoredSetup(
  value: Partial<WebPrepStoredSetup> | null | undefined,
): WebPrepStoredSetup {
  const source =
    value?.source === "lichess-all" ||
    value?.source === "lichess-masters" ||
    value?.source === "local"
      ? value.source
      : "local";
  const mode = value?.mode === "general" ? "general" : "player";
  const userColor: WebColor = value?.userColor === "black" ? "black" : "white";
  const result = normalizeWebLocalResultFilter(value?.result);
  const minGames = Math.max(
    1,
    Math.min(999, Math.round(Number(value?.minGames) || DEFAULT_WEB_PREP_MIN_GAMES)),
  );
  const moveLimit = Math.max(
    1,
    Math.min(20, Math.round(Number(value?.moveLimit) || DEFAULT_WEB_PREP_MOVE_LIMIT)),
  );

  return {
    mode,
    source,
    sourceId: typeof value?.sourceId === "string" && value.sourceId ? value.sourceId : null,
    sourceRef: typeof value?.sourceRef === "string" && value.sourceRef ? value.sourceRef : null,
    opponent: typeof value?.opponent === "string" ? value.opponent : "",
    userColor,
    startDate: normalizeWebDateFilter(value?.startDate),
    endDate: normalizeWebDateFilter(value?.endDate),
    result,
    minGames,
    moveLimit,
    builder: normalizeWebPrepStrengthSettings(value?.builder),
    sortDefaults: normalizeWebPrepMoveSortDefaults(value?.sortDefaults),
  };
}

function normalizeWebLocalResultFilter(value: unknown): WebLocalResultFilter {
  return value === "whitewon" || value === "draw" || value === "blackwon" ? value : "any";
}

function normalizeWebDateFilter(value: unknown) {
  if (typeof value !== "string") return "";
  const match = value.trim().match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1952 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeWebEnginePanelSettings(
  value: Partial<WebEnginePanelSettings> | null | undefined,
): WebEnginePanelSettings {
  return {
    enabled: Boolean(value?.enabled),
    useCloud: value?.useCloud !== false,
    multipv: clampWholeNumber(value?.multipv, 1, 8, DEFAULT_WEB_ENGINE_PANEL_SETTINGS.multipv),
    depth: clampWholeNumber(value?.depth, 6, 70, DEFAULT_WEB_ENGINE_PANEL_SETTINGS.depth),
    infinite: Boolean(value?.infinite),
  };
}

function clampWholeNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function usePersistentJson<T>(
  key: string,
  fallback: T,
  normalize: (value: Partial<T> | null | undefined) => T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored
        ? normalize(JSON.parse(stored) as Partial<T>)
        : normalize(fallback as Partial<T>);
    } catch {
      return normalize(fallback as Partial<T>);
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Browser storage is best-effort for these small source options.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function usePersistentString(key: string, fallback: string) {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      if (value) {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Browser storage is best-effort for this small preference.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatLibraryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatWebDate(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString();
}
