import {
  ActionIcon,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCopy,
  IconDatabase,
  IconDeviceFloppy,
  IconExternalLink,
  IconFilterOff,
  IconFolderPlus,
  IconSearch,
  IconSelectAll,
} from "@tabler/icons-react";
import { resolve, tempDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { useNavigate } from "@tanstack/react-router";
import { INITIAL_FEN } from "chessops/fen";
import { useAtom, useSetAtom } from "jotai";
import { DataTable } from "mantine-datatable";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { commands, type NormalizedGame, type Outcome } from "@/bindings";
import { usePanelDensity } from "@/components/common/ResponsivePanel";
import { PlayerSearchInput } from "@/components/databases/PlayerSearchInput";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { getDatabasesDir, getDocumentDir } from "@/utils/directories";
import { query_games } from "@/utils/db";
import {
  createRepertoireDatabaseFromGameBatches,
  createRepertoireDatabaseFromGames,
} from "@/utils/repertoireCopy";
import { createTab } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";

type GameFilters = {
  search: string;
  eco: string;
  result: Outcome | "";
  minElo: number | "";
  since: number | "";
  until: number | "";
};

const DEFAULT_FILTERS: GameFilters = {
  search: "",
  eco: "",
  result: "",
  minElo: "",
  since: "",
  until: "",
};

const RESULT_PATTERN = /\s(?:1-0|0-1|1\/2-1\/2|\*)\s*$/;
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;
const RESERVED_WINDOWS_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const GAME_FILE_METADATA = JSON.stringify({ type: "game", tags: [] });
const REPERTOIRE_COPY_PAGE_SIZE = 500;

function GamesTable({
  games,
  loading,
  databasePath,
  whitePlayer,
  blackPlayer,
  onWhitePlayerChange,
  onBlackPlayerChange,
  searchText,
  onSearchTextChange,
  repertoirePlayer,
  repertoirePlayerSide = "any",
}: {
  games: NormalizedGame[];
  loading: boolean;
  databasePath?: string | null;
  whitePlayer?: number | null;
  blackPlayer?: number | null;
  onWhitePlayerChange?: (player: number | null) => void;
  onBlackPlayerChange?: (player: number | null) => void;
  searchText?: string;
  onSearchTextChange?: (value: string) => void;
  repertoirePlayer?: { id?: number | null; name: string } | null;
  repertoirePlayerSide?: "white" | "black" | "any";
}) {
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<GameFilters>(DEFAULT_FILTERS);
  const [selectedRecords, setSelectedRecords] = useState<NormalizedGame[]>([]);
  const [appFolderOpened, setAppFolderOpened] = useState(false);
  const [appFolderName, setAppFolderName] = useState(() => defaultMasterGamesCollectionName());
  const [savingToAppFolder, setSavingToAppFolder] = useState(false);
  const [creatingDatabase, setCreatingDatabase] = useState(false);
  const [creatingRepertoire, setCreatingRepertoire] = useState(false);
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const panelDensity = usePanelDensity();
  const compact = panelDensity !== "regular";
  const dense = panelDensity === "dense";
  const playerFilterWidth = dense ? 132 : compact ? 150 : 170;
  const tableSpacing = dense ? 4 : compact ? 6 : "xs";
  const playerTextSize = dense ? "xs" : "sm";
  const denseColumns = {
    avgElo: dense ? 62 : compact ? 76 : 92,
    date: dense ? 68 : compact ? 82 : 92,
    result: dense ? 54 : compact ? 64 : 78,
    eco: dense ? 44 : compact ? 56 : 70,
    actions: dense ? 56 : compact ? 68 : 82,
  };

  const filteredGames = useMemo(() => {
    return games.filter((game) => gameMatchesFilters(game, filters)).sort(compareMasterGames);
  }, [filters, games]);

  const pageRecords = filteredGames.slice((page - 1) * 20, page * 20);
  const databaseRecords = selectedRecords.length > 0 ? selectedRecords : filteredGames;
  const allFilteredSelected =
    filteredGames.length > 0 && selectedRecords.length === filteredGames.length;
  const canFetchFullRepertoire =
    !!databasePath &&
    !!repertoirePlayer &&
    repertoirePlayer.id !== null &&
    repertoirePlayer.id !== undefined;
  const canCreateRepertoire =
    !!repertoirePlayer && (databaseRecords.length > 0 || canFetchFullRepertoire);

  useEffect(() => {
    setPage(1);
    setSelectedRecords([]);
  }, [filters, games]);

  const openGame = useCallback(
    (game: NormalizedGame) => {
      void createTab({
        tab: {
          name: `${game.white} - ${game.black}`,
          type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: game.moves,
        headers: game,
        gameOrigin: databasePath
          ? {
              kind: "database",
              database: databasePath,
              gameId: game.id,
            }
          : undefined,
      });
      navigate({ to: "/" });
    },
    [databasePath, navigate, setActiveTab, setTabs],
  );

  const saveGames = useCallback(async (records: NormalizedGame[], defaultName: string) => {
    if (records.length === 0) return;

    const file = await save({
      defaultPath: ensurePgnExtension(defaultName),
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (file === null) return;

    const filePath = ensurePgnExtension(file);
    const content = `${records.map(gameToPgn).join("\n\n")}\n`;
    try {
      await writeTextFile(filePath, content);
      notifications.show({
        title: "Master games saved",
        message: `${records.length} game${records.length === 1 ? "" : "s"} exported to PGN.`,
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Could not save master games",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  }, []);

  const saveSelectedToAppFolder = useCallback(async () => {
    if (selectedRecords.length === 0) return;

    setSavingToAppFolder(true);
    try {
      const targetDir = await saveGamesToAppFolder(selectedRecords, appFolderName);
      await mutate(["file-directory", await getDocumentDir()]);
      notifications.show({
        title: "Master games saved",
        message: `${selectedRecords.length} game${
          selectedRecords.length === 1 ? "" : "s"
        } saved to Files: ${targetDir}`,
        color: "green",
      });
      setAppFolderOpened(false);
    } catch (error) {
      notifications.show({
        title: "Could not save to app Files",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setSavingToAppFolder(false);
    }
  }, [appFolderName, mutate, selectedRecords]);

  const createDatabaseFromGames = useCallback(async () => {
    if (databaseRecords.length === 0) return;

    setCreatingDatabase(true);
    try {
      const database = await createMasterGamesDatabase(databaseRecords);
      await mutate("databases");
      notifications.show({
        title: "Database created",
        message: `${database.title} was saved to the app databases.`,
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Could not create database",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setCreatingDatabase(false);
    }
  }, [databaseRecords, mutate]);

  const createRepertoireFromGames = useCallback(async () => {
    if (!repertoirePlayer) return;

    setCreatingRepertoire(true);
    try {
      const database =
        selectedRecords.length > 0 || !canFetchFullRepertoire
          ? await createRepertoireDatabaseFromGames(databaseRecords, repertoirePlayer)
          : await createRepertoireDatabaseFromGameBatches(
              fetchFullRepertoireGameBatches(
                databasePath!,
                repertoirePlayer.id!,
                repertoirePlayerSide,
              ),
              repertoirePlayer,
            );
      await mutate("databases");
      notifications.show({
        title: "Repertoire database created",
        message: `${database.title} saved ${database.positions} ${repertoirePlayer.name} response${
          database.positions === 1 ? "" : "s"
        }.`,
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Could not copy repertoire",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setCreatingRepertoire(false);
    }
  }, [
    canFetchFullRepertoire,
    databasePath,
    databaseRecords,
    mutate,
    repertoirePlayer,
    repertoirePlayerSide,
    selectedRecords.length,
  ]);

  const openAppFolderModal = () => {
    setAppFolderName(defaultMasterGamesCollectionName());
    setAppFolderOpened(true);
  };

  const selectAllFilteredGames = () => setSelectedRecords(filteredGames);

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    onSearchTextChange?.("");
  };

  return (
    <Stack flex={1} gap="xs" mt="xs" style={{ minHeight: 0 }}>
      <Modal
        opened={appFolderOpened}
        onClose={() => setAppFolderOpened(false)}
        title="Save to app Files"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveSelectedToAppFolder();
          }}
        >
          <Stack gap="sm">
            <TextInput
              label="Folder"
              value={appFolderName}
              onChange={(event) => setAppFolderName(event.currentTarget.value)}
              data-autofocus
            />
            <Button
              type="submit"
              leftSection={<IconFolderPlus size="1rem" />}
              loading={savingToAppFolder}
              disabled={!appFolderName.trim() || selectedRecords.length === 0}
            >
              Save selected games
            </Button>
          </Stack>
        </form>
      </Modal>

      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          {databasePath && (
            <>
              <div style={{ width: playerFilterWidth }}>
                <PlayerSearchInput
                  label="White player"
                  file={databasePath}
                  value={whitePlayer ?? undefined}
                  setValue={(value) => onWhitePlayerChange?.(value ?? null)}
                />
              </div>
              <div style={{ width: playerFilterWidth }}>
                <PlayerSearchInput
                  label="Black player"
                  file={databasePath}
                  value={blackPlayer ?? undefined}
                  setValue={(value) => onBlackPlayerChange?.(value ?? null)}
                />
              </div>
            </>
          )}
          <TextInput
            leftSection={<IconSearch size="0.9rem" />}
            placeholder="Any player, event, site"
            value={searchText ?? filters.search}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setFilters((current) => ({ ...current, search: value }));
              onSearchTextChange?.(value);
            }}
            size="xs"
            w={dense ? 150 : 190}
          />
          <NumberInput
            placeholder="Min Elo"
            value={filters.minElo}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                minElo: typeof value === "number" ? value : "",
              }))
            }
            min={0}
            max={4000}
            step={50}
            size="xs"
            w={dense ? 78 : 95}
          />
          <Select
            placeholder="Result"
            value={filters.result}
            onChange={(value) =>
              setFilters((current) => ({ ...current, result: (value as Outcome | null) ?? "" }))
            }
            data={[
              { value: "1-0", label: "White wins" },
              { value: "0-1", label: "Black wins" },
              { value: "1/2-1/2", label: "Draw" },
              { value: "*", label: "Unfinished" },
            ]}
            clearable
            size="xs"
            w={dense ? 98 : 120}
          />
          <TextInput
            placeholder="ECO"
            value={filters.eco}
            onChange={(event) =>
              setFilters((current) => ({ ...current, eco: event.currentTarget.value }))
            }
            size="xs"
            w={74}
          />
          <NumberInput
            placeholder="Since"
            value={filters.since}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                since: typeof value === "number" ? value : "",
              }))
            }
            min={1800}
            max={new Date().getFullYear()}
            step={1}
            size="xs"
            w={dense ? 70 : 82}
          />
          <NumberInput
            placeholder="Until"
            value={filters.until}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                until: typeof value === "number" ? value : "",
              }))
            }
            min={1800}
            max={new Date().getFullYear()}
            step={1}
            size="xs"
            w={dense ? 70 : 82}
          />
          <Tooltip label="Clear filters">
            <ActionIcon variant="default" size="sm" onClick={resetFilters}>
              <IconFilterOff size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {filteredGames.length} / {games.length}
          </Text>
        </Group>

        <Group gap="xs" wrap="wrap">
          <Tooltip label="Select every filtered game across all pages">
            <Button
              variant="default"
              size="xs"
              leftSection={<IconSelectAll size="0.95rem" />}
              disabled={filteredGames.length === 0 || allFilteredSelected}
              onClick={selectAllFilteredGames}
            >
              {allFilteredSelected ? "All selected" : "Select all"}
            </Button>
          </Tooltip>
          {selectedRecords.length > 0 ? (
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              {selectedRecords.length} selected
            </Text>
          ) : null}
          <Tooltip label="Save selected games into app Files">
            <Button
              variant="default"
              size="xs"
              leftSection={<IconFolderPlus size="0.95rem" />}
              disabled={selectedRecords.length === 0}
              onClick={openAppFolderModal}
            >
              Files
            </Button>
          </Tooltip>
          <Tooltip
            label={
              selectedRecords.length > 0
                ? "Create database from selected games"
                : "Create database from shown games"
            }
          >
            <Button
              variant="default"
              size="xs"
              leftSection={<IconDatabase size="0.95rem" />}
              disabled={databaseRecords.length === 0}
              loading={creatingDatabase}
              onClick={() => void createDatabaseFromGames()}
            >
              Database
            </Button>
          </Tooltip>
          <Tooltip
            label={
              repertoirePlayer
                ? selectedRecords.length > 0
                  ? `Copy ${repertoirePlayer.name}'s repertoire from selected games`
                  : canFetchFullRepertoire
                    ? `Copy ${repertoirePlayer.name}'s full repertoire from this database`
                    : `Copy ${repertoirePlayer.name}'s repertoire from shown games`
                : "Choose a player in a player field first"
            }
          >
            <Button
              variant="default"
              size="xs"
              leftSection={<IconCopy size="0.95rem" />}
              disabled={!canCreateRepertoire}
              loading={creatingRepertoire}
              onClick={() => void createRepertoireFromGames()}
            >
              Repertoire
            </Button>
          </Tooltip>
          <Tooltip label="Save selected games to a PGN file">
            <Button
              variant="default"
              size="xs"
              leftSection={<IconDeviceFloppy size="0.95rem" />}
              disabled={selectedRecords.length === 0}
              onClick={() => void saveGames(selectedRecords, "selected-master-games.pgn")}
            >
              Selected
            </Button>
          </Tooltip>
          <Tooltip label="Save all shown games to a PGN file">
            <Button
              variant="default"
              size="xs"
              leftSection={<IconDeviceFloppy size="0.95rem" />}
              disabled={filteredGames.length === 0}
              onClick={() => void saveGames(filteredGames, "master-games.pgn")}
            >
              Shown
            </Button>
          </Tooltip>
        </Group>
      </Group>

      <DataTable
        withTableBorder
        highlightOnHover
        horizontalSpacing={tableSpacing}
        verticalSpacing={dense ? 3 : compact ? 4 : "xs"}
        records={pageRecords}
        fetching={loading}
        totalRecords={filteredGames.length}
        recordsPerPage={20}
        page={page}
        onPageChange={setPage}
        selectedRecords={selectedRecords}
        onSelectedRecordsChange={setSelectedRecords}
        onRowClick={({ record }) => openGame(record)}
        columns={[
          {
            accessor: "white",
            render: ({ white, white_elo }) => (
              <div>
                <Text size={playerTextSize} fw={500}>
                  {white}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatElo(white_elo)}
                </Text>
              </div>
            ),
          },
          {
            accessor: "black",
            render: ({ black, black_elo }) => (
              <div>
                <Text size={playerTextSize} fw={500}>
                  {black}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatElo(black_elo)}
                </Text>
              </div>
            ),
          },
          {
            accessor: "avgElo",
            title: "Avg Elo",
            width: denseColumns.avgElo,
            render: (game) => gameAverageElo(game) || "",
          },
          { accessor: "date", width: denseColumns.date },
          {
            accessor: "result",
            width: denseColumns.result,
            render: ({ result }) => formatResult(result),
          },
          { accessor: "eco", width: denseColumns.eco },
          { accessor: "event" },
          {
            accessor: "actions",
            title: "",
            width: denseColumns.actions,
            render: (game) => (
              <Group gap={4} wrap="nowrap" justify="flex-end">
                <Tooltip label="Open game">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      openGame(game);
                    }}
                  >
                    <IconExternalLink size="1rem" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Save PGN">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      void saveGames([game], `${defaultGameFilename(game)}.pgn`);
                    }}
                  >
                    <IconDeviceFloppy size="1rem" />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ),
          },
        ]}
        noRecordsText="No master games found"
      />
    </Stack>
  );
}

export default memo(GamesTable);

function gameMatchesFilters(game: NormalizedGame, filters: GameFilters) {
  const query = normalizeSearchText(filters.search);
  if (query) {
    const searchable = normalizeSearchText(
      [game.white, game.black, game.event, game.site].filter(Boolean).join(" "),
    );
    const tokens = query.split(" ").filter(Boolean);
    if (!tokens.every((token) => searchable.includes(token))) return false;
  }

  const eco = filters.eco.trim().toLowerCase();
  if (eco && !game.eco?.toLowerCase().startsWith(eco)) return false;

  if (filters.result && game.result !== filters.result) return false;

  if (typeof filters.minElo === "number" && gameAverageElo(game) < filters.minElo) {
    return false;
  }

  const year = gameYear(game);
  if (typeof filters.since === "number" && (year === null || year < filters.since)) {
    return false;
  }
  if (typeof filters.until === "number" && (year === null || year > filters.until)) {
    return false;
  }

  return true;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compareMasterGames(a: NormalizedGame, b: NormalizedGame) {
  const aAverage = gameAverageElo(a);
  const bAverage = gameAverageElo(b);
  const aMax = Math.max(a.white_elo ?? 0, a.black_elo ?? 0);
  const bMax = Math.max(b.white_elo ?? 0, b.black_elo ?? 0);
  const aYear = gameYear(a) ?? 0;
  const bYear = gameYear(b) ?? 0;

  return bAverage - aAverage || bMax - aMax || bYear - aYear || a.white.localeCompare(b.white);
}

function gameAverageElo(game: NormalizedGame) {
  const elos = [game.white_elo, game.black_elo].filter(
    (elo): elo is number => typeof elo === "number" && elo > 0,
  );
  if (elos.length === 0) return 0;
  return Math.round(elos.reduce((sum, elo) => sum + elo, 0) / elos.length);
}

function gameYear(game: NormalizedGame) {
  const year = game.date?.match(/\d{4}/)?.[0];
  return year ? Number(year) : null;
}

function formatElo(elo?: number | null) {
  return !elo || elo === 0 ? "Unrated" : elo;
}

function formatResult(result: Outcome) {
  return result;
}

function ensurePgnExtension(filePath: string) {
  return filePath.toLowerCase().endsWith(".pgn") ? filePath : `${filePath}.pgn`;
}

async function* fetchFullRepertoireGameBatches(
  databasePath: string,
  playerId: number,
  side: "white" | "black" | "any",
) {
  const sides = side === "white" ? "WhiteBlack" : side === "black" ? "BlackWhite" : "Any";
  let page = 1;

  while (true) {
    const result = await query_games(databasePath, {
      player1: playerId,
      sides,
      options: {
        page,
        pageSize: REPERTOIRE_COPY_PAGE_SIZE,
        skipCount: true,
        sort: "id",
        direction: "desc",
      },
    });

    if (result.data.length === 0) return;
    yield result.data;

    if (result.data.length < REPERTOIRE_COPY_PAGE_SIZE) return;
    page += 1;
  }
}

async function saveGamesToAppFolder(records: NormalizedGame[], folderName: string) {
  const documentDir = await getDocumentDir();
  const folderSegments = toSafePathSegments(folderName);
  if (folderSegments.length === 0) {
    throw new Error("Enter a folder name");
  }

  const targetDir = await resolve(documentDir, ...folderSegments);
  await mkdir(targetDir, { recursive: true });

  const width = String(records.length).length;
  for (const [index, game] of records.entries()) {
    const prefix = String(index + 1).padStart(width, "0");
    const filename = `${prefix} ${defaultGameFilename(game)}`;
    const filePath = await getAvailablePath(targetDir, filename, ".pgn");
    await writeTextFile(filePath, `${gameToPgn(game)}\n`);
    await writeTextFile(pgnInfoPath(filePath), GAME_FILE_METADATA);
  }

  return folderSegments.join("/");
}

async function createMasterGamesDatabase(records: NormalizedGame[]) {
  const databasesDir = await getDatabasesDir();
  const database = await getAvailableNamedPath(
    databasesDir,
    defaultMasterGamesCollectionName(),
    ".db3",
  );
  const tempPgn = await resolve(
    await tempDir(),
    `${sanitizeFileSegment(database.title)}-${Date.now()}.pgn`,
  );

  await writeTextFile(tempPgn, `${records.map(gameToPgn).join("\n\n")}\n`);
  try {
    unwrap(
      await commands.convertPgn(
        tempPgn,
        database.path,
        null,
        database.title,
        `${records.length} master game${records.length === 1 ? "" : "s"} from the Database panel.`,
      ),
    );
  } finally {
    try {
      await remove(tempPgn);
    } catch {
      // The temp PGN is only an intermediate import file.
    }
  }

  return database;
}

async function getAvailablePath(dir: string, basename: string, extension: string) {
  const base = removeExtension(sanitizeFileSegment(basename), extension) || "master-game";
  for (let index = 0; index < 1000; index++) {
    const suffix = index === 0 ? "" : ` ${index + 1}`;
    const candidate = await resolve(dir, `${base}${suffix}${extension}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Could not find an available filename");
}

async function getAvailableNamedPath(dir: string, basename: string, extension: string) {
  const base = removeExtension(sanitizeFileSegment(basename), extension) || "master-games";
  for (let index = 0; index < 1000; index++) {
    const suffix = index === 0 ? "" : ` ${index + 1}`;
    const title = `${base}${suffix}`;
    const candidate = await resolve(dir, `${title}${extension}`);
    if (!(await exists(candidate))) {
      return { path: candidate, title };
    }
  }
  throw new Error("Could not find an available database name");
}

function toSafePathSegments(path: string) {
  return path
    .split(/[\\/]+/)
    .map(sanitizeFileSegment)
    .filter(Boolean);
}

function sanitizeFileSegment(value: string) {
  const clean = value
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!clean) return "";
  return RESERVED_WINDOWS_FILENAME.test(clean) ? `${clean}_` : clean;
}

function removeExtension(value: string, extension: string) {
  return value.toLowerCase().endsWith(extension) ? value.slice(0, -extension.length) : value;
}

function pgnInfoPath(filePath: string) {
  return `${filePath.slice(0, -".pgn".length)}.info`;
}

function defaultMasterGamesCollectionName() {
  const date = new Date();
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join("-");
  return `Master games ${day} ${time}`;
}

function defaultGameFilename(game: NormalizedGame) {
  const date = game.date?.replaceAll(".", "-") ?? "";
  const base = [date, game.white, game.black].filter(Boolean).join(" ");
  const clean = base.replace(INVALID_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim();
  return clean || "master-game";
}

function gameToPgn(game: NormalizedGame) {
  const raw = game.moves.trim();
  if (raw.startsWith("[")) return raw;

  const result = game.result || "*";
  const tags: [string, string | number | null | undefined][] = [
    ["Event", game.event || "?"],
    ["Site", game.site || "?"],
    ["Date", game.date || "????.??.??"],
    ["Round", game.round || "?"],
    ["White", game.white || "?"],
    ["Black", game.black || "?"],
    ["Result", result],
    ["WhiteElo", game.white_elo],
    ["BlackElo", game.black_elo],
    ["ECO", game.eco],
    ["TimeControl", game.time_control],
    ["PlyCount", game.ply_count],
  ];

  if (game.fen && game.fen !== INITIAL_FEN) {
    tags.push(["SetUp", "1"], ["FEN", game.fen]);
  }

  const header = tags
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([name, value]) => `[${name} "${escapeTagValue(String(value))}"]`)
    .join("\n");
  const movetext = RESULT_PATTERN.test(raw) ? raw : `${raw} ${result}`.trim();

  return `${header}\n\n${movetext}`;
}

function escapeTagValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
