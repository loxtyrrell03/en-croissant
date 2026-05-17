import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Divider,
  Group,
  Input,
  InputWrapper,
  Loader,
  Modal,
  Paper,
  Rating,
  RingProgress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue, useElementSize, useToggle } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowRight,
  IconDatabase,
  IconFileExport,
  IconFolderDown,
  IconPlus,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { basename, resolve } from "@tauri-apps/api/path";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue } from "jotai";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import type { DatabaseInfo } from "@/bindings";
import { commands } from "@/bindings";
import {
  type DatabaseConversionState,
  databaseConversionStateAtom,
  type LichessStudyDatabaseUpdateRecord,
  type LichessStudyDatabaseUpdateRecords,
  lichessStudyDatabaseUpdatesAtom,
  type OnlineDatabaseUpdateAccount,
  type OnlineDatabaseUpdateRecord,
  type OnlineDatabaseUpdateRecords,
  onlineDatabaseUpdatesAtom,
  referenceDbAtom,
  sessionsAtom,
  storedDatabasesDirAtom,
  storedDocumentDirAtom,
} from "@/state/atoms";
import { useActiveDatabaseViewStore } from "@/state/store/database";
import {
  getDefaultDatabaseFolderName,
  getGameFileCountText,
  splitGameSourceToFiles,
  validateDatabaseFilesFolderName,
} from "@/utils/databaseFileExport";
import { getDatabases, query_games, type SuccessDatabaseInfo } from "@/utils/db";
import { getDocumentDir } from "@/utils/directories";
import { formatBytes, formatNumber } from "@/utils/format";
import { updateOnlineDatabaseNow } from "@/utils/onlineDatabaseAutoUpdate";
import { updateLichessStudyDatabaseNow } from "@/utils/lichessStudyDatabaseAutoUpdate";
import {
  getOnlineDatabaseUpdateAccounts,
  getOnlineDatabaseUpdateLabel,
  getOnlineDatabaseUpdateRecord,
  getOnlineGameSourceLabel,
  importOnlineGameAccountsToDatabase,
  type OnlineGameAccount,
  type OnlineGameSource,
  upsertOnlineDatabaseUpdateRecord,
} from "@/utils/onlineGameImport";
import {
  getLichessStudyDatabaseUpdateLabel,
  getLichessStudyDatabaseUpdateRecord,
  upsertLichessStudyDatabaseUpdateRecord,
} from "@/utils/lichess/study";
import { createRepertoireDatabaseFromGameBatches } from "@/utils/repertoireCopy";
import type { Session } from "@/utils/session";
import { unwrap } from "@/utils/unwrap";
import ConfirmModal from "../common/ConfirmModal";
import GenericCard from "../common/GenericCard";
import OpenFolderButton from "../common/OpenFolderButton";
import { getPanelDensity, ResponsivePanel } from "../common/ResponsivePanel";
import AddDatabase from "./AddDatabase";
import { PlayerSearchInput } from "./PlayerSearchInput";

const REPERTOIRE_COPY_PAGE_SIZE = 500;

function resetDatabaseConversionStateFields() {
  return {
    inProgress: false,
    phase: null,
    progress: null,
    progressId: null,
    sourceKind: null,
    startedAt: null,
    updatedAt: Date.now(),
    totalGames: 0,
    totalGamesExpected: null,
    elapsedSeconds: 0,
    targetDatabasePath: null,
    targetDatabaseTitle: null,
    sourceFileName: null,
  };
}

export default function DatabasesPage() {
  const { t } = useTranslation();

  const { data: databases, isLoading, mutate } = useSWR("databases", () => getDatabases());

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [referenceDatabase, setReferenceDatabase] = useAtom(referenceDbAtom);
  const [conversionState, setConversionState] = useAtom(databaseConversionStateAtom);
  const [onlineDatabaseUpdates, setOnlineDatabaseUpdates] = useAtom(onlineDatabaseUpdatesAtom);
  const [lichessStudyDatabaseUpdates, setLichessStudyDatabaseUpdates] = useAtom(
    lichessStudyDatabaseUpdatesAtom,
  );
  const sessions = useAtomValue(sessionsAtom);
  const [updatingOnlineDatabasePath, setUpdatingOnlineDatabasePath] = useState<string | null>(null);
  const selectedDatabase = useMemo(
    () => (databases ?? []).find((db) => db.file === selected) ?? null,
    [databases, selected],
  );
  const selectedOnlineRecord = useMemo(
    () =>
      selectedDatabase?.type === "success"
        ? getOnlineDatabaseUpdateRecord(selectedDatabase, onlineDatabaseUpdates)
        : null,
    [onlineDatabaseUpdates, selectedDatabase],
  );
  const selectedStudyRecord = useMemo(
    () =>
      selectedDatabase?.type === "success"
        ? getLichessStudyDatabaseUpdateRecord(selectedDatabase, lichessStudyDatabaseUpdates)
        : null,
    [lichessStudyDatabaseUpdates, selectedDatabase],
  );
  const filteredDatabases = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return databases ?? [];
    }

    return (databases ?? []).filter((item) => {
      const values = [
        item.filename,
        item.file,
        item.type === "success" ? item.title : item.error,
        item.type === "success" ? item.description : "",
      ];

      return values.some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [databases, search]);
  const showConversionPlaceholder =
    conversionState.inProgress &&
    !!conversionState.targetDatabasePath &&
    !!conversionState.targetDatabaseTitle &&
    !(databases ?? []).some((item) => item.file === conversionState.targetDatabasePath);
  const showFilteredConversionPlaceholder =
    showConversionPlaceholder &&
    (!search.trim() ||
      [
        conversionState.targetDatabaseTitle,
        conversionState.targetDatabasePath,
        conversionState.sourceFileName ?? "",
      ]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(search.trim().toLowerCase())));
  const hasSearch = search.trim().length > 0;
  const [databaseDir] = useAtom(storedDatabasesDirAtom);
  // const [, setStorageSelected] = useAtom(selectedDatabaseAtom);
  const setActiveDatabase = useActiveDatabaseViewStore((store) => store.setDatabase);

  const isReference = referenceDatabase === selectedDatabase?.file;

  const [deleteModal, toggleDeleteModal] = useToggle();
  const [exportLoading, setExportLoading] = useState(false);
  const [exportFilesOpened, setExportFilesOpened] = useState(false);
  const documentDir = useAtomValue(storedDocumentDirAtom);

  function changeReferenceDatabase(file: string) {
    commands.clearGames();
    if (file === referenceDatabase) {
      setReferenceDatabase(null);
    } else {
      setReferenceDatabase(file);
    }
  }

  async function updateOnlineDatabase(database: SuccessDatabaseInfo) {
    const record = getOnlineDatabaseUpdateRecord(database, onlineDatabaseUpdates);
    if (!record || updatingOnlineDatabasePath) return;

    setUpdatingOnlineDatabasePath(database.file);
    try {
      const result = await updateOnlineDatabaseNow({
        database,
        record,
        databaseDir,
        sessions,
        setConversionState,
        setUpdateRecords: setOnlineDatabaseUpdates,
        isConversionInProgress: () => conversionState.inProgress,
      });
      await mutate();

      if (result.updated) {
        notifications.show({
          title: "Online database updated",
          message:
            "Latest games were imported. Linked review decks will scan the new games automatically.",
          color: "green",
        });
      } else {
        notifications.show({
          title: "No new games",
          message: `${database.title} is already up to date.`,
          color: "blue",
        });
      }
    } catch (error) {
      notifications.show({
        title: "Could not update database",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setUpdatingOnlineDatabasePath(null);
    }
  }

  async function updateLichessStudyDatabase(
    database: SuccessDatabaseInfo,
    record: LichessStudyDatabaseUpdateRecord,
  ) {
    if (updatingOnlineDatabasePath) return;

    setUpdatingOnlineDatabasePath(database.file);
    try {
      const result = await updateLichessStudyDatabaseNow({
        database,
        record,
        databaseDir,
        token: getAnyLichessTokenFromSessions(sessions),
        setConversionState,
        setUpdateRecords: setLichessStudyDatabaseUpdates,
        isConversionInProgress: () => conversionState.inProgress,
      });
      await mutate();

      if (result.updated) {
        notifications.show({
          title: "Lichess study updated",
          message: `${database.title} was rebuilt from the latest study PGN.`,
          color: "green",
        });
      } else {
        notifications.show({
          title: "No study changes",
          message: `${database.title} is already up to date.`,
          color: "blue",
        });
      }
    } catch (error) {
      notifications.show({
        title: "Could not update Lichess study",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setUpdatingOnlineDatabasePath(null);
    }
  }

  const navigate = useNavigate();
  const { ref: pagePanelsRef, width: pagePanelsWidth } = useElementSize();
  const pageDensity = getPanelDensity(pagePanelsWidth);
  const compact = pageDensity !== "regular";
  const stackPanels = pagePanelsWidth > 0 && pagePanelsWidth < 920;
  const listColumns = pagePanelsWidth > 0 && pagePanelsWidth < 1280 ? 1 : 2;

  return (
    <Stack h="100%">
      <ConfirmModal
        title={t("Databases.Delete.Title")}
        description={t("Databases.Delete.Message")}
        opened={deleteModal}
        onClose={toggleDeleteModal}
        onConfirm={() => {
          if (!selectedDatabase) return;
          commands.deleteDatabase(selectedDatabase.file).then(() => {
            mutate();
            setSelected(null);
          });
          toggleDeleteModal();
        }}
      />

      <AddDatabase
        databases={databases ?? []}
        opened={open}
        setOpened={setOpen}
        setLoading={(next) => {
          const value = typeof next === "function" ? next(conversionState.inProgress) : next;
          setConversionState((prev) => ({
            ...prev,
            inProgress: value,
            ...(value ? {} : resetDatabaseConversionStateFields()),
          }));
        }}
        disableLocalConversion={conversionState.inProgress}
        setDatabases={mutate}
      />

      {selectedDatabase?.type === "success" && (
        <DatabaseFilesExportModal
          opened={exportFilesOpened}
          setOpened={setExportFilesOpened}
          selectedDatabase={selectedDatabase}
          documentDir={documentDir}
        />
      )}

      <Group align="baseline" pl="lg" py={compact ? 6 : "sm"}>
        <Title order={compact ? 2 : 1}>{t("Databases.Title")}</Title>
        <OpenFolderButton base="Database" folder={databaseDir} />
      </Group>

      <Box
        ref={pagePanelsRef}
        flex={1}
        px={compact ? 6 : "md"}
        pb={compact ? 6 : "md"}
        style={{
          display: "grid",
          gridTemplateColumns: stackPanels
            ? "minmax(0, 1fr)"
            : "minmax(0, 1fr) minmax(20rem, 0.8fr)",
          gridTemplateRows: stackPanels ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
          gap: compact ? 6 : "var(--mantine-spacing-md)",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <ResponsivePanel>
          <Paper withBorder style={{ borderWidth: 2 }} h="100%">
            <Stack gap={0} h="100%" style={{ overflow: "hidden" }}>
              <Group p="xs" gap="xs">
                <Input
                  size="sm"
                  style={{ flexGrow: 1 }}
                  leftSection={<IconSearch size="1rem" />}
                  placeholder={t("Common.Search")}
                  value={search}
                  onChange={(e) => setSearch(e.currentTarget.value)}
                />
                <Tooltip label={t("Common.AddNew")}>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    onClick={() => setOpen(true)}
                    disabled={conversionState.inProgress}
                  >
                    <IconPlus size="1rem" />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Divider />
              {conversionState.inProgress && (
                <>
                  <Group px="xs" py={6} gap="xs" justify="space-between">
                    <Group gap={6}>
                      <Loader size="xs" />
                      <Text size="sm">
                        {conversionState.sourceFileName || conversionState.targetDatabaseTitle
                          ? `${getConversionPhaseLabel(conversionState)}: ${conversionState.sourceFileName ?? conversionState.targetDatabaseTitle}`
                          : getConversionPhaseLabel(conversionState)}
                      </Text>
                    </Group>
                    {conversionState.totalGames > 0 && (
                      <Text size="xs" c="dimmed">
                        {conversionState.totalGames} games
                        {conversionState.elapsedSeconds > 0
                          ? ` • ${(conversionState.totalGames / conversionState.elapsedSeconds).toFixed(1)} games/s`
                          : ""}
                      </Text>
                    )}
                  </Group>
                  <Divider />
                </>
              )}
              <ScrollArea flex={1}>
                <SimpleGrid cols={listColumns} spacing={compact ? 6 : "sm"} p={compact ? 6 : "xs"}>
                  {showFilteredConversionPlaceholder && (
                    <DatabaseConversionCard conversionState={conversionState} />
                  )}
                  {isLoading && (
                    <>
                      <Skeleton h="8rem" />
                      <Skeleton h="8rem" />
                      <Skeleton h="8rem" />
                    </>
                  )}
                  {!isLoading &&
                    filteredDatabases?.map((item) => {
                      const onlineRecord =
                        item.type === "success"
                          ? getOnlineDatabaseUpdateRecord(item, onlineDatabaseUpdates)
                          : null;
                      const studyRecord =
                        item.type === "success"
                          ? getLichessStudyDatabaseUpdateRecord(item, lichessStudyDatabaseUpdates)
                          : null;
                      const onlineUpdating =
                        item.type === "success" && updatingOnlineDatabasePath === item.file;
                      const updateActionLabel =
                        item.type === "success" && studyRecord
                          ? `Reload ${getLichessStudyDatabaseUpdateLabel(studyRecord)}`
                          : item.type === "success" && onlineRecord
                            ? `Update ${getOnlineDatabaseUpdateLabel(onlineRecord)}`
                            : null;

                      return (
                        <GenericCard
                          id={item.file}
                          key={item.filename}
                          isSelected={selectedDatabase?.filename === item.filename}
                          setSelected={setSelected}
                          error={item.type === "error" ? item.error : ""}
                          onDoubleClick={() => {
                            if (item.type === "error") return;
                            navigate({
                              to: "/databases/$databaseId",
                              params: {
                                databaseId: item.title,
                              },
                            });
                            setActiveDatabase(item);
                            //setStorageSelected(item);
                          }}
                          Header={
                            <Group wrap="nowrap" justify="space-between">
                              <Group wrap="nowrap" miw={0}>
                                <IconDatabase size="1.5rem" />
                                <Box miw={0}>
                                  <Text fw={500} fz="sm">
                                    {item.type === "success" ? item.title : item.error}
                                  </Text>
                                  <Text size="xs" c="dimmed" style={{ wordWrap: "break-word" }}>
                                    {item.type === "error" ? item.file : item.description}
                                  </Text>
                                </Box>
                              </Group>
                              <Group gap={4} wrap="nowrap">
                                {item.type === "success" && updateActionLabel && (
                                  <Tooltip label={updateActionLabel}>
                                    <ActionIcon
                                      aria-label={updateActionLabel}
                                      variant="subtle"
                                      loading={onlineUpdating}
                                      disabled={
                                        conversionState.inProgress ||
                                        (!!updatingOnlineDatabasePath && !onlineUpdating)
                                      }
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (studyRecord) {
                                          void updateLichessStudyDatabase(item, studyRecord);
                                        } else if (onlineRecord) {
                                          void updateOnlineDatabase(item);
                                        }
                                      }}
                                    >
                                      <IconRefresh size="1rem" />
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                                <Rating
                                  value={referenceDatabase === item.file ? 1 : 0}
                                  count={1}
                                  onChange={() => {
                                    changeReferenceDatabase(item.file);
                                  }}
                                />
                              </Group>
                            </Group>
                          }
                          stats={[
                            {
                              label: t("Databases.Card.Games"),
                              value:
                                item.type === "success" ? formatNumber(item.game_count) : "???",
                            },
                            {
                              label: t("Databases.Card.Storage"),
                              value:
                                item.type === "success"
                                  ? formatBytes(item.storage_size ?? 0)
                                  : "???",
                            },
                          ]}
                        />
                      );
                    })}
                </SimpleGrid>
              </ScrollArea>
              {!isLoading && filteredDatabases.length === 0 && (
                <Center h="100%">
                  <Stack align="center" gap="sm">
                    <ThemeIcon size={64} radius="100%" variant="light" color="gray">
                      <IconDatabase size={32} />
                    </ThemeIcon>
                    <Text c="dimmed" fw={500} ta="center">
                      {hasSearch ? t("Common.NoResults") : t("Databases.Empty.NoInstalled")}
                    </Text>
                    {!hasSearch && (
                      <Text c="dimmed" size="sm" ta="center">
                        {t("Databases.Empty.AddHint")}
                      </Text>
                    )}
                  </Stack>
                </Center>
              )}
            </Stack>
          </Paper>
        </ResponsivePanel>

        {selectedDatabase === null ? (
          <ResponsivePanel>
            <Paper withBorder style={{ borderWidth: 2 }} p="md" h="100%">
              <Center h="100%">
                <Stack align="center" gap="sm">
                  <ThemeIcon size={80} radius="100%" variant="light" color="gray">
                    <IconDatabase size={40} />
                  </ThemeIcon>
                  <Text c="dimmed" fw={500} size="lg">
                    {t("Databases.NoSelection")}
                  </Text>
                </Stack>
              </Center>
            </Paper>
          </ResponsivePanel>
        ) : (
          <ResponsivePanel>
            <Paper withBorder style={{ borderWidth: 2 }} p={compact ? 8 : "md"} h="100%">
              <ScrollArea h="100%" offsetScrollbars>
                <Stack>
                  {selectedDatabase.type === "error" ? (
                    <>
                      <Text fz="lg" fw="bold">
                        {t("Databases.LoadError.Title")}
                      </Text>

                      <Text>
                        <Text td="underline" span>
                          {t("Common.Reason")}:
                        </Text>
                        {` ${selectedDatabase.error}`}
                      </Text>

                      <Text>{t("Databases.LoadError.Description")}</Text>
                    </>
                  ) : (
                    <>
                      <Divider variant="dashed" label={t("Common.GeneralSettings")} />
                      <GeneralSettings
                        key={selectedDatabase.filename}
                        selectedDatabase={selectedDatabase}
                        mutate={mutate}
                      />
                      <Checkbox
                        label={t("Databases.Settings.ReferenceDatabase")}
                        checked={isReference}
                        onChange={() => {
                          changeReferenceDatabase(selectedDatabase.file);
                        }}
                      />
                      <IndexInput
                        indexed={selectedDatabase.indexed}
                        file={selectedDatabase.file}
                        setDatabases={mutate}
                      />
                      {selectedStudyRecord ? (
                        <LichessStudySyncControls
                          selectedDatabase={selectedDatabase}
                          record={selectedStudyRecord}
                          setRecords={setLichessStudyDatabaseUpdates}
                          loading={updatingOnlineDatabasePath === selectedDatabase.file}
                          disabled={
                            conversionState.inProgress ||
                            (!!updatingOnlineDatabasePath &&
                              updatingOnlineDatabasePath !== selectedDatabase.file)
                          }
                          onReload={() => {
                            void updateLichessStudyDatabase(selectedDatabase, selectedStudyRecord);
                          }}
                        />
                      ) : (
                        <Group justify="space-between" align="center">
                          <OnlineAutoUpdateInput
                            selectedDatabase={selectedDatabase}
                            records={onlineDatabaseUpdates}
                            setRecords={setOnlineDatabaseUpdates}
                          />
                          {selectedOnlineRecord && (
                            <Button
                              size="xs"
                              variant="default"
                              leftSection={<IconRefresh size="1rem" />}
                              loading={updatingOnlineDatabasePath === selectedDatabase.file}
                              disabled={
                                conversionState.inProgress ||
                                (!!updatingOnlineDatabasePath &&
                                  updatingOnlineDatabasePath !== selectedDatabase.file)
                              }
                              onClick={() => {
                                void updateOnlineDatabase(selectedDatabase);
                              }}
                            >
                              Update now
                            </Button>
                          )}
                        </Group>
                      )}
                      {!selectedStudyRecord && (
                        <OnlineAccountLinks
                          selectedDatabase={selectedDatabase}
                          record={selectedOnlineRecord}
                          databaseDir={databaseDir}
                          sessions={sessions}
                          conversionState={conversionState}
                          setConversionState={setConversionState}
                          setRecords={setOnlineDatabaseUpdates}
                          reload={mutate}
                        />
                      )}

                      <Divider variant="dashed" label={t("Common.Data")} />
                      <Group grow>
                        <Stack gap={0} justify="center" ta="center">
                          <Text size="md" tt="uppercase" fw="bold" c="dimmed">
                            {t("Databases.Card.Games")}
                          </Text>
                          <Text fw={700} size="lg">
                            {formatNumber(selectedDatabase.game_count)}
                          </Text>
                        </Stack>
                        <Stack gap={0} justify="center" ta="center">
                          <Text size="md" tt="uppercase" fw="bold" c="dimmed">
                            {t("Databases.Card.Players")}
                          </Text>
                          <Text fw={700} size="lg">
                            {formatNumber(selectedDatabase.player_count - 1)}
                          </Text>
                        </Stack>
                        <Stack gap={0} justify="center" ta="center">
                          <Text size="md" tt="uppercase" fw="bold" c="dimmed">
                            {t("Databases.Settings.Events")}
                          </Text>
                          <Text fw={700} size="lg">
                            {formatNumber(selectedDatabase.event_count - 1)}
                          </Text>
                        </Stack>
                      </Group>

                      <div>
                        {selectedDatabase.type === "success" && (
                          <Button
                            component={Link}
                            to={`/databases/${selectedDatabase.title}`}
                            onClick={() => setActiveDatabase(selectedDatabase)}
                            fullWidth
                            variant="default"
                            size="lg"
                            rightSection={<IconArrowRight size="1rem" />}
                          >
                            {t("Databases.Settings.Explore")}
                          </Button>
                        )}
                      </div>
                    </>
                  )}

                  <Divider variant="dashed" label={t("Databases.Settings.AdvancedTools")} />

                  {selectedDatabase.type === "success" && (
                    <AdvancedSettings selectedDatabase={selectedDatabase} reload={mutate} />
                  )}

                  <Divider variant="dashed" label={t("Databases.Settings.Actions")} />
                  <Group justify="space-between">
                    {selectedDatabase.type === "success" && (
                      <Group>
                        <Button
                          variant="default"
                          rightSection={<IconPlus size="1rem" />}
                          onClick={async () => {
                            const file = await openDialog({
                              filters: [{ name: "PGN", extensions: ["pgn"] }],
                            });
                            if (!file || typeof file !== "string") return;
                            const sourceFileName = await basename(file);
                            const startedAt = Date.now();
                            setConversionState((prev) => ({
                              ...prev,
                              inProgress: true,
                              phase: "converting",
                              progress: null,
                              progressId: null,
                              sourceKind: "local-import",
                              startedAt,
                              updatedAt: startedAt,
                              totalGames: 0,
                              totalGamesExpected: null,
                              elapsedSeconds: 0,
                              targetDatabasePath: selectedDatabase.file,
                              targetDatabaseTitle: selectedDatabase.title,
                              sourceFileName,
                            }));
                            try {
                              await commands.convertPgn(
                                file,
                                selectedDatabase.file,
                                null,
                                "",
                                null,
                              );
                              mutate();
                            } finally {
                              setConversionState((prev) => ({
                                ...prev,
                                ...resetDatabaseConversionStateFields(),
                              }));
                            }
                          }}
                        >
                          {t("Databases.Settings.AddGames")}
                        </Button>
                        <Button
                          rightSection={<IconArrowRight size="1rem" />}
                          variant="default"
                          loading={exportLoading}
                          onClick={async () => {
                            const destFile = await save({
                              filters: [{ name: "PGN", extensions: ["pgn"] }],
                            });
                            if (!destFile) return;
                            setExportLoading(true);
                            await commands.exportToPgn(selectedDatabase.file, destFile);
                            setExportLoading(false);
                          }}
                        >
                          {t("Databases.Settings.ExportPGN")}
                        </Button>
                        <Button
                          rightSection={<IconFolderDown size="1rem" />}
                          variant="default"
                          onClick={() => setExportFilesOpened(true)}
                        >
                          Export to files
                        </Button>
                      </Group>
                    )}
                    <Button onClick={() => toggleDeleteModal()} color="red">
                      {t("Common.Delete")}
                    </Button>
                  </Group>
                </Stack>
              </ScrollArea>
            </Paper>
          </ResponsivePanel>
        )}
      </Box>
    </Stack>
  );
}

function getConversionPhaseLabel(conversionState: DatabaseConversionState) {
  if (conversionState.phase === "downloading") {
    return "Downloading";
  }
  if (conversionState.phase === "converting") {
    return "Converting";
  }
  return "Processing";
}

function getConversionProgress(conversionState: DatabaseConversionState) {
  if (typeof conversionState.progress === "number") {
    return Math.max(0, Math.min(100, conversionState.progress));
  }
  return null;
}

function getLichessTokenFromSessions(sessions: Session[], username: string) {
  return sessions.find(
    (session) =>
      session.lichess?.username.toLowerCase() === username.toLowerCase() &&
      session.lichess.accessToken,
  )?.lichess?.accessToken;
}

function getAnyLichessTokenFromSessions(sessions: Session[]) {
  return sessions.find((session) => session.lichess?.accessToken)?.lichess?.accessToken;
}

function DatabaseConversionCard({ conversionState }: { conversionState: DatabaseConversionState }) {
  const progress = getConversionProgress(conversionState);
  const phaseLabel = getConversionPhaseLabel(conversionState);
  const title = conversionState.targetDatabaseTitle ?? "New database";
  const detail =
    conversionState.phase === "converting" && conversionState.totalGamesExpected
      ? `${formatNumber(conversionState.totalGames)} / ${formatNumber(conversionState.totalGamesExpected)} games`
      : conversionState.sourceFileName;

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{
        opacity: 0.62,
        pointerEvents: "none",
      }}
    >
      <Group wrap="nowrap" justify="space-between" align="center">
        <Group wrap="nowrap" miw={0}>
          <IconDatabase size="1.5rem" />
          <Box miw={0}>
            <Text fw={500} fz="sm">
              {title}
            </Text>
            <Text size="xs" c="dimmed" style={{ wordWrap: "break-word" }}>
              {phaseLabel}
              {detail ? `: ${detail}` : ""}
            </Text>
          </Box>
        </Group>
        <RingProgress
          size={64}
          thickness={6}
          roundCaps
          sections={[{ value: progress ?? 100, color: progress === null ? "gray" : "blue" }]}
          label={
            progress === null ? (
              <Center>
                <Loader size="xs" />
              </Center>
            ) : (
              <Text ta="center" size="xs" fw={700}>
                {Math.round(progress)}%
              </Text>
            )
          }
        />
      </Group>
    </Paper>
  );
}

function DatabaseFilesExportModal({
  opened,
  setOpened,
  selectedDatabase,
  documentDir,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
  selectedDatabase: SuccessDatabaseInfo;
  documentDir: string;
}) {
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setFolderName(
      getDefaultDatabaseFolderName(selectedDatabase.title || selectedDatabase.filename),
    );
    setError("");
  }, [opened, selectedDatabase.filename, selectedDatabase.title]);

  async function exportDatabaseFiles() {
    const trimmedFolderName = folderName.trim();
    const folderNameError = validateDatabaseFilesFolderName(trimmedFolderName);
    if (folderNameError) {
      setError(folderNameError);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const filesRoot = documentDir || (await getDocumentDir());
      const targetDir = await resolve(filesRoot, trimmedFolderName);
      const report = await splitGameSourceToFiles({
        sourcePath: selectedDatabase.file,
        targetDir,
        fileType: "game",
      });

      notifications.show({
        title: "Exported database to Files",
        message: `Created ${getGameFileCountText(report.created)} in ${trimmedFolderName}.`,
        color: "green",
      });
      setOpened(false);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title="Export database to files">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void exportDatabaseFiles();
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Create one PGN file per game under the Files root. Existing folders are reused, and
            duplicate game names get numbered automatically.
          </Text>
          <TextInput
            label="Folder name"
            description={`${formatNumber(selectedDatabase.game_count)} games will be saved as individual files.`}
            value={folderName}
            onChange={(event) => {
              setFolderName(event.currentTarget.value);
              if (error) setError("");
            }}
            error={error}
            data-autofocus
          />
          <Button type="submit" loading={loading} leftSection={<IconFileExport size="1rem" />}>
            {loading ? "Exporting..." : "Export games"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function GeneralSettings({
  selectedDatabase,
  mutate,
}: {
  selectedDatabase: SuccessDatabaseInfo;
  mutate: () => void;
}) {
  const { t } = useTranslation();

  const [title, setTitle] = useState(selectedDatabase.title);
  const [description, setDescription] = useState(selectedDatabase.description);

  const [debouncedTitle] = useDebouncedValue(title, 300);
  const [debouncedDescription] = useDebouncedValue(description, 300);

  useEffect(() => {
    commands
      .editDbInfo(selectedDatabase.file, debouncedTitle ?? null, debouncedDescription ?? null)
      .then(() => mutate());
  }, [debouncedTitle, debouncedDescription, mutate, selectedDatabase.file]);

  return (
    <>
      <TextInput
        label={t("Common.Name")}
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        error={title === "" && t("Common.RequireName")}
      />
      <Textarea
        label={t("Common.Description")}
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
      />
    </>
  );
}

function AdvancedSettings({
  selectedDatabase,
  reload,
}: {
  selectedDatabase: DatabaseInfo;
  reload: () => void;
}) {
  return (
    <Stack>
      <RepertoireCopier selectedDatabase={selectedDatabase} reload={reload} />
      <PlayerMerger selectedDatabase={selectedDatabase} />
      <DuplicateRemover selectedDatabase={selectedDatabase} reload={reload} />
    </Stack>
  );
}

function RepertoireCopier({
  selectedDatabase,
  reload,
}: {
  selectedDatabase: DatabaseInfo;
  reload: () => void;
}) {
  const [playerId, setPlayerId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function copyRepertoire() {
    if (playerId === undefined) return;

    setLoading(true);
    try {
      const player = unwrap(await commands.getPlayer(selectedDatabase.file, playerId));
      if (!player?.name) {
        throw new Error("Choose a player first.");
      }

      const database = await createRepertoireDatabaseFromGameBatches(
        fetchRepertoireGameBatches(selectedDatabase.file, playerId),
        {
          id: player.id,
          name: player.name,
        },
      );
      notifications.show({
        title: "Repertoire database created",
        message: `${database.title} saved ${database.positions} ${player.name} response${
          database.positions === 1 ? "" : "s"
        }.`,
        color: "green",
      });
      reload();
    } catch (error) {
      notifications.show({
        title: "Could not copy repertoire",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack>
      <Text fz="lg" fw="bold">
        Copy repertoire
      </Text>
      <Text fz="sm">
        Create a new database containing only this player's choices from positions where they were
        to move.
      </Text>
      <Group grow>
        <PlayerSearchInput label="Player" file={selectedDatabase.file} setValue={setPlayerId} />
        <Button
          loading={loading}
          disabled={playerId === undefined || loading}
          onClick={copyRepertoire}
          rightSection={<IconDatabase size="1rem" />}
        >
          Copy repertoire
        </Button>
      </Group>
    </Stack>
  );
}

async function* fetchRepertoireGameBatches(databasePath: string, playerId: number) {
  let page = 1;

  while (true) {
    const games = await query_games(databasePath, {
      player1: playerId,
      sides: "Any",
      options: {
        page,
        pageSize: REPERTOIRE_COPY_PAGE_SIZE,
        skipCount: true,
        sort: "id",
        direction: "desc",
      },
    });

    if (games.data.length === 0) return;
    yield games.data;

    if (games.data.length < REPERTOIRE_COPY_PAGE_SIZE) return;
    page += 1;
  }
}

function PlayerMerger({ selectedDatabase }: { selectedDatabase: DatabaseInfo }) {
  const { t } = useTranslation();

  const [player1, setPlayer1] = useState<number | undefined>(undefined);
  const [player2, setPlayer2] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function mergePlayers() {
    if (player1 === undefined || player2 === undefined) {
      return;
    }
    setLoading(true);
    const res = await commands.mergePlayers(selectedDatabase.file, player1, player2);
    setLoading(false);
    unwrap(res);
  }

  return (
    <Stack>
      <Text fz="lg" fw="bold">
        {t("Databases.Settings.MergePlayers")}
      </Text>
      <Text fz="sm">{t("Databases.Settings.MergePlayers.Desc")}</Text>
      <Group grow>
        <PlayerSearchInput
          label={t("Databases.Player.One")}
          file={selectedDatabase.file}
          setValue={setPlayer1}
        />
        <Button
          loading={loading}
          onClick={mergePlayers}
          rightSection={<IconArrowRight size="1rem" />}
        >
          {t("Databases.Settings.Merge")}
        </Button>
        <PlayerSearchInput
          label={t("Databases.Player.Two")}
          file={selectedDatabase.file}
          setValue={setPlayer2}
        />
      </Group>
    </Stack>
  );
}

function DuplicateRemover({
  selectedDatabase,
  reload,
}: {
  selectedDatabase: DatabaseInfo;
  reload: () => void;
}) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  return (
    <Stack>
      <Text fz="lg" fw="bold">
        {t("Databases.Settings.BatchDelete")}
      </Text>
      <Text fz="sm">{t("Databases.Settings.BatchDelete.Desc")}</Text>
      <Group>
        <Button
          loading={loading}
          onClick={async () => {
            setLoading(true);
            commands
              .deleteDuplicatedGames(selectedDatabase.file)
              .then(() => {
                setLoading(false);
                reload();
              })
              .catch(() => {
                setLoading(false);
                reload();
              });
          }}
        >
          {t("Databases.Settings.RemoveDup")}
        </Button>

        <Button
          loading={loading}
          onClick={async () => {
            setLoading(true);
            commands
              .deleteEmptyGames(selectedDatabase.file)
              .then(() => {
                setLoading(false);
                reload();
              })
              .catch(() => {
                setLoading(false);
                reload();
              });
          }}
        >
          {t("Databases.Settings.RemoveEmpty")}
        </Button>
      </Group>
    </Stack>
  );
}

function IndexInput({
  indexed,
  file,
  setDatabases,
}: {
  indexed: boolean;
  file: string;
  setDatabases: (dbs: DatabaseInfo[]) => void;
}) {
  const { t } = useTranslation();

  const [loading, setLoading] = useToggle();
  return (
    <Group>
      <Tooltip label={t("Databases.Settings.Indexed.Desc")}>
        <Checkbox
          label={t("Databases.Settings.Indexed")}
          disabled={loading}
          checked={indexed}
          onChange={(e) => {
            setLoading(true);
            const fn = e.currentTarget.checked ? commands.createIndexes : commands.deleteIndexes;
            fn(file).then(() => {
              getDatabases().then((dbs) => {
                setDatabases(dbs);
                setLoading(false);
              });
            });
          }}
        />
      </Tooltip>
      {loading && <Loader size="sm" />}
    </Group>
  );
}

function getDefaultNewOnlineSource(accounts: OnlineDatabaseUpdateAccount[]): OnlineGameSource {
  return accounts.some((account) => account.source === "lichess") ? "chesscom" : "lichess";
}

function isSameOnlineAccount(a: OnlineGameAccount, b: OnlineGameAccount) {
  return a.source === b.source && a.username.toLowerCase() === b.username.toLowerCase();
}

function getSuggestedOnlineUsername(sessions: Session[], source: OnlineGameSource) {
  const session = sessions.find((candidate) =>
    source === "lichess" ? candidate.lichess?.username : candidate.chessCom?.username,
  );
  return source === "lichess" ? session?.lichess?.username : session?.chessCom?.username;
}

function OnlineAccountLinks({
  selectedDatabase,
  record,
  databaseDir,
  sessions,
  conversionState,
  setConversionState,
  setRecords,
  reload,
}: {
  selectedDatabase: SuccessDatabaseInfo;
  record: OnlineDatabaseUpdateRecord | null;
  databaseDir: string;
  sessions: Session[];
  conversionState: DatabaseConversionState;
  setConversionState: Dispatch<SetStateAction<DatabaseConversionState>>;
  setRecords: Dispatch<SetStateAction<OnlineDatabaseUpdateRecords>>;
  reload: () => unknown;
}) {
  const [source, setSource] = useState<OnlineGameSource>("lichess");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const accounts = record ? getOnlineDatabaseUpdateAccounts(record) : [];
  const usernameTrimmed = username.trim();
  const duplicate = accounts.some((account) =>
    isSameOnlineAccount(account, { source, username: usernameTrimmed }),
  );
  const suggestedUsername = getSuggestedOnlineUsername(sessions, source);

  useEffect(() => {
    const nextAccounts = record ? getOnlineDatabaseUpdateAccounts(record) : [];
    setSource(getDefaultNewOnlineSource(nextAccounts));
    setUsername("");
  }, [record, selectedDatabase.file]);

  async function addOnlineAccount() {
    if (!usernameTrimmed || duplicate || loading || conversionState.inProgress) return;

    const account = {
      source,
      username: usernameTrimmed,
      token:
        source === "lichess" ? getLichessTokenFromSessions(sessions, usernameTrimmed) : undefined,
    };
    setLoading(true);
    try {
      const importedAccounts = await importOnlineGameAccountsToDatabase({
        accounts: [account],
        databaseDir,
        dbPath: selectedDatabase.file,
        title: selectedDatabase.title,
        description: selectedDatabase.description,
        setConversionState,
      });
      await commands.clearGames();
      const nextDatabases = await getDatabases();
      await reload();
      const updatedDatabase =
        nextDatabases.find(
          (database): database is SuccessDatabaseInfo =>
            database.type === "success" && database.file === selectedDatabase.file,
        ) ?? selectedDatabase;

      const importedAccount = importedAccounts[0]!;
      const existingAccounts = record ? getOnlineDatabaseUpdateAccounts(record) : [];
      const nextAccounts = [
        ...existingAccounts.filter((candidate) => !isSameOnlineAccount(candidate, importedAccount)),
        importedAccount,
      ];
      const primary = nextAccounts[0]!;
      const now = Date.now();

      setRecords((records) =>
        upsertOnlineDatabaseUpdateRecord(records, {
          ...(record ?? {
            source: primary.source,
            username: primary.username,
            lastCheckedAt: null,
            lastUpdatedAt: null,
            lastKnownGameCount: null,
          }),
          source: primary.source,
          username: primary.username,
          accounts: nextAccounts,
          dbPath: selectedDatabase.file,
          title: selectedDatabase.title,
          description: selectedDatabase.description,
          autoUpdate: record?.autoUpdate ?? true,
          lastCheckedAt: now,
          lastUpdatedAt: now,
          lastKnownGameCount: updatedDatabase.game_count,
        }),
      );

      notifications.show({
        title: "Online account linked",
        message: `${getOnlineGameSourceLabel(source)} games for ${usernameTrimmed} were added to ${selectedDatabase.title}. Linked review decks will scan them automatically.`,
        color: "green",
      });
      setUsername("");
    } catch (error) {
      notifications.show({
        title: "Could not link online account",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setConversionState((prev) => ({
        ...prev,
        ...resetDatabaseConversionStateFields(),
      }));
      setLoading(false);
    }
  }

  return (
    <Stack gap="xs">
      <Text fz="sm" fw={600}>
        Online accounts
      </Text>
      {accounts.length > 0 && (
        <Group gap={6}>
          {accounts.map((account) => (
            <Badge key={`${account.source}:${account.username}`} variant="light">
              {getOnlineGameSourceLabel(account.source)}: {account.username}
            </Badge>
          ))}
        </Group>
      )}
      <Group align="flex-end" grow>
        <InputWrapper label="Website">
          <SegmentedControl
            fullWidth
            data={[
              { label: "Lichess", value: "lichess" },
              { label: "Chess.com", value: "chesscom" },
            ]}
            value={source}
            onChange={(value) => setSource(value as OnlineGameSource)}
          />
        </InputWrapper>
        <TextInput
          label="Username"
          value={username}
          placeholder={suggestedUsername}
          error={duplicate ? "This account is already linked" : undefined}
          onChange={(event) => setUsername(event.currentTarget.value)}
        />
        <Button
          variant="default"
          leftSection={<IconPlus size="1rem" />}
          loading={loading}
          disabled={!usernameTrimmed || duplicate || loading || conversionState.inProgress}
          onClick={() => void addOnlineAccount()}
        >
          Add account
        </Button>
      </Group>
    </Stack>
  );
}

function OnlineAutoUpdateInput({
  selectedDatabase,
  records,
  setRecords,
}: {
  selectedDatabase: SuccessDatabaseInfo;
  records: OnlineDatabaseUpdateRecords;
  setRecords: Dispatch<SetStateAction<OnlineDatabaseUpdateRecords>>;
}) {
  const { t } = useTranslation();
  const record = getOnlineDatabaseUpdateRecord(selectedDatabase, records);

  if (!record) return null;

  return (
    <Tooltip label={`Check ${getOnlineDatabaseUpdateLabel(record)} for new games`}>
      <Checkbox
        label={t("Databases.Online.AutoUpdate")}
        checked={record.autoUpdate}
        onChange={(event) => {
          setRecords((records) =>
            upsertOnlineDatabaseUpdateRecord(records, {
              ...record,
              dbPath: selectedDatabase.file,
              title: selectedDatabase.title,
              description: selectedDatabase.description,
              autoUpdate: event.currentTarget.checked,
              lastKnownGameCount: selectedDatabase.game_count,
            }),
          );
        }}
      />
    </Tooltip>
  );
}

function LichessStudySyncControls({
  selectedDatabase,
  record,
  setRecords,
  loading,
  disabled,
  onReload,
}: {
  selectedDatabase: SuccessDatabaseInfo;
  record: LichessStudyDatabaseUpdateRecord;
  setRecords: Dispatch<SetStateAction<LichessStudyDatabaseUpdateRecords>>;
  loading: boolean;
  disabled: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const gameCount = record.lastKnownGameCount ?? selectedDatabase.game_count;

  return (
    <Stack gap={6}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Box miw={0}>
          <Group gap={6} align="center">
            <Text fz="sm" fw={600}>
              Lichess Study
            </Text>
            <Badge size="xs" variant="light">
              {formatNumber(gameCount)} games
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
            {record.studyUrl.replace(/^https?:\/\//, "")}
          </Text>
          <Text size="xs" c="dimmed">
            Last checked {formatStudySyncTimestamp(record.lastCheckedAt)}
          </Text>
        </Box>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconRefresh size="1rem" />}
          loading={loading}
          disabled={disabled}
          aria-label={`Reload ${selectedDatabase.title} from Lichess study`}
          onClick={onReload}
        >
          Reload study
        </Button>
      </Group>
      <Tooltip label="Check the Lichess study for new chapters and annotation changes">
        <Checkbox
          label={t("Databases.Online.AutoUpdate")}
          checked={record.autoUpdate}
          onChange={(event) => {
            setRecords((records) =>
              upsertLichessStudyDatabaseUpdateRecord(records, {
                ...record,
                dbPath: selectedDatabase.file,
                title: selectedDatabase.title,
                description: selectedDatabase.description,
                autoUpdate: event.currentTarget.checked,
                lastKnownGameCount: selectedDatabase.game_count,
              }),
            );
          }}
        />
      </Tooltip>
    </Stack>
  );
}

function formatStudySyncTimestamp(value: number | null) {
  if (!value) return "never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
