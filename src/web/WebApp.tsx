import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@/styles/global.css";

import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Collapse,
  createTheme,
  Group,
  Loader,
  MantineProvider,
  NumberInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  Title,
} from "@mantine/core";
import { notifications, Notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronsLeft,
  IconChevronsRight,
  IconChess,
  IconCloudDownload,
  IconDatabase,
  IconDownload,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { isNormal, makeSquare, parseSquare, parseUci } from "chessops";
import { chessgroundDests } from "chessops/compat";
import { INITIAL_FEN } from "chessops/fen";
import {
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
import DatabaseFolderSelect from "@/components/common/DatabaseFolderSelect";
import classes from "./WebApp.module.css";
import {
  fetchWebExplorerMoveStats,
  type WebDatabaseExplorerSource,
} from "./explorer";
import {
  getHostedRawFileUrl,
  getHostedDatabaseFolders,
  getHostedDirectPgnFilesInPath,
  getHostedWebLibrary,
  listHostedLibraryPath,
  readHostedPgnFolder,
  readHostedPgnFile,
  type WebHostedDatabaseFolder,
  type WebHostedFileEntry,
  type WebHostedFileListResponse,
  type WebHostedLibrary,
} from "./hostedFiles";
import type {
  WebBoardState,
  WebColor,
  WebCompanionState,
  WebDatabase,
  WebGame,
  WebImportResult,
  WebPrepLineMove,
  WebPrepMode,
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
import {
  collectGamesForSources,
  getFirstOpenPrepStat,
  getGamesForWebPrepSource,
  getKnownPlayers,
  getNextOpenPrepStat,
  getWebPrepMoveStats,
  type WebPrepMoveStat,
} from "./prepIndex";
import {
  formatWebDate,
  getFenColor,
  normalizeWebFen,
  oppositeWebColor,
  parsePgnDatabase,
  playSanMove,
  playUciMove,
  webGameToLine,
} from "./pgn";
import { createEmptyWebBoardState, createEmptyWebState, loadWebState, saveWebState } from "./storage";

type ViewMode = "board" | "files";
type BoardPanelMode = "moves" | "database" | "prep";
type WebHostedPgnImportHandler = (entry: WebHostedFileEntry) => Promise<WebImportResult | null>;
type WebHostedFolderImportHandler = (
  library: WebHostedLibrary,
  path: string,
  options?: WebHostedFolderImportOptions,
) => Promise<WebImportResult | null>;
type WebHostedFolderImportOptions = {
  openFirstGame?: boolean;
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
type WebPrepSortColumn = "move" | "strength" | "games" | "results" | "prep" | "state";
type WebPrepSortState = {
  column: WebPrepSortColumn;
  direction: WebPrepSortDirection;
};

const WEB_LICHESS_ALL_SOURCE_VALUE = "web-source:lichess-all";
const WEB_LICHESS_MASTERS_SOURCE_VALUE = "web-source:lichess-masters";
const WEB_TEMPORARY_PREP_SOURCE_VALUE = "web-source:temporary-prep";
const WEB_DATABASE_PANEL_SOURCE_STORAGE_KEY = "en-croissant-web-database-panel-source";
const WEB_DATABASE_PANEL_LOCAL_STORAGE_KEY = "en-croissant-web-database-panel-local-source";
const DEFAULT_WEB_PREP_MIN_GAMES = 1;
const DEFAULT_WEB_PREP_MOVE_LIMIT = 12;
const DEFAULT_WEB_PREP_SORT: WebPrepSortState = { column: "games", direction: "desc" };
const DEFAULT_WEB_PREP_CANDIDATE_SORT: WebPrepSortState = {
  column: "strength",
  direction: "desc",
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
  const [lichessToken, setLichessToken] = usePersistentString(
    WEB_LICHESS_TOKEN_STORAGE_KEY,
    "",
  );
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
  const activeDatabaseGames = activeDatabase ? state.gamesByDatabase[activeDatabase.id] ?? [] : [];
  const selectedGame =
    activeDatabaseGames.find((game) => game.id === selectedGameId) ?? activeDatabaseGames[0] ?? null;

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
      },
    }));
    setSelectedDatabaseId(game.databaseId);
    setSelectedGameId(game.id);
    setView("board");
  }, []);

  const addImportedDatabases = useCallback((imported: WebImportResult[]) => {
    setState((current) => {
      const nextGames = { ...current.gamesByDatabase };
      for (const result of imported) {
        nextGames[result.database.id] = result.games;
      }

      return {
        ...current,
        databases: [...imported.map((result) => result.database), ...current.databases],
        gamesByDatabase: nextGames,
      };
    });
    setSelectedDatabaseId(imported[0]?.database.id ?? selectedDatabaseId);
  }, [selectedDatabaseId]);

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
          imported.push(parsePgnDatabase(file.name, text));
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
        const folder = await readHostedPgnFolder(library, path);
        const latestHostedUpdate = Math.max(...folder.files.map((file) => file.lastModified), 0);
        const existingDatabase = state.databases.find(
          (database) =>
            database.hostedPath === folder.path &&
            (database.hostedUpdatedAt ?? 0) >= latestHostedUpdate,
        );
        if (existingDatabase) {
          notifications.show({
            title: "Hosted database already loaded",
            message: `${existingDatabase.name} is ready to use.`,
            color: "blue",
          });
          return {
            database: existingDatabase,
            games: state.gamesByDatabase[existingDatabase.id] ?? [],
            warnings: [],
          };
        }

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
        setImporting(false);
      }
      return null;
    },
    [importPgnText, state.databases, state.gamesByDatabase],
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
          throw new Error(`${getWebOnlineSourceLabel(source)} did not return public PGNs for ${username}.`);
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
                <IconChess size={24} />
                <Box>
                  <Title order={3} lh={1.1}>
                    En Croissant Web
                  </Title>
                  <Text size="xs" c="dimmed" truncate>
                    Board, files, database, prep
                  </Text>
                </Box>
              </Group>
            </Box>
            <Group justify="flex-end" gap="xs" wrap="nowrap">
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
              importHostedPgn={importHostedPgn}
              importHostedFolder={importHostedFolder}
              importOnlineGames={importOnlineGames}
              loadGameOnBoard={loadGameOnBoard}
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
  importHostedPgn,
  importHostedFolder,
  importOnlineGames,
  loadGameOnBoard,
  lichessToken,
  setLichessToken,
}: {
  state: WebCompanionState;
  setState: Dispatch<SetStateAction<WebCompanionState>>;
  activePrep: WebPrepWorkspace | null;
  importHostedPgn: WebHostedPgnImportHandler;
  importHostedFolder: WebHostedFolderImportHandler;
  importOnlineGames: WebOnlineImportHandler;
  loadGameOnBoard: (game: WebGame) => void;
  lichessToken: string;
  setLichessToken: (value: string) => void;
}) {
  const [panelMode, setPanelMode] = useState<BoardPanelMode>("moves");
  const board = state.board ?? createEmptyWebBoardState();
  const activeLine = activePrep?.line ?? board.line;
  const startFen = activePrep?.startFen ?? board.startFen;
  const cursor = clampCursor(board.cursor, activeLine.length);
  const currentFen = fenAtCursor(activeLine, cursor, startFen);
  const currentLine = activeLine.slice(0, cursor);
  const prepMinGames = activePrep?.minGames ?? DEFAULT_WEB_PREP_MIN_GAMES;
  const prepMoveLimit = activePrep?.moveLimit ?? DEFAULT_WEB_PREP_MOVE_LIMIT;
  const prepGames = useMemo(
    () => getGamesForWebPrepSource({ gamesByDatabase: state.gamesByDatabase, prep: activePrep }),
    [activePrep, state.gamesByDatabase],
  );
  const prepStats = useMemo(
    () =>
      getWebPrepMoveStats({ games: prepGames, prep: activePrep, fen: currentFen })
        .filter((stat) => stat.total >= prepMinGames)
        .slice(0, prepMoveLimit),
    [activePrep, currentFen, prepGames, prepMinGames, prepMoveLimit],
  );
  const turnColor = getFenColor(currentFen);
  const boardTitle =
    activePrep?.name ?? board.sourceTitle ?? (state.databases.length > 0 ? "Analysis board" : "Board");

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

  const updateActivePrep = (updater: (prep: WebPrepWorkspace) => WebPrepWorkspace) => {
    if (!activePrep) return;
    setState((current) => ({
      ...current,
      prepWorkspaces: current.prepWorkspaces.map((prep) =>
        prep.id === activePrep.id ? updater(prep) : prep,
      ),
    }));
  };

  const appendMove = (san: string, uci: string | null, fenAfter: string) => {
    const fenBefore = currentFen;
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
      const nextLine = [...activeLine.slice(0, cursor), move];
      updateActivePrep((prep) => ({
        ...prep,
        line: nextLine,
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

    const nextLine = [...activeLine.slice(0, cursor), move];
    updateBoard({
      line: nextLine,
      cursor: nextLine.length,
      sourceTitle: board.sourceTitle ?? "Analysis board",
    });
  };

  const playMove = (stat: WebPrepMoveStat) => {
    const played = playSanMove(currentFen, stat.move);
    if (!played) return;
    appendMove(played.san, played.uci, played.fenAfter);
  };

  const handleBoardMove = (uci: string) => {
    const played = playUciMove(currentFen, uci);
    if (!played) return;
    appendMove(played.san, played.uci, played.fenAfter);
  };

  const activeLastMove = cursor > 0 ? activeLine[cursor - 1]?.uci ?? null : null;
  const orientation = activePrep?.userColor ?? board.orientation;

  return (
    <Box className={classes.phoneBoard}>
      <Box className={classes.boardHeader}>
        <Box miw={0}>
          <Text size="xs" c="dimmed">
            {activePrep ? "Prep board" : "Board"}
          </Text>
          <Title order={3} className={classes.truncateTitle}>
            {boardTitle}
          </Title>
        </Box>
        <Badge color={turnColor === "white" ? "gray" : "dark"} variant="light">
          {turnColor}
        </Badge>
      </Box>

      <WebChessboard
        fen={currentFen}
        orientation={orientation}
        lastMoveUci={activeLastMove}
        onMove={handleBoardMove}
      />

      <Box className={classes.underBoardPanel}>
        <Group className={classes.underBoardTop} justify="space-between" gap="xs" wrap="nowrap">
          <Box miw={0}>
            <Text size="sm" fw={700} truncate>
              {panelMode === "moves" ? "Moves" : panelMode === "database" ? "Database" : "Prep"}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {normalizeWebFen(currentFen)}
            </Text>
          </Box>
          <SegmentedControl
            aria-label="Under-board panel"
            size="xs"
            value={panelMode}
            onChange={(value) => setPanelMode(value as BoardPanelMode)}
            data={[
              { value: "moves", label: "Moves" },
              { value: "database", label: "Database" },
              { value: "prep", label: "Prep" },
            ]}
          />
        </Group>

        <Box className={classes.underBoardContent}>
          {panelMode === "moves" ? (
            <MovesUnderBoardPanel
              line={activeLine}
              cursor={cursor}
              setCursor={setCursor}
              sourceTitle={boardTitle}
            />
          ) : panelMode === "database" ? (
            <DatabaseUnderBoardPanel
              currentFen={currentFen}
              databases={state.databases}
              gamesByDatabase={state.gamesByDatabase}
              importHostedPgn={importHostedPgn}
              importHostedFolder={importHostedFolder}
              onPlayMove={playMove}
              onOpenSourceGame={loadGameOnBoard}
              lichessToken={lichessToken}
              setLichessToken={setLichessToken}
            />
          ) : (
            <PrepUnderBoardPanel
              state={state}
              setState={setState}
              activePrep={activePrep}
              currentFen={currentFen}
              stats={prepStats}
              currentLine={currentLine}
              onPlayMove={playMove}
              onOpenSourceGame={loadGameOnBoard}
              importHostedPgn={importHostedPgn}
              importHostedFolder={importHostedFolder}
              importOnlineGames={importOnlineGames}
              lichessToken={lichessToken}
              setLichessToken={setLichessToken}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}

function MovesUnderBoardPanel({
  line,
  cursor,
  setCursor,
  sourceTitle,
}: {
  line: WebPrepLineMove[];
  cursor: number;
  setCursor: (cursor: number) => void;
  sourceTitle: string;
}) {
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
      <Box className={classes.moveList}>
        {line.length === 0 ? (
          <Text size="sm" c="dimmed">
            Start
          </Text>
        ) : (
          line.map((move, index) => {
            const moveNumber = Math.floor(index / 2) + 1;
            const isWhiteMove = index % 2 === 0;
            return (
              <button
                key={`${index}-${move.san}-${move.fenAfter}`}
                className={classes.movePill}
                data-current={cursor === index + 1}
                type="button"
                onClick={() => setCursor(index + 1)}
              >
                {isWhiteMove ? `${moveNumber}. ` : ""}
                {move.san}
              </button>
            );
          })
        )}
      </Box>
    </Stack>
  );
}

type WebDatabasePanelSource = "local" | WebDatabaseExplorerSource;

function DatabaseUnderBoardPanel({
  currentFen,
  databases,
  gamesByDatabase,
  importHostedPgn,
  importHostedFolder,
  onPlayMove,
  onOpenSourceGame,
  lichessToken,
  setLichessToken,
}: {
  currentFen: string;
  databases: WebDatabase[];
  gamesByDatabase: Record<string, WebGame[]>;
  importHostedPgn: WebHostedPgnImportHandler;
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
  const [selectedLocalIdValue, setSelectedLocalIdValue] = usePersistentString(
    WEB_DATABASE_PANEL_LOCAL_STORAGE_KEY,
    "",
  );
  const selectedLocalId = selectedLocalIdValue || null;
  const [hostedOpen, setHostedOpen] = useState(false);
  const [loadingLocalSource, setLoadingLocalSource] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [onlineStats, setOnlineStats] = useState<WebPrepMoveStat[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const hostedDatabases = useHostedDatabaseFolders();
  const sourceOptions = useMemo(
    () =>
      getWebDatabaseSelectData({
        databases,
        hostedFolders: hostedDatabases.folders,
      }),
    [databases, hostedDatabases.folders],
  );
  const hasLocalChoices = databases.length > 0 || hostedDatabases.folders.length > 0;
  const selectedLocalDatabase = useMemo(
    () => databases.find((database) => database.id === selectedLocalId) ?? null,
    [databases, selectedLocalId],
  );
  const localGames = useMemo(
    () =>
      selectedLocalId ? collectGamesForSources(gamesByDatabase, [selectedLocalId]) : [],
    [gamesByDatabase, selectedLocalId],
  );
  const localStats = useMemo(
    () => getWebPrepMoveStats({ games: localGames, prep: null, fen: currentFen }),
    [currentFen, localGames],
  );

  useEffect(() => {
    setSelectedLocalIdValue((current) => {
      if (current && databases.some((database) => database.id === current)) return current;
      return databases[0]?.id ?? "";
    });
  }, [databases, setSelectedLocalIdValue]);

  const setSource = (nextSource: WebDatabasePanelSource) => {
    setStoredSource(nextSource);
  };

  const setSelectedLocalId = (nextSourceId: string | null) => {
    setSelectedLocalIdValue(nextSourceId ?? "");
  };

  const chooseLocalDatabase = async (value: string | null) => {
    if (!value) {
      setSelectedLocalId(null);
      return;
    }

    if (!isHostedDatabaseValue(value)) {
      setSelectedLocalId(value);
      return;
    }

    const folderPath = hostedDatabasePathFromValue(value);
    const folder = hostedDatabases.folders.find((candidate) => candidate.path === folderPath);
    if (!folder || !hostedDatabases.library) return;
    setLoadingLocalSource(folder.label);
    try {
      const imported = await importHostedFolder(hostedDatabases.library, folder.path, {
        openFirstGame: false,
      });
      if (imported) setSelectedLocalId(imported.database.id);
    } finally {
      setLoadingLocalSource(null);
    }
  };

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
      signal: controller.signal,
    })
      .then((stats) => {
        if (!active) return;
        setOnlineStats(stats);
      })
      .catch((error) => {
        if (!active) return;
        setOnlineStats([]);
        setOnlineError(error instanceof Error ? error.message : "Could not query Lichess explorer.");
      })
      .finally(() => {
        if (active) setOnlineLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [currentFen, lichessToken, refreshKey, source]);

  const importHostedPgnForDatabase = async (entry: WebHostedFileEntry) => {
    const imported = await importHostedPgn(entry);
    if (imported) setSelectedLocalId(imported.database.id);
    return imported;
  };

  const importHostedFolderForDatabase = async (library: WebHostedLibrary, path: string) => {
    const label = getHostedDatabaseGroupLabel(path) || path;
    setLoadingLocalSource(label);
    try {
      const imported = await importHostedFolder(library, path, { openFirstGame: false });
      if (imported) setSelectedLocalId(imported.database.id);
      return imported;
    } finally {
      setLoadingLocalSource(null);
    }
  };

  const stats = source === "local" ? localStats : onlineStats;
  const sourceLabel =
    source === "local" ? selectedLocalDatabase?.name ?? "Local database" : getExplorerSourceLabel(source);

  return (
    <Stack gap="xs">
      <Group gap="xs" align="flex-end" wrap="wrap">
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
              label="Local database"
              size="xs"
              value={selectedLocalId}
              onChange={(value) => void chooseLocalDatabase(value)}
              data={sourceOptions}
              placeholder={hasLocalChoices ? "Choose database" : "No local databases"}
              allowDeselect={false}
              loading={Boolean(loadingLocalSource)}
              loadingLabel={loadingLocalSource ? `Loading ${loadingLocalSource}` : undefined}
              flex="1 1 13rem"
              minWidth="13rem"
            />
            <Button
              size="xs"
              variant={hostedOpen ? "light" : "default"}
              leftSection={<IconFolder size={14} />}
              onClick={() => setHostedOpen((open) => !open)}
            >
              Browse
            </Button>
          </>
        ) : (
          <>
            <TextInput
              label="Lichess token"
              size="xs"
              type="password"
              value={lichessToken}
              onChange={(event) => setLichessToken(event.currentTarget.value)}
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

      {source === "local" && loadingLocalSource ? (
        <Group gap="xs" wrap="nowrap">
          <Loader size="xs" />
          <Text size="xs" c="dimmed" truncate>
            Loading {loadingLocalSource} from synced files
          </Text>
        </Group>
      ) : null}

      {source === "local" && (
        <Collapse in={hostedOpen}>
          <HostedFilesPanel
            importHostedPgn={importHostedPgnForDatabase}
            importHostedFolder={importHostedFolderForDatabase}
            preferFolderImport
            embedded
          />
        </Collapse>
      )}

      {source === "local" && loadingLocalSource ? (
        <Center h={150}>
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="xs" c="dimmed">
              Importing hosted database
            </Text>
          </Stack>
        </Center>
      ) : source !== "local" && !lichessToken.trim() ? (
        <UnderBoardEmpty
          icon={<IconDatabase size={30} />}
          title={`${sourceLabel} locked`}
          text="Sign in to Lichess or paste a token to query this source from the phone."
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
      ) : source === "local" && !hasLocalChoices ? (
        <UnderBoardEmpty
          icon={<IconDatabase size={30} />}
          title="No local databases"
          text={hostedDatabases.loading ? "Loading hosted database list." : "Import PGNs or wait for the phone-site sync."}
        />
      ) : source === "local" && !selectedLocalId ? (
        <UnderBoardEmpty
          icon={<IconDatabase size={30} />}
          title="Choose a database"
          text="Use Local database to pick one synced fork database."
        />
      ) : stats.length === 0 ? (
        <UnderBoardEmpty
          icon={<IconDatabase size={30} />}
          title="No database games"
          text={`No ${sourceLabel} moves reach this board position.`}
        />
      ) : (
        <CompactMoveTable
          stats={stats}
          showState={false}
          emptyLabel="No database moves"
          onPlayMove={onPlayMove}
          onOpenSourceGame={source === "local" ? onOpenSourceGame : undefined}
        />
      )}
    </Stack>
  );
}

function PrepUnderBoardPanel({
  state,
  setState,
  activePrep,
  currentFen,
  stats,
  currentLine,
  onPlayMove,
  onOpenSourceGame,
  importHostedPgn,
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
  currentLine: WebPrepLineMove[];
  onPlayMove: (stat: WebPrepMoveStat) => void;
  onOpenSourceGame: (game: WebGame) => void;
  importHostedPgn: WebHostedPgnImportHandler;
  importHostedFolder: WebHostedFolderImportHandler;
  importOnlineGames: WebOnlineImportHandler;
  lichessToken: string;
  setLichessToken: (value: string) => void;
}) {
  const [opponent, setOpponent] = useState("");
  const [userColor, setUserColor] = useState<WebColor>("white");
  const [prepMode, setPrepMode] = useState<WebPrepMode>("player");
  const [prepSource, setPrepSource] = useState<WebPrepSource>("local");
  const [setupOpen, setSetupOpen] = useState(true);
  const [sourceId, setSourceId] = useState<string | null>(() => state.databases[0]?.id ?? null);
  const [minGames, setMinGames] = useState(DEFAULT_WEB_PREP_MIN_GAMES);
  const [moveLimit, setMoveLimit] = useState(DEFAULT_WEB_PREP_MOVE_LIMIT);
  const [draftTemporarySource, setDraftTemporarySource] =
    useState<WebPrepTemporarySource | null>(null);
  const [sourcesOpen] = useState(true);
  const [hostedOpen, setHostedOpen] = useState(false);
  const [loadingPrepSource, setLoadingPrepSource] = useState<string | null>(null);
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
  const [prepSort, setPrepSort] = useState<WebPrepSortState>(DEFAULT_WEB_PREP_SORT);
  const [prepCandidateSort, setPrepCandidateSort] = useState<WebPrepSortState>(
    DEFAULT_WEB_PREP_CANDIDATE_SORT,
  );
  const lastActivePrepIdRef = useRef<string | null>(null);
  const hostedDatabases = useHostedDatabaseFolders();
  const players = useMemo(() => getKnownPlayers(state.gamesByDatabase), [state.gamesByDatabase]);
  const sourceOptions = useMemo(
    () =>
      getWebDatabaseSelectData({
        databases: state.databases,
        hostedFolders: hostedDatabases.folders,
        includeOnline: true,
        temporarySource: activePrep?.temporarySource ?? draftTemporarySource,
      }),
    [activePrep?.temporarySource, draftTemporarySource, hostedDatabases.folders, state.databases],
  );
  const selectedPrepMode = activePrep?.mode ?? prepMode;
  const selectedPrepSource = activePrep?.source ?? prepSource;
  const selectedTemporarySource = activePrep?.temporarySource ?? draftTemporarySource;
  const selectedPrepSourceId =
    selectedPrepSource === "local"
      ? activePrep
        ? activePrep.sourceIds[0] ?? state.databases[0]?.id ?? null
        : sourceId
      : null;
  const selectedPrepSourceValue =
    selectedPrepSource === "lichess-all"
      ? WEB_LICHESS_ALL_SOURCE_VALUE
      : selectedPrepSource === "lichess-masters"
        ? WEB_LICHESS_MASTERS_SOURCE_VALUE
        : selectedPrepSource === "temporary"
          ? WEB_TEMPORARY_PREP_SOURCE_VALUE
          : selectedPrepSourceId;
  const activePrepSourceId = selectedPrepSourceId ?? state.databases[0]?.id ?? null;
  const activePrepSourceDatabase =
    state.databases.find((database) => database.id === activePrepSourceId) ?? null;
  const selectedMinGames = activePrep?.minGames ?? minGames;
  const selectedMoveLimit = activePrep?.moveLimit ?? moveLimit;
  const selectedPlayerColor = oppositeWebColor(activePrep?.userColor ?? userColor);
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
            : sourceOptions
                .flatMap((group) => group.items)
                .find((item) => item.value === selectedPrepSourceValue)?.label ?? null;
  const displayedStats =
    activePrep && isOnlinePrepSource(selectedPrepSource)
      ? onlinePrepStats
          .filter((stat) => stat.total >= selectedMinGames)
          .slice(0, selectedMoveLimit)
      : stats;
  const openPrepStats = activePrep
    ? displayedStats.filter((stat) => !activePrep.skippedMoves?.[stat.key])
    : displayedStats;
  const commonOpenStat = activePrep
    ? getFirstOpenPrepStat(openPrepStats, activePrep.preparedMoves)
    : null;
  const showSetupStage = !activePrep || setupOpen;
  const showTrainingStage = Boolean(activePrep) && !setupOpen;
  const opponentToMove = activePrep
    ? getFenColor(currentFen) === oppositeWebColor(activePrep.userColor)
    : false;
  const startedMoveKeys = useMemo(
    () => new Set((activePrep?.line ?? []).map((move) => getWebPrepMoveKey(move.fenBefore, move.san))),
    [activePrep?.line],
  );
  const preparedCount = displayedStats.filter(
    (stat) =>
      getWebPrepBranchStatus(stat, activePrep?.preparedMoves, activePrep?.skippedMoves, startedMoveKeys) ===
      "prepared",
  ).length;
  const startedCount = displayedStats.filter(
    (stat) =>
      getWebPrepBranchStatus(stat, activePrep?.preparedMoves, activePrep?.skippedMoves, startedMoveKeys) ===
      "started",
  ).length;
  const skippedCount = displayedStats.filter(
    (stat) =>
      getWebPrepBranchStatus(stat, activePrep?.preparedMoves, activePrep?.skippedMoves, startedMoveKeys) ===
      "skipped",
  ).length;
  const shownGamesCount = displayedStats.reduce((sum, stat) => sum + stat.total, 0);

  useEffect(() => {
    setSourceId((current) => {
      if (current && state.databases.some((database) => database.id === current)) return current;
      return state.databases[0]?.id ?? null;
    });
  }, [state.databases]);

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
    if (onlineUsername || !activePrep?.opponent) return;
    setOnlineUsername(activePrep.opponent);
  }, [activePrep?.opponent, onlineUsername]);

  useEffect(() => {
    if (onlineMode !== "range") return;
    setOnlinePreviewText(`Imports every public PGN in ${getWebOnlineRangeLabel(onlineRange).toLowerCase()}.`);
  }, [onlineMode, onlineRange]);

  useEffect(() => {
    if (!activePrep || !isOnlinePrepSource(selectedPrepSource)) {
      setOnlinePrepStats([]);
      setOnlinePrepError(null);
      setOnlinePrepLoading(false);
      return;
    }

    if (!lichessToken.trim()) {
      setOnlinePrepStats([]);
      setOnlinePrepError("Sign in to Lichess or paste a token to use this prep source.");
      setOnlinePrepLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setOnlinePrepLoading(true);
    setOnlinePrepError(null);

    void fetchWebExplorerMoveStats({
      source: selectedPrepSource,
      fen: currentFen,
      token: lichessToken,
      signal: controller.signal,
    })
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

    return () => {
      active = false;
      controller.abort();
    };
  }, [activePrep, currentFen, lichessToken, selectedPrepSource]);

  const createPrep = () => {
    const now = Date.now();
    const trimmedOpponent = opponent.trim();
    const selectedSourceId = prepSource === "local" ? sourceId ?? state.databases[0]?.id ?? null : null;
    const selectedTemporarySource = prepSource === "temporary" ? draftTemporarySource : null;
    const prep: WebPrepWorkspace = {
      id: `prep-${now.toString(36)}`,
      name: `${trimmedOpponent || "General"} prep`,
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
      minGames,
      moveLimit,
      startFen: INITIAL_FEN,
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
    if (!commonOpenStat) {
      notifications.show({
        title: "No common move",
        message: "This prep source has no move for the current board position.",
        color: "yellow",
      });
      return;
    }
    onPlayMove(commonOpenStat);
  };

  const doneAndNext = () => {
    if (!activePrep || !commonOpenStat) {
      notifications.show({
        title: "No open move",
        message: "There is no open prep move at this board position.",
        color: "yellow",
      });
      return;
    }

    const nextPreparedMoves = {
      ...activePrep.preparedMoves,
      [commonOpenStat.key]: activePrep.preparedMoves[commonOpenStat.key] || Date.now(),
    };
    if (!activePrep.preparedMoves[commonOpenStat.key]) {
      updateActivePrepSettings({
        preparedMoves: nextPreparedMoves,
        skippedMoves: omitRecordKey(activePrep.skippedMoves ?? {}, commonOpenStat.key),
      });
    }

    const nextStat = getNextOpenPrepStat(openPrepStats, nextPreparedMoves, commonOpenStat.key);
    if (!nextStat) {
      notifications.show({
        title: "Prep line covered",
        message: "No unprepared move is left in Show top.",
        color: "green",
      });
      return;
    }

    window.setTimeout(() => onPlayMove(nextStat), 0);
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

  const updatePrepMode = (mode: WebPrepMode) => {
    if (activePrep) {
      updateActivePrepSettings({ mode });
    } else {
      setPrepMode(mode);
    }
  };

  const updatePrepMinGames = (value: number) => {
    const next = Math.max(1, Math.min(999, Math.round(value || DEFAULT_WEB_PREP_MIN_GAMES)));
    if (activePrep) updateActivePrepSettings({ minGames: next });
    else setMinGames(next);
  };

  const updatePrepMoveLimit = (value: number) => {
    const next = Math.max(1, Math.min(20, Math.round(value || DEFAULT_WEB_PREP_MOVE_LIMIT)));
    if (activePrep) updateActivePrepSettings({ moveLimit: next });
    else setMoveLimit(next);
  };

  const updatePrepOpponent = (value: string) => {
    if (activePrep) updateActivePrepSettings({ opponent: value });
    else setOpponent(value);
  };

  const updatePrepUserColor = (value: WebColor) => {
    if (activePrep) updateActivePrepSettings({ userColor: value });
    else setUserColor(value);
  };

  const updateActivePrepSource = (nextSource: WebPrepSource, nextSourceId: string | null) => {
    updateActivePrepSettings({
      source: nextSource,
      sourceIds:
        nextSource === "local" && nextSourceId
          ? [nextSourceId]
          : nextSource === "temporary" && activePrep?.temporarySource
            ? [activePrep.temporarySource.id]
            : [],
    });
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
      if (activePrep) updateActivePrepSource(nextSource, null);
      else setPrepSource(nextSource);
      return;
    }

    if (value === WEB_TEMPORARY_PREP_SOURCE_VALUE) {
      if (activePrep?.temporarySource) updateActivePrepSource("temporary", activePrep.temporarySource.id);
      else if (draftTemporarySource) {
        setPrepSource("temporary");
        setSourceId(null);
      }
      return;
    }

    if (!isHostedDatabaseValue(value)) {
      if (activePrep) updateActivePrepSource("local", value);
      else {
        setPrepSource("local");
        setSourceId(value);
      }
      return;
    }

    const folderPath = hostedDatabasePathFromValue(value);
    const folder = hostedDatabases.folders.find((candidate) => candidate.path === folderPath);
    if (!folder || !hostedDatabases.library) return;
    setLoadingPrepSource(folder.label);
    try {
      const imported = await importHostedFolder(hostedDatabases.library, folder.path, {
        openFirstGame: false,
      });
      if (imported) attachImportedDatabase(imported.database.id);
    } finally {
      setLoadingPrepSource(null);
    }
  };

  const attachImportedDatabase = (databaseId: string) => {
    setDraftTemporarySource(null);
    if (activePrep) {
      updateActivePrepSource("local", databaseId);
      return;
    }

    setPrepSource("local");
    setSourceId(databaseId);
  };

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
      updateActivePrepSettings({
        source: "temporary",
        sourceIds: [temporarySource.id],
        temporarySource,
      });
      return;
    }

    setDraftTemporarySource(temporarySource);
    setPrepSource("temporary");
    setSourceId(null);
  };

  const importHostedPgnForPrep = async (entry: WebHostedFileEntry) => {
    const imported = await importHostedPgn(entry);
    if (imported) attachImportedDatabase(imported.database.id);
    return imported;
  };

  const importHostedFolderForPrep = async (library: WebHostedLibrary, path: string) => {
    const label = getHostedDatabaseGroupLabel(path) || path;
    setLoadingPrepSource(label);
    try {
      const imported = await importHostedFolder(library, path, { openFirstGame: false });
      if (imported) attachImportedDatabase(imported.database.id);
      return imported;
    } finally {
      setLoadingPrepSource(null);
    }
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
      const oldestLabel = Number.isFinite(oldest) ? formatWebDate(new Date(oldest).toISOString()) : "";
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
      if (onlineSaveDatabase) attachImportedDatabase(imported.database.id);
      else attachTemporaryPrepSource(imported);
    });
  };

  return (
    <Stack gap="sm">
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
        {showSetupStage && (
          <Button
            size="xs"
            leftSection={<IconPlayerPlay size={14} />}
            onClick={() => {
              if (activePrep) setSetupOpen(false);
              else createPrep();
            }}
          >
            Start prep
          </Button>
        )}
      </Group>

      {showSetupStage ? (
        <>
          <Group align="flex-end" gap="xs" wrap="wrap">
            {state.prepWorkspaces.length > 0 && (
              <Select
                label="Prep"
                size="xs"
                value={state.activePrepId}
                onChange={(value) => {
                  const nextPrep = state.prepWorkspaces.find((prep) => prep.id === value);
                  setSetupOpen(!nextPrep);
                  setState((current) => ({
                    ...current,
                    activePrepId: value,
                    board: {
                      ...current.board,
                      cursor: nextPrep?.line.length ?? current.board.cursor,
                      sourceTitle: nextPrep ? prepBoardTitle(nextPrep) : current.board.sourceTitle,
                      sourceDatabaseId: null,
                      sourceGameId: null,
                    },
                  }));
                }}
                data={state.prepWorkspaces.map((prep) => ({ value: prep.id, label: prep.name }))}
                style={{ flex: "1 1 12rem" }}
                clearable
              />
            )}
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
              Import games
            </Button>
            <Button
              size="compact-xs"
              variant={hostedOpen ? "light" : "default"}
              leftSection={<IconFolder size={14} />}
              onClick={() => setHostedOpen((open) => !open)}
            >
              Hosted files
            </Button>
          </Group>

          <Collapse in={sourcesOpen}>
            <Stack gap="xs" className={classes.prepToolBox}>
              {loadingPrepSource ? (
                <Group gap="xs" wrap="nowrap">
                  <Loader size="xs" />
                  <Text size="xs" c="dimmed" truncate>
                    Loading {loadingPrepSource} from synced files
                  </Text>
                </Group>
              ) : null}
              <Group gap="xs" wrap="wrap" align="flex-end">
                {selectedPrepMode === "player" ? (
                  <>
                    <TextInput
                      label="Player"
                      size="xs"
                      placeholder="Player"
                      value={activePrep?.opponent ?? opponent}
                      onChange={(event) => updatePrepOpponent(event.currentTarget.value)}
                      list="web-known-players"
                      style={{ flex: "1 1 10rem" }}
                    />
                    <datalist id="web-known-players">
                      {players.map((player) => (
                        <option key={player} value={player} />
                      ))}
                    </datalist>
                    <SegmentedControl
                      aria-label="Player colour"
                      size="xs"
                      value={selectedPlayerColor}
                      onChange={(value) => updatePrepUserColor(oppositeWebColor(value as WebColor))}
                      data={[
                        {
                          value: "white",
                          label: `${(activePrep?.opponent ?? opponent).trim() || "Player"} as white`,
                        },
                        {
                          value: "black",
                          label: `${(activePrep?.opponent ?? opponent).trim() || "Player"} as black`,
                        },
                      ]}
                    />
                  </>
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
                  <TextInput
                    label="Lichess token"
                    size="xs"
                    type="password"
                    value={lichessToken}
                    onChange={(event) => setLichessToken(event.currentTarget.value)}
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
                  Choose a prep source or import hosted/public games.
                </Text>
              )}
            </Stack>
          </Collapse>

          <Collapse in={hostedOpen}>
            <HostedFilesPanel
              importHostedPgn={importHostedPgnForPrep}
              importHostedFolder={importHostedFolderForPrep}
              preferFolderImport
              embedded
            />
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
                      ? `Imports public PGNs from ${getWebOnlineSourceLabel(onlineSource)} into the phone database list.`
                      : `Imports public PGNs from ${getWebOnlineSourceLabel(onlineSource)} and uses them for this prep.`}
                  </Text>
                )}
              </Group>
            </Stack>
          </Collapse>
        </>
      ) : null}

      {showSetupStage && !activePrep ? (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Choose a source and target, then start prep from this board.
          </Text>
        </Stack>
      ) : showTrainingStage && activePrep ? (
        <>
          <Group justify="space-between" gap="xs" wrap="wrap">
            <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
              <Text size="xs" c="dimmed" truncate>
                Start: game start
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {opponentToMove
                  ? `${activePrep.opponent || "Opponent"} to move`
                  : "Your move"}
                {currentLine.length > 0 ? ` - ${currentLine.slice(-10).map((move) => move.san).join(" ")}` : ""}
              </Text>
            </Stack>
            <Group gap={4} wrap="nowrap">
              <Tooltip label="Play the first open common move from the prep start">
                <Button
                  size="xs"
                  leftSection={<IconPlayerPlay size={14} />}
                  disabled={!commonOpenStat}
                  onClick={playCommonMove}
                >
                  Common move
                </Button>
              </Tooltip>
              <Tooltip label="Mark this line done and play the next common move">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconChevronRight size={14} />}
                  disabled={!commonOpenStat}
                  onClick={doneAndNext}
                >
                  Done + next
                </Button>
              </Tooltip>
              <Tooltip label="Change prep source and target">
                <ActionIcon aria-label="Change prep setup" variant="default" onClick={() => setSetupOpen(true)}>
                  <IconSettings size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
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
          <Group gap="xs" wrap="wrap">
            {opponentToMove ? (
              <>
                <Badge variant="light">{preparedCount} prepared</Badge>
                {startedCount > 0 ? <Badge variant="light">{startedCount} started</Badge> : null}
                {skippedCount > 0 ? (
                  <Badge color="gray" variant="light">
                    {skippedCount} skipped
                  </Badge>
                ) : null}
              </>
            ) : (
              <Badge color="blue" variant="light">
                {activePrep.userColor === "white" ? "White" : "Black"} candidates
              </Badge>
            )}
            <Text size="xs" c="dimmed">
              {formatCount(shownGamesCount)} games in shown moves
            </Text>
            {commonOpenStat ? (
              <Badge variant="light" size="sm">
                {commonOpenStat.move} - {commonOpenStat.total} games
              </Badge>
            ) : null}
          </Group>
          <Textarea
            label="Position notes"
            size="xs"
            autosize
            minRows={2}
            value={activePrep.notesByFen[normalizeWebFen(currentFen)] ?? ""}
            onChange={(event) => updateNote(event.currentTarget.value)}
          />
          <CompactMoveTable
            stats={displayedStats}
            preparedMoves={activePrep.preparedMoves}
            skippedMoves={activePrep.skippedMoves ?? {}}
            startedMoveKeys={startedMoveKeys}
            showState={opponentToMove}
            emptyLabel="No prep moves"
            onPlayMove={onPlayMove}
            onOpenSourceGame={isOnlinePrepSource(selectedPrepSource) ? undefined : onOpenSourceGame}
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
        </>
      ) : null}
    </Stack>
  );
}

function CompactMoveTable({
  stats,
  showState,
  preparedMoves,
  skippedMoves,
  startedMoveKeys,
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
  emptyLabel: string;
  onPlayMove: (stat: WebPrepMoveStat) => void;
  onOpenSourceGame?: (game: WebGame) => void;
  onMarkDone?: (stat: WebPrepMoveStat) => void;
  onSkipMove?: (stat: WebPrepMoveStat) => void;
  sort?: WebPrepSortState;
  onSort?: (column: WebPrepSortColumn) => void;
}) {
  const isPrepTable = Boolean(onMarkDone || onSkipMove || startedMoveKeys);
  const isPrepCandidateTable = isPrepTable && !showState;
  const effectiveSort =
    isPrepCandidateTable && sort && (sort.column === "prep" || sort.column === "state")
      ? DEFAULT_WEB_PREP_CANDIDATE_SORT
      : sort;
  const sortedStats =
    isPrepTable && effectiveSort
      ? sortWebPrepMoveStats(stats, effectiveSort, preparedMoves, skippedMoves, startedMoveKeys)
      : stats;

  if (stats.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {emptyLabel}
      </Text>
    );
  }

  return (
    <Table.ScrollContainer minWidth={showState ? 760 : isPrepCandidateTable ? 560 : 520}>
      <Table className={classes.compactTable} verticalSpacing={showState ? 3 : 4} highlightOnHover>
        <Table.Thead>
          {showState ? (
            <Table.Tr>
              <SortableWebPrepTh label="Move" column="move" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh label="Strength" column="strength" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh label="Games" column="games" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh label="Results" column="results" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh label="Prep" column="prep" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh label="State" column="state" sort={effectiveSort} onSort={onSort} />
              <Table.Th />
            </Table.Tr>
          ) : isPrepCandidateTable ? (
            <Table.Tr>
              <SortableWebPrepTh label="Move" column="move" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh label="Strength" column="strength" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh label="Games" column="games" sort={effectiveSort} onSort={onSort} />
              <SortableWebPrepTh label="WDL" column="results" sort={effectiveSort} onSort={onSort} />
              <Table.Th />
            </Table.Tr>
          ) : (
            <Table.Tr>
              <Table.Th>Move</Table.Th>
              <Table.Th>Games</Table.Th>
              <Table.Th>WDL</Table.Th>
              <Table.Th>Last</Table.Th>
              <Table.Th />
            </Table.Tr>
          )}
        </Table.Thead>
        <Table.Tbody>
          {sortedStats.map((stat) => {
            const status = getWebPrepBranchStatus(stat, preparedMoves, skippedMoves, startedMoveKeys);
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
                      <PrepCoverageCell status={status} />
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
                      <Text size="sm">{formatCount(stat.total)}</Text>
                      <Text size="xs" c="dimmed">
                        {formatPercent(stat.share)}
                      </Text>
                    </Table.Td>
                    <Table.Td>{formatPercent(stat.scoreForUser)}</Table.Td>
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

function PrepStrengthCell({ strength }: { strength: WebPrepMoveStat["strength"] }) {
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
          <Badge variant="light" size="sm">
            {strength.label}
          </Badge>
          <Text size="xs" fw={700}>
            {strength.score}%
          </Text>
        </Group>
        <Progress value={strength.score} size={3} />
      </Stack>
    </Tooltip>
  );
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

function PrepCoverageCell({ status }: { status: WebPrepBranchStatus }) {
  const value = status === "prepared" ? 100 : status === "started" ? 45 : 0;
  const label = status === "prepared" ? "Done" : status === "started" ? "Started" : "-";

  return (
    <Stack gap={2} style={{ minWidth: 0 }}>
      <Group gap={4} wrap="nowrap">
        <Badge color={status === "prepared" ? "green" : status === "started" ? "blue" : "gray"} variant="light" size="sm">
          {label}
        </Badge>
        {value > 0 ? (
          <Text size="xs" fw={700}>
            {value}%
          </Text>
        ) : null}
      </Group>
      <Progress value={value} color={status === "prepared" ? "green" : "blue"} size={3} />
    </Stack>
  );
}

function getNextWebPrepSort(current: WebPrepSortState, column: WebPrepSortColumn): WebPrepSortState {
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

function sortWebPrepMoveStats(
  stats: WebPrepMoveStat[],
  sort: WebPrepSortState,
  preparedMoves: Record<string, number> | undefined,
  skippedMoves: Record<string, number> | undefined,
  startedMoveKeys: Set<string> | undefined,
) {
  return [...stats].sort((a, b) => {
    const diff = compareWebPrepMoveStats(a, b, sort.column, preparedMoves, skippedMoves, startedMoveKeys);
    const directed = sort.direction === "asc" ? diff : -diff;
    return directed || b.total - a.total || a.move.localeCompare(b.move, undefined, { sensitivity: "base" });
  });
}

function compareWebPrepMoveStats(
  a: WebPrepMoveStat,
  b: WebPrepMoveStat,
  column: WebPrepSortColumn,
  preparedMoves: Record<string, number> | undefined,
  skippedMoves: Record<string, number> | undefined,
  startedMoveKeys: Set<string> | undefined,
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
      getWebPrepCoverageSortScore(a, preparedMoves, skippedMoves, startedMoveKeys) -
      getWebPrepCoverageSortScore(b, preparedMoves, skippedMoves, startedMoveKeys)
    );
  }
  if (column === "state") {
    return (
      getWebPrepStatusSortScore(getWebPrepBranchStatus(a, preparedMoves, skippedMoves, startedMoveKeys)) -
      getWebPrepStatusSortScore(getWebPrepBranchStatus(b, preparedMoves, skippedMoves, startedMoveKeys))
    );
  }

  return a.total - b.total;
}

function getWebPrepStrengthSortScore(stat: WebPrepMoveStat) {
  return stat.strength?.score ?? -1;
}

function getWebPrepCoverageSortScore(
  stat: WebPrepMoveStat,
  preparedMoves: Record<string, number> | undefined,
  skippedMoves: Record<string, number> | undefined,
  startedMoveKeys: Set<string> | undefined,
) {
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

function getWebPrepMoveKey(fen: string, move: string) {
  return `${normalizeWebFen(fen)}:${move}`;
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
  const activeGames = selectedDatabaseId ? gamesByDatabase[selectedDatabaseId] ?? [] : [];

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
          <Button component="label" size="xs" leftSection={<IconUpload size={14} />} loading={importing}>
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
                      downloadText(`${selectedGame.white}-${selectedGame.black}.pgn`, selectedGame.pgn)
                    }
                  >
                    PGN
                  </Button>
                )}
              </Group>
              <ScrollArea.Autosize mah={280}>
                <Box className={classes.itemList}>
                  {activeGames.map((game) => (
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
                        {formatWebDate(game.date) || "undated"} - {game.result} - {game.moves.length} plies
                      </Text>
                    </button>
                  ))}
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

  const load = useCallback(async (nextPath = path) => {
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
        message: error instanceof Error ? error.message : "The published file library did not respond.",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }, [path]);

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
              onClick={() => void importHostedFolder(library, path, { openFirstGame: !preferFolderImport })}
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
                    if (preferFolderImport && importHostedFolder && entry.directPgnFileCount > 0 && library) {
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
  onMove,
}: {
  fen: string;
  orientation: WebColor;
  lastMoveUci: string | null;
  onMove: (uci: string) => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

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
      animation: {
        enabled: true,
      },
    };
  }, [fen, lastMoveUci, orientation]);

  useEffect(() => {
    if (!boardRef.current || apiRef.current) return;
    apiRef.current = Chessground(boardRef.current, config);

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, [config]);

  useEffect(() => {
    apiRef.current?.set(config);
  }, [config]);

  return <Box ref={boardRef} className={classes.boardMount} />;
}

function UnderBoardEmpty({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
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
  return prep.opponent ? `${prep.opponent} prep` : prep.name;
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

  for (const database of databases) {
    const folderPath = database.hostedPath ? getHostedDatabaseFolderPath(database.hostedPath) : "";
    addItem(folderPath ? getHostedDatabaseGroupLabel(folderPath) : "Unfiled", {
      value: database.id,
      label: formatDatabasePickerLabel(database.name),
      detail: `Loaded - ${formatCount(database.gameCount)} game${database.gameCount === 1 ? "" : "s"}${
        database.sizeBytes ? ` - ${formatBytes(database.sizeBytes)}` : ""
      }`,
      searchText: [
        database.name,
        database.hostedPath,
        database.playerNames.slice(0, 12).join(" "),
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
      detail: `Not loaded - ${formatCount(folder.fileCount)} PGN${
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

function normalizeHostedDatabasePathParts(path: string) {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^Databases\//, "")
    .split("/")
    .filter(Boolean);
}

function formatDatabasePickerLabel(name: string) {
  return name.replace(/\.pgn$/i, "");
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
  return `hosted-db:${path}`;
}

function isHostedDatabaseValue(value: string) {
  return value.startsWith("hosted-db:");
}

function hostedDatabasePathFromValue(value: string) {
  return value.replace(/^hosted-db:/, "");
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
