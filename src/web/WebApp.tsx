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
  MultiSelect,
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
  Title,
} from "@mantine/core";
import { notifications, Notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconChess,
  IconCloudDownload,
  IconDatabase,
  IconDownload,
  IconFileText,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
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
import classes from "./WebApp.module.css";
import {
  getHostedRawFileUrl,
  getHostedWebLibrary,
  listHostedLibraryPath,
  readHostedPgnFile,
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
  collectGamesForSources,
  getKnownPlayers,
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
type WebOnlineImportHandler = (request: {
  source: WebOnlineSource;
  username: string;
  mode: WebOnlineImportMode;
  count: number;
  range: WebOnlineRangePreset;
  setProgress: (progress: number | null) => void;
}) => Promise<WebImportResult | null>;

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
    }: {
      name: string;
      pgn: string;
      notificationTitle: string;
      notificationMessage?: (result: WebImportResult) => string;
    }) => {
      const imported = parsePgnDatabase(name, pgn);
      addImportedDatabases([imported]);
      if (imported.games[0]) {
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

  const importOnlineGames = useCallback(
    async ({
      source,
      username,
      mode,
      count,
      range,
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
        const imported = await importPgnText({
          name: `${title}.pgn`,
          pgn: games.map((game) => game.pgn.trim()).join("\n\n"),
          notificationTitle: "Online games imported",
          notificationMessage: (imported) =>
            `${imported.games.length} ${getWebOnlineSourceLabel(source)} games indexed for ${username}.`,
        });
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
              importOnlineGames={importOnlineGames}
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
  importOnlineGames,
}: {
  state: WebCompanionState;
  setState: Dispatch<SetStateAction<WebCompanionState>>;
  activePrep: WebPrepWorkspace | null;
  importHostedPgn: WebHostedPgnImportHandler;
  importOnlineGames: WebOnlineImportHandler;
}) {
  const [panelMode, setPanelMode] = useState<BoardPanelMode>("moves");
  const board = state.board ?? createEmptyWebBoardState();
  const activeLine = activePrep?.line ?? board.line;
  const startFen = activePrep?.startFen ?? board.startFen;
  const cursor = clampCursor(board.cursor, activeLine.length);
  const currentFen = fenAtCursor(activeLine, cursor, startFen);
  const currentLine = activeLine.slice(0, cursor);
  const allGames = useMemo(
    () => Object.values(state.gamesByDatabase).flat(),
    [state.gamesByDatabase],
  );
  const prepGames = useMemo(
    () =>
      collectGamesForSources(
        state.gamesByDatabase,
        activePrep?.sourceIds.length ? activePrep.sourceIds : state.databases.map((db) => db.id),
      ),
    [activePrep?.sourceIds, state.databases, state.gamesByDatabase],
  );
  const databaseStats = useMemo(
    () => getWebPrepMoveStats({ games: allGames, prep: null, fen: currentFen }),
    [allGames, currentFen],
  );
  const prepStats = useMemo(
    () => getWebPrepMoveStats({ games: prepGames, prep: activePrep, fen: currentFen }),
    [activePrep, currentFen, prepGames],
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
            <DatabaseUnderBoardPanel stats={databaseStats} games={allGames} onPlayMove={playMove} />
          ) : (
            <PrepUnderBoardPanel
              state={state}
              setState={setState}
              activePrep={activePrep}
              currentFen={currentFen}
              stats={prepStats}
              currentLine={currentLine}
              onPlayMove={playMove}
              importHostedPgn={importHostedPgn}
              importOnlineGames={importOnlineGames}
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

function DatabaseUnderBoardPanel({
  stats,
  games,
  onPlayMove,
}: {
  stats: WebPrepMoveStat[];
  games: WebGame[];
  onPlayMove: (stat: WebPrepMoveStat) => void;
}) {
  if (games.length === 0) {
    return (
      <UnderBoardEmpty
        icon={<IconDatabase size={30} />}
        title="No databases"
        text="Open Files and import or load a PGN from the laptop."
      />
    );
  }

  if (stats.length === 0) {
    return (
      <UnderBoardEmpty
        icon={<IconDatabase size={30} />}
        title="No database games"
        text="No indexed game reaches this board position."
      />
    );
  }

  return (
    <CompactMoveTable
      stats={stats}
      showState={false}
      emptyLabel="No database moves"
      onPlayMove={onPlayMove}
    />
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
  importHostedPgn,
  importOnlineGames,
}: {
  state: WebCompanionState;
  setState: Dispatch<SetStateAction<WebCompanionState>>;
  activePrep: WebPrepWorkspace | null;
  currentFen: string;
  stats: WebPrepMoveStat[];
  currentLine: WebPrepLineMove[];
  onPlayMove: (stat: WebPrepMoveStat) => void;
  importHostedPgn: WebHostedPgnImportHandler;
  importOnlineGames: WebOnlineImportHandler;
}) {
  const [opponent, setOpponent] = useState("");
  const [userColor, setUserColor] = useState<WebColor>("white");
  const [sourceIds, setSourceIds] = useState<string[]>(() => state.databases.map((db) => db.id));
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [hostedOpen, setHostedOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineSource, setOnlineSource] = useState<WebOnlineSource>("chesscom");
  const [onlineUsername, setOnlineUsername] = useState("");
  const [onlineMode, setOnlineMode] = useState<WebOnlineImportMode>("count");
  const [onlineCount, setOnlineCount] = useState(50);
  const [onlineRange, setOnlineRange] = useState<WebOnlineRangePreset>("3m");
  const [onlineProgress, setOnlineProgress] = useState<number | null>(null);
  const players = useMemo(() => getKnownPlayers(state.gamesByDatabase), [state.gamesByDatabase]);
  const sourceOptions = state.databases.map((database) => ({
    value: database.id,
    label: `${database.name} (${database.gameCount})`,
  }));
  const activePrepSourceIds = activePrep?.sourceIds.length
    ? activePrep.sourceIds
    : state.databases.map((database) => database.id);
  const activePrepSourceDatabases = state.databases.filter((database) =>
    activePrepSourceIds.includes(database.id),
  );

  useEffect(() => {
    if (onlineUsername || !activePrep?.opponent) return;
    setOnlineUsername(activePrep.opponent);
  }, [activePrep?.opponent, onlineUsername]);

  const createPrep = () => {
    const now = Date.now();
    const trimmedOpponent = opponent.trim();
    const selectedSources = sourceIds.length > 0 ? sourceIds : state.databases.map((db) => db.id);
    const prep: WebPrepWorkspace = {
      id: `prep-${now.toString(36)}`,
      name: `${trimmedOpponent || "General"} prep`,
      opponent: trimmedOpponent,
      userColor,
      sourceIds: selectedSources,
      startFen: INITIAL_FEN,
      line: currentLine,
      notesByFen: {},
      preparedMoves: {},
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

  const markMovePrepared = (stat: WebPrepMoveStat) => {
    updateActivePrep((prep) => ({
      ...prep,
      preparedMoves: {
        ...prep.preparedMoves,
        [stat.key]: prep.preparedMoves[stat.key] ? 0 : Date.now(),
      },
      updatedAt: Date.now(),
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

  const updateActivePrepSources = (nextSourceIds: string[]) => {
    updateActivePrep((prep) => ({
      ...prep,
      sourceIds: nextSourceIds,
      updatedAt: Date.now(),
    }));
  };

  const attachImportedDatabase = (databaseId: string) => {
    if (activePrep) {
      updateActivePrep((prep) => {
        if (prep.sourceIds.length === 0 || prep.sourceIds.includes(databaseId)) return prep;
        return {
          ...prep,
          sourceIds: [...prep.sourceIds, databaseId],
          updatedAt: Date.now(),
        };
      });
      return;
    }

    setSourceIds((current) => (current.includes(databaseId) ? current : [...current, databaseId]));
  };

  const importHostedPgnForPrep = async (entry: WebHostedFileEntry) => {
    const imported = await importHostedPgn(entry);
    if (imported) attachImportedDatabase(imported.database.id);
    return imported;
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
      setProgress: setOnlineProgress,
    }).then((imported) => {
      if (imported) attachImportedDatabase(imported.database.id);
    });
  };

  return (
    <Stack gap="sm">
      <Group align="flex-end" gap="xs">
        {state.prepWorkspaces.length > 0 && (
          <Select
            label="Prep"
            size="xs"
            value={state.activePrepId}
            onChange={(value) => {
              const nextPrep = state.prepWorkspaces.find((prep) => prep.id === value);
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
        {!activePrep && (
          <>
            <TextInput
              label="Opponent"
              size="xs"
              placeholder="Player"
              value={opponent}
              onChange={(event) => setOpponent(event.currentTarget.value)}
              list="web-known-players"
              style={{ flex: "1 1 10rem" }}
            />
            <datalist id="web-known-players">
              {players.map((player) => (
                <option key={player} value={player} />
              ))}
            </datalist>
            <Select
              label="Side"
              size="xs"
              value={userColor}
              onChange={(value) => setUserColor((value as WebColor | null) ?? "white")}
              data={[
                { value: "white", label: "I'm white" },
                { value: "black", label: "I'm black" },
              ]}
              w={118}
            />
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={createPrep}>
              New
            </Button>
          </>
        )}
      </Group>

      <Group gap="xs" wrap="wrap">
        <Button
          size="compact-xs"
          variant={sourcesOpen ? "light" : "default"}
          leftSection={<IconDatabase size={14} />}
          onClick={() => setSourcesOpen((open) => !open)}
        >
          Databases
        </Button>
        <Button
          size="compact-xs"
          variant={hostedOpen ? "light" : "default"}
          leftSection={<IconFolder size={14} />}
          onClick={() => setHostedOpen((open) => !open)}
        >
          Hosted files
        </Button>
        <Button
          size="compact-xs"
          variant={onlineOpen ? "light" : "default"}
          leftSection={<IconCloudDownload size={14} />}
          onClick={() => setOnlineOpen((open) => !open)}
        >
          Import games
        </Button>
      </Group>

      <Collapse in={sourcesOpen}>
        <Stack gap="xs" className={classes.prepToolBox}>
          <MultiSelect
            label="Prep databases"
            size="xs"
            value={activePrep ? activePrep.sourceIds : sourceIds}
            onChange={activePrep ? updateActivePrepSources : setSourceIds}
            data={sourceOptions}
            placeholder={state.databases.length > 0 ? "All indexed databases" : "No databases yet"}
          />
          {activePrep ? (
            <Group gap={4} wrap="wrap">
              {(activePrepSourceDatabases.length > 0 ? activePrepSourceDatabases : state.databases)
                .slice(0, 6)
                .map((database) => (
                  <Badge key={database.id} size="xs" variant="light">
                    {database.name} - {database.gameCount}
                  </Badge>
                ))}
              {state.databases.length === 0 && (
                <Text size="xs" c="dimmed">
                  Import hosted PGNs or public online games to create prep databases.
                </Text>
              )}
            </Group>
          ) : (
            <Text size="xs" c="dimmed">
              These sources will be attached to the next prep workspace you create.
            </Text>
          )}
        </Stack>
      </Collapse>

      <Collapse in={hostedOpen}>
        <HostedFilesPanel importHostedPgn={importHostedPgnForPrep} embedded />
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
                onChange={(value) => setOnlineRange((value as WebOnlineRangePreset | null) ?? "3m")}
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
                Imports public PGNs from {getWebOnlineSourceLabel(onlineSource)} into the phone database list.
              </Text>
            )}
          </Group>
        </Stack>
      </Collapse>

      {!activePrep ? (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Create prep to track notes and prepared moves from this board position.
          </Text>
        </Stack>
      ) : (
        <>
          <Group justify="space-between" gap="xs">
            <Box miw={0}>
              <Text size="sm" fw={700} truncate>
                {activePrep.opponent || "General prep"}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {getFenColor(currentFen) === oppositeWebColor(activePrep.userColor)
                  ? `${activePrep.opponent || "Opponent"} to move`
                  : "Your move"}
              </Text>
            </Box>
            <Badge variant="light">{stats.reduce((sum, stat) => sum + stat.total, 0)} games</Badge>
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
            stats={stats}
            preparedMoves={activePrep.preparedMoves}
            showState
            emptyLabel="No prep moves"
            onPlayMove={onPlayMove}
            onTogglePrepared={markMovePrepared}
          />
        </>
      )}
    </Stack>
  );
}

function CompactMoveTable({
  stats,
  showState,
  preparedMoves,
  emptyLabel,
  onPlayMove,
  onTogglePrepared,
}: {
  stats: WebPrepMoveStat[];
  showState: boolean;
  preparedMoves?: Record<string, number>;
  emptyLabel: string;
  onPlayMove: (stat: WebPrepMoveStat) => void;
  onTogglePrepared?: (stat: WebPrepMoveStat) => void;
}) {
  if (stats.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {emptyLabel}
      </Text>
    );
  }

  return (
    <Table.ScrollContainer minWidth={showState ? 560 : 440}>
      <Table className={classes.compactTable} verticalSpacing={4} highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Move</Table.Th>
            <Table.Th>Games</Table.Th>
            <Table.Th>WDL</Table.Th>
            <Table.Th>Last</Table.Th>
            {showState && <Table.Th>State</Table.Th>}
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {stats.map((stat) => {
            const prepared = Boolean(preparedMoves?.[stat.key]);
            return (
              <Table.Tr key={stat.key}>
                <Table.Td>
                  <Text size="sm" fw={700}>
                    {stat.move}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {stat.strength?.label ? `Strength ${stat.strength.label}` : stat.sourceLabel}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{stat.total}</Text>
                  <Text size="xs" c="dimmed">
                    {formatPercent(stat.share)}
                  </Text>
                </Table.Td>
                <Table.Td>{formatPercent(stat.scoreForUser)}</Table.Td>
                <Table.Td>{formatWebDate(stat.lastPlayed) || "-"}</Table.Td>
                {showState && (
                  <Table.Td>
                    <Checkbox
                      size="xs"
                      checked={prepared}
                      label={prepared ? "Done" : "Open"}
                      onChange={() => onTogglePrepared?.(stat)}
                    />
                  </Table.Td>
                )}
                <Table.Td ta="right">
                  <Button size="compact-xs" variant="light" onClick={() => onPlayMove(stat)}>
                    Play
                  </Button>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function FilesWorkspace({
  databases,
  gamesByDatabase,
  selectedDatabaseId,
  selectedGame,
  importing,
  importFiles,
  importHostedPgn,
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
  setSelectedDatabaseId: (id: string | null) => void;
  setSelectedGameId: (id: string | null) => void;
  deleteDatabase: (database: WebDatabase) => void;
  loadGameOnBoard: (game: WebGame) => void;
}) {
  const activeGames = selectedDatabaseId ? gamesByDatabase[selectedDatabaseId] ?? [] : [];

  return (
    <Box className={classes.filesWorkspace}>
      <HostedFilesPanel importHostedPgn={importHostedPgn} />

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
  embedded = false,
}: {
  importHostedPgn: WebHostedPgnImportHandler;
  embedded?: boolean;
}) {
  const [library, setLibrary] = useState<WebHostedLibrary | null>(null);
  const [listing, setListing] = useState<WebHostedFileListResponse | null>(null);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);

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
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<IconArrowBackUp size={14} />}
          mb="xs"
          onClick={() => void load(listing?.parentPath ?? "")}
        >
          Up
        </Button>
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
                        ? "Folder"
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
