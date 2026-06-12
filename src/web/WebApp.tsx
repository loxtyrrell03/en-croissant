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
  Text,
  TextInput,
  Tooltip,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications, Notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconArrowsSort,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronsLeft,
  IconChevronsRight,
  IconChess,
  IconCloud,
  IconCloudDownload,
  IconCpu,
  IconDatabase,
  IconDownload,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTarget,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
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
import { getWinChance, normalizeScore } from "@/utils/score";
import {
  normalizePrepBuilderSettings,
  type PrepBuilderEngineMove,
  type PrepBuilderSettings,
} from "@/utils/opponentPrep";
import DatabaseFolderSelect from "@/components/common/DatabaseFolderSelect";
import classes from "./WebApp.module.css";
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
  getHostedDirectPgnFilesInPath,
  getHostedPgnFilesInPath,
  getHostedWebLibrary,
  listHostedLibraryPath,
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
import {
  fetchWebOnlineGames,
  getWebOnlineImportTitle,
  getWebOnlineRangeLabel,
  getWebOnlineSourceLabel,
  type WebOnlineImportMode,
  type WebOnlineRangePreset,
  type WebOnlineSource,
} from "./onlineImport";
import {
  completeWebLichessLoginIfPresent,
  startWebLichessLogin,
  WEB_LICHESS_TOKEN_STORAGE_KEY,
} from "./lichessAuth";
import { queryWebLichessCloudEngineMoves, queryWebLichessCloudLines } from "./lichessCloud";
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
  countWebGameVariationMoves,
  formatWebDate,
  getFenColor,
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
import { formatWebEngineScore } from "./engineScore";
import { analyzeWithWebStockfish18, stopWebStockfish18Search } from "./stockfishEngine";

type ViewMode = "board" | "files";
type BoardPanelMode = "moves" | "database" | "prep" | "engine";
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
const DEFAULT_WEB_PREP_MIN_GAMES = 1;
const DEFAULT_WEB_PREP_MOVE_LIMIT = 12;
const WEB_ENGINE_ARROW_LARGE_BRUSH = 11;
const WEB_ENGINE_ARROW_MEDIUM_BRUSH = 7.5;
const WEB_ENGINE_ARROW_SMALL_BRUSH = 4;
const WEB_ENGINE_ARROW_WIN_CHANCE_LIMIT = 10;
const WEB_ENGINE_ARROW_COLORS = [
  { strong: "blue", pale: "paleBlue" },
  { strong: "green", pale: "paleGreen" },
  { strong: "red", pale: "paleRed" },
  { strong: "yellow", pale: "yellow" },
] as const;

type WebEnginePanelSettings = {
  enabled: boolean;
  useCloud: boolean;
  multipv: number;
  depth: number;
};

const DEFAULT_WEB_ENGINE_PANEL_SETTINGS: WebEnginePanelSettings = {
  enabled: false,
  useCloud: true,
  multipv: 3,
  depth: 14,
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
  const [importing, setImporting] = useState(false);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [lichessToken, setLichessToken] = usePersistentString(WEB_LICHESS_TOKEN_STORAGE_KEY, "");
  const saveReady = useRef(false);

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
    if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}web-sw.js`).catch((error) => {
      console.warn("Web companion service worker registration failed", error);
    });
  }, []);

  useEffect(() => {
    void completeWebLichessLoginIfPresent()
      .then((result) => {
        if (result.status === "complete") {
          setLichessToken(result.token);
          notifications.show({
            title: "Lichess connected",
            message: "Lichess All and Lichess Masters are available on this phone.",
            color: "green",
          });
        } else if (result.status === "error") {
          notifications.show({
            title: "Lichess login failed",
            message: result.message,
            color: "red",
          });
        }
      })
      .catch((error) => {
        console.error(error);
        notifications.show({
          title: "Lichess login failed",
          message: error instanceof Error ? error.message : "Could not finish Lichess login.",
          color: "red",
        });
      });
  }, [setLichessToken]);

  const activePrep = useMemo(
    () => state.prepWorkspaces.find((prep) => prep.id === state.activePrepId) ?? null,
    [state.activePrepId, state.prepWorkspaces],
  );
  const activeDatabase = useMemo(
    () => state.databases.find((database) => database.id === selectedDatabaseId) ?? null,
    [selectedDatabaseId, state.databases],
  );
  const activeDatabaseGames = activeDatabase
    ? (state.gamesByDatabase[activeDatabase.id] ?? [])
    : [];
  const selectedGame =
    activeDatabaseGames.find((game) => game.id === selectedGameId) ??
    activeDatabaseGames[0] ??
    null;

  const loadGameOnBoard = useCallback((game: WebGame) => {
    setState((current) => ({
      ...current,
      activePrepId: null,
      board: {
        orientation: "white",
        startFen: INITIAL_FEN,
        line: webGameToLine(game),
        cursor: game.moves.length,
        sourceTitle: `${game.white} - ${game.black}`,
        sourceDatabaseId: game.databaseId,
        sourceGameId: game.id,
        sourceComments: game.comments ?? [],
      },
    }));
    setSelectedDatabaseId(game.databaseId);
    setSelectedGameId(game.id);
    setView("board");
  }, []);

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

  const exitBoardFile = useCallback(() => {
    setState((current) => ({
      ...current,
      activePrepId: null,
      board: {
        ...createEmptyWebBoardState(),
        ...current.board,
        sourceTitle: "Analysis board",
        sourceDatabaseId: null,
        sourceGameId: null,
        sourceComments: [],
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
        message: notificationMessage?.(imported) ?? `${imported.games.length} games indexed.`,
        color: "green",
      });

      return imported;
    },
    [addImportedDatabases, loadGameOnBoard],
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
              sourceKind: "source",
            },
          });
        }

        addImportedDatabases(imported);
        const firstGame = imported[0]?.games[0];
        if (firstGame) {
          window.setTimeout(() => loadGameOnBoard(firstGame), 0);
        }

        notifications.show({
          title: "PGN imported",
          message: `${imported.reduce((sum, result) => sum + result.games.length, 0)} games indexed.`,
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
            `${imported.games.length} games indexed from ${file.filename}.`,
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
            `${imported.games.length} games indexed from ${folder.files.length} hosted PGNs.`,
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
                `${imported.games.length} ${getWebOnlineSourceLabel(source)} games indexed for ${username}.`,
            })
          : parsePgnDatabase(`${title}.pgn`, pgn);
        if (!saveDatabase) {
          notifications.show({
            title: "Prep source ready",
            message: `${imported.games.length} ${getWebOnlineSourceLabel(source)} games are available for this prep.`,
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

  const deleteDatabase = useCallback((database: WebDatabase) => {
    setState((current) => {
      const nextGames = { ...current.gamesByDatabase };
      delete nextGames[database.id];

      return {
        ...current,
        databases: current.databases.filter((item) => item.id !== database.id),
        gamesByDatabase: nextGames,
        prepWorkspaces: current.prepWorkspaces.map((prep) => ({
          ...prep,
          sourceIds: prep.sourceIds.filter((id) => id !== database.id),
        })),
        board:
          current.board.sourceDatabaseId === database.id
            ? createEmptyWebBoardState()
            : current.board,
      };
    });
    setSelectedDatabaseId((current) => (current === database.id ? null : current));
  }, []);

  return (
    <MantineProvider defaultColorScheme="dark" theme={theme}>
      <Notifications />
      <Box className={classes.shell}>
        <Box className={classes.header}>
          <Box className={classes.headerInner}>
            <Box className={classes.brand}>
              <Group gap="xs" wrap="nowrap">
                <IconChess className={classes.brandIcon} size={24} />
                <Box>
                  <Title order={3} className={classes.brandTitle} lh={1.1}>
                    En Croissant Web
                  </Title>
                  <Text className={classes.brandSubtitle} size="xs" c="dimmed" truncate>
                    Board, files, prep
                  </Text>
                </Box>
              </Group>
            </Box>
            <Group className={classes.headerActions} justify="flex-end" gap="xs" wrap="nowrap">
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(value) => setView(value as ViewMode)}
                data={[
                  { value: "board", label: "Board" },
                  { value: "files", label: "Files" },
                ]}
              />
              <Button
                aria-label="Import PGN files"
                className={classes.headerImportButton}
                component="label"
                size="xs"
                leftSection={<IconUpload size={15} />}
                loading={importing}
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
              importOnlineGames={importOnlineGames}
              loadGameOnBoard={loadGameOnBoard}
              onStartBlankBoard={openEmptyBoard}
              onExitBoardFile={exitBoardFile}
              lichessToken={lichessToken}
              setLichessToken={setLichessToken}
            />
          ) : (
            <FilesWorkspace
              databases={state.databases}
              gamesByDatabase={state.gamesByDatabase}
              selectedDatabaseId={selectedDatabaseId}
              selectedGame={selectedGame}
              importing={importing}
              importFiles={importFiles}
              importHostedPgn={importHostedPgn}
              importHostedFolder={importHostedFolder}
              setSelectedDatabaseId={setSelectedDatabaseId}
              setSelectedGameId={setSelectedGameId}
              deleteDatabase={deleteDatabase}
              loadGameOnBoard={loadGameOnBoard}
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
  importOnlineGames,
  loadGameOnBoard,
  onStartBlankBoard,
  onExitBoardFile,
  lichessToken,
  setLichessToken,
}: {
  state: WebCompanionState;
  setState: Dispatch<SetStateAction<WebCompanionState>>;
  activePrep: WebPrepWorkspace | null;
  importHostedFolder: WebHostedFolderImportHandler;
  importOnlineGames: WebOnlineImportHandler;
  loadGameOnBoard: (game: WebGame) => void;
  onStartBlankBoard: () => void;
  onExitBoardFile: () => void;
  lichessToken: string;
  setLichessToken: (value: string) => void;
}) {
  const [panelMode, setPanelMode] = useState<BoardPanelMode>("moves");
  const [engineArrowAnalysis, setEngineArrowAnalysis] = useState<{
    fen: string;
    lines: WebEngineLine[];
  } | null>(null);
  const board = state.board ?? createEmptyWebBoardState();
  const activeLine = activePrep?.line ?? board.line;
  const startFen = activePrep?.startFen ?? board.startFen;
  const cursor = clampCursor(board.cursor, activeLine.length);
  const currentFen = fenAtCursor(activeLine, cursor, startFen);
  const currentLine = activeLine.slice(0, cursor);
  const sourceGame = useMemo(() => {
    if (activePrep || !board.sourceDatabaseId || !board.sourceGameId) return null;
    return (
      (state.gamesByDatabase[board.sourceDatabaseId] ?? []).find(
        (game) => game.id === board.sourceGameId,
      ) ?? null
    );
  }, [activePrep, board.sourceDatabaseId, board.sourceGameId, state.gamesByDatabase]);
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
    setEngineArrowAnalysis(lines.length > 0 ? { fen, lines } : null);
  }, []);
  const engineArrowShapes = useMemo(
    () =>
      panelMode === "engine" && engineArrowAnalysis?.fen === currentFen
        ? getWebEngineArrowShapes(engineArrowAnalysis.lines, currentFen)
        : [],
    [currentFen, engineArrowAnalysis, panelMode],
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
      side: activePrep.userColor,
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
      side: activePrep.userColor,
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

  const playMoveFromPrepRoot = (stat: WebPrepMoveStat) => {
    if (!prepBranchFen) return;
    const played = playSanMove(prepBranchFen, stat.move);
    if (!played) return;
    appendMoveAtCursor(played.san, played.uci, played.fenAfter, prepBranchPly);
  };

  const handleBoardMove = (uci: string) => {
    const played = playUciMove(currentFen, uci);
    if (!played) return;
    appendMove(played.san, played.uci, played.fenAfter);
  };

  const activeLastMove = cursor > 0 ? (activeLine[cursor - 1]?.uci ?? null) : null;
  const orientation = activePrep?.userColor ?? board.orientation;
  const isViewingFile = !activePrep && Boolean(board.sourceDatabaseId || board.sourceGameId);

  return (
    <Box className={classes.phoneBoard}>
      <Box className={classes.boardHeader}>
        <Box miw={0}>
          <Text size="xs" c="dimmed">
            {activePrep ? "Prep board" : isViewingFile ? "File board" : "Board"}
          </Text>
          <Title order={3} className={classes.truncateTitle}>
            {boardTitle}
          </Title>
        </Box>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="xs"
            variant="light"
            leftSection={isViewingFile ? <IconX size={14} /> : <IconRefresh size={14} />}
            onClick={isViewingFile ? onExitBoardFile : onStartBlankBoard}
          >
            {isViewingFile ? "Exit file" : "New board"}
          </Button>
          <Badge color={turnColor === "white" ? "gray" : "dark"} variant="light">
            {turnColor}
          </Badge>
        </Group>
      </Box>

      <WebChessboard
        fen={currentFen}
        orientation={orientation}
        lastMoveUci={activeLastMove}
        engineArrowShapes={engineArrowShapes}
        onMove={handleBoardMove}
        canGoToPreviousMove={canGoToPreviousMove}
        canGoToNextMove={canGoToNextMove}
        onPreviousMove={goToPreviousMove}
        onNextMove={goToNextMove}
      />

      <BoardMoveControls
        canGoToPreviousMove={canGoToPreviousMove}
        canGoToNextMove={canGoToNextMove}
        onPreviousMove={goToPreviousMove}
        onNextMove={goToNextMove}
      />

      <BoardStartActions activeMode={panelMode} onChooseMode={(mode) => setPanelMode(mode)} />

      <Box className={classes.underBoardPanel}>
        <Box className={classes.underBoardContent}>
          {panelMode === "moves" ? (
            <MovesUnderBoardPanel
              line={activeLine}
              cursor={cursor}
              setCursor={setCursor}
              rootLines={sourceRootLines}
              onChooseLine={chooseMovePanelLine}
              sourceTitle={boardTitle}
              sourceComments={activePrep ? [] : (board.sourceComments ?? [])}
            />
          ) : panelMode === "database" ? (
            <DatabaseUnderBoardPanel
              currentFen={currentFen}
              databases={state.databases}
              gamesByDatabase={state.gamesByDatabase}
              importHostedFolder={importHostedFolder}
              onPlayMove={playMove}
              onOpenSourceGame={loadGameOnBoard}
              lichessToken={lichessToken}
              setLichessToken={setLichessToken}
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
              setLichessToken={setLichessToken}
            />
          ) : (
            <EngineUnderBoardPanel
              currentFen={currentFen}
              onAnalysisLinesChange={handleEngineAnalysisLinesChange}
              onPlayMove={playEngineMove}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}

function BoardMoveControls({
  canGoToPreviousMove,
  canGoToNextMove,
  onPreviousMove,
  onNextMove,
}: {
  canGoToPreviousMove: boolean;
  canGoToNextMove: boolean;
  onPreviousMove: () => void;
  onNextMove: () => void;
}) {
  return (
    <Group
      aria-label="Board move navigation"
      className={classes.boardMoveControls}
      gap="xs"
      justify="center"
      wrap="nowrap"
    >
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
    </Group>
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
    <Group className={classes.boardStartActions} gap={6} grow>
      <Button
        aria-label="Moves"
        size="xs"
        variant={activeMode === "moves" ? "filled" : "light"}
        leftSection={<IconPlayerPlay size={14} />}
        onClick={() => onChooseMode("moves")}
      >
        Moves
      </Button>
      <Button
        aria-label="Database"
        size="xs"
        variant={activeMode === "database" ? "filled" : "light"}
        leftSection={<IconDatabase size={14} />}
        onClick={() => onChooseMode("database")}
      >
        DB
      </Button>
      <Button
        aria-label="Prep"
        size="xs"
        variant={activeMode === "prep" ? "filled" : "light"}
        leftSection={<IconTarget size={14} />}
        onClick={() => onChooseMode("prep")}
      >
        Prep
      </Button>
      <Button
        aria-label="Engine"
        size="xs"
        variant={activeMode === "engine" ? "filled" : "light"}
        leftSection={<IconCpu size={14} />}
        onClick={() => onChooseMode("engine")}
      >
        Engine
      </Button>
    </Group>
  );
}

function MovesUnderBoardPanel({
  line,
  cursor,
  setCursor,
  rootLines,
  onChooseLine,
  sourceTitle,
  sourceComments,
}: {
  line: WebPrepLineMove[];
  cursor: number;
  setCursor: (cursor: number) => void;
  rootLines: WebPrepLineMove[][];
  onChooseLine: (line: WebPrepLineMove[], cursor?: number) => void;
  sourceTitle: string;
  sourceComments: string[];
}) {
  const rootAlternatives = rootLines.filter(
    (rootLine) => rootLine.length > 0 && !webLinesStartSame(rootLine, line),
  );

  const renderLine = (
    moves: WebPrepLineMove[],
    parentLine: WebPrepLineMove[],
    keyPrefix: string,
    depth: number,
  ) =>
    moves.map((move, index) => {
      const beforeMoveLine = [...parentLine, ...moves.slice(0, index)];
      const lineToMove = [...beforeMoveLine, move];
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
                onChooseLine(lineToMove, lineToMove.length);
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
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed" truncate>
          {sourceTitle}
        </Text>
        <Group gap={2} wrap="nowrap">
          <ActionIcon aria-label="Start" disabled={cursor === 0} onClick={() => setCursor(0)}>
            <IconChevronsLeft size={16} />
          </ActionIcon>
          <ActionIcon
            aria-label="Previous"
            disabled={cursor === 0}
            onClick={() => setCursor(cursor - 1)}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
          <ActionIcon
            aria-label="Next"
            disabled={cursor >= line.length}
            onClick={() => setCursor(cursor + 1)}
          >
            <IconChevronRight size={16} />
          </ActionIcon>
          <ActionIcon
            aria-label="End"
            disabled={cursor >= line.length}
            onClick={() => setCursor(line.length)}
          >
            <IconChevronsRight size={16} />
          </ActionIcon>
        </Group>
      </Group>
      {sourceComments.length > 0 && (
        <Box className={classes.moveRootComments}>
          {sourceComments.map((comment, index) => (
            <Text key={`root-comment-${index}`} size="xs" className={classes.moveComment}>
              {comment}
            </Text>
          ))}
        </Box>
      )}
      <Box className={classes.moveList}>
        {line.length === 0 && rootAlternatives.length === 0 ? (
          <Text size="sm" c="dimmed">
            Start
          </Text>
        ) : (
          <>
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
            {renderLine(line, [], "main", 0)}
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

function webLinesStartSame(left: WebPrepLineMove[], right: WebPrepLineMove[]) {
  if (left.length === 0 || right.length === 0) return left.length === right.length;
  return webMovesMatch(left[0], right[0]);
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
  setLichessToken,
}: {
  currentFen: string;
  databases: WebDatabase[];
  gamesByDatabase: Record<string, WebGame[]>;
  importHostedFolder: WebHostedFolderImportHandler;
  onPlayMove: (stat: WebPrepMoveStat) => void;
  onOpenSourceGame: (game: WebGame) => void;
  lichessToken: string;
  setLichessToken: (value: string) => void;
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
  const localLazySide = trimmedLocalPlayerName ? localColor : getFenColor(currentFen);
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
      side: trimmedLocalPlayerName ? localColor : getFenColor(currentFen),
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
                <WebLichessAccessControls
                  token={lichessToken}
                  setToken={setLichessToken}
                  signedInLabel="Lichess saved"
                />
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
          <Tooltip label="Return to database settings">
            <ActionIcon
              aria-label="Return to database settings"
              className={classes.databaseStartedExit}
              size="sm"
              variant="filled"
              color="dark"
              onClick={() => setStoredPanelStage("setup")}
            >
              <IconX size={15} />
            </ActionIcon>
          </Tooltip>
          {databaseContent}
        </Box>
      ) : null}
    </Stack>
  );
}

type WebEnginePanelStatus = "idle" | "loading" | "running" | "complete" | "error";
type WebEngineCloudStatus = "off" | "loading" | "ready" | "miss" | "error";

function EngineUnderBoardPanel({
  currentFen,
  onAnalysisLinesChange,
  onPlayMove,
}: {
  currentFen: string;
  onAnalysisLinesChange: (fen: string, lines: WebEngineLine[]) => void;
  onPlayMove: (uci: string) => void;
}) {
  const [settings, setSettings] = usePersistentJson(
    WEB_ENGINE_PANEL_SETTINGS_STORAGE_KEY,
    DEFAULT_WEB_ENGINE_PANEL_SETTINGS,
    normalizeWebEnginePanelSettings,
  );
  const [stockfishLines, setStockfishLines] = useState<WebEngineLine[]>([]);
  const [cloudLines, setCloudLines] = useState<WebEngineLine[]>([]);
  const [status, setStatus] = useState<WebEnginePanelStatus>("idle");
  const [cloudStatus, setCloudStatus] = useState<WebEngineCloudStatus>(
    settings.useCloud ? "miss" : "off",
  );
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const updateSettings = (patch: Partial<WebEnginePanelSettings>) => {
    setSettings((current) => normalizeWebEnginePanelSettings({ ...current, ...patch }));
  };

  useEffect(() => {
    if (!settings.enabled) {
      stopWebStockfish18Search();
      setStatus("idle");
      setError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setStatus("loading");
    setError(null);
    setStockfishLines([]);

    if (settings.useCloud) {
      setCloudStatus("loading");
      setCloudLines([]);
      void queryWebLichessCloudLines({
        fen: currentFen,
        multipv: settings.multipv,
        signal: controller.signal,
      })
        .then((lines) => {
          if (!active) return;
          setCloudLines(lines);
          setCloudStatus(lines.length > 0 ? "ready" : "miss");
        })
        .catch((cloudError) => {
          if (!active || isAbortError(cloudError)) return;
          setCloudLines([]);
          setCloudStatus("error");
        });
    } else {
      setCloudStatus("off");
      setCloudLines([]);
    }

    void analyzeWithWebStockfish18({
      fen: currentFen,
      multipv: settings.multipv,
      depth: settings.depth,
      signal: controller.signal,
      onUpdate: (lines) => {
        if (!active) return;
        setStockfishLines(lines);
        setStatus(lines.length > 0 ? "running" : "loading");
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
  }, [currentFen, settings.depth, settings.enabled, settings.multipv, settings.useCloud]);

  const displayLines = stockfishLines.length > 0 ? stockfishLines : cloudLines;
  useEffect(() => {
    onAnalysisLinesChange(currentFen, settings.enabled ? displayLines : []);
  }, [currentFen, displayLines, onAnalysisLinesChange, settings.enabled]);

  useEffect(() => {
    return () => onAnalysisLinesChange(currentFen, []);
  }, [currentFen, onAnalysisLinesChange]);

  const topLine = displayLines[0] ?? null;
  const progress = getWebEngineProgress({
    enabled: settings.enabled,
    status,
    lines: displayLines,
    targetDepth: settings.depth,
  });
  const headerStatus = getWebEngineHeaderStatus({
    enabled: settings.enabled,
    status,
    cloudStatus,
    topLine,
    hasCloudFallback: stockfishLines.length === 0 && cloudLines.length > 0,
  });
  const topLineSpeed = topLine ? formatWebEngineNodeSpeed(topLine.nps) : null;

  return (
    <Box className={classes.enginePanelShell}>
      <Box className={classes.enginePanelHeader}>
        <ActionIcon
          className={classes.enginePanelToggle}
          aria-label={settings.enabled ? "Pause Stockfish 18" : "Start Stockfish 18"}
          variant={settings.enabled ? "filled" : "subtle"}
          color={settings.enabled ? "blue" : "gray"}
          onClick={() => updateSettings({ enabled: !settings.enabled })}
        >
          {settings.enabled ? <IconPlayerPause size={17} /> : <IconPlayerPlay size={17} />}
        </ActionIcon>

        <Box className={classes.enginePanelTitleArea}>
          <Group gap={6} wrap="nowrap" miw={0}>
            <Text fw={700} size="sm" truncate>
              Stockfish 18
            </Text>
            {headerStatus ? (
              <Code className={classes.enginePanelCode} c={engineStatusTextColor(status)}>
                {headerStatus}
              </Code>
            ) : null}
            {settings.useCloud ? (
              <Code className={classes.enginePanelCode} c={cloudStatusTextColor(cloudStatus)}>
                {cloudStatusLabel(cloudStatus)}
              </Code>
            ) : null}
          </Group>
          {settings.enabled && topLineSpeed ? (
            <Text size="xs" c="dimmed" truncate>
              {topLineSpeed}
            </Text>
          ) : null}
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
          <ActionIcon.Group>
            <Tooltip label={settings.useCloud ? "Disable Lichess Cloud" : "Enable Lichess Cloud"}>
              <ActionIcon
                aria-label="Toggle Lichess Cloud"
                variant={settings.useCloud ? "light" : "subtle"}
                color={settings.useCloud ? "cyan" : "gray"}
                disabled={!settings.enabled}
                onClick={() => updateSettings({ useCloud: !settings.useCloud })}
              >
                <IconCloud size={16} />
              </ActionIcon>
            </Tooltip>
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
            <Switch
              checked={settings.useCloud}
              onChange={(event) => updateSettings({ useCloud: event.currentTarget.checked })}
              label="Lichess Cloud"
              size="xs"
              disabled={!settings.enabled}
            />
            <NumberInput
              label="Lines"
              value={settings.multipv}
              onChange={(value) => updateSettings({ multipv: Number(value) || 1 })}
              min={1}
              max={8}
              step={1}
              size="xs"
              disabled={!settings.enabled}
            />
            <NumberInput
              label="Depth"
              value={settings.depth}
              onChange={(value) => updateSettings({ depth: Number(value) || 14 })}
              min={6}
              max={30}
              step={1}
              size="xs"
              disabled={!settings.enabled}
            />
          </Group>
        </Box>
      </Collapse>

      <Progress value={progress} radius={0} size={3} color={status === "error" ? "red" : "blue"} />
      <EngineLineTable
        enabled={settings.enabled}
        error={error}
        lines={displayLines}
        settings={settings}
        status={status}
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
  status,
  onPlayMove,
}: {
  enabled: boolean;
  error: string | null;
  lines: WebEngineLine[];
  settings: WebEnginePanelSettings;
  status: WebEnginePanelStatus;
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
          {status === "loading"
            ? "Starting Stockfish 18"
            : "Waiting for engine lines from this position"}
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
                    <Code className={classes.enginePanelCode}>
                      {line.source === "lichess-cloud" ? "Lichess" : "Stockfish"}
                    </Code>
                    <Text size="xs" c="dimmed">
                      d{line.depth || "?"}
                    </Text>
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
  setLichessToken,
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
  setLichessToken: (value: string) => void;
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
  const [setupOpen, setSetupOpen] = useState(true);
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
  const lastActivePrepIdRef = useRef<string | null>(null);
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
  const showSetupStage = !activePrep || setupOpen;
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
    if (!activePrep) {
      lastActivePrepIdRef.current = null;
      setSetupOpen(true);
      return;
    }
    if (lastActivePrepIdRef.current !== activePrep.id) {
      lastActivePrepIdRef.current = activePrep.id;
      setSetupOpen(false);
    }
  }, [activePrep]);

  useEffect(() => {
    const nextSort = getDefaultWebPrepSortState(selectedPrepSortDefaults);
    setPrepSort(nextSort.opponent);
    setPrepCandidateSort(nextSort.candidate);
  }, [activePrep?.id, selectedPrepSortDefaults.candidate, selectedPrepSortDefaults.opponent]);

  useEffect(() => {
    if (onlineUsername || !activePrep?.opponent) return;
    setOnlineUsername(activePrep.opponent);
  }, [activePrep?.opponent, onlineUsername]);

  useEffect(() => {
    if (onlineMode !== "range") return;
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
  }, [activePrep, branchFen, currentFen, explorerOptions, lichessToken, selectedPrepSource]);

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
    activePrep,
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
      side: activePrep.userColor,
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
      side: activePrep.userColor,
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
    setSetupOpen(false);
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

  useEffect(() => {
    if (selectedPrepMode !== "player" || selectedPrepSource !== "local") return;
    if (!activePrepSourceId || selectedPrepDatabasePlayers.length === 0) return;
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
                  setSetupOpen(false);
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
                  <WebLichessAccessControls
                    token={lichessToken}
                    setToken={setLichessToken}
                    signedInLabel="Lichess saved"
                  />
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
          <Box className={classes.prepTrainingMoves}>
            <Tooltip label="Return to prep settings">
              <ActionIcon
                aria-label="Return to prep settings"
                className={classes.prepTrainingExit}
                size="sm"
                variant="filled"
                color="dark"
                onClick={() => setSetupOpen(true)}
              >
                <IconX size={15} />
              </ActionIcon>
            </Tooltip>
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
  const isPhoneWidth = useMediaQuery("(max-width: 520px)");

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
  setToken,
  signedInLabel,
}: {
  token: string;
  setToken: (value: string) => void;
  signedInLabel: string;
}) {
  const signedIn = Boolean(token.trim());

  if (signedIn) {
    return (
      <Group gap={4} wrap="nowrap" style={{ flex: "1 1 12rem" }}>
        <Badge color="green" variant="light">
          {signedInLabel}
        </Badge>
        <Button
          size="compact-xs"
          variant="default"
          leftSection={<IconCloudDownload size={14} />}
          onClick={() => void startWebLichessLogin()}
        >
          Relink
        </Button>
        <Tooltip label="Forget saved Lichess token">
          <ActionIcon
            aria-label="Forget Lichess token"
            variant="default"
            onClick={() => setToken("")}
          >
            <IconX size={15} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return (
    <>
      <TextInput
        label="Lichess token"
        size="xs"
        type="password"
        value={token}
        onChange={(event) => setToken(event.currentTarget.value)}
        placeholder="Bearer token"
        style={{ flex: "1 1 12rem" }}
      />
      <Button
        size="xs"
        variant="light"
        leftSection={<IconCloudDownload size={14} />}
        onClick={() => void startWebLichessLogin()}
      >
        Sign in
      </Button>
    </>
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
  const isPhoneWidth = useMediaQuery("(max-width: 520px)");
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
            : (formatWebDate(stat.lastPlayed) ?? stat.sourceLabel);
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
                <Box className={classes.phonePrepMoveTitle}>
                  <Group gap={6} wrap="nowrap" align="center">
                    <Text fw={800} className={classes.phonePrepMove}>
                      {stat.move}
                    </Text>
                    {showState ? (
                      <Badge color={webPrepStatusColor(status)} variant="light" size="xs">
                        {webPrepStatusLabel(status)}
                      </Badge>
                    ) : null}
                  </Group>
                  <Text size="xs" c="dimmed" className={classes.phonePrepMeta}>
                    {metaLabel}
                  </Text>
                </Box>
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
                  <Text size="sm" fw={700}>
                    {stat.move}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {isPrepTable ? formatWebPrepLastPlayed(stat.lastPlayed) : stat.sourceLabel}
                  </Text>
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
        {formatCount(stat.total)} games
      </Text>
      <Text size="xs" c="dimmed" className={classes.phonePrepStatItem}>
        {formatPercent(stat.share)}
      </Text>
      {branchStats ? <PrepBranchStatsCell stats={branchStats} compact /> : null}
      <Text size="xs" c="dimmed" className={classes.phonePrepStatItem}>
        {formatCompactWdl(stat)}
      </Text>
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
  cloudStatus,
  topLine,
  hasCloudFallback,
}: {
  enabled: boolean;
  status: WebEnginePanelStatus;
  cloudStatus: WebEngineCloudStatus;
  topLine: WebEngineLine | null;
  hasCloudFallback: boolean;
}) {
  if (!enabled) return "Off";
  if (status === "error") return "Error";
  if (hasCloudFallback) return "Lichess";
  if (topLine) return topLine.source === "lichess-cloud" ? "Lichess" : "Stockfish";
  if (cloudStatus === "loading") return "Loading";
  return status === "loading" ? "Loading" : "Stockfish";
}

function formatWebEngineNodeSpeed(value?: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mn/s`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} kn/s`;
  return `${Math.round(value)} n/s`;
}

function engineStatusTextColor(status: WebEnginePanelStatus) {
  if (status === "error") return "red";
  if (status === "running" || status === "complete") return "green";
  if (status === "loading") return "blue";
  return "dimmed";
}

function cloudStatusLabel(status: WebEngineCloudStatus) {
  if (status === "loading") return "Cloud";
  if (status === "ready") return "Cloud";
  if (status === "error") return "Cloud error";
  if (status === "off") return "Cloud off";
  return "No cloud";
}

function cloudStatusTextColor(status: WebEngineCloudStatus) {
  if (status === "ready") return "cyan";
  if (status === "loading") return "blue";
  if (status === "error") return "red";
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
  return value ? (formatWebDate(value) ?? "-") : "-";
}

function FilesWorkspace({
  databases,
  gamesByDatabase,
  selectedDatabaseId,
  selectedGame,
  importing,
  importFiles,
  importHostedPgn,
  importHostedFolder,
  setSelectedDatabaseId,
  setSelectedGameId,
  deleteDatabase,
  loadGameOnBoard,
}: {
  databases: WebDatabase[];
  gamesByDatabase: Record<string, WebGame[]>;
  selectedDatabaseId: string | null;
  selectedGame: WebGame | null;
  importing: boolean;
  importFiles: (files: FileList | null) => Promise<void>;
  importHostedPgn: WebHostedPgnImportHandler;
  importHostedFolder: WebHostedFolderImportHandler;
  setSelectedDatabaseId: (id: string | null) => void;
  setSelectedGameId: (id: string | null) => void;
  deleteDatabase: (database: WebDatabase) => void;
  loadGameOnBoard: (game: WebGame) => void;
}) {
  const activeGames = selectedDatabaseId ? (gamesByDatabase[selectedDatabaseId] ?? []) : [];

  return (
    <Box className={classes.filesWorkspace}>
      <HostedFilesPanel importHostedPgn={importHostedPgn} importHostedFolder={importHostedFolder} />

      <Box className={`${classes.panel} ${classes.panelBody}`}>
        <Group justify="space-between" gap="xs" mb="sm">
          <Box>
            <Title order={3}>Indexed PGNs</Title>
            <Text size="xs" c="dimmed">
              Browser-side databases used by the board panels
            </Text>
          </Box>
          <Button
            component="label"
            size="xs"
            leftSection={<IconUpload size={14} />}
            loading={importing}
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

        {databases.length === 0 ? (
          <UnderBoardEmpty
            icon={<IconFileText size={30} />}
            title="No indexed PGNs"
            text="Import a PGN or open one from Hosted files."
          />
        ) : (
          <Box className={classes.filesSplit}>
            <ScrollArea.Autosize mah={520}>
              <Box className={classes.itemList}>
                {databases.map((database) => (
                  <button
                    key={database.id}
                    className={classes.listButton}
                    data-active={database.id === selectedDatabaseId}
                    onClick={() => {
                      setSelectedDatabaseId(database.id);
                      setSelectedGameId(null);
                    }}
                    type="button"
                  >
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Box miw={0}>
                        <Text fw={700} truncate>
                          {database.name}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {database.gameCount} games - {formatBytes(database.sizeBytes)}
                        </Text>
                      </Box>
                      <ActionIcon
                        aria-label="Delete database"
                        color="red"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteDatabase(database);
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </button>
                ))}
              </Box>
            </ScrollArea.Autosize>

            <Stack gap="xs" miw={0}>
              <Group justify="space-between" gap="xs">
                <Text size="sm" fw={700}>
                  Games
                </Text>
                {selectedGame && (
                  <Button
                    size="compact-xs"
                    variant="light"
                    leftSection={<IconDownload size={14} />}
                    onClick={() =>
                      downloadText(
                        `${selectedGame.white}-${selectedGame.black}.pgn`,
                        selectedGame.pgn,
                      )
                    }
                  >
                    PGN
                  </Button>
                )}
              </Group>
              <ScrollArea.Autosize mah={280}>
                <Box className={classes.itemList}>
                  {activeGames.map((game) => {
                    const variationMoves = countWebGameVariationMoves(game);
                    return (
                      <button
                        key={game.id}
                        className={classes.listButton}
                        data-active={game.id === selectedGame?.id}
                        onClick={() => setSelectedGameId(game.id)}
                        type="button"
                      >
                        <Text fw={700} truncate>
                          {game.white} - {game.black}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {formatWebDate(game.date) || "undated"} - {game.result} -{" "}
                          {game.moves.length} plies
                          {variationMoves > 0 ? ` + ${variationMoves} variation plies` : ""}
                        </Text>
                      </button>
                    );
                  })}
                </Box>
              </ScrollArea.Autosize>
              {selectedGame && (
                <Group gap="xs">
                  <Button
                    size="xs"
                    leftSection={<IconChess size={14} />}
                    onClick={() => loadGameOnBoard(selectedGame)}
                  >
                    Open on board
                  </Button>
                  <Badge variant="light">{selectedGame.result}</Badge>
                </Group>
              )}
            </Stack>
          </Box>
        )}
      </Box>
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
    () => (library ? getHostedDirectPgnFilesInPath(library, path) : []),
    [library, path],
  );

  const load = useCallback(
    async (nextPath = path) => {
      setLoading(true);
      try {
        const nextLibrary = await getHostedWebLibrary();
        const nextListing = listHostedLibraryPath(nextLibrary, nextPath);
        setLibrary(nextLibrary);
        setListing(nextListing);
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

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box className={embedded ? classes.prepToolBox : `${classes.panel} ${classes.panelBody}`}>
      <Group justify="space-between" gap="xs" mb="sm">
        <Box miw={0}>
          <Title order={3}>Hosted files</Title>
          <Text size="xs" c="dimmed" truncate>
            {library?.manifest
              ? `${library.manifest.sourceName} - ${formatLibraryDate(library.manifest.generatedAt)}`
              : "Published web library"}
          </Text>
        </Box>
        <ActionIcon aria-label="Refresh files" onClick={() => void load(path)} loading={loading}>
          <IconRefresh size={16} />
        </ActionIcon>
      </Group>

      {listing?.parentPath !== null && (
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
              onClick={() =>
                void importHostedFolder(library, path, { openFirstGame: !preferFolderImport })
              }
            >
              Import database
            </Button>
          )}
        </Group>
      )}

      {library && !library.available && (
        <Text size="sm" c="dimmed">
          No hosted file library is published with this build.
        </Text>
      )}

      {listing && (
        <ScrollArea.Autosize mah={420}>
          <Box className={classes.itemList}>
            {listing.entries.map((entry) => (
              <button
                key={`${entry.type}-${entry.path}`}
                className={classes.listButton}
                type="button"
                onClick={() => {
                  if (entry.type === "directory") {
                    if (
                      preferFolderImport &&
                      importHostedFolder &&
                      entry.directPgnFileCount > 0 &&
                      library
                    ) {
                      void importHostedFolder(library, entry.path, { openFirstGame: false });
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
                <Group gap="xs" wrap="nowrap">
                  {entry.type === "directory" ? (
                    <IconFolder size={18} />
                  ) : (
                    <IconFileText size={18} />
                  )}
                  <Box miw={0}>
                    <Text fw={700} truncate>
                      {entry.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {entry.type === "directory"
                        ? entry.directPgnFileCount > 0
                          ? `${entry.directPgnFileCount} PGN ${entry.directPgnFileCount === 1 ? "file" : "files"}`
                          : `${entry.pgnFileCount} PGN ${entry.pgnFileCount === 1 ? "file" : "files"} inside`
                        : `${entry.extension.toUpperCase()} - ${formatBytes(entry.sizeBytes)}`}
                    </Text>
                  </Box>
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

  return <Box ref={boardRef} className={classes.boardMount} />;
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

    const color = WEB_ENGINE_ARROW_COLORS[0];
    shapes.push({
      orig: from as Key,
      dest: to as Key,
      brush: index === 0 ? color.strong : color.pale,
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

function makeBoardMoveUci(fen: string, orig: Key, dest: Key) {
  const [position] = positionFromFen(fen);
  if (!position || orig === "a0" || dest === "a0") return null;

  const from = parseSquare(orig);
  const to = parseSquare(dest);
  if (from === undefined || to === undefined) return null;

  const piece = position.board.get(from);
  const needsPromotion =
    piece?.role === "pawn" &&
    ((piece.color === "white" && dest.endsWith("8")) ||
      (piece.color === "black" && dest.endsWith("1")));

  return `${orig}${dest}${needsPromotion ? "q" : ""}`;
}

function getLastMove(uci: string | null): Key[] | undefined {
  if (!uci) return undefined;
  const move = parseUci(uci);
  if (!move || !isNormal(move)) return undefined;
  return [makeSquare(move.from) as Key, makeSquare(move.to) as Key];
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

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-chess-pgn" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = sanitizeFilename(filename);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[\\/:*?"<>|]+/g, "-");
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
    depth: clampWholeNumber(value?.depth, 6, 30, DEFAULT_WEB_ENGINE_PANEL_SETTINGS.depth),
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
