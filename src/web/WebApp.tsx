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
  createTheme,
  Divider,
  Group,
  Loader,
  MantineProvider,
  MultiSelect,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications, Notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconBook,
  IconChess,
  IconDatabase,
  IconDownload,
  IconFolderOpen,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { chessgroundDests } from "chessops/compat";
import { INITIAL_FEN } from "chessops/fen";
import { isNormal, makeSquare, parseSquare, parseUci } from "chessops";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import classes from "./WebApp.module.css";
import type {
  WebColor,
  WebCompanionState,
  WebDatabase,
  WebGame,
  WebImportResult,
  WebPrepWorkspace,
} from "./model";
import {
  collectGamesForSources,
  getDatabasePlayerCounts,
  getKnownPlayers,
  getWebPrepMoveStats,
  type WebPrepMoveStat,
} from "./prepIndex";
import {
  currentWebFen,
  formatWebDate,
  getFenColor,
  normalizeWebFen,
  oppositeWebColor,
  parsePgnDatabase,
  playSanMove,
  playUciMove,
} from "./pgn";
import { createEmptyWebState, loadWebState, saveWebState } from "./storage";
import { positionFromFen } from "@/utils/chessops";

type ViewMode = "prep" | "files" | "databases";

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
  const [view, setView] = useState<ViewMode>("prep");
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
    void navigator.serviceWorker.register("/web-sw.js").catch((error) => {
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
    [selectedDatabaseId],
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
                    Prep, files, and PGN databases
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
                  { value: "prep", label: "Prep" },
                  { value: "files", label: "Files" },
                  { value: "databases", label: "Databases" },
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
          ) : state.databases.length === 0 ? (
            <EmptyImportState importing={importing} importFiles={importFiles} />
          ) : view === "prep" ? (
            <PrepView state={state} setState={setState} activePrep={activePrep} />
          ) : view === "files" ? (
            <FilesView
              databases={state.databases}
              gamesByDatabase={state.gamesByDatabase}
              selectedDatabaseId={selectedDatabaseId}
              selectedGame={selectedGame}
              setSelectedDatabaseId={setSelectedDatabaseId}
              setSelectedGameId={setSelectedGameId}
              deleteDatabase={deleteDatabase}
            />
          ) : (
            <DatabasesView
              databases={state.databases}
              gamesByDatabase={state.gamesByDatabase}
              selectedDatabaseId={selectedDatabaseId}
              setSelectedDatabaseId={setSelectedDatabaseId}
            />
          )}
        </main>
      </Box>
    </MantineProvider>
  );
}

function EmptyImportState({
  importing,
  importFiles,
}: {
  importing: boolean;
  importFiles: (files: FileList | null) => Promise<void>;
}) {
  return (
    <Box className={`${classes.panel} ${classes.empty}`}>
      <Stack align="center" gap="sm">
        <IconFolderOpen size={44} />
        <Title order={2}>Import a PGN</Title>
        <Text size="sm" c="dimmed" maw={430}>
          Browser prep starts from PGN files saved on this device.
        </Text>
        <Button component="label" leftSection={<IconUpload size={16} />} loading={importing}>
          Choose PGN files
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
      </Stack>
    </Box>
  );
}

function PrepView({
  state,
  setState,
  activePrep,
}: {
  state: WebCompanionState;
  setState: Dispatch<SetStateAction<WebCompanionState>>;
  activePrep: WebPrepWorkspace | null;
}) {
  const [opponent, setOpponent] = useState("");
  const [userColor, setUserColor] = useState<WebColor>("white");
  const [sourceIds, setSourceIds] = useState<string[]>(() => state.databases.map((db) => db.id));
  const currentFen = currentWebFen(activePrep?.line ?? [], activePrep?.startFen ?? INITIAL_FEN);
  const games = useMemo(
    () =>
      collectGamesForSources(
        state.gamesByDatabase,
        activePrep?.sourceIds.length ? activePrep.sourceIds : sourceIds,
      ),
    [activePrep?.sourceIds, sourceIds, state.gamesByDatabase],
  );
  const stats = useMemo(
    () => getWebPrepMoveStats({ games, prep: activePrep, fen: currentFen }),
    [activePrep, currentFen, games],
  );
  const players = useMemo(() => getKnownPlayers(state.gamesByDatabase), [state.gamesByDatabase]);
  const sourceOptions = state.databases.map((database) => ({
    value: database.id,
    label: `${database.name} (${database.gameCount})`,
  }));

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
      line: [],
      notesByFen: {},
      preparedMoves: {},
      createdAt: now,
      updatedAt: now,
    };

    setState((current) => ({
      ...current,
      prepWorkspaces: [prep, ...current.prepWorkspaces],
      activePrepId: prep.id,
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

  const appendMove = (san: string, uci: string | null, fenAfter: string) => {
    if (!activePrep) return;
    const fenBefore = currentWebFen(activePrep.line, activePrep.startFen);
    const actor = getFenColor(fenBefore) === activePrep.userColor ? "user" : "opponent";
    updateActivePrep((prep) => ({
      ...prep,
      line: [
        ...prep.line,
        {
          fenBefore,
          fenAfter,
          san,
          uci,
          actor,
        },
      ],
      updatedAt: Date.now(),
    }));
  };

  const playStatMove = (stat: WebPrepMoveStat) => {
    const played = playSanMove(currentFen, stat.move);
    if (!played) return;
    appendMove(played.san, played.uci, played.fenAfter);
  };

  const handleBoardMove = (uci: string) => {
    const played = playUciMove(currentFen, uci);
    if (!played) return;
    appendMove(played.san, played.uci, played.fenAfter);
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

  const note = activePrep?.notesByFen[normalizeWebFen(currentFen)] ?? "";
  const turnColor = getFenColor(currentFen);
  const actorLabel = activePrep
    ? turnColor === oppositeWebColor(activePrep.userColor)
      ? `${activePrep.opponent || "Opponent"} to move`
      : "Your move"
    : "Create prep";

  return (
    <Stack gap="md">
      <Box className={`${classes.panel} ${classes.panelBody}`}>
        <Group justify="space-between" gap="sm" align="flex-start">
          <Stack gap={4}>
            <Title order={3}>Opponent prep</Title>
            <Text size="sm" c="dimmed">
              {activePrep
                ? `${activePrep.name} from ${games.length} indexed games`
                : `${state.databases.length} PGN databases indexed`}
            </Text>
          </Stack>
          {state.prepWorkspaces.length > 0 && (
            <Select
              w={220}
              size="xs"
              value={state.activePrepId}
              onChange={(value) => setState((current) => ({ ...current, activePrepId: value }))}
              data={state.prepWorkspaces.map((prep) => ({ value: prep.id, label: prep.name }))}
            />
          )}
        </Group>
        <Divider my="sm" />
        <Group align="flex-end" gap="xs">
          <TextInput
            label="Opponent"
            placeholder="Player name"
            value={opponent}
            onChange={(event) => setOpponent(event.currentTarget.value)}
            list="web-known-players"
            style={{ flex: "1 1 12rem" }}
          />
          <datalist id="web-known-players">
            {players.map((player) => (
              <option key={player} value={player} />
            ))}
          </datalist>
          <Select
            label="Side"
            value={userColor}
            onChange={(value) => setUserColor((value as WebColor | null) ?? "white")}
            data={[
              { value: "white", label: "I'm white" },
              { value: "black", label: "I'm black" },
            ]}
            w={132}
          />
          <MultiSelect
            label="Sources"
            value={sourceIds}
            onChange={setSourceIds}
            data={sourceOptions}
            placeholder="All databases"
            style={{ flex: "1 1 16rem" }}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={createPrep}>
            New prep
          </Button>
        </Group>
      </Box>

      {activePrep ? (
        <Box className={classes.workspace}>
          <Box className={`${classes.panel} ${classes.boardPanel}`}>
            <Stack gap="sm">
              <Group justify="space-between" gap="xs">
                <Badge color={turnColor === activePrep.userColor ? "blue" : "teal"} variant="light">
                  {actorLabel}
                </Badge>
                <Group gap={4}>
                  <Tooltip label="Back">
                    <ActionIcon
                      aria-label="Back"
                      onClick={() =>
                        updateActivePrep((prep) => ({
                          ...prep,
                          line: prep.line.slice(0, -1),
                          updatedAt: Date.now(),
                        }))
                      }
                      disabled={activePrep.line.length === 0}
                    >
                      <IconArrowBackUp size={17} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Start">
                    <ActionIcon
                      aria-label="Start"
                      onClick={() =>
                        updateActivePrep((prep) => ({
                          ...prep,
                          line: [],
                          updatedAt: Date.now(),
                        }))
                      }
                      disabled={activePrep.line.length === 0}
                    >
                      <IconRefresh size={17} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
              <WebChessboard
                fen={currentFen}
                orientation={activePrep.userColor}
                lastMoveUci={activePrep.line.at(-1)?.uci ?? null}
                onMove={handleBoardMove}
              />
              <Text size="xs" c="dimmed">
                {normalizeWebFen(currentFen)}
              </Text>
              <Box className={classes.line}>
                <Text size="sm">{activePrep.line.map((move) => move.san).join(" ") || "Start"}</Text>
              </Box>
              <Textarea
                label="Position notes"
                autosize
                minRows={3}
                value={note}
                onChange={(event) => updateNote(event.currentTarget.value)}
              />
            </Stack>
          </Box>

          <Box className={`${classes.panel} ${classes.panelBody}`}>
            <PrepMoveTable
              prep={activePrep}
              stats={stats}
              onPlayMove={playStatMove}
              onTogglePrepared={markMovePrepared}
            />
          </Box>
        </Box>
      ) : (
        <Box className={`${classes.panel} ${classes.empty}`}>
          <Stack align="center" gap="sm">
            <IconBook size={42} />
            <Title order={3}>Create prep</Title>
            <Text size="sm" c="dimmed">
              Choose an opponent and side, then start from the indexed PGNs.
            </Text>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

function PrepMoveTable({
  prep,
  stats,
  onPlayMove,
  onTogglePrepared,
}: {
  prep: WebPrepWorkspace;
  stats: WebPrepMoveStat[];
  onPlayMove: (stat: WebPrepMoveStat) => void;
  onTogglePrepared: (stat: WebPrepMoveStat) => void;
}) {
  if (stats.length === 0) {
    return (
      <Box className={classes.empty} mih={260}>
        <Stack align="center" gap="xs">
          <IconDatabase size={34} />
          <Text fw={700}>No games reach this position</Text>
          <Text size="sm" c="dimmed">
            Try a broader source or return to an earlier move.
          </Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Box>
          <Title order={4}>Moves</Title>
          <Text size="xs" c="dimmed">
            Sorted by usage from selected sources
          </Text>
        </Box>
        <Badge variant="light">{stats.reduce((sum, stat) => sum + stat.total, 0)} games</Badge>
      </Group>
      <Table.ScrollContainer minWidth={620}>
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Move</Table.Th>
              <Table.Th>Games</Table.Th>
              <Table.Th>Score</Table.Th>
              <Table.Th>Strength</Table.Th>
              <Table.Th>Last</Table.Th>
              <Table.Th>State</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {stats.map((stat) => {
              const prepared = Boolean(prep.preparedMoves[stat.key]);
              return (
                <Table.Tr key={stat.key}>
                  <Table.Td>
                    <Text fw={700}>{stat.move}</Text>
                    <Text size="xs" c="dimmed">
                      {stat.sourceLabel}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text>{stat.total}</Text>
                    <Text size="xs" c="dimmed">
                      {formatPercent(stat.share)}
                    </Text>
                  </Table.Td>
                  <Table.Td>{formatPercent(stat.scoreForUser)}</Table.Td>
                  <Table.Td>
                    {stat.strength ? (
                      <Tooltip label={stat.strength.detail} multiline maw={280}>
                        <Badge color={stat.strength.score >= 65 ? "green" : "gray"} variant="light">
                          {stat.strength.label}
                        </Badge>
                      </Tooltip>
                    ) : (
                      <Text size="sm" c="dimmed">
                        -
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{formatWebDate(stat.lastPlayed)}</Table.Td>
                  <Table.Td>
                    <Checkbox
                      checked={prepared}
                      label={prepared ? "Done" : "Open"}
                      onChange={() => onTogglePrepared(stat)}
                    />
                  </Table.Td>
                  <Table.Td ta="right">
                    <Button
                      size="compact-xs"
                      variant="light"
                      leftSection={<IconChess size={14} />}
                      onClick={() => onPlayMove(stat)}
                    >
                      Play
                    </Button>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function FilesView({
  databases,
  gamesByDatabase,
  selectedDatabaseId,
  selectedGame,
  setSelectedDatabaseId,
  setSelectedGameId,
  deleteDatabase,
}: {
  databases: WebDatabase[];
  gamesByDatabase: Record<string, WebGame[]>;
  selectedDatabaseId: string | null;
  selectedGame: WebGame | null;
  setSelectedDatabaseId: (id: string | null) => void;
  setSelectedGameId: (id: string | null) => void;
  deleteDatabase: (database: WebDatabase) => void;
}) {
  const activeGames = selectedDatabaseId ? gamesByDatabase[selectedDatabaseId] ?? [] : [];

  return (
    <Box className={classes.split}>
      <Box className={`${classes.panel} ${classes.panelBody}`}>
        <Group justify="space-between" mb="sm">
          <Title order={3}>Files</Title>
          <Badge variant="light">{databases.length}</Badge>
        </Group>
        <Stack gap="xs">
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
                    {database.gameCount} games · {formatBytes(database.sizeBytes)}
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
        </Stack>
      </Box>

      <Box className={`${classes.panel} ${classes.panelBody}`}>
        <Group justify="space-between" mb="sm">
          <Title order={3}>Games</Title>
          {selectedGame && (
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDownload size={15} />}
              onClick={() => downloadText(`${selectedGame.white}-${selectedGame.black}.pgn`, selectedGame.pgn)}
            >
              PGN
            </Button>
          )}
        </Group>
        <Box className={classes.split}>
          <ScrollArea.Autosize mah={520}>
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
                    {formatWebDate(game.date) || "undated"} · {game.result} · {game.moves.length} plies
                  </Text>
                </button>
              ))}
            </Box>
          </ScrollArea.Autosize>
          <Box>
            {selectedGame ? (
              <Stack gap="xs">
                <Group gap="xs">
                  <Badge color="blue" variant="light">
                    {selectedGame.result}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    {selectedGame.event}
                  </Text>
                </Group>
                <Box className={classes.gamePgn}>{selectedGame.pgn}</Box>
              </Stack>
            ) : (
              <Text c="dimmed">Select a game.</Text>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function DatabasesView({
  databases,
  gamesByDatabase,
  selectedDatabaseId,
  setSelectedDatabaseId,
}: {
  databases: WebDatabase[];
  gamesByDatabase: Record<string, WebGame[]>;
  selectedDatabaseId: string | null;
  setSelectedDatabaseId: (id: string | null) => void;
}) {
  const activeDatabase = databases.find((database) => database.id === selectedDatabaseId) ?? databases[0];
  const games = useMemo(
    () => (activeDatabase ? gamesByDatabase[activeDatabase.id] ?? [] : []),
    [activeDatabase, gamesByDatabase],
  );
  const players = useMemo(() => getDatabasePlayerCounts(games).slice(0, 24), [games]);

  return (
    <Stack gap="md">
      <Box className={`${classes.panel} ${classes.panelBody}`}>
        <Group justify="space-between" align="flex-start">
          <Box>
            <Title order={3}>Databases</Title>
            <Text size="sm" c="dimmed">
              Browser-indexed PGN sources
            </Text>
          </Box>
          <Select
            value={activeDatabase?.id ?? null}
            onChange={setSelectedDatabaseId}
            data={databases.map((database) => ({ value: database.id, label: database.name }))}
            w={260}
          />
        </Group>
      </Box>

      {activeDatabase && (
        <Box className={classes.workspace}>
          <Box className={`${classes.panel} ${classes.panelBody}`}>
            <Stack gap="md">
              <Title order={4}>{activeDatabase.name}</Title>
              <Box className={classes.statGrid}>
                <Box className={classes.stat}>
                  <Text size="xs" c="dimmed">
                    Games
                  </Text>
                  <Text fw={700}>{activeDatabase.gameCount}</Text>
                </Box>
                <Box className={classes.stat}>
                  <Text size="xs" c="dimmed">
                    Size
                  </Text>
                  <Text fw={700}>{formatBytes(activeDatabase.sizeBytes)}</Text>
                </Box>
                <Box className={classes.stat}>
                  <Text size="xs" c="dimmed">
                    Latest
                  </Text>
                  <Text fw={700}>{formatWebDate(activeDatabase.latestDate) || "-"}</Text>
                </Box>
                <Box className={classes.stat}>
                  <Text size="xs" c="dimmed">
                    Players
                  </Text>
                  <Text fw={700}>{players.length}</Text>
                </Box>
              </Box>
              <Divider />
              <Stack gap={4}>
                <Text size="sm" fw={700}>
                  Top players
                </Text>
                {players.map((player) => (
                  <Group key={player.name} justify="space-between" gap="xs">
                    <Text size="sm" truncate>
                      {player.name}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {player.games} · {formatPercent(player.score / player.games)}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Stack>
          </Box>

          <Box className={`${classes.panel} ${classes.panelBody}`}>
            <Title order={4} mb="sm">
              Recent games
            </Title>
            <Table.ScrollContainer minWidth={520}>
              <Table verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>White</Table.Th>
                    <Table.Th>Black</Table.Th>
                    <Table.Th>Result</Table.Th>
                    <Table.Th>Date</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {games
                    .slice()
                    .sort((a, b) => sortableDate(b.date) - sortableDate(a.date))
                    .slice(0, 40)
                    .map((game) => (
                      <Table.Tr key={game.id}>
                        <Table.Td>{game.white}</Table.Td>
                        <Table.Td>{game.black}</Table.Td>
                        <Table.Td>{game.result}</Table.Td>
                        <Table.Td>{formatWebDate(game.date)}</Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>
        </Box>
      )}
    </Stack>
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

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function sortableDate(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? Number(digits.padEnd(8, "0")) : 0;
}
