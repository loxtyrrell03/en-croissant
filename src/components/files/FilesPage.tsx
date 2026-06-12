import {
  ActionIcon,
  Center,
  Chip,
  Divider,
  Group,
  Input,
  Menu,
  Paper,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { useHotkeys, useToggle } from "@mantine/hooks";
import {
  IconFileDescription,
  IconFileImport,
  IconFilePlus,
  IconFolderPlus,
  IconSearch,
  IconFolder,
  IconArrowsSort,
  IconCheck,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { appDataDir, resolve } from "@tauri-apps/api/path";
import { mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import clsx from "clsx";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import {
  archivedFileEntriesAtom,
  filesSortModeAtom,
  manualFileEntryOrderAtom,
  pinnedFileEntriesAtom,
  recentFilesAtom,
  tabsAtom,
  type FilesSortMode,
} from "@/state/atoms";
import { capitalize } from "@/utils/format";
import ConfirmModal from "../common/ConfirmModal";
import OpenFolderButton from "../common/OpenFolderButton";
import DirectoryTree from "./DirectoryTree";
import { DragContext, type DragRowRegistration, type DropTarget } from "./DirectoryTree";
import treeClasses from "./DirectoryTree.module.css";
import FileCard from "./FileCard";
import {
  type Directory,
  type Entry,
  type FileMetadata,
  type FileType,
  isPgnFile,
  readDirectoryEntries,
} from "./file";
import {
  CreateDirectoryModal,
  CreateModal,
  EditModal,
  ImportDatabaseFolderModal,
  RenameModal,
  type RenameResult,
} from "./Modals";

const FILE_TYPES: FileType[] = ["game", "repertoire", "tournament", "puzzle", "other", "pdf"];
const ROW_REORDER_EDGE_RATIO = 0.32;
const PINNED_FILE_ENTRIES_EXPORT = "web-pinned-file-entries.json";

const SORT_OPTIONS: { value: FilesSortMode; label: string }[] = [
  { value: "manual", label: "Manual order" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "type", label: "Type" },
];

function findEntryByPath(entries: Entry[], path: string): Entry | null {
  for (const entry of entries) {
    if (entry.path === path) {
      return entry;
    }

    if (entry.type === "directory") {
      const child = findEntryByPath(entry.children, path);
      if (child) {
        return child;
      }
    }
  }

  return null;
}

function isDescendantPath(path: string, parent: string) {
  return path.startsWith(parent + "/") || path.startsWith(parent + "\\");
}

function isSameOrDescendantPath(path: string, parent: string) {
  return path === parent || isDescendantPath(path, parent);
}

async function writePinnedFileEntriesExport(pinnedPaths: string[]) {
  try {
    const dir = await appDataDir();
    await mkdir(dir, { recursive: true });
    const path = await resolve(dir, PINNED_FILE_ENTRIES_EXPORT);
    await writeTextFile(
      path,
      `${JSON.stringify(
        {
          version: 1,
          pinnedPaths,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    console.warn("Could not export pinned file entries for the web companion.", error);
  }
}

function replacePathPrefix(path: string, oldPath: string, newPath: string) {
  if (path === oldPath) {
    return newPath;
  }

  if (isDescendantPath(path, oldPath)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }

  return path;
}

function getParentPath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function findDirectoryChildren(entries: Entry[], parentPath: string, documentDir: string): Entry[] {
  if (parentPath === documentDir) {
    return entries;
  }

  for (const entry of entries) {
    if (entry.type === "file") {
      continue;
    }

    if (entry.path === parentPath) {
      return entry.children;
    }

    const child = findDirectoryChildren(entry.children, parentPath, documentDir);
    if (child.length > 0) {
      return child;
    }
  }

  return [];
}

function getFileTypeLabel(type: FileType, t: (key: string) => string) {
  return type === "pdf" ? "PDF" : t(`Files.FileType.${capitalize(type)}`);
}

function hasUnloadedDirectories(entries: Entry[]): boolean {
  return entries.some((entry) => {
    if (entry.type === "file") {
      return false;
    }

    return entry.childrenLoaded !== true || hasUnloadedDirectories(entry.children);
  });
}

function withDirectoryChildren(entries: Entry[], path: string, children: Entry[]): Entry[] {
  return entries.map((entry) => {
    if (entry.type === "file") {
      return entry;
    }

    if (entry.path === path) {
      return {
        ...entry,
        children,
        childrenLoaded: true,
      };
    }

    return {
      ...entry,
      children: withDirectoryChildren(entry.children, path, children),
    };
  });
}

const useFileDirectory = (dir: string) => {
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [isDeepLoading, setIsDeepLoading] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<Entry[]>(["file-directory", dir], async () =>
    readDirectoryEntries(dir),
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      const directory = data ? findEntryByPath(data, path) : null;
      if (directory?.type !== "directory" || directory.childrenLoaded === true) {
        return;
      }

      setLoadingDirectories((current) => new Set(current).add(path));
      try {
        const children = await readDirectoryEntries(path);
        await mutate(
          (current) => (current ? withDirectoryChildren(current, path, children) : current),
          {
            revalidate: false,
          },
        );
      } finally {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [data, mutate],
  );

  const loadAllDirectories = useCallback(async () => {
    if (isDeepLoading || !data || !hasUnloadedDirectories(data)) {
      return;
    }

    setIsDeepLoading(true);
    try {
      const allEntries = await readDirectoryEntries(dir, { recursive: true });
      await mutate(allEntries, { revalidate: false });
    } finally {
      setIsDeepLoading(false);
    }
  }, [data, dir, isDeepLoading, mutate]);

  return {
    files: data,
    isLoading,
    isDeepLoading,
    loadingDirectories,
    error,
    mutate,
    loadDirectory,
    loadAllDirectories,
  };
};

function FilesPage() {
  const { t } = useTranslation();

  const { documentDir } = useLoaderData({ from: "/files" });
  const {
    files,
    isLoading,
    isDeepLoading,
    loadingDirectories,
    error,
    mutate,
    loadDirectory,
    loadAllDirectories,
  } = useFileDirectory(documentDir);
  const setTabs = useSetAtom(tabsAtom);
  const setRecentFiles = useSetAtom(recentFilesAtom);
  const [pinnedFiles, setPinnedFiles] = useAtom(pinnedFileEntriesAtom);
  const setArchivedFiles = useSetAtom(archivedFileEntriesAtom);
  const [manualOrder, setManualOrder] = useAtom(manualFileEntryOrderAtom);
  const [sortMode, setSortMode] = useAtom(filesSortModeAtom);
  const activeSortLabel =
    SORT_OPTIONS.find((option) => option.value === sortMode)?.label ?? SORT_OPTIONS[0].label;

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [renameTarget, setRenameTarget] = useState<Entry | null>(null);
  const [games, setGames] = useState<Map<number, string>>(new Map());
  const [filter, setFilter] = useState<FileType | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [deleteModal, toggleDeleteModal] = useToggle();
  const [createModal, toggleCreateModal] = useToggle();
  const [createDirModal, toggleCreateDirModal] = useToggle();
  const [importDatabaseModal, toggleImportDatabaseModal] = useToggle();
  const [editModal, toggleEditModal] = useToggle();
  const [renameModal, toggleRenameModal] = useToggle();

  const searchInputRef = useRef<HTMLInputElement>(null);

  useHotkeys([
    ["mod+f", () => searchInputRef.current?.focus()],
    [
      "Delete",
      () => {
        if (selected && !deleteModal) {
          toggleDeleteModal();
        }
      },
    ],
  ]);

  useEffect(() => {
    setGames(new Map());
  }, [selected]);

  useEffect(() => {
    void writePinnedFileEntriesExport(pinnedFiles);
  }, [pinnedFiles]);

  useEffect(() => {
    if (!files || !selected) {
      return;
    }

    const canonicalSelection = findEntryByPath(files, selected.path);

    if (!canonicalSelection) {
      setSelected(null);
      return;
    }

    if (canonicalSelection !== selected) {
      setSelected(canonicalSelection);
    }
  }, [files, selected]);

  useEffect(() => {
    if (!files || !(search || filter)) {
      return;
    }

    void loadAllDirectories();
  }, [files, filter, loadAllDirectories, search]);

  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<DropTarget | null>(null);
  const folderRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const rowRefs = useRef<Map<string, { entry: DragRowRegistration; ref: HTMLDivElement }>>(
    new Map(),
  );
  const rootDropzoneRef = useRef<HTMLDivElement>(null);

  const registerFolder = useCallback((path: string, ref: HTMLDivElement | null) => {
    if (ref) {
      folderRefs.current.set(path, ref);
    } else {
      folderRefs.current.delete(path);
    }
  }, []);

  const registerRow = useCallback((entry: DragRowRegistration, ref: HTMLDivElement | null) => {
    if (ref) {
      rowRefs.current.set(entry.path, { entry, ref });
    } else {
      rowRefs.current.delete(entry.path);
    }
  }, []);

  const getDropTarget = useCallback(
    (clientX: number, clientY: number, activeDraggingPath = draggingPath) => {
      let hovered: DropTarget | null = null;
      let minArea = Infinity;
      let blockedByInvalidFolder = false;
      const draggingRow = activeDraggingPath ? rowRefs.current.get(activeDraggingPath) : null;

      for (const [path, { entry, ref }] of rowRefs.current.entries()) {
        const rect = ref.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          if (activeDraggingPath && path === activeDraggingPath) {
            continue;
          }

          if (activeDraggingPath && isDescendantPath(path, activeDraggingPath)) {
            blockedByInvalidFolder = true;
            continue;
          }

          const relativeY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
          const canReorder =
            draggingRow &&
            draggingRow.entry.parentPath === entry.parentPath &&
            draggingRow.entry.parentPath !== "" &&
            !search &&
            !filter;

          const area = rect.width * rect.height;
          if (area < minArea) {
            minArea = area;
            if (canReorder && relativeY <= ROW_REORDER_EDGE_RATIO) {
              hovered = { kind: "before", path };
            } else if (canReorder && relativeY >= 1 - ROW_REORDER_EDGE_RATIO) {
              hovered = { kind: "after", path };
            } else if (entry.type === "directory") {
              hovered = { kind: "into", path };
            } else {
              hovered = null;
            }
          }
        }
      }

      if (blockedByInvalidFolder) {
        return null;
      }

      if (!hovered && rootDropzoneRef.current) {
        const rect = rootDropzoneRef.current.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          hovered = { kind: "into", path: documentDir };
        }
      }

      return hovered;
    },
    [documentDir, draggingPath, filter, search],
  );

  const checkHover = useCallback(
    (clientX: number, clientY: number, activeDraggingPath?: string | null) => {
      setHoverTarget(getDropTarget(clientX, clientY, activeDraggingPath));
    },
    [getDropTarget],
  );

  const reorderEntry = useCallback(
    (sourcePath: string, targetPath: string, position: "before" | "after") => {
      if (!files || search || filter || sourcePath === targetPath) {
        return;
      }

      const sourceParent = getParentPath(sourcePath);
      const targetParent = getParentPath(targetPath);
      if (sourceParent !== targetParent) {
        return;
      }

      const visibleSiblingPaths = Array.from(rowRefs.current.values())
        .filter(({ entry }) => entry.parentPath === sourceParent)
        .sort((a, b) => a.ref.getBoundingClientRect().top - b.ref.getBoundingClientRect().top)
        .map(({ entry }) => entry.path);
      const directorySiblingPaths = findDirectoryChildren(files, sourceParent, documentDir).map(
        (entry) => entry.path,
      );
      const knownSiblingPaths = Array.from(
        new Set([
          ...(manualOrder[sourceParent] ?? []),
          ...visibleSiblingPaths,
          ...directorySiblingPaths,
        ]),
      ).filter(
        (path) => directorySiblingPaths.includes(path) || visibleSiblingPaths.includes(path),
      );
      const nextOrder = knownSiblingPaths.filter((path) => path !== sourcePath);
      const targetIndex = nextOrder.indexOf(targetPath);

      if (targetIndex < 0) {
        return;
      }

      nextOrder.splice(position === "before" ? targetIndex : targetIndex + 1, 0, sourcePath);
      setManualOrder((current) => ({
        ...current,
        [sourceParent]: nextOrder,
      }));
      setSortMode("manual");
    },
    [documentDir, files, filter, manualOrder, search, setManualOrder, setSortMode],
  );

  const replaceManualOrderPathPrefix = useCallback(
    (oldPath: string, newPath: string) => {
      setManualOrder((current) =>
        Object.fromEntries(
          Object.entries(current).map(([parent, order]) => [
            replacePathPrefix(parent, oldPath, newPath),
            Array.from(new Set(order.map((path) => replacePathPrefix(path, oldPath, newPath)))),
          ]),
        ),
      );
    },
    [setManualOrder],
  );

  const requestDelete = useCallback(
    (entry: Entry) => {
      setSelected(entry);
      if (!deleteModal) {
        toggleDeleteModal();
      }
    },
    [deleteModal, toggleDeleteModal],
  );

  const requestRename = useCallback(
    (entry: Entry) => {
      setSelected(entry);
      setRenameTarget(entry);
      toggleRenameModal(true);
    },
    [toggleRenameModal],
  );

  const closeRenameModal = useCallback(
    (opened: boolean) => {
      toggleRenameModal(opened);
      if (!opened) {
        setRenameTarget(null);
      }
    },
    [toggleRenameModal],
  );

  const handleRenamed = useCallback(
    ({ oldPath, newPath, oldEntry, newEntry }: RenameResult) => {
      setTabs((currentTabs) =>
        currentTabs.map((tab) => {
          if (tab.gameOrigin.kind !== "file" && tab.gameOrigin.kind !== "temp_file") {
            return tab;
          }

          const file = tab.gameOrigin.file;
          const isAffected =
            oldEntry.type === "directory"
              ? isSameOrDescendantPath(file.path, oldPath)
              : file.path === oldPath;

          if (!isAffected) {
            return tab;
          }

          const isRenamedFile = oldEntry.type === "file" && file.path === oldPath;
          const nextFile = {
            ...file,
            path: replacePathPrefix(file.path, oldPath, newPath),
            name: isRenamedFile && newEntry.type === "file" ? newEntry.name : file.name,
          };

          return {
            ...tab,
            name:
              isRenamedFile && newEntry.type === "file" && tab.name === file.name
                ? newEntry.name
                : tab.name,
            gameOrigin: {
              ...tab.gameOrigin,
              file: nextFile,
            },
          };
        }),
      );

      setRecentFiles((recentFiles) =>
        recentFiles.map((file) => {
          const isAffected =
            oldEntry.type === "directory"
              ? isSameOrDescendantPath(file.path, oldPath)
              : file.path === oldPath;

          if (!isAffected) {
            return file;
          }

          const isRenamedFile = oldEntry.type === "file" && file.path === oldPath;

          return {
            ...file,
            path: replacePathPrefix(file.path, oldPath, newPath),
            name: isRenamedFile && newEntry.type === "file" ? newEntry.name : file.name,
          };
        }),
      );

      setPinnedFiles((pinnedFiles) =>
        Array.from(
          new Set(
            pinnedFiles.map((path) => {
              const isAffected =
                oldEntry.type === "directory"
                  ? isSameOrDescendantPath(path, oldPath)
                  : path === oldPath;

              return isAffected ? replacePathPrefix(path, oldPath, newPath) : path;
            }),
          ),
        ),
      );
      setArchivedFiles((archivedFiles) =>
        Array.from(
          new Set(
            archivedFiles.map((path) => {
              const isAffected =
                oldEntry.type === "directory"
                  ? isSameOrDescendantPath(path, oldPath)
                  : path === oldPath;

              return isAffected ? replacePathPrefix(path, oldPath, newPath) : path;
            }),
          ),
        ),
      );
      replaceManualOrderPathPrefix(oldPath, newPath);
    },
    [replaceManualOrderPathPrefix, setArchivedFiles, setPinnedFiles, setRecentFiles, setTabs],
  );

  const refreshDirectory = useCallback(() => mutate(), [mutate]);

  const handleConfirmDelete = useCallback(async () => {
    if (!selected) {
      return;
    }

    if (selected.type === "directory") {
      await remove(selected.path, { recursive: true });
    } else {
      await remove(selected.path);
      if (isPgnFile(selected)) {
        await remove(selected.path.replace(/\.pgn$/i, ".info")).catch(() => {});
      }
    }

    await mutate();
    toggleDeleteModal();
    setPinnedFiles((pinnedFiles) =>
      pinnedFiles.filter((path) =>
        selected.type === "directory"
          ? !isSameOrDescendantPath(path, selected.path)
          : path !== selected.path,
      ),
    );
    setArchivedFiles((archivedFiles) =>
      archivedFiles.filter((path) =>
        selected.type === "directory"
          ? !isSameOrDescendantPath(path, selected.path)
          : path !== selected.path,
      ),
    );
    setManualOrder((current) =>
      Object.fromEntries(
        Object.entries(current)
          .filter(([parent]) =>
            selected.type === "directory"
              ? !isSameOrDescendantPath(parent, selected.path)
              : parent !== selected.path,
          )
          .map(([parent, order]) => [
            parent,
            order.filter((path) =>
              selected.type === "directory"
                ? !isSameOrDescendantPath(path, selected.path)
                : path !== selected.path,
            ),
          ]),
      ),
    );
    setSelected(null);
  }, [selected, mutate, toggleDeleteModal, setArchivedFiles, setPinnedFiles, setManualOrder]);

  const dragContextValue = useMemo(
    () => ({
      draggingPath,
      setDraggingPath,
      hoverTarget,
      setHoverTarget,
      registerFolder,
      registerRow,
      getDropTarget,
      checkHover,
      reorderEntry,
      replaceOrderedPathPrefix: replaceManualOrderPathPrefix,
      documentDir,
    }),
    [
      draggingPath,
      hoverTarget,
      registerFolder,
      registerRow,
      getDropTarget,
      checkHover,
      reorderEntry,
      replaceManualOrderPathPrefix,
      documentDir,
    ],
  );

  const isRootDropActive =
    draggingPath !== null && hoverTarget?.kind === "into" && hoverTarget.path === documentDir;

  return (
    <Stack h="100%">
      {files && (
        <CreateModal
          opened={createModal}
          setOpened={toggleCreateModal}
          files={files}
          setFiles={mutate}
          setSelected={setSelected}
          selected={selected}
        />
      )}
      <CreateDirectoryModal
        opened={createDirModal}
        setOpened={toggleCreateDirModal}
        mutate={mutate}
        selected={selected}
      />
      <ImportDatabaseFolderModal
        opened={importDatabaseModal}
        setOpened={toggleImportDatabaseModal}
        mutate={mutate}
        selected={selected}
        setSelected={setSelected}
      />
      <RenameModal
        opened={renameModal}
        setOpened={closeRenameModal}
        entry={renameTarget}
        mutate={mutate}
        setSelected={setSelected}
        onRenamed={handleRenamed}
      />
      {selected && files && selected.type === "file" && isPgnFile(selected) && (
        <EditModal
          key={selected.name}
          opened={editModal}
          setOpened={toggleEditModal}
          mutate={mutate}
          setSelected={setSelected}
          metadata={selected as FileMetadata}
        />
      )}
      <Group align="baseline" pl="lg" py="sm">
        <Title>{t("Files.Title")}</Title>
        <OpenFolderButton folder={documentDir} />
      </Group>

      <Group grow flex={1} style={{ overflow: "hidden" }} px="md" pb="md">
        <Paper withBorder style={{ borderWidth: 2 }} h="100%">
          <Stack gap={0} h="100%" style={{ overflow: "hidden" }}>
            <Group p="xs" gap="xs">
              <Input
                size="sm"
                style={{ flexGrow: 1 }}
                leftSection={<IconSearch size="1rem" />}
                placeholder={t("Files.Search")}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                ref={searchInputRef}
                onKeyDown={(e) => {
                  if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                  }
                  if (e.key === "Escape") {
                    setSearch("");
                    searchInputRef.current?.blur();
                  }
                }}
              />
              <Menu shadow="md" width={180} position="bottom-end">
                <Menu.Target>
                  <ActionIcon
                    aria-label={`Sort files: ${activeSortLabel}`}
                    variant="default"
                    size="lg"
                  >
                    <IconArrowsSort size="1rem" />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Sort files</Menu.Label>
                  {SORT_OPTIONS.map((option) => (
                    <Menu.Item
                      key={option.value}
                      leftSection={sortMode === option.value ? <IconCheck size={14} /> : null}
                      onClick={() => setSortMode(option.value)}
                    >
                      {option.label}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
              <Tooltip label={t("Files.CreateFile.Title")}>
                <ActionIcon variant="default" size="lg" onClick={() => toggleCreateModal()}>
                  <IconFilePlus size="1rem" />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("Files.CreateDirectory.Title")}>
                <ActionIcon variant="default" size="lg" onClick={() => toggleCreateDirModal()}>
                  <IconFolderPlus size="1rem" />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Import database as files">
                <ActionIcon
                  aria-label="Import database as files"
                  variant="default"
                  size="lg"
                  onClick={() => toggleImportDatabaseModal()}
                >
                  <IconFileImport size="1rem" />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Divider />
            <Group px="xs" py={6} gap={4} wrap="wrap">
              {FILE_TYPES.map((type) => (
                <Chip
                  variant="outline"
                  key={type}
                  size="sm"
                  checked={filter === type}
                  onChange={(checked) => {
                    setFilter(checked ? type : null);
                    if (checked) setShowArchived(false);
                  }}
                >
                  {getFileTypeLabel(type, t)}
                </Chip>
              ))}
              <Chip
                variant="outline"
                size="sm"
                checked={showArchived}
                onChange={(checked) => {
                  setShowArchived(checked);
                  if (checked) setFilter(null);
                }}
              >
                Archived
              </Chip>
            </Group>
            <Divider />
            <ScrollArea
              flex={1}
              viewportRef={rootDropzoneRef}
              className={clsx(treeClasses.rootDropTarget, {
                [treeClasses.rootDropTargetActive]: isRootDropActive,
              })}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('[data-files-tree-row="true"]')) {
                  return;
                }
                setSelected(null);
              }}
            >
              {error ? (
                <Center h="100%">
                  <Text c="red">Failed to load files.</Text>
                </Center>
              ) : isLoading ? (
                <Center h="100%">
                  <Text c="dimmed">Loading files...</Text>
                </Center>
              ) : (
                <DragContext.Provider value={dragContextValue}>
                  <DirectoryTree
                    files={files}
                    refreshDirectory={refreshDirectory}
                    loadDirectory={loadDirectory}
                    loadingDirectories={loadingDirectories}
                    isDeepLoading={isDeepLoading}
                    selectedFile={selected}
                    setSelectedFile={setSelected}
                    onRequestDelete={requestDelete}
                    onRequestRename={requestRename}
                    search={search}
                    filter={filter || ""}
                    showArchived={showArchived}
                    sortMode={sortMode}
                    documentDir={documentDir}
                  />
                </DragContext.Provider>
              )}
            </ScrollArea>
          </Stack>
        </Paper>

        {selected ? (
          <>
            <ConfirmModal
              title={t("Files.Delete.Title")}
              description={t("Files.Delete.Message", {
                fileName: selected.name,
              })}
              opened={deleteModal}
              onClose={toggleDeleteModal}
              onConfirm={handleConfirmDelete}
            />
            {selected.type === "file" ? (
              <Paper withBorder style={{ borderWidth: 2 }} pt="md" h="100%">
                <FileCard
                  selected={selected}
                  games={games}
                  setGames={setGames}
                  toggleEditModal={toggleEditModal}
                />
              </Paper>
            ) : (
              <Paper withBorder style={{ borderWidth: 2 }} p="md" h="100%">
                <Center h="100%">
                  <Stack align="center" gap="xs">
                    <ThemeIcon size={80} radius="100%" variant="light" color="gray">
                      <IconFolder size={40} />
                    </ThemeIcon>
                    <Text fw={600} size="lg">
                      {selected.name}
                    </Text>
                    <Text c="dimmed" size="sm">
                      {(selected as Directory).childrenLoaded !== true
                        ? "Open folder to load items"
                        : (selected as Directory).children.length === 1
                          ? "1 item"
                          : `${(selected as Directory).children.length} items`}
                    </Text>
                  </Stack>
                </Center>
              </Paper>
            )}
          </>
        ) : (
          <Paper withBorder style={{ borderWidth: 2 }} p="md" h="100%">
            <Center h="100%">
              <Stack align="center" gap="sm">
                <ThemeIcon size={80} radius="100%" variant="light" color="gray">
                  <IconFileDescription size={40} />
                </ThemeIcon>
                <Text c="dimmed" fw={500} size="lg">
                  {t("Files.NoSelection")}
                </Text>
              </Stack>
            </Center>
          </Paper>
        )}
      </Group>
    </Stack>
  );
}
export default FilesPage;
