import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activeTabAtom,
  addRecentFileAtom,
  deckAtomFamily,
  enginesAtom,
  latestOnlineGameAccountSelectionAtom,
  mistakeReviewScanProgressAtom,
  onlineDatabaseUpdatesAtom,
  type RecentFile,
  recentFilesAtom,
  sessionsAtom,
  tabFamily,
  tabsAtom,
} from "@/state/atoms";
import { getDatabases, query_players, type SuccessDatabaseInfo } from "@/utils/db";
import { createTab } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import type { LocalEngine } from "@/utils/engines";
import { parsePGN } from "@/utils/chess";
import CreateRepertoireModal from "./CreateRepertoireModal";
import ImportModal from "./ImportModal";
import classes from "./NewTabHome.module.css";
import {
  IconChess,
  IconClock,
  IconBook,
  IconCloudDownload,
  IconEye,
  IconExclamationCircle,
  IconFileImport,
  IconPuzzle,
  IconSearch,
  IconSettings,
  IconTarget,
  IconTargetArrow,
  IconTrash,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Chessground } from "@/chessground/Chessground";
import { getStats, type Position } from "@/components/files/opening";
import Chessboard from "../icons/Chessboard";
import { FileIcon } from "@/components/files/FileIcon";
import {
  createOpeningReviewDeck,
  deleteOpeningReviewDeck,
  getAvailableOpeningReviewDeckPath,
  listOpeningReviewDecks,
  readOpeningReviewDeck,
  type OpeningReviewAutoUpdateConfig,
  type OpeningReviewDeck,
  type OpeningReviewDeckSummary,
  writeOpeningReviewDeck,
} from "@/utils/openingReview";
import {
  buildOpeningReviewRows,
  filterOpeningReviewRows,
  getOpeningReviewMoveSequenceLabel,
  getOpeningReviewOpeningCacheKey,
  getOpeningReviewOpeningOptions,
  getOpeningReviewPracticeLabel,
  getOpeningReviewMoveSide,
  openingReviewFiltersDisplayName,
  resolveOpeningReviewOpeningName,
  type OpeningReviewColourFilter,
} from "@/utils/openingReviewOpenings";
import {
  getOnlineDatabaseUpdateRecord,
  getOnlineGameSourceLabel,
  upsertOnlineDatabaseUpdateRecord,
} from "@/utils/onlineGameImport";
import {
  createMistakeReviewDeck,
  createMistakeReviewPosition,
  DEFAULT_MISTAKE_REVIEW_SEVERITIES,
  DEFAULT_MISTAKE_REVIEW_THRESHOLDS,
  deleteMistakeReviewDeck,
  getAvailableMistakeReviewDeckPath,
  listMistakeReviewDecks,
  mistakeReviewRequestFromSettings,
  type MistakeReviewDeckSummary,
  type MistakeReviewSettings,
  writeMistakeReviewDeck,
} from "@/utils/mistakeReview";
import {
  getLatestOnlineGame,
  getLinkedOnlineGameProviders,
  getOnlineGameProviderKey,
  getSelectedOnlineGameProviders,
  type LatestOnlineGameAccountSelection,
  type OnlineGameProvider,
} from "@/utils/onlineLatestGame";
import { getGameName } from "@/utils/treeReducer";

dayjs.extend(relativeTime);

const OPENING_REVIEW_PREVIEW_BOARD_SIZE = 168;

function RecentFileDuePositions({ file }: { file: string }) {
  const [deck] = useAtom(
    deckAtomFamily({
      file,
      game: 0,
    }),
  );

  const stats = getStats(deck.positions);

  if (stats.due + stats.unseen === 0) return null;

  return (
    <Badge size="sm" variant="light" color="orange" leftSection={<IconTarget size="0.75rem" />}>
      {stats.due + stats.unseen} due
    </Badge>
  );
}

function RecentFileRow({ file, onOpen }: { file: RecentFile; onOpen: (file: RecentFile) => void }) {
  const displayName = file.name.replace(/\.pgn$/i, "");

  return (
    <UnstyledButton
      onClick={() => onOpen(file)}
      px="sm"
      py={6}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
      }}
      className={classes.recentFileRow}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Box style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }}>
            <FileIcon type={file.type} size={20} />
          </Box>
          <Text size="sm" truncate fw={500}>
            {displayName}
          </Text>
          {file.type === "repertoire" && <RecentFileDuePositions file={file.path} />}
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Tooltip label={dayjs(file.lastOpened).format("YYYY-MM-DD HH:mm")}>
            <Group gap={4} wrap="nowrap">
              <IconClock size={14} style={{ color: "var(--mantine-color-dimmed)" }} />
              <Text size="xs" c="dimmed">
                {dayjs(file.lastOpened).fromNow()}
              </Text>
            </Group>
          </Tooltip>
        </Group>
      </Group>
    </UnstyledButton>
  );
}

function OpeningReviewModal({
  opened,
  decks,
  loading,
  deletingPath,
  onClose,
  onOpen,
  onPositions,
  onDelete,
  onSettings,
  onAnalyze,
}: {
  opened: boolean;
  decks: OpeningReviewDeckSummary[];
  loading: boolean;
  deletingPath: string | null;
  onClose: () => void;
  onOpen: (deck: OpeningReviewDeckSummary) => void;
  onPositions: (deck: OpeningReviewDeckSummary) => void;
  onDelete: (deck: OpeningReviewDeckSummary) => void;
  onSettings: (deck: OpeningReviewDeckSummary) => void;
  onAnalyze: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={<b>Opening Review</b>} size="lg">
      <Stack gap="sm">
        <Group justify="space-between" align="center" gap="sm">
          <Text size="sm" c="dimmed">
            Analyze your repertoire, save the important positions, then train them here.
          </Text>
          <Button size="xs" leftSection={<IconSearch size="0.9rem" />} onClick={onAnalyze}>
            Analyze repertoire
          </Button>
        </Group>
        {loading ? (
          <Text c="dimmed">Loading review decks...</Text>
        ) : decks.length === 0 ? (
          <Paper p="md" withBorder>
            <Stack gap="xs" align="center">
              <IconTargetArrow size={36} style={{ opacity: 0.35 }} />
              <Text fw={600}>No review decks yet</Text>
              <Text size="sm" c="dimmed" ta="center">
                Run Analyze Repertoire, then save review positions when the scan finishes.
              </Text>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconSearch size="0.9rem" />}
                onClick={onAnalyze}
              >
                Analyze repertoire
              </Button>
            </Stack>
          </Paper>
        ) : (
          <Stack gap={4}>
            {decks.map((deck) => (
              <Group
                key={deck.path}
                px="sm"
                py="xs"
                className={classes.recentFileRow}
                wrap="nowrap"
                style={{ borderRadius: "var(--mantine-radius-sm)" }}
              >
                <UnstyledButton
                  onClick={() => onOpen(deck)}
                  style={{ flex: 1, minWidth: 0, textAlign: "left" }}
                >
                  <Stack gap={1} style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>
                      {deck.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {deck.source
                        ? `${deck.total} positions - ${deck.source}`
                        : `${deck.total} positions`}
                    </Text>
                  </Stack>
                </UnstyledButton>
                <Group gap="xs" wrap="nowrap">
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconEye size="0.9rem" />}
                    onClick={() => onPositions(deck)}
                  >
                    Positions
                  </Button>
                  <Button size="xs" variant="default" onClick={() => onOpen(deck)}>
                    Open
                  </Button>
                  {deck.autoUpdate?.enabled && (
                    <Badge color="blue" variant="light">
                      Auto
                    </Badge>
                  )}
                  {(deck.due > 0 || deck.unseen > 0) && (
                    <Badge color="orange" variant="light">
                      {deck.due + deck.unseen} due
                    </Badge>
                  )}
                  <Text size="xs" c="dimmed">
                    {dayjs(deck.updatedAt).fromNow()}
                  </Text>
                  <Tooltip label="Opening gap settings">
                    <ActionIcon
                      aria-label={`Settings for ${deck.name}`}
                      variant="subtle"
                      onClick={() => onSettings(deck)}
                    >
                      <IconSettings size="1rem" />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Delete review deck">
                    <ActionIcon
                      aria-label={`Delete ${deck.name}`}
                      variant="subtle"
                      color="red"
                      loading={deletingPath === deck.path}
                      onClick={() => onDelete(deck)}
                    >
                      <IconTrash size="1rem" />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

function OpeningReviewPositionPreviewBoard({
  position,
}: {
  position: Position;
}) {
  const orientation = getOpeningReviewMoveSide(position);

  return (
    <Tooltip label="Position preview" withArrow>
      <Box
        w={OPENING_REVIEW_PREVIEW_BOARD_SIZE}
        miw={OPENING_REVIEW_PREVIEW_BOARD_SIZE}
        style={{
          borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 0 0 1px var(--mantine-color-default-border)",
        }}
      >
        <Chessground
          coordinates={false}
          viewOnly
          fen={position.fen}
          orientation={orientation}
          turnColor={orientation}
        />
      </Box>
    </Tooltip>
  );
}

function OpeningReviewDeckPositionsModal({
  deckSummary,
  opened,
  onClose,
  onOpenDeck,
}: {
  deckSummary: OpeningReviewDeckSummary | null;
  opened: boolean;
  onClose: () => void;
  onOpenDeck: (
    deck: OpeningReviewDeckSummary,
    options?: {
      initialPractice?: { mode: "due" | "all"; indices: number[]; label?: string };
    },
  ) => void;
}) {
  const [deck, setDeck] = useState<OpeningReviewDeck | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colourFilter, setColourFilter] = useState<OpeningReviewColourFilter>("any");
  const [openingFilters, setOpeningFilters] = useState<string[]>([]);
  const [openingNamesByKey, setOpeningNamesByKey] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!opened || !deckSummary) return;

    let disposed = false;
    setLoading(true);
    setError(null);
    setDeck(null);
    setOpeningFilters([]);
    setOpeningNamesByKey({});

    readOpeningReviewDeck(deckSummary.path)
      .then((nextDeck) => {
        if (!disposed) setDeck(nextDeck);
      })
      .catch((loadError) => {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [deckSummary, opened]);

  useEffect(() => {
    if (!opened || !deck) return;

    let disposed = false;
    const missing = deck.positions.map((position) => ({
      key: getOpeningReviewOpeningCacheKey(position),
      position,
    }));

    async function loadOpeningNames() {
      for (let index = 0; index < missing.length; index += 12) {
        const chunk = missing.slice(index, index + 12);
        const resolved = await Promise.all(
          chunk.map(async ({ key, position }) => ({
            key,
            name: await resolveOpeningReviewOpeningName(position),
          })),
        );
        if (disposed) return;

        setOpeningNamesByKey((current) => {
          const next = { ...current };
          for (const { key, name } of resolved) {
            next[key] = name;
          }
          return next;
        });
      }
    }

    void loadOpeningNames();

    return () => {
      disposed = true;
    };
  }, [deck, opened]);

  const rows = useMemo(
    () => (deck ? buildOpeningReviewRows(deck.positions, openingNamesByKey) : []),
    [deck, openingNamesByKey],
  );
  const openingOptions = useMemo(
    () => getOpeningReviewOpeningOptions(rows, colourFilter),
    [colourFilter, rows],
  );
  const visibleRows = useMemo(
    () => filterOpeningReviewRows(rows, colourFilter, openingFilters),
    [colourFilter, openingFilters, rows],
  );
  const visibleIndices = useMemo(() => visibleRows.map((row) => row.index), [visibleRows]);
  const visibleDueCount = useMemo(() => {
    const now = new Date();
    return visibleRows.filter(({ position }) => new Date(position.card.due) <= now).length;
  }, [visibleRows]);
  const hasActivePositionFilter = openingFilters.length > 0 || colourFilter !== "any";
  const practiceLabel = getOpeningReviewPracticeLabel(openingFilters, colourFilter);

  useEffect(() => {
    const validValues = new Set(openingOptions.map((option) => option.value));
    setOpeningFilters((current) => {
      const next = current.filter((filter) => validValues.has(filter));
      return next.length === current.length ? current : next;
    });
  }, [openingOptions]);

  function openFocusedPractice(mode: "due" | "all") {
    if (!deckSummary || visibleIndices.length === 0) return;
    onOpenDeck(deckSummary, {
      initialPractice: {
        mode,
        indices: visibleIndices,
        label: practiceLabel,
      },
    });
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<b>{deckSummary ? `${deckSummary.name} positions` : "Review positions"}</b>}
      size="xl"
    >
      <Stack gap="sm">
        {loading ? (
          <Text c="dimmed">Loading positions...</Text>
        ) : error ? (
          <Alert color="red">{error}</Alert>
        ) : deck ? (
          <>
            <Group gap="xs" align="flex-end">
              <MultiSelect
                label="Openings"
                value={openingFilters}
                onChange={setOpeningFilters}
                data={openingOptions}
                searchable
                clearable
                placeholder="All openings"
                w={340}
                maxDropdownHeight={320}
              />
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Colour
                </Text>
                <SegmentedControl
                  value={colourFilter}
                  onChange={(value) => setColourFilter(value as OpeningReviewColourFilter)}
                  data={[
                    { value: "any", label: "All" },
                    { value: "white", label: "White" },
                    { value: "black", label: "Black" },
                  ]}
                />
              </Stack>
              <Button
                variant="light"
                leftSection={<IconTarget size={16} />}
                disabled={visibleDueCount === 0}
                onClick={() => openFocusedPractice("due")}
              >
                {hasActivePositionFilter ? "Review due matches" : "Review due"}
                <Badge variant="white" ml={6}>
                  {visibleDueCount}
                </Badge>
              </Button>
              <Button
                variant="default"
                leftSection={<IconBook size={16} />}
                disabled={visibleIndices.length === 0}
                onClick={() => openFocusedPractice("all")}
              >
                Review
                <Badge variant="light" ml={6}>
                  {visibleIndices.length}
                </Badge>
              </Button>
            </Group>
            <Group gap="xs">
              <Badge variant="light">{visibleRows.length} shown</Badge>
              {openingFilters.length > 0 && (
                <Badge variant="light">
                  Openings: {openingReviewFiltersDisplayName(openingFilters)}
                </Badge>
              )}
              {colourFilter !== "any" && (
                <Badge variant="light">{colourFilter === "white" ? "White" : "Black"} side</Badge>
              )}
            </Group>
            <ScrollArea.Autosize mah={430}>
              <Table miw={1320}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Position</Table.Th>
                    <Table.Th>Opening</Table.Th>
                    <Table.Th>Correct move</Table.Th>
                    <Table.Th>Last played</Table.Th>
                    <Table.Th>Why</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visibleRows.slice(0, 200).map(({ position, index, opening }) => {
                    const due = new Date(position.card.due);
                    const status =
                      position.card.reps === 0
                        ? "Unseen"
                        : due <= new Date()
                          ? "Due"
                          : "Scheduled";
                    const colour = getOpeningReviewMoveSide(position);
                    const moveSequence = getOpeningReviewMoveSequenceLabel(position);
                    const openingDetail =
                      opening.variation ??
                      (opening.rawName !== opening.family ? opening.rawName : null);

                    return (
                      <Table.Tr key={`${position.reviewKey ?? position.fen}-${index}`}>
                        <Table.Td>
                          <OpeningReviewPositionPreviewBoard position={position} />
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm" fw={600} lineClamp={2}>
                              {opening.family}
                            </Text>
                            {openingDetail && (
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                {openingDetail}
                              </Text>
                            )}
                            <Badge
                              size="xs"
                              variant="light"
                              color={colour === "white" ? "gray" : "dark"}
                              w="fit-content"
                            >
                              {colour === "white" ? "White" : "Black"} side
                            </Badge>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Text fw={700}>{position.answer}</Text>
                          {moveSequence && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {moveSequence}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" lineClamp={2}>
                            {position.openingHealth?.lastPlayed || "Unknown"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" lineClamp={2}>
                            {position.reason || position.evidence || "Saved for review"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light">{status}</Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={6}>
                        <Text c="dimmed" ta="center" py="md">
                          No review positions match those filters.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            {visibleRows.length > 200 && (
              <Text size="xs" c="dimmed">
                Showing the first 200 matching positions. Use the opening and colour filters to
                narrow the list before reviewing.
              </Text>
            )}
          </>
        ) : (
          <Text c="dimmed">Choose a deck to view positions.</Text>
        )}
      </Stack>
    </Modal>
  );
}

type OpeningReviewSettingsDatabase = {
  database: SuccessDatabaseInfo;
  record: NonNullable<ReturnType<typeof getOnlineDatabaseUpdateRecord>>;
};

function OpeningReviewSettingsModal({
  deck,
  opened,
  onClose,
  onSaved,
}: {
  deck: OpeningReviewDeckSummary | null;
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [onlineDatabaseUpdates, setOnlineDatabaseUpdates] = useAtom(onlineDatabaseUpdatesAtom);
  const [loadedDeck, setLoadedDeck] = useState<OpeningReviewDeck | null>(null);
  const [databases, setDatabases] = useState<SuccessDatabaseInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [playerDb, setPlayerDb] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [referenceDb, setReferenceDb] = useState<string | null>(null);
  const [maxPlies, setMaxPlies] = useState(30);
  const [minPlayerGames, setMinPlayerGames] = useState(3);
  const [minReferenceGames, setMinReferenceGames] = useState(20);
  const [maxPositions, setMaxPositions] = useState(0);
  const [keepDatabaseUpdated, setKeepDatabaseUpdated] = useState(true);
  const [playerOptions, setPlayerOptions] = useState<{ value: string; label: string }[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);

  const onlineDatabases = useMemo(
    () =>
      databases
        .map((database) => {
          const record = getOnlineDatabaseUpdateRecord(database, onlineDatabaseUpdates);
          return record ? { database, record } : null;
        })
        .filter((item): item is OpeningReviewSettingsDatabase => Boolean(item)),
    [databases, onlineDatabaseUpdates],
  );
  const selectedOnlineDatabase = onlineDatabases.find((item) => item.database.file === playerDb);
  const databaseOptions = onlineDatabases.map(({ database, record }) => ({
    value: database.file,
    label: `${database.title || database.filename} (${getOnlineGameSourceLabel(record.source)})`,
  }));
  const referenceOptions = databases.map((database) => ({
    value: database.file,
    label: database.title || database.filename,
  }));

  useEffect(() => {
    if (!opened || !deck) return;

    let disposed = false;
    setLoading(true);
    setLoadedDeck(null);
    setPlayerOptions([]);

    Promise.all([readOpeningReviewDeck(deck.path), getDatabases()])
      .then(([nextDeck, databaseInfo]) => {
        if (disposed) return;
        const successDatabases = databaseInfo.filter(
          (database): database is SuccessDatabaseInfo => database.type === "success",
        );
        const onlineRows = successDatabases
          .map((database) => {
            const record = getOnlineDatabaseUpdateRecord(database, onlineDatabaseUpdates);
            return record ? { database, record } : null;
          })
          .filter((item): item is OpeningReviewSettingsDatabase => Boolean(item));
        const config = nextDeck.autoUpdate;
        const defaultPlayerDb =
          config?.playerDb ??
          onlineRows.find((item) => item.database.title === nextDeck.source)?.database.file ??
          onlineRows.find((item) => item.record.title === nextDeck.source)?.database.file ??
          onlineRows[0]?.database.file ??
          null;
        const defaultReferenceDb =
          config?.referenceDb ??
          successDatabases.find((database) => database.file !== defaultPlayerDb)?.file ??
          successDatabases[0]?.file ??
          null;
        const selectedRecord = onlineRows.find((item) => item.database.file === defaultPlayerDb)
          ?.record;

        setLoadedDeck(nextDeck);
        setDatabases(successDatabases);
        setEnabled(config?.enabled ?? true);
        setPlayerDb(defaultPlayerDb);
        setPlayerId(
          config?.playerDb === defaultPlayerDb && config.playerId ? String(config.playerId) : null,
        );
        setReferenceDb(defaultReferenceDb);
        setMaxPlies(config?.maxPlies ?? 30);
        setMinPlayerGames(config?.minPlayerGames ?? 3);
        setMinReferenceGames(config?.minReferenceGames ?? 20);
        setMaxPositions(config?.maxPositions ?? config?.limit ?? 0);
        setKeepDatabaseUpdated(selectedRecord?.autoUpdate ?? true);
      })
      .catch((error) => {
        notifications.show({
          title: "Could not open Opening Review settings",
          message: error instanceof Error ? error.message : String(error),
          color: "red",
        });
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [deck, opened, onlineDatabaseUpdates]);

  useEffect(() => {
    if (!opened || !playerDb || !selectedOnlineDatabase) {
      setPlayerOptions([]);
      setPlayerId(null);
      return;
    }

    let disposed = false;
    const searchName =
      (loadedDeck?.autoUpdate?.playerDb === playerDb ? loadedDeck.autoUpdate.playerName : null) ||
      selectedOnlineDatabase.record.username ||
      getOpeningReviewPlayerSearchSeed(selectedOnlineDatabase.database);
    setPlayersLoading(true);

    query_players(playerDb, {
      name: searchName,
      range: null,
      options: {
        skipCount: true,
        page: 1,
        pageSize: 50,
        sort: "name",
        direction: "asc",
      },
    })
      .then((players) => {
        if (disposed) return;
        const options = players.data
          .filter((player) => player.name)
          .map((player) => ({
            value: String(player.id),
            label: player.name!,
          }));
        const normalizedSearch = normalizeOpeningReviewPlayerName(searchName);
        const exact = options.find(
          (option) => normalizeOpeningReviewPlayerName(option.label) === normalizedSearch,
        );

        setPlayerOptions(options);
        setPlayerId((current) => {
          if (current && options.some((option) => option.value === current)) return current;
          return exact?.value ?? (options.length === 1 ? options[0]!.value : null);
        });
      })
      .catch(() => {
        if (!disposed) {
          setPlayerOptions([]);
          setPlayerId(null);
        }
      })
      .finally(() => {
        if (!disposed) setPlayersLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [
    loadedDeck?.autoUpdate?.playerDb,
    loadedDeck?.autoUpdate?.playerName,
    opened,
    playerDb,
    selectedOnlineDatabase,
  ]);

  const saveSettings = async () => {
    if (!deck || !loadedDeck) return;

    const selectedPlayer = playerOptions.find((option) => option.value === playerId);
    if (enabled && (!selectedOnlineDatabase || !referenceDb || !playerId || !selectedPlayer)) {
      notifications.show({
        title: "Choose opening gap settings",
        message: "Select your online games database, player, and strong-games source.",
        color: "yellow",
      });
      return;
    }

    setSaving(true);
    try {
      const previousConfig = loadedDeck.autoUpdate;
      const now = Date.now();
      const nextAutoUpdate: OpeningReviewAutoUpdateConfig | undefined = enabled
        ? {
            enabled: true,
            playerDb: playerDb!,
            playerId: Number(playerId),
            playerName: selectedPlayer!.label,
            referenceDb: referenceDb!,
            mode: loadedDeck.mode ?? "self",
            color: "any",
            maxPlies,
            minPlayerGames,
            minReferenceGames,
            topReferenceMoves: previousConfig?.topReferenceMoves ?? 3,
            dateRange: previousConfig?.dateRange ?? "all",
            startDate: previousConfig?.startDate ?? null,
            endDate: previousConfig?.endDate ?? null,
            maxPositions,
            createdAt: previousConfig?.createdAt ?? now,
            updatedAt: now,
            lastRunAt: previousConfig?.lastRunAt ?? null,
            lastUpdatedDatabaseAt:
              previousConfig?.playerDb === playerDb
                ? (previousConfig.lastUpdatedDatabaseAt ?? selectedOnlineDatabase!.record.lastUpdatedAt)
                : selectedOnlineDatabase!.record.lastUpdatedAt,
            lastKnownGameCount:
              previousConfig?.playerDb === playerDb
                ? (previousConfig.lastKnownGameCount ??
                  selectedOnlineDatabase!.record.lastKnownGameCount)
                : selectedOnlineDatabase!.record.lastKnownGameCount,
            lastAdded: previousConfig?.lastAdded ?? null,
            lastError: null,
          }
        : previousConfig
          ? {
              ...previousConfig,
              enabled: false,
              updatedAt: now,
              lastError: null,
            }
          : undefined;

      await writeOpeningReviewDeck(deck.path, {
        ...loadedDeck,
        autoUpdate: nextAutoUpdate,
      });

      if (enabled && selectedOnlineDatabase) {
        setOnlineDatabaseUpdates((records) =>
          upsertOnlineDatabaseUpdateRecord(records, {
            ...selectedOnlineDatabase.record,
            autoUpdate: keepDatabaseUpdated,
            title: selectedOnlineDatabase.database.title,
            description: selectedOnlineDatabase.database.description,
            lastKnownGameCount:
              selectedOnlineDatabase.record.lastKnownGameCount ??
              selectedOnlineDatabase.database.game_count,
          }),
        );
      }

      notifications.show({
        title: "Opening gap settings saved",
        message: enabled
          ? "New online games will trigger an Opening Review gap scan for this deck."
          : "Automatic Opening Review updates are disabled for this deck.",
        color: "green",
      });
      onSaved();
      onClose();
    } catch (error) {
      notifications.show({
        title: "Could not save Opening Review settings",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<b>Opening gap settings</b>} size="lg">
      {loading ? (
        <Group gap="xs">
          <Text c="dimmed">Loading settings...</Text>
        </Group>
      ) : (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Link this deck to a self-updating online games database. When new games are imported,
            Opening Review scans all games for the selected player, auto-detects your colour in
            each game, and adds new gaps to this deck.
          </Text>
          <Switch
            checked={enabled}
            onChange={(event) => setEnabled(event.currentTarget.checked)}
            label="Automatically add new opening gaps"
          />
          <Select
            label="My online games database"
            data={databaseOptions}
            value={playerDb}
            onChange={(value) => {
              setPlayerDb(value);
              setPlayerId(null);
              const record = onlineDatabases.find((item) => item.database.file === value)?.record;
              setKeepDatabaseUpdated(record?.autoUpdate ?? true);
            }}
            placeholder="Choose a Chess.com or Lichess database"
            searchable
            allowDeselect={false}
            disabled={!enabled}
          />
          <Switch
            checked={keepDatabaseUpdated}
            onChange={(event) => setKeepDatabaseUpdated(event.currentTarget.checked)}
            label="Keep this games database self-updating"
            disabled={!enabled || !playerDb}
          />
          <Select
            label="Player"
            data={playerOptions}
            value={playerId}
            onChange={setPlayerId}
            placeholder={playersLoading ? "Loading players..." : "Choose player"}
            searchable
            allowDeselect={false}
            disabled={!enabled || !playerDb}
          />
          <Select
            label="Strong-games source"
            data={referenceOptions}
            value={referenceDb}
            onChange={setReferenceDb}
            searchable
            allowDeselect={false}
            disabled={!enabled}
          />
          <NumberInput
            label="Opening ply"
            value={maxPlies}
            min={2}
            max={80}
            onChange={(value) => setMaxPlies(Math.min(80, Math.max(2, Number(value) || 2)))}
            disabled={!enabled}
          />
          <Group grow>
            <NumberInput
              label="Minimum my games"
              value={minPlayerGames}
              min={1}
              onChange={(value) => setMinPlayerGames(Math.max(1, Number(value) || 1))}
              disabled={!enabled}
            />
            <NumberInput
              label="Minimum strong games"
              value={minReferenceGames}
              min={1}
              onChange={(value) => setMinReferenceGames(Math.max(1, Number(value) || 1))}
              disabled={!enabled}
            />
            <NumberInput
              label="Maximum deck positions"
              description="0 keeps every detected gap"
              value={maxPositions}
              min={0}
              max={5000}
              onChange={(value) => setMaxPositions(Math.max(0, Math.round(Number(value) || 0)))}
              disabled={!enabled}
            />
          </Group>
          {enabled && databaseOptions.length === 0 && (
            <Alert color="yellow" variant="light">
              Import a Chess.com or Lichess games database first, then turn on its database
              auto-update.
            </Alert>
          )}
          {enabled && playerDb && playerOptions.length === 0 && !playersLoading && (
            <Alert color="yellow" variant="light">
              No matching player was found in that database. Make sure this database contains your
              Chess.com account games.
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={saving} onClick={saveSettings}>
              Save settings
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function getMistakeReviewLastAddedText(deck: MistakeReviewDeckSummary) {
  if (!deck.lastAddedAt || !deck.lastAddedCount) return null;

  const addedAt = dayjs(deck.lastAddedAt);
  if (!addedAt.isValid()) return null;

  const mistakeLabel = deck.lastAddedCount === 1 ? "new mistake" : "new mistakes";
  return `${deck.lastAddedCount} ${mistakeLabel}, added on ${addedAt.format("MMM D, YYYY")}`;
}

function MistakeReviewModal({
  opened,
  decks,
  loading,
  deletingPath,
  onClose,
  onOpen,
  onDelete,
  onNewScan,
}: {
  opened: boolean;
  decks: MistakeReviewDeckSummary[];
  loading: boolean;
  deletingPath: string | null;
  onClose: () => void;
  onOpen: (deck: MistakeReviewDeckSummary) => void;
  onDelete: (deck: MistakeReviewDeckSummary) => void;
  onNewScan: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={<b>Mistake Review</b>} size="lg">
      <Stack gap="sm">
        <Group justify="space-between" align="center" gap="sm">
          <Text size="sm" c="dimmed">
            Scan your own games, create Stockfish-backed mistake cards, and review them daily.
          </Text>
          <Button size="xs" leftSection={<IconSearch size="0.9rem" />} onClick={onNewScan}>
            New scan
          </Button>
        </Group>
        {loading ? (
          <Text c="dimmed">Loading mistake decks...</Text>
        ) : decks.length === 0 ? (
          <Paper p="md" withBorder>
            <Stack gap="xs" align="center">
              <IconExclamationCircle size={36} style={{ opacity: 0.35 }} />
              <Text fw={600}>No mistake decks yet</Text>
              <Text size="sm" c="dimmed" ta="center">
                Start a scan from one of your local games databases.
              </Text>
              <Button size="xs" variant="light" onClick={onNewScan}>
                Scan mistakes
              </Button>
            </Stack>
          </Paper>
        ) : (
          <Stack gap="xs">
            {decks.map((deck) => {
              const lastAddedText = getMistakeReviewLastAddedText(deck);

              return (
                <Group key={deck.path} justify="space-between" p="xs" wrap="nowrap">
                  <Stack gap={2} miw={0}>
                    <Text fw={600} truncate>
                      {deck.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {deck.total} cards, {deck.due} due, {deck.unseen} new
                      {deck.playerName ? ` - ${deck.playerName}` : ""}
                    </Text>
                    {lastAddedText && (
                      <Text size="xs" c="dimmed" truncate>
                        {lastAddedText}
                      </Text>
                    )}
                  </Stack>
                  <Group gap="xs" wrap="nowrap">
                    <Button size="xs" variant="light" onClick={() => onOpen(deck)}>
                      Open
                    </Button>
                    <Tooltip label="Delete deck">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        loading={deletingPath === deck.path}
                        onClick={() => onDelete(deck)}
                      >
                        <IconTrash size="1rem" />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

function MistakeReviewScanModal({
  opened,
  documentDir,
  engines,
  onClose,
  onCreated,
}: {
  opened: boolean;
  documentDir: string;
  engines: LocalEngine[];
  onClose: () => void;
  onCreated: (deck: { path: string; name: string }, options?: { open?: boolean }) => void;
}) {
  const [databases, setDatabases] = useState<SuccessDatabaseInfo[]>([]);
  const [database, setDatabase] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerOptions, setPlayerOptions] = useState<{ value: string; label: string }[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [enginePath, setEnginePath] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<MistakeReviewSettings["analysisMode"]>("single");
  const [fastDepth, setFastDepth] = useState(12);
  const [deepDepth, setDeepDepth] = useState(17);
  const [multiPv, setMultiPv] = useState(3);
  const [timeControls, setTimeControls] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<MistakeReviewSettings["dateRange"]>("all");
  const [inaccuracy, setInaccuracy] = useState(DEFAULT_MISTAKE_REVIEW_THRESHOLDS.inaccuracy);
  const [mistake, setMistake] = useState(DEFAULT_MISTAKE_REVIEW_THRESHOLDS.mistake);
  const [blunder, setBlunder] = useState(DEFAULT_MISTAKE_REVIEW_THRESHOLDS.blunder);
  const [minWinProbabilityDrop, setMinWinProbabilityDrop] = useState(5);
  const [includeInaccuracies, setIncludeInaccuracies] = useState(true);
  const [includeMistakes, setIncludeMistakes] = useState(true);
  const [includeBlunders, setIncludeBlunders] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [pendingPartialDeck, setPendingPartialDeck] = useState<{
    name: string;
    path: string;
    settings: MistakeReviewSettings;
    positions: ReturnType<typeof createMistakeReviewPosition>[];
    gamesScanned: number;
    positionsAnalyzed: number;
    candidateMoves: number;
  } | null>(null);
  const [savingPartialDeck, setSavingPartialDeck] = useState(false);
  const [onlineDatabaseUpdates, setOnlineDatabaseUpdates] = useAtom(onlineDatabaseUpdatesAtom);
  const setMistakeScanProgress = useSetAtom(mistakeReviewScanProgressAtom);

  const engineOptions = engines.map((engine) => ({
    value: engine.path,
    label: engine.version ? `${engine.name} ${engine.version}` : engine.name,
  }));
  const databaseOptions = databases.map((item) => ({
    value: item.file,
    label: item.title || item.filename,
  }));
  const selectedDatabase = databases.find((item) => item.file === database);
  const selectedOnlineRecord = selectedDatabase
    ? getOnlineDatabaseUpdateRecord(selectedDatabase, onlineDatabaseUpdates)
    : null;

  useEffect(() => {
    if (!opened) return;

    let disposed = false;
    getDatabases().then((databaseInfo) => {
      if (disposed) return;
      const successDatabases = databaseInfo.filter(
        (item): item is SuccessDatabaseInfo => item.type === "success",
      );
      setDatabases(successDatabases);
      setDatabase((current) => current ?? successDatabases[0]?.file ?? null);
    });
    setEnginePath((current) => current ?? engines[0]?.path ?? null);

    return () => {
      disposed = true;
    };
  }, [engines, opened]);

  useEffect(() => {
    if (!opened || !database) {
      setPlayerOptions([]);
      setPlayerId(null);
      return;
    }

    let disposed = false;
    setPlayersLoading(true);
    query_players(database, {
      name: getOpeningReviewPlayerSearchSeed(selectedDatabase),
      range: null,
      options: {
        skipCount: true,
        page: 1,
        pageSize: 50,
        sort: "name",
        direction: "asc",
      },
    })
      .then((players) => {
        if (disposed) return;
        const options = players.data
          .filter((player) => player.name)
          .map((player) => ({ value: String(player.id), label: player.name! }));
        setPlayerOptions(options);
        setPlayerId((current) =>
          current && options.some((option) => option.value === current)
            ? current
            : options[0]?.value ?? null,
        );
      })
      .finally(() => {
        if (!disposed) setPlayersLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [database, opened, selectedDatabase]);

  async function savePendingPartialDeck() {
    if (!pendingPartialDeck) return;

    setSavingPartialDeck(true);
    try {
      const deck = createMistakeReviewDeck({
        name: pendingPartialDeck.name,
        settings: pendingPartialDeck.settings,
        positions: pendingPartialDeck.positions,
      });
      await writeMistakeReviewDeck(pendingPartialDeck.path, deck);
      notifications.show({
        title: "Partial Mistake Review deck saved",
        message: `${pendingPartialDeck.positions.length} mistake card${
          pendingPartialDeck.positions.length === 1 ? "" : "s"
        } saved from the stopped scan.`,
        color: "green",
      });
      onCreated({ path: pendingPartialDeck.path, name: pendingPartialDeck.name }, { open: false });
      setPendingPartialDeck(null);
    } catch (error) {
      notifications.show({
        title: "Could not save partial mistake deck",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setSavingPartialDeck(false);
    }
  }

  async function startScan() {
    const selectedPlayer = playerOptions.find((option) => option.value === playerId);
    const selectedEngine = engines.find((engine) => engine.path === enginePath);
    if (!database || !selectedPlayer || !enginePath || !selectedEngine) {
      notifications.show({
        title: "Choose scan settings",
        message: "Select a database, player, and local Stockfish engine.",
        color: "yellow",
      });
      return;
    }

    const settings: MistakeReviewSettings = {
      playerDb: database,
      playerId: Number(selectedPlayer.value),
      playerName: selectedPlayer.label,
      enginePath,
      engineName: selectedEngine.version
        ? `${selectedEngine.name} ${selectedEngine.version}`
        : selectedEngine.name,
      analysisMode,
      fastDepth,
      deepDepth,
      multiPv,
      timeControls: timeControls as MistakeReviewSettings["timeControls"],
      dateRange,
      thresholds: { inaccuracy, mistake, blunder },
      includeSeverities: {
        ...DEFAULT_MISTAKE_REVIEW_SEVERITIES,
        inaccuracy: includeInaccuracies,
        mistake: includeMistakes,
        blunder: includeBlunders,
      },
      minWinProbabilityDrop,
    };
    const name = `Mistake Review - ${selectedPlayer.label}`;
    const path = await getAvailableMistakeReviewDeckPath(documentDir, name);
    const requestId = `mistake-review-${Date.now()}`;

    setPendingPartialDeck(null);
    setScanning(true);
    setMistakeScanProgress({
      requestId,
      running: true,
      progress: 0,
      deckName: name,
      phase: "Analyzing games",
      paused: false,
      gamesAnalyzed: 0,
      gamesTotal: 0,
      positionsAnalyzed: 0,
      candidateMoves: 0,
      mistakesFound: 0,
      stopping: false,
      error: null,
      startedAt: Date.now(),
      completedAt: null,
    });
    onClose();
    try {
      const report = unwrap(
        await commands.scanMistakeReview(
          mistakeReviewRequestFromSettings(settings, {
            requestId,
          }),
        ),
      );
      const wasStopped = report.stopped;
      const positions = report.mistakes.map((result) =>
        createMistakeReviewPosition(result, settings),
      );

      if (wasStopped) {
        setMistakeScanProgress((current) => ({
          ...current,
          requestId,
          running: false,
          progress: current.progress,
          phase: "Stopped",
          paused: false,
          stopping: false,
          gamesAnalyzed: report.gamesScanned,
          gamesTotal: current.gamesTotal || report.gamesScanned,
          positionsAnalyzed: report.positionsAnalyzed,
          candidateMoves: report.candidateMoves,
          mistakesFound: positions.length,
          completedAt: Date.now(),
        }));
        if (positions.length > 0) {
          setPendingPartialDeck({
            name,
            path,
            settings,
            positions,
            gamesScanned: report.gamesScanned,
            positionsAnalyzed: report.positionsAnalyzed,
            candidateMoves: report.candidateMoves,
          });
        }
        notifications.show({
          title: "Mistake scan stopped",
          message:
            positions.length === 0
              ? "No mistake cards had been found yet."
              : `${positions.length} mistake card${
                  positions.length === 1 ? "" : "s"
                } found so far. Save them from the prompt before starting another scan.`,
          color: "blue",
        });
        return;
      }

      const autoUpdateRecord = !wasStopped && autoUpdate ? selectedOnlineRecord : null;
      const deck = createMistakeReviewDeck({
        name,
        settings,
        positions,
        autoUpdate: autoUpdateRecord
          ? {
              ...settings,
              enabled: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastRunAt: Date.now(),
              lastUpdatedDatabaseAt: autoUpdateRecord.lastUpdatedAt,
              lastKnownGameCount:
                autoUpdateRecord.lastKnownGameCount ?? selectedDatabase?.game_count ?? null,
              lastAnalyzedGameId: report.lastAnalyzedGameId,
              lastAdded: positions.length,
              lastError: null,
            }
          : undefined,
      });
      await writeMistakeReviewDeck(path, deck);
      if (autoUpdateRecord && selectedDatabase) {
        setOnlineDatabaseUpdates((records) =>
          upsertOnlineDatabaseUpdateRecord(records, {
            ...autoUpdateRecord,
            autoUpdate: true,
            title: selectedDatabase.title,
            description: selectedDatabase.description,
            lastKnownGameCount:
              autoUpdateRecord.lastKnownGameCount ?? selectedDatabase.game_count ?? null,
          }),
        );
      }
      setMistakeScanProgress((current) => ({
        ...current,
        requestId,
        running: false,
        progress: 100,
        phase: "Done",
        paused: false,
        stopping: false,
        gamesAnalyzed: report.gamesScanned,
        gamesTotal: current.gamesTotal || report.gamesScanned,
        positionsAnalyzed: report.positionsAnalyzed,
        candidateMoves: report.candidateMoves,
        mistakesFound: positions.length,
        completedAt: Date.now(),
      }));
      notifications.show({
        title: wasStopped ? "Partial Mistake Review deck saved" : "Mistake Review deck created",
        message: `${positions.length} mistake card${positions.length === 1 ? "" : "s"} saved${
          wasStopped ? " from the stopped scan." : "."
        }`,
        color: "green",
      });
      onCreated({ path, name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stopped = message.toLowerCase().includes("analysis cancelled");
      setMistakeScanProgress((current) => ({
        ...current,
        requestId,
        running: false,
        phase: stopped ? "Stopped" : "Failed",
        paused: false,
        stopping: false,
        error: message,
        completedAt: Date.now(),
      }));
      notifications.show({
        title: stopped ? "Mistake scan stopped" : "Mistake scan failed",
        message,
        color: stopped ? "blue" : "red",
      });
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <Modal opened={opened} onClose={onClose} title={<b>New mistake scan</b>} size="lg">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Mistake Review analyzes only moves made by the selected player, with colour detected per
            game.
          </Text>
          <Select
            label="Games database"
            data={databaseOptions}
            value={database}
            onChange={setDatabase}
            searchable
            allowDeselect={false}
          />
          <Select
            label="Player"
            data={playerOptions}
            value={playerId}
            onChange={setPlayerId}
            placeholder={playersLoading ? "Loading players..." : "Choose your username"}
            searchable
            allowDeselect={false}
          />
          <Select
            label="Local Stockfish engine"
            data={engineOptions}
            value={enginePath}
            onChange={setEnginePath}
            searchable
            allowDeselect={false}
          />
          <SegmentedControl
            value={analysisMode}
            onChange={(value) => setAnalysisMode(value as MistakeReviewSettings["analysisMode"])}
            data={[
              { value: "single", label: "Single Stockfish pass" },
              { value: "layered", label: "Fast + deep confirmation" },
            ]}
          />
          <MultiSelect
            label="Time controls"
            description="Leave empty to include every time control"
            data={[
              { value: "bullet", label: "Bullet" },
              { value: "blitz", label: "Blitz" },
              { value: "rapid", label: "Rapid" },
              { value: "classical", label: "Classical" },
              { value: "correspondence", label: "Correspondence" },
              { value: "unknown", label: "Unknown" },
            ]}
            value={timeControls}
            onChange={setTimeControls}
            clearable
          />
          <Select
            label="Game date range"
            data={[
              { value: "all", label: "All games" },
              { value: "week", label: "Past week" },
              { value: "2weeks", label: "Past 2 weeks" },
              { value: "month", label: "Past month" },
              { value: "3months", label: "Past 3 months" },
              { value: "6months", label: "Past 6 months" },
              { value: "year", label: "Past year" },
            ]}
            value={dateRange}
            onChange={(value) => value && setDateRange(value as MistakeReviewSettings["dateRange"])}
            allowDeselect={false}
          />
          <Group grow>
            {analysisMode === "layered" && (
              <NumberInput
                label="Fast depth"
                value={fastDepth}
                min={1}
                onChange={(v) => setFastDepth(Number(v) || 12)}
              />
            )}
            <NumberInput
              label={analysisMode === "layered" ? "Deep depth" : "Analysis depth"}
              value={deepDepth}
              min={1}
              onChange={(v) => setDeepDepth(Number(v) || 17)}
            />
            <NumberInput
              label="MultiPV"
              value={multiPv}
              min={1}
              max={10}
              onChange={(v) => setMultiPv(Number(v) || 3)}
            />
          </Group>
          <Group grow>
            <NumberInput
              label="Inaccuracy cp"
              value={inaccuracy}
              min={1}
              onChange={(v) => setInaccuracy(Number(v) || 50)}
            />
            <NumberInput
              label="Mistake cp"
              value={mistake}
              min={1}
              onChange={(v) => setMistake(Number(v) || 100)}
            />
            <NumberInput
              label="Blunder cp"
              value={blunder}
              min={1}
              onChange={(v) => setBlunder(Number(v) || 200)}
            />
          </Group>
          <NumberInput
            label="Minimum win-probability drop"
            suffix="%"
            value={minWinProbabilityDrop}
            min={0}
            max={100}
            onChange={(v) => setMinWinProbabilityDrop(Number(v) || 0)}
          />
          <SimpleGrid cols={3}>
            <Switch
              label="Inaccuracies"
              checked={includeInaccuracies}
              onChange={(event) => setIncludeInaccuracies(event.currentTarget.checked)}
            />
            <Switch
              label="Mistakes"
              checked={includeMistakes}
              onChange={(event) => setIncludeMistakes(event.currentTarget.checked)}
            />
            <Switch
              label="Blunders"
              checked={includeBlunders}
              onChange={(event) => setIncludeBlunders(event.currentTarget.checked)}
            />
          </SimpleGrid>
          <Switch
            label="Self-update when this online database imports new games"
            checked={Boolean(selectedOnlineRecord) && autoUpdate}
            onChange={(event) => setAutoUpdate(event.currentTarget.checked)}
            disabled={!selectedOnlineRecord}
          />
          {engineOptions.length === 0 && (
            <Alert color="yellow">Add a local Stockfish engine in Settings before scanning.</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={scanning} onClick={startScan}>
              Scan mistakes
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={Boolean(pendingPartialDeck)}
        onClose={() => {
          if (!savingPartialDeck) setPendingPartialDeck(null);
        }}
        title={<b>Save stopped scan?</b>}
        size="md"
      >
        <Stack gap="sm">
          <Text size="sm">
            The scan was stopped after {pendingPartialDeck?.gamesScanned ?? 0} fully analyzed game
            {(pendingPartialDeck?.gamesScanned ?? 0) === 1 ? "" : "s"}.
          </Text>
          <Text size="sm" c="dimmed">
            {pendingPartialDeck?.positions.length ?? 0} mistake card
            {(pendingPartialDeck?.positions.length ?? 0) === 1 ? "" : "s"} found so far. Nothing has
            been saved yet.
          </Text>
          <Group gap="md">
            <Text size="xs" c="dimmed">
              Positions: {pendingPartialDeck?.positionsAnalyzed ?? 0}
            </Text>
            <Text size="xs" c="dimmed">
              Candidates: {pendingPartialDeck?.candidateMoves ?? 0}
            </Text>
          </Group>
          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="red"
              disabled={savingPartialDeck}
              onClick={() => setPendingPartialDeck(null)}
            >
              Discard
            </Button>
            <Button loading={savingPartialDeck} onClick={savePendingPartialDeck}>
              Save partial deck
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function getOpeningReviewPlayerSearchSeed(database: SuccessDatabaseInfo | null | undefined) {
  const rawName = database?.title || database?.filename || "";
  return rawName
    .replace(/\.db3$/i, "")
    .replace(/[_\s-]*(lichess|chess\.com|chesscom)$/i, "")
    .replace(/[_\s-]*(games|database)$/i, "")
    .trim();
}

function normalizeOpeningReviewPlayerName(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function LatestGameAccountsModal({
  opened,
  providers,
  selection,
  onSelectionChange,
  onClose,
  onOpenAccounts,
}: {
  opened: boolean;
  providers: OnlineGameProvider[];
  selection: LatestOnlineGameAccountSelection;
  onSelectionChange: (selection: LatestOnlineGameAccountSelection) => void;
  onClose: () => void;
  onOpenAccounts: () => void;
}) {
  const selectedCount = providers.filter(
    (provider) => selection[getOnlineGameProviderKey(provider)] !== false,
  ).length;

  function setProviderChecked(provider: OnlineGameProvider, checked: boolean) {
    onSelectionChange({
      ...selection,
      [getOnlineGameProviderKey(provider)]: checked,
    });
  }

  function useAllAccounts() {
    const nextSelection = { ...selection };
    for (const provider of providers) {
      nextSelection[getOnlineGameProviderKey(provider)] = true;
    }
    onSelectionChange(nextSelection);
  }

  return (
    <Modal opened={opened} onClose={onClose} title={<b>Latest game accounts</b>} size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Choose which linked accounts are searched when loading your latest online game.
        </Text>

        {providers.length === 0 ? (
          <Alert color="yellow" variant="light">
            Link a Chess.com or Lichess account before choosing accounts for this shortcut.
          </Alert>
        ) : (
          <Stack gap="xs">
            {providers.map((provider) => {
              const key = getOnlineGameProviderKey(provider);
              return (
                <Checkbox
                  key={key}
                  checked={selection[key] !== false}
                  onChange={(event) => setProviderChecked(provider, event.currentTarget.checked)}
                  label={
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" fw={600}>
                        {provider.username}
                      </Text>
                      <Badge
                        size="xs"
                        variant="light"
                        color={provider.source === "lichess" ? "gray" : "green"}
                      >
                        {provider.sourceLabel}
                      </Badge>
                    </Group>
                  }
                />
              );
            })}
          </Stack>
        )}

        {providers.length > 0 && selectedCount === 0 && (
          <Alert color="yellow" variant="light">
            Select at least one account to analyse your latest game.
          </Alert>
        )}

        <Group justify="space-between">
          <Button
            variant="subtle"
            size="xs"
            disabled={providers.length === 0}
            onClick={useAllAccounts}
          >
            Use all
          </Button>
          <Group gap="xs">
            {providers.length === 0 && (
              <Button variant="light" size="xs" onClick={onOpenAccounts}>
                Add account
              </Button>
            )}
            <Button variant="default" size="xs" onClick={onClose}>
              Done
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function NewTabHome() {
  const { t } = useTranslation();

  const [openModal, setOpenModal] = useState(false);
  const [openRepertoireModal, setOpenRepertoireModal] = useState(false);
  const [openReviewModal, setOpenReviewModal] = useState(false);
  const [openMistakeReviewModal, setOpenMistakeReviewModal] = useState(false);
  const [openMistakeScanModal, setOpenMistakeScanModal] = useState(false);
  const [openLatestGameSettingsModal, setOpenLatestGameSettingsModal] = useState(false);
  const [reviewDecks, setReviewDecks] = useState<OpeningReviewDeckSummary[]>([]);
  const [mistakeDecks, setMistakeDecks] = useState<MistakeReviewDeckSummary[]>([]);
  const [reviewDecksLoading, setReviewDecksLoading] = useState(false);
  const [mistakeDecksLoading, setMistakeDecksLoading] = useState(false);
  const [latestGameLoading, setLatestGameLoading] = useState(false);
  const [deletingReviewDeckPath, setDeletingReviewDeckPath] = useState<string | null>(null);
  const [deletingMistakeDeckPath, setDeletingMistakeDeckPath] = useState<string | null>(null);
  const [settingsReviewDeck, setSettingsReviewDeck] = useState<OpeningReviewDeckSummary | null>(
    null,
  );
  const [positionsReviewDeck, setPositionsReviewDeck] = useState<OpeningReviewDeckSummary | null>(
    null,
  );
  const [engines] = useAtom(enginesAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [latestGameAccountSelection, setLatestGameAccountSelection] = useAtom(
    latestOnlineGameAccountSelectionAtom,
  );
  const setActiveTab = useSetAtom(activeTabAtom);
  const sessions = useAtomValue(sessionsAtom);

  const [recentFiles, setRecentFiles] = useAtom(recentFilesAtom);
  const store = useStore();
  const navigate = useNavigate();
  const { documentDir } = useLoaderData({ from: "/home" });
  const localEngines = useMemo(
    () => (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local"),
    [engines],
  );
  const linkedOnlineProviders = useMemo(() => getLinkedOnlineGameProviders(sessions), [sessions]);
  const selectedOnlineProviders = useMemo(
    () => getSelectedOnlineGameProviders(sessions, latestGameAccountSelection),
    [latestGameAccountSelection, sessions],
  );

  const openBoardTab = useCallback(
    async ({
      name,
      type,
    }: {
      name: string;
      type: "analysis" | "play" | "puzzles";
    }) => {
      const tabId = await createTab({
        tab: {
          name,
          type,
        },
        setTabs,
        setActiveTab,
      });
      if (type === "analysis") {
        store.set(tabFamily(tabId), "analysis");
      }
      navigate({ to: "/" });
    },
    [navigate, setActiveTab, setTabs, store],
  );

  useEffect(() => {
    const checkFiles = async () => {
      const newRecentFiles = await Promise.all(
        recentFiles.map(async (file) => {
          const exists = await commands.fileExists(file.path);
          if (exists.status === "error" || !exists.data) {
            return null;
          }
          return file;
        }),
      );
      const filtered = newRecentFiles.filter((f) => f !== null) as RecentFile[];
      if (filtered.length !== recentFiles.length) {
        setRecentFiles(filtered);
      }
    };
    checkFiles();
  }, [recentFiles, recentFiles.length, setRecentFiles]);

  const refreshReviewDecks = useCallback(async () => {
    setReviewDecksLoading(true);
    try {
      setReviewDecks(await listOpeningReviewDecks(documentDir));
    } finally {
      setReviewDecksLoading(false);
    }
  }, [documentDir]);

  const refreshMistakeDecks = useCallback(async () => {
    setMistakeDecksLoading(true);
    try {
      setMistakeDecks(await listMistakeReviewDecks(documentDir));
    } finally {
      setMistakeDecksLoading(false);
    }
  }, [documentDir]);

  useEffect(() => {
    if (!openReviewModal) return;

    let disposed = false;
    setReviewDecksLoading(true);
    listOpeningReviewDecks(documentDir)
      .then((decks) => {
        if (!disposed) setReviewDecks(decks);
      })
      .finally(() => {
        if (!disposed) setReviewDecksLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [documentDir, openReviewModal]);

  useEffect(() => {
    if (!openMistakeReviewModal) return;

    let disposed = false;
    setMistakeDecksLoading(true);
    listMistakeReviewDecks(documentDir)
      .then((decks) => {
        if (!disposed) setMistakeDecks(decks);
      })
      .finally(() => {
        if (!disposed) setMistakeDecksLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [documentDir, openMistakeReviewModal]);

  const openRecentFile = useCallback(
    async (file: RecentFile) => {
      const pgn = unwrap(await commands.readGames(file.path, 0, 0));
      const tabId = await createTab({
        tab: {
          name: file.name,
          type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: pgn[0] || "",
        gameOrigin: {
          kind: "file",
          gameNumber: 0,
          file: {
            type: "file",
            name: file.name,
            path: file.path,
            numGames: 1,
            metadata: { type: file.type, tags: [] },
            lastModified: Math.floor(Date.now() / 1000),
          },
        },
      });
      if (file.type === "repertoire") {
        store.set(tabFamily(tabId), "practice");
      }
      store.set(addRecentFileAtom, {
        name: file.name,
        path: file.path,
        type: file.type,
      });
      navigate({ to: "/" });
    },
    [setTabs, setActiveTab, store, navigate],
  );

  const openReviewDeck = useCallback(
    async (
      deck: OpeningReviewDeckSummary,
      options?: {
        initialPractice?: { mode: "due" | "all"; indices: number[]; label?: string };
      },
    ) => {
      await createTab({
        tab: {
          name: deck.name,
          type: "opening-review",
        },
        setTabs,
        setActiveTab,
        gameOrigin: {
          kind: "opening_review",
          path: deck.path,
          name: deck.name,
          ...(options?.initialPractice ? { initialPractice: options.initialPractice } : {}),
        },
      });
      setOpenReviewModal(false);
      setPositionsReviewDeck(null);
      navigate({ to: "/" });
    },
    [navigate, setActiveTab, setTabs],
  );

  const openMistakeDeck = useCallback(
    async (deck: MistakeReviewDeckSummary) => {
      await createTab({
        tab: {
          name: deck.name,
          type: "mistake-review",
        },
        setTabs,
        setActiveTab,
        gameOrigin: {
          kind: "mistake_review",
          path: deck.path,
          name: deck.name,
        },
      });
      setOpenMistakeReviewModal(false);
      navigate({ to: "/" });
    },
    [navigate, setActiveTab, setTabs],
  );

  const openCreatedMistakeDeck = useCallback(
    async (deck: { path: string; name: string }, options?: { open?: boolean }) => {
      if (options?.open === false) {
        void refreshMistakeDecks();
        return;
      }
      await openMistakeDeck({
        ...deck,
        updatedAt: Date.now(),
        total: 0,
        due: 0,
        unseen: 0,
      });
      void refreshMistakeDecks();
    },
    [openMistakeDeck, refreshMistakeDecks],
  );

  const openAnalyzeRepertoire = useCallback(async () => {
    try {
      const name = "Analyze Repertoire";
      const path = await getAvailableOpeningReviewDeckPath(documentDir, name);
      const deck = createOpeningReviewDeck({
        name,
        positions: [],
        source: "Analyze Repertoire",
      });
      await writeOpeningReviewDeck(path, deck);

      await createTab({
        tab: {
          name,
          type: "opening-review",
        },
        setTabs,
        setActiveTab,
        gameOrigin: {
          kind: "opening_review",
          path,
          name,
          initialTab: "gaps",
        },
      });
      setOpenReviewModal(false);
      navigate({ to: "/" });
    } catch (error) {
      notifications.show({
        title: "Could not open Analyze Repertoire",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  }, [documentDir, navigate, setActiveTab, setTabs]);

  const openLatestOnlineGame = useCallback(async () => {
    if (latestGameLoading) return;

    if (linkedOnlineProviders.length === 0) {
      notifications.show({
        title: "Link an online account",
        message: "Add a Chess.com or Lichess account, then this will pull your newest game.",
        color: "yellow",
      });
      navigate({ to: "/accounts" });
      return;
    }

    if (selectedOnlineProviders.length === 0) {
      notifications.show({
        title: "Choose an account",
        message: "Select at least one linked account for the latest-game shortcut.",
        color: "yellow",
      });
      setOpenLatestGameSettingsModal(true);
      return;
    }

    setLatestGameLoading(true);
    try {
      const latestGame = await getLatestOnlineGame(sessions, latestGameAccountSelection);
      if (!latestGame) {
        notifications.show({
          title: "No recent games found",
          message: "None of the linked online accounts returned an importable game.",
          color: "yellow",
        });
        return;
      }

      const tree = await parsePGN(latestGame.pgn);
      const gameName = getGameName(tree.headers);
      const tabName =
        gameName && gameName !== "Unknown" ? gameName : `${latestGame.sourceLabel} latest game`;
      const tabId = await createTab({
        tab: {
          name: tabName,
          type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: latestGame.pgn,
        gameOrigin: {
          kind: "none",
        },
      });
      store.set(tabFamily(tabId), "analysis");
      navigate({ to: "/" });
      notifications.show({
        title: "Latest game loaded",
        message: `${latestGame.sourceLabel} ${latestGame.username}${
          latestGame.playedAt ? ` - ${dayjs(latestGame.playedAt).format("YYYY-MM-DD HH:mm")}` : ""
        }`,
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Could not load latest game",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setLatestGameLoading(false);
    }
  }, [
    latestGameLoading,
    latestGameAccountSelection,
    linkedOnlineProviders.length,
    navigate,
    selectedOnlineProviders.length,
    sessions,
    setActiveTab,
    setTabs,
    store,
  ]);

  const deleteReviewDeck = useCallback(async (deck: OpeningReviewDeckSummary) => {
    const confirmed = window.confirm(
      `Delete "${deck.name}"?\n\nThis removes the review deck file and cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingReviewDeckPath(deck.path);
    try {
      await deleteOpeningReviewDeck(deck.path);
      setReviewDecks((current) => current.filter((item) => item.path !== deck.path));
      notifications.show({
        title: "Review deck deleted",
        message: `${deck.name} was removed.`,
        color: "blue",
      });
    } catch (error) {
      notifications.show({
        title: "Could not delete review deck",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setDeletingReviewDeckPath(null);
    }
  }, []);

  const deleteMistakeDeck = useCallback(async (deck: MistakeReviewDeckSummary) => {
    const confirmed = window.confirm(
      `Delete "${deck.name}"?\n\nThis removes the mistake review deck file and cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingMistakeDeckPath(deck.path);
    try {
      await deleteMistakeReviewDeck(deck.path);
      setMistakeDecks((current) => current.filter((item) => item.path !== deck.path));
      notifications.show({
        title: "Mistake deck deleted",
        message: `${deck.name} was removed.`,
        color: "blue",
      });
    } catch (error) {
      notifications.show({
        title: "Could not delete mistake deck",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setDeletingMistakeDeckPath(null);
    }
  }, []);

  const latestGameDescription =
    linkedOnlineProviders.length === 0
      ? "Link Chess.com or Lichess, then fetch your newest game."
      : selectedOnlineProviders.length === 0
        ? "Choose which linked accounts this shortcut should search."
        : selectedOnlineProviders.length === linkedOnlineProviders.length
          ? "Pull the newest linked Chess.com or Lichess game into the analysis board."
          : `Search ${selectedOnlineProviders.length} of ${linkedOnlineProviders.length} linked accounts.`;

  const cards = [
    {
      icon: <IconChess size={60} />,
      title: t("Home.Card.PlayChess.Title"),
      description: t("Home.Card.PlayChess.Desc"),
      label: t("Home.Card.PlayChess.Button"),
      onClick: () => {
        void openBoardTab({
          name: t("Home.NewGame"),
          type: "play",
        });
      },
    },
    {
      icon: <Chessboard size={60} />,
      title: t("Home.Card.AnalysisBoard.Title"),
      description: t("Home.Card.AnalysisBoard.Desc"),
      label: t("Home.Card.AnalysisBoard.Button"),
      onClick: () => {
        void openBoardTab({
          name: t("Home.Card.AnalysisBoard.Title"),
          type: "analysis",
        });
      },
    },
    {
      icon: <IconCloudDownload size={60} />,
      title: "Analyse your last game",
      description: latestGameDescription,
      label:
        linkedOnlineProviders.length === 0
          ? "Link account"
          : selectedOnlineProviders.length === 0
            ? "Choose account"
            : "Analyse latest",
      loading: latestGameLoading,
      onClick: openLatestOnlineGame,
      onSettings: () => setOpenLatestGameSettingsModal(true),
      settingsLabel: "Choose accounts",
    },
    {
      icon: <IconTargetArrow size={60} />,
      title: t("Home.Card.NewRepertoire.Title"),
      description: t("Home.Card.NewRepertoire.Desc"),
      label: t("Home.Card.NewRepertoire.Button"),
      onClick: () => {
        setOpenRepertoireModal(true);
      },
    },
    {
      icon: <IconTarget size={60} />,
      title: "Opening Review",
      description: "Analyze your repertoire and train saved positions with spaced repetition.",
      label: "Open",
      onClick: () => {
        setOpenReviewModal(true);
      },
    },
    {
      icon: <IconExclamationCircle size={60} />,
      title: "Mistake Review",
      description: "Scan your games for mistakes and train them with spaced repetition.",
      label: "Open",
      onClick: () => {
        setOpenMistakeReviewModal(true);
      },
    },
    {
      icon: <IconFileImport size={60} />,
      title: t("Home.Card.ImportGame.Title"),
      description: t("Home.Card.ImportGame.Desc"),
      label: t("Home.Card.ImportGame.Button"),
      onClick: () => {
        setOpenModal(true);
      },
    },
    {
      icon: <IconPuzzle size={60} />,
      title: t("Home.Card.Puzzle.Title"),
      description: t("Home.Card.Puzzle.Desc"),
      label: t("Home.Card.Puzzle.Button"),
      onClick: () => {
        void openBoardTab({
          name: t("Home.PuzzleTraining"),
          type: "puzzles",
        });
      },
    },
  ];

  return (
    <>
      <ImportModal
        openModal={openModal}
        setOpenModal={setOpenModal}
        setTabs={setTabs}
        setActiveTab={setActiveTab}
      />
      <CreateRepertoireModal opened={openRepertoireModal} setOpened={setOpenRepertoireModal} />
      <OpeningReviewModal
        opened={openReviewModal}
        decks={reviewDecks}
        loading={reviewDecksLoading}
        deletingPath={deletingReviewDeckPath}
        onClose={() => setOpenReviewModal(false)}
        onOpen={openReviewDeck}
        onPositions={setPositionsReviewDeck}
        onDelete={deleteReviewDeck}
        onSettings={setSettingsReviewDeck}
        onAnalyze={openAnalyzeRepertoire}
      />
      <OpeningReviewDeckPositionsModal
        opened={Boolean(positionsReviewDeck)}
        deckSummary={positionsReviewDeck}
        onClose={() => setPositionsReviewDeck(null)}
        onOpenDeck={openReviewDeck}
      />
      <OpeningReviewSettingsModal
        opened={Boolean(settingsReviewDeck)}
        deck={settingsReviewDeck}
        onClose={() => setSettingsReviewDeck(null)}
        onSaved={() => void refreshReviewDecks()}
      />
      <MistakeReviewModal
        opened={openMistakeReviewModal}
        decks={mistakeDecks}
        loading={mistakeDecksLoading}
        deletingPath={deletingMistakeDeckPath}
        onClose={() => setOpenMistakeReviewModal(false)}
        onOpen={openMistakeDeck}
        onDelete={deleteMistakeDeck}
        onNewScan={() => setOpenMistakeScanModal(true)}
      />
      <MistakeReviewScanModal
        opened={openMistakeScanModal}
        documentDir={documentDir}
        engines={localEngines}
        onClose={() => setOpenMistakeScanModal(false)}
        onCreated={openCreatedMistakeDeck}
      />
      <LatestGameAccountsModal
        opened={openLatestGameSettingsModal}
        providers={linkedOnlineProviders}
        selection={latestGameAccountSelection}
        onSelectionChange={setLatestGameAccountSelection}
        onClose={() => setOpenLatestGameSettingsModal(false)}
        onOpenAccounts={() => {
          setOpenLatestGameSettingsModal(false);
          navigate({ to: "/accounts" });
        }}
      />
      <Stack gap="lg" p="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {cards.map((card) => (
            <Card shadow="sm" p="lg" radius="md" withBorder key={card.title}>
              <Stack align="center" h="100%" justify="space-between">
                {card.icon}

                <Box style={{ textAlign: "center" }}>
                  <Text fw={500}>{card.title}</Text>
                  <Text size="sm" c="dimmed">
                    {card.description}
                  </Text>
                </Box>

                {card.onSettings ? (
                  <Group w="100%" mt="md" gap="xs" wrap="nowrap">
                    <Button
                      variant="light"
                      radius="md"
                      loading={card.loading}
                      onClick={card.onClick}
                      style={{ flex: 1 }}
                    >
                      {card.label}
                    </Button>
                    <Tooltip label={card.settingsLabel}>
                      <ActionIcon
                        aria-label={card.settingsLabel}
                        variant="light"
                        radius="md"
                        size={36}
                        onClick={card.onSettings}
                      >
                        <IconSettings size="1.1rem" />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ) : (
                  <Button
                    variant="light"
                    fullWidth
                    mt="md"
                    radius="md"
                    loading={card.loading}
                    onClick={card.onClick}
                  >
                    {card.label}
                  </Button>
                )}
              </Stack>
            </Card>
          ))}
        </SimpleGrid>

        <Card shadow="sm" p="md" radius="md" withBorder>
          <Text fw={600} size="lg" mb="xs">
            {t("Home.RecentFiles.Title")}
          </Text>
          {recentFiles.length === 0 ? (
            <Stack align="center" justify="center" h={200} gap="xs">
              <IconClock size={48} style={{ opacity: 0.3 }} />
              <Text c="dimmed">{t("Home.RecentFiles.NoRecentFiles")}</Text>
            </Stack>
          ) : (
            <ScrollArea.Autosize mah={300}>
              <Stack gap={2}>
                {recentFiles.map((file) => (
                  <RecentFileRow key={file.path} file={file} onOpen={openRecentFile} />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Card>
      </Stack>
    </>
  );
}
