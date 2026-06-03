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
  Menu,
  Modal,
  Paper,
  Rating,
  RingProgress,
  ScrollArea,
  SegmentedControl,
  Select,
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
  IconArrowsSort,
  IconDots,
  IconDatabase,
  IconEdit,
  IconFileExport,
  IconFolder,
  IconFolderDown,
  IconFolderPlus,
  IconLink,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconUnlink,
  IconWand,
} from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { basename, resolve } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { useAtom, useAtomValue } from "jotai";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import type { DatabaseInfo } from "@/bindings";
import { commands } from "@/bindings";
import {
  type DatabaseConversionState,
  databaseConversionStateAtom,
  databaseLinkedFoldersAtom,
  type LichessStudyDatabaseUpdateRecord,
  type LichessStudyDatabaseUpdateRecords,
  type DatabaseLinkedFolderRecord,
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
  getDatabaseLinkedFolderRecord,
  getGameFileCountText,
  removeDatabaseLinkedFolderRecord,
  syncDatabaseLinkedFolder,
  splitGameSourceToFiles,
  upsertDatabaseLinkedFolderRecord,
  validateDatabaseFilesFolderName,
} from "@/utils/databaseFileExport";
import {
  type DatabaseSortMode,
  getDatabaseDisplayTitle,
  getDatabaseFolderOptions,
  getDatabaseFolderPath,
  getDatabaseFolders,
  getDatabaseMoveTarget,
  getSuggestedDatabaseFolder,
  groupDatabasesByFolder,
  moveDatabaseFile,
  normalizeDatabaseFolderPath,
  query_games,
  resolveDatabaseFolderPath,
  getDatabases,
  type SuccessDatabaseInfo,
  validateDatabaseFolderPath,
} from "@/utils/db";
import { getDatabasesDir, getDocumentDir } from "@/utils/directories";
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
import { getLichessAccount } from "@/utils/lichess/api";
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

type DatabaseFolderModalState =
  | { mode: "create"; folder?: never }
  | { mode: "rename"; folder: string };

function rewriteDatabaseUpdateRecordPath<TRecord extends { dbPath: string }>(
  records: Record<string, TRecord>,
  previousPath: string,
  nextPath: string,
): Record<string, TRecord> {
  const record = records[previousPath];
  if (!record) return records;

  const nextRecords: Record<string, TRecord> = { ...records };
  delete nextRecords[previousPath];
  nextRecords[nextPath] = {
    ...record,
    dbPath: nextPath,
  };
  return nextRecords;
}

export default function DatabasesPage() {
  const { t } = useTranslation();

  const { data: databases, isLoading, mutate } = useSWR("databases", () => getDatabases());
  const { data: folders, mutate: mutateFolders } = useSWR("database-folders", () =>
    getDatabaseFolders(),
  );

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [referenceDatabase, setReferenceDatabase] = useAtom(referenceDbAtom);
  const [conversionState, setConversionState] = useAtom(databaseConversionStateAtom);
  const [onlineDatabaseUpdates, setOnlineDatabaseUpdates] = useAtom(onlineDatabaseUpdatesAtom);
  const [lichessStudyDatabaseUpdates, setLichessStudyDatabaseUpdates] = useAtom(
    lichessStudyDatabaseUpdatesAtom,
  );
  const [databaseLinkedFolders, setDatabaseLinkedFolders] = useAtom(databaseLinkedFoldersAtom);
  const [sessions, setSessions] = useAtom(sessionsAtom);
  const [updatingOnlineDatabasePath, setUpdatingOnlineDatabasePath] = useState<string | null>(null);
  const [syncingLinkedFolderPath, setSyncingLinkedFolderPath] = useState<string | null>(null);
  const [lichessLoginOpened, setLichessLoginOpened] = useState(false);
  const [lichessLoginUsername, setLichessLoginUsername] = useState("");
  const [lichessLoginWaiting, setLichessLoginWaiting] = useState(false);
  const firstLichessUsername =
    sessions.find((session) => session.lichess?.username)?.lichess?.username ?? "";

  function openLichessLoginPrompt() {
    setLichessLoginUsername((current) => current || firstLichessUsername);
    setLichessLoginOpened(true);
  }

  async function beginLichessLogin() {
    setLichessLoginWaiting(true);
    try {
      await commands.authenticate(lichessLoginUsername.trim());
      notifications.show({
        title: "Lichess login opened",
        message: "Finish the Lichess authorization in your browser to continue study sync.",
        color: "blue",
      });
    } catch (error) {
      setLichessLoginWaiting(false);
      notifications.show({
        title: "Could not open Lichess login",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  }

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    void listen<string>("access_token", async (event) => {
      if (!mounted) return;
      const token = event.payload;
      try {
        const account = await getLichessAccount({ token });
        if (!account) throw new Error("Could not read the authorized Lichess account.");

        setSessions((current) => {
          const existing = current.find(
            (session) =>
              session.lichess?.username.toLowerCase() === account.username.toLowerCase(),
          );
          const remaining = current.filter(
            (session) =>
              session.lichess?.username.toLowerCase() !== account.username.toLowerCase(),
          );
          return [
            ...remaining,
            {
              lichess: {
                accessToken: token,
                username: account.username,
                account,
              },
              player: existing?.player || account.username,
              updatedAt: Date.now(),
            },
          ];
        });

        setLichessLoginOpened(false);
        notifications.show({
          title: "Lichess connected",
          message: `${account.username} can now be used for Lichess study sync.`,
          color: "green",
        });
      } catch (error) {
        notifications.show({
          title: "Could not finish Lichess login",
          message: error instanceof Error ? error.message : String(error),
          color: "red",
        });
      } finally {
        if (mounted) setLichessLoginWaiting(false);
      }
    }).then((cleanup) => {
      if (mounted) {
        unlisten = cleanup;
      } else {
        cleanup();
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [setSessions]);

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
  const selectedLinkedFolder = useMemo(
    () =>
      selectedDatabase?.type === "success"
        ? getDatabaseLinkedFolderRecord(selectedDatabase.file, databaseLinkedFolders)
        : null,
    [databaseLinkedFolders, selectedDatabase],
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
  const [exportFilesLinkDefault, setExportFilesLinkDefault] = useState(false);
  const [folderModal, setFolderModal] = useState<DatabaseFolderModalState | null>(null);
  const [sortMode, setSortMode] = useState<DatabaseSortMode>("folder");
  const [selectedFolderDraft, setSelectedFolderDraft] = useState("");
  const [organizing, setOrganizing] = useState(false);
  const documentDir = useAtomValue(storedDocumentDirAtom);
  const databaseFolderGroups = useMemo(() => {
    const groups = groupDatabasesByFolder(filteredDatabases, sortMode);
    const existing = new Set(groups.map((group) => group.path));
    const emptyGroups = (folders ?? [])
      .filter((folder) => !existing.has(folder))
      .map((folder) => ({ path: folder, label: folder, databases: [] }));
    return [...groups, ...emptyGroups].sort((a, b) => {
      if (a.path === "" && b.path !== "") return -1;
      if (a.path !== "" && b.path === "") return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
  }, [filteredDatabases, folders, sortMode]);
  const databaseFolderOptions = useMemo(
    () => Array.from(new Set([...getDatabaseFolderOptions(databases ?? []), ...(folders ?? [])])),
    [databases, folders],
  );

  useEffect(() => {
    setSelectedFolderDraft(selectedDatabase ? getDatabaseFolderPath(selectedDatabase) : "");
  }, [selectedDatabase]);

  function changeReferenceDatabase(file: string) {
    commands.clearGames();
    if (file === referenceDatabase) {
      setReferenceDatabase(null);
    } else {
      setReferenceDatabase(file);
    }
  }

  function rewriteMovedDatabasePath(previousPath: string, nextPath: string) {
    setSelected((current) => (current === previousPath ? nextPath : current));
    setReferenceDatabase((current) => (current === previousPath ? nextPath : current));
    setOnlineDatabaseUpdates((records) =>
      rewriteDatabaseUpdateRecordPath(records, previousPath, nextPath),
    );
    setLichessStudyDatabaseUpdates((records) =>
      rewriteDatabaseUpdateRecordPath(records, previousPath, nextPath),
    );
    setDatabaseLinkedFolders((records) =>
      rewriteDatabaseUpdateRecordPath(records, previousPath, nextPath),
    );
  }

  async function moveDatabaseToFolder(database: DatabaseInfo, folder: string) {
    const normalizedFolder = normalizeDatabaseFolderPath(folder);
    const folderError = normalizedFolder ? validateDatabaseFolderPath(normalizedFolder) : null;
    if (folderError) throw new Error(folderError);
    const resolvedDatabaseDir = databaseDir || (await getDatabasesDir());
    const target = await getDatabaseMoveTarget(database, resolvedDatabaseDir, normalizedFolder);
    if (target === database.file) return;

    await moveDatabaseFile(database.file, target);
    rewriteMovedDatabasePath(database.file, target);
    await mutate();
    await mutateFolders();
  }

  async function createDatabaseFolder(folder: string) {
    const normalizedFolder = normalizeDatabaseFolderPath(folder);
    const error = validateDatabaseFolderPath(normalizedFolder);
    if (error) throw new Error(error);
    const resolvedDatabaseDir = databaseDir || (await getDatabasesDir());
    const target = await resolveDatabaseFolderPath(resolvedDatabaseDir, normalizedFolder);
    if (await exists(target)) throw new Error("That folder already exists.");
    await mkdir(target, { recursive: true });
    await mutate();
    await mutateFolders();
  }

  async function renameDatabaseFolder(previousFolder: string, nextFolder: string) {
    const normalizedNextFolder = normalizeDatabaseFolderPath(nextFolder);
    const error = validateDatabaseFolderPath(normalizedNextFolder);
    if (error) throw new Error(error);
    if (previousFolder === normalizedNextFolder) return;

    const affected = (databases ?? []).filter((database) => {
      const folder = getDatabaseFolderPath(database);
      return folder === previousFolder || folder.startsWith(`${previousFolder}/`);
    });

    for (const database of affected) {
      const folder = getDatabaseFolderPath(database);
      const trailing = folder === previousFolder ? "" : folder.slice(previousFolder.length + 1);
      const targetFolder = [normalizedNextFolder, trailing].filter(Boolean).join("/");
      await moveDatabaseToFolder(database, targetFolder);
    }
    await mutate();
    await mutateFolders();
  }

  async function autoOrganizeDatabases() {
    const candidates = (databases ?? []).filter((database) => database.type === "success");
    const moves = candidates.filter(
      (database) => getDatabaseFolderPath(database) !== getSuggestedDatabaseFolder(database),
    );
    if (moves.length === 0) {
      notifications.show({
        title: "Databases already organized",
        message: "Every database is already in its suggested folder.",
        color: "blue",
      });
      return;
    }

    setOrganizing(true);
    try {
      for (const database of moves) {
        await moveDatabaseToFolder(database, getSuggestedDatabaseFolder(database));
      }
      await mutate();
      notifications.show({
        title: "Databases organized",
        message: `${moves.length} database${moves.length === 1 ? "" : "s"} moved into folders.`,
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Could not organize databases",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setOrganizing(false);
    }
  }

  async function syncLinkedFolder(database: SuccessDatabaseInfo) {
    const record = getDatabaseLinkedFolderRecord(database.file, databaseLinkedFolders);
    if (!record || syncingLinkedFolderPath) return null;
    const studyRecord = getLichessStudyDatabaseUpdateRecord(database, lichessStudyDatabaseUpdates);

    setSyncingLinkedFolderPath(database.file);
    try {
      const result = await syncDatabaseLinkedFolder({
        sourcePath: database.file,
        title: database.title,
        gameCount: database.game_count,
        fileNamePrefix: studyRecord?.title ?? null,
        orderedFilenames: !!studyRecord,
        record: {
          ...record,
          dbPath: database.file,
          title: database.title,
        },
      });
      setDatabaseLinkedFolders((records) =>
        upsertDatabaseLinkedFolderRecord(records, result.record),
      );
      return result.report;
    } finally {
      setSyncingLinkedFolderPath(null);
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
      const latestDatabases = await mutate();
      const latestDatabase =
        latestDatabases?.find(
          (item): item is SuccessDatabaseInfo =>
            item.type === "success" && item.file === database.file,
        ) ?? database;

      if (result.updated) {
        const syncReport = await syncLinkedFolder(latestDatabase);
        notifications.show({
          title: "Online database updated",
          message:
            syncReport && syncReport.created > 0
              ? `Latest games were imported and ${getGameFileCountText(syncReport.created)} were added to the linked Files folder.`
              : "Latest games were imported. Linked review decks will scan the new games automatically.",
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
      const latestDatabases = await mutate();
      const latestDatabase =
        latestDatabases?.find(
          (item): item is SuccessDatabaseInfo =>
            item.type === "success" && item.file === database.file,
        ) ?? database;

      if (result.updated) {
        const syncReport = await syncLinkedFolder(latestDatabase);
        notifications.show({
          title: result.pushed ? "Lichess study synced" : "Lichess study updated",
          message:
            syncReport && syncReport.created > 0
              ? `${database.title} was rebuilt and ${getGameFileCountText(syncReport.created)} were added to the linked Files folder.`
              : result.pushed
                ? `${database.title} was pushed to Lichess and rebuilt from the latest study PGN.`
                : `${database.title} was rebuilt from the latest study PGN.`,
          color: "green",
        });
      } else if (result.pushed) {
        await syncLinkedFolder(latestDatabase);
        notifications.show({
          title: "Lichess study synced",
          message: `${database.title} was pushed to Lichess.`,
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
      if (isLichessStudyLoginError(error)) {
        openLichessLoginPrompt();
      }
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
      <LichessStudyLoginModal
        opened={lichessLoginOpened}
        username={lichessLoginUsername}
        waiting={lichessLoginWaiting}
        onUsernameChange={setLichessLoginUsername}
        onClose={() => setLichessLoginOpened(false)}
        onLogin={() => {
          void beginLichessLogin();
        }}
      />
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
            setDatabaseLinkedFolders((records) =>
              removeDatabaseLinkedFolderRecord(records, selectedDatabase.file),
            );
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

      <DatabaseFolderModal
        opened={folderModal !== null}
        mode={folderModal?.mode ?? "create"}
        initialFolder={folderModal?.folder ?? ""}
        onClose={() => setFolderModal(null)}
        onSubmit={async (folder) => {
          if (folderModal?.mode === "rename" && folderModal.folder) {
            await renameDatabaseFolder(folderModal.folder, folder);
            notifications.show({
              title: "Folder renamed",
              message: `${folderModal.folder} is now ${normalizeDatabaseFolderPath(folder)}.`,
              color: "green",
            });
          } else {
            await createDatabaseFolder(folder);
            notifications.show({
              title: "Folder created",
              message: `${normalizeDatabaseFolderPath(folder)} is ready for databases.`,
              color: "green",
            });
          }
          setFolderModal(null);
        }}
      />

      {selectedDatabase?.type === "success" && (
        <DatabaseFilesExportModal
          opened={exportFilesOpened}
          setOpened={setExportFilesOpened}
          selectedDatabase={selectedDatabase}
          documentDir={documentDir}
          linkByDefault={exportFilesLinkDefault}
          linkedFolder={selectedLinkedFolder}
          fileNamePrefix={selectedStudyRecord?.title ?? null}
          onLinked={(record) => {
            setDatabaseLinkedFolders((records) =>
              upsertDatabaseLinkedFolderRecord(records, record),
            );
          }}
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
                <Select
                  size="sm"
                  w={compact ? 128 : 160}
                  aria-label="Sort databases"
                  leftSection={<IconArrowsSort size="1rem" />}
                  data={[
                    { value: "folder", label: "Folder" },
                    { value: "name", label: "Name" },
                    { value: "games", label: "Games" },
                    { value: "storage", label: "Storage" },
                  ]}
                  value={sortMode}
                  onChange={(value) => setSortMode((value as DatabaseSortMode | null) ?? "folder")}
                />
                <Tooltip label="Create folder">
                  <ActionIcon
                    variant="default"
                    size="lg"
                    onClick={() => setFolderModal({ mode: "create" })}
                  >
                    <IconFolderPlus size="1rem" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Auto organize databases">
                  <ActionIcon
                    variant="default"
                    size="lg"
                    loading={organizing}
                    disabled={conversionState.inProgress}
                    onClick={() => void autoOrganizeDatabases()}
                  >
                    <IconWand size="1rem" />
                  </ActionIcon>
                </Tooltip>
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
                <Stack gap={compact ? 6 : "sm"} p={compact ? 6 : "xs"}>
                  {showFilteredConversionPlaceholder && (
                    <DatabaseConversionCard conversionState={conversionState} />
                  )}
                  {isLoading && (
                    <SimpleGrid cols={listColumns} spacing={compact ? 6 : "sm"}>
                      <Skeleton h="8rem" />
                      <Skeleton h="8rem" />
                      <Skeleton h="8rem" />
                    </SimpleGrid>
                  )}
                  {!isLoading &&
                    databaseFolderGroups.map((folder) => (
                      <Stack key={folder.path || "unfiled"} gap={6}>
                        <Group justify="space-between" wrap="nowrap">
                          <Group gap={6} wrap="nowrap" miw={0}>
                            <IconFolder size="1rem" />
                            <Text fw={700} size="xs" tt="uppercase" c="dimmed" truncate>
                              {folder.label}
                            </Text>
                            <Badge size="xs" variant="light">
                              {folder.databases.length}
                            </Badge>
                          </Group>
                          {folder.path && (
                            <Menu position="bottom-end" withinPortal>
                              <Menu.Target>
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  aria-label={`Folder actions for ${folder.label}`}
                                >
                                  <IconDots size="1rem" />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item
                                  leftSection={<IconEdit size="1rem" />}
                                  onClick={() =>
                                    setFolderModal({ mode: "rename", folder: folder.path })
                                  }
                                >
                                  Rename folder
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          )}
                        </Group>
                        <SimpleGrid cols={listColumns} spacing={compact ? 6 : "sm"}>
                          {folder.databases.map((item) => (
                            <DatabaseListCard
                              key={item.file}
                              item={item}
                              selectedDatabase={selectedDatabase}
                              referenceDatabase={referenceDatabase}
                              onlineDatabaseUpdates={onlineDatabaseUpdates}
                              lichessStudyDatabaseUpdates={lichessStudyDatabaseUpdates}
                              updatingOnlineDatabasePath={updatingOnlineDatabasePath}
                              conversionInProgress={conversionState.inProgress}
                              onSelect={setSelected}
                              onOpen={(database) => {
                                navigate({
                                  to: "/databases/$databaseId",
                                  params: {
                                    databaseId: database.title,
                                  },
                                });
                                setActiveDatabase(database, {
                                  gameOrder: getLichessStudyDatabaseUpdateRecord(
                                    database,
                                    lichessStudyDatabaseUpdates,
                                  )
                                    ? "source"
                                    : "recent",
                                });
                              }}
                              onChangeReference={changeReferenceDatabase}
                              onUpdateOnline={updateOnlineDatabase}
                              onUpdateStudy={updateLichessStudyDatabase}
                            />
                          ))}
                        </SimpleGrid>
                      </Stack>
                    ))}
                </Stack>
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
                      <Stack gap={4}>
                        <Text fw={600} fz="sm">
                          Folder
                        </Text>
                        <Group align="flex-end" grow>
                          <Select
                            label="Existing folder"
                            placeholder="Unfiled"
                            clearable
                            searchable
                            data={databaseFolderOptions}
                            value={selectedFolderDraft || null}
                            onChange={(value) => setSelectedFolderDraft(value ?? "")}
                          />
                          <TextInput
                            label="Move to folder"
                            placeholder="Reference or Online Games/Chess.com"
                            value={selectedFolderDraft}
                            onChange={(event) => setSelectedFolderDraft(event.currentTarget.value)}
                          />
                          <Button
                            variant="default"
                            leftSection={<IconFolder size="1rem" />}
                            disabled={
                              normalizeDatabaseFolderPath(selectedFolderDraft) ===
                              getDatabaseFolderPath(selectedDatabase)
                            }
                            onClick={async () => {
                              try {
                                await moveDatabaseToFolder(selectedDatabase, selectedFolderDraft);
                                notifications.show({
                                  title: "Database moved",
                                  message: `${selectedDatabase.title} moved to ${
                                    normalizeDatabaseFolderPath(selectedFolderDraft) || "Unfiled"
                                  }.`,
                                  color: "green",
                                });
                              } catch (error) {
                                notifications.show({
                                  title: "Could not move database",
                                  message: error instanceof Error ? error.message : String(error),
                                  color: "red",
                                });
                              }
                            }}
                          >
                            Move
                          </Button>
                        </Group>
                      </Stack>
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
                          onRelink={openLichessLoginPrompt}
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

                      <Divider variant="dashed" label="Files link" />
                      <Group justify="space-between" align="center">
                        <Box miw={0}>
                          <Text fw={600} fz="sm">
                            Linked folder
                          </Text>
                          <Text size="xs" c="dimmed" style={{ wordBreak: "break-word" }}>
                            {selectedLinkedFolder
                              ? `${selectedLinkedFolder.folderName} - ${
                                  selectedLinkedFolder.lastSyncedAt
                                    ? `Synced ${new Date(
                                        selectedLinkedFolder.lastSyncedAt,
                                      ).toLocaleString()}`
                                    : "Not synced yet"
                                }`
                              : "Create a Files folder that receives new games when this database updates."}
                          </Text>
                        </Box>
                        <Group gap="xs" wrap="nowrap">
                          {selectedLinkedFolder ? (
                            <>
                              <OpenFolderButton folder={selectedLinkedFolder.folderPath} />
                              <Button
                                size="xs"
                                variant="default"
                                leftSection={<IconRefresh size="1rem" />}
                                loading={syncingLinkedFolderPath === selectedDatabase.file}
                                onClick={async () => {
                                  try {
                                    const report = await syncLinkedFolder(selectedDatabase);
                                    notifications.show({
                                      title: "Linked folder synced",
                                      message: report
                                        ? `Added ${getGameFileCountText(report.created)}.`
                                        : "No linked folder found.",
                                      color: "green",
                                    });
                                  } catch (error) {
                                    notifications.show({
                                      title: "Could not sync linked folder",
                                      message:
                                        error instanceof Error ? error.message : String(error),
                                      color: "red",
                                    });
                                  }
                                }}
                              >
                                Sync now
                              </Button>
                              <Button
                                size="xs"
                                variant="subtle"
                                color="red"
                                leftSection={<IconUnlink size="1rem" />}
                                onClick={() => {
                                  setDatabaseLinkedFolders((records) =>
                                    removeDatabaseLinkedFolderRecord(
                                      records,
                                      selectedDatabase.file,
                                    ),
                                  );
                                }}
                              >
                                Unlink
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="xs"
                              variant="default"
                              leftSection={<IconLink size="1rem" />}
                              onClick={() => {
                                setExportFilesLinkDefault(true);
                                setExportFilesOpened(true);
                              }}
                            >
                              Create linked folder
                            </Button>
                          )}
                        </Group>
                      </Group>

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
                            onClick={() =>
                              setActiveDatabase(selectedDatabase, {
                                gameOrder: selectedStudyRecord ? "source" : "recent",
                              })
                            }
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
                              const latestDatabases = await mutate();
                              const latestDatabase =
                                latestDatabases?.find(
                                  (item): item is SuccessDatabaseInfo =>
                                    item.type === "success" && item.file === selectedDatabase.file,
                                ) ?? selectedDatabase;
                              await syncLinkedFolder(latestDatabase);
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
                          onClick={() => {
                            setExportFilesLinkDefault(false);
                            setExportFilesOpened(true);
                          }}
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

function isLichessStudyLoginError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("database sync prompt") ||
    message.includes("Two-way Lichess study sync needs a linked Lichess account")
  );
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

function DatabaseListCard({
  item,
  selectedDatabase,
  referenceDatabase,
  onlineDatabaseUpdates,
  lichessStudyDatabaseUpdates,
  updatingOnlineDatabasePath,
  conversionInProgress,
  onSelect,
  onOpen,
  onChangeReference,
  onUpdateOnline,
  onUpdateStudy,
}: {
  item: DatabaseInfo;
  selectedDatabase: DatabaseInfo | null;
  referenceDatabase: string | null;
  onlineDatabaseUpdates: OnlineDatabaseUpdateRecords;
  lichessStudyDatabaseUpdates: LichessStudyDatabaseUpdateRecords;
  updatingOnlineDatabasePath: string | null;
  conversionInProgress: boolean;
  onSelect: (value: string | null) => void;
  onOpen: (database: SuccessDatabaseInfo) => void;
  onChangeReference: (file: string) => void;
  onUpdateOnline: (database: SuccessDatabaseInfo) => void;
  onUpdateStudy: (database: SuccessDatabaseInfo, record: LichessStudyDatabaseUpdateRecord) => void;
}) {
  const { t } = useTranslation();
  const onlineRecord =
    item.type === "success" ? getOnlineDatabaseUpdateRecord(item, onlineDatabaseUpdates) : null;
  const studyRecord =
    item.type === "success"
      ? getLichessStudyDatabaseUpdateRecord(item, lichessStudyDatabaseUpdates)
      : null;
  const onlineUpdating = item.type === "success" && updatingOnlineDatabasePath === item.file;
  const updateActionLabel =
    item.type === "success" && studyRecord
      ? `Reload ${getLichessStudyDatabaseUpdateLabel(studyRecord)}`
      : item.type === "success" && onlineRecord
        ? `Update ${getOnlineDatabaseUpdateLabel(onlineRecord)}`
        : null;

  return (
    <GenericCard
      id={item.file}
      isSelected={selectedDatabase?.file === item.file}
      setSelected={onSelect}
      error={item.type === "error" ? item.error : ""}
      onDoubleClick={() => {
        if (item.type === "success") onOpen(item);
      }}
      Header={
        <Group wrap="nowrap" justify="space-between">
          <Group wrap="nowrap" miw={0}>
            <IconDatabase size="1.5rem" />
            <Box miw={0}>
              <Text fw={500} fz="sm">
                {getDatabaseDisplayTitle(item)}
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
                    conversionInProgress || (!!updatingOnlineDatabasePath && !onlineUpdating)
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    if (studyRecord) {
                      onUpdateStudy(item, studyRecord);
                    } else if (onlineRecord) {
                      onUpdateOnline(item);
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
                onChangeReference(item.file);
              }}
            />
          </Group>
        </Group>
      }
      stats={[
        {
          label: t("Databases.Card.Games"),
          value: item.type === "success" ? formatNumber(item.game_count) : "???",
        },
        {
          label: t("Databases.Card.Storage"),
          value: item.type === "success" ? formatBytes(item.storage_size ?? 0) : "???",
        },
      ]}
    />
  );
}

function DatabaseFolderModal({
  opened,
  mode,
  initialFolder,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  mode: "create" | "rename";
  initialFolder: string;
  onClose: () => void;
  onSubmit: (folder: string) => Promise<void>;
}) {
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setFolder(initialFolder);
    setError("");
  }, [initialFolder, opened]);

  async function submit() {
    const normalized = normalizeDatabaseFolderPath(folder);
    const validationError = validateDatabaseFolderPath(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      await onSubmit(normalized);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={mode === "rename" ? "Rename database folder" : "Create database folder"}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Stack>
          <TextInput
            label="Folder"
            description="Use / for nested folders."
            placeholder="Reference or Online Games/Chess.com"
            value={folder}
            error={error}
            onChange={(event) => {
              setFolder(event.currentTarget.value);
              if (error) setError("");
            }}
            data-autofocus
          />
          <Button type="submit" loading={loading} leftSection={<IconFolderPlus size="1rem" />}>
            {mode === "rename" ? "Rename folder" : "Create folder"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function DatabaseFilesExportModal({
  opened,
  setOpened,
  selectedDatabase,
  documentDir,
  linkByDefault,
  linkedFolder,
  fileNamePrefix,
  onLinked,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
  selectedDatabase: SuccessDatabaseInfo;
  documentDir: string;
  linkByDefault: boolean;
  linkedFolder: DatabaseLinkedFolderRecord | null;
  fileNamePrefix?: string | null;
  onLinked: (record: DatabaseLinkedFolderRecord) => void;
}) {
  const [folderName, setFolderName] = useState("");
  const [linkFolder, setLinkFolder] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setFolderName(
      linkedFolder?.folderName ??
        getDefaultDatabaseFolderName(selectedDatabase.title || selectedDatabase.filename),
    );
    setLinkFolder(linkByDefault || !!linkedFolder);
    setError("");
  }, [linkByDefault, linkedFolder, opened, selectedDatabase.filename, selectedDatabase.title]);

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
      let created = 0;
      if (linkFolder) {
        const linkRecord = {
          ...(linkedFolder ?? {
            dbPath: selectedDatabase.file,
            title: selectedDatabase.title,
            folderName: trimmedFolderName,
            folderPath: targetDir,
            linkedAt: Date.now(),
            lastSyncedAt: null,
            lastCreated: 0,
            lastKnownGameCount: null,
          }),
          dbPath: selectedDatabase.file,
          title: selectedDatabase.title,
          folderName: trimmedFolderName,
          folderPath: targetDir,
        };
        const result = await syncDatabaseLinkedFolder({
          sourcePath: selectedDatabase.file,
          title: selectedDatabase.title,
          gameCount: selectedDatabase.game_count,
          fileNamePrefix,
          record: linkRecord,
        });
        created = result.report.created;
        onLinked(result.record);
      } else {
        const report = await splitGameSourceToFiles({
          sourcePath: selectedDatabase.file,
          targetDir,
          fileType: "game",
        });
        created = report.created;
      }

      notifications.show({
        title: linkFolder ? "Linked folder synced" : "Exported database to Files",
        message: linkFolder
          ? `Added ${getGameFileCountText(created)} in ${trimmedFolderName}.`
          : `Created ${getGameFileCountText(created)} in ${trimmedFolderName}.`,
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
          <Checkbox
            label="Link this folder to database updates"
            checked={linkFolder}
            onChange={(event) => setLinkFolder(event.currentTarget.checked)}
          />
          <Button type="submit" loading={loading} leftSection={<IconFileExport size="1rem" />}>
            {loading ? "Exporting..." : linkFolder ? "Export and link" : "Export games"}
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

function LichessStudyLoginModal({
  opened,
  username,
  waiting,
  onUsernameChange,
  onClose,
  onLogin,
}: {
  opened: boolean;
  username: string;
  waiting: boolean;
  onUsernameChange: (username: string) => void;
  onClose: () => void;
  onLogin: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title="Connect Lichess for study sync" centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onLogin();
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Two-way study sync needs Lichess permission to edit studies. Sign in again to grant
            study write access, then retry the sync.
          </Text>
          <TextInput
            label="Lichess username"
            description="Optional, but helps Lichess choose the right account in your browser."
            placeholder="Your Lichess username"
            value={username}
            onChange={(event) => onUsernameChange(event.currentTarget.value)}
            disabled={waiting}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={waiting}>
              Cancel
            </Button>
            <Button type="submit" leftSection={<IconLink size="1rem" />} loading={waiting}>
              Sign in with Lichess
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function LichessStudySyncControls({
  selectedDatabase,
  record,
  setRecords,
  loading,
  disabled,
  onReload,
  onRelink,
}: {
  selectedDatabase: SuccessDatabaseInfo;
  record: LichessStudyDatabaseUpdateRecord;
  setRecords: Dispatch<SetStateAction<LichessStudyDatabaseUpdateRecords>>;
  loading: boolean;
  disabled: boolean;
  onReload: () => void;
  onRelink: () => void;
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
      <Tooltip label="Push local En Croissant annotations to Lichess before pulling remote study changes. Requires relinking Lichess with study write access.">
        <Checkbox
          label="Two-way sync"
          checked={!!record.twoWaySync}
          onChange={(event) => {
            setRecords((records) =>
              upsertLichessStudyDatabaseUpdateRecord(records, {
                ...record,
                dbPath: selectedDatabase.file,
                title: selectedDatabase.title,
                description: selectedDatabase.description,
                twoWaySync: event.currentTarget.checked,
                autoUpdate: event.currentTarget.checked ? true : record.autoUpdate,
                lastKnownGameCount: selectedDatabase.game_count,
              }),
            );
          }}
        />
      </Tooltip>
      {record.twoWaySync && (
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            Last pushed {formatStudySyncTimestamp(record.lastPushedAt ?? null)}
          </Text>
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed">
              Requires Lichess study write access and permission to edit this study.
            </Text>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconLink size="0.85rem" />}
              onClick={onRelink}
              disabled={disabled}
            >
              Sign in
            </Button>
          </Group>
        </Stack>
      )}
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
