import {
  ActionIcon,
  Center,
  Chip,
  Divider,
  Group,
  Input,
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
  IconFilePlus,
  IconFolderPlus,
  IconSearch,
  IconFolder,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { readDir, remove } from "@tauri-apps/plugin-fs";
import clsx from "clsx";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { recentFilesAtom, tabsAtom } from "@/state/atoms";
import { capitalize } from "@/utils/format";
import ConfirmModal from "../common/ConfirmModal";
import OpenFolderButton from "../common/OpenFolderButton";
import DirectoryTree from "./DirectoryTree";
import { DragContext } from "./DirectoryTree";
import treeClasses from "./DirectoryTree.module.css";
import FileCard from "./FileCard";
import {
  type Directory,
  type FileMetadata,
  type FileType,
  processEntriesRecursively,
} from "./file";
import {
  CreateDirectoryModal,
  CreateModal,
  EditModal,
  RenameModal,
  type RenameResult,
} from "./Modals";

const FILE_TYPES: FileType[] = ["game", "repertoire", "tournament", "puzzle", "other"];
type Entry = FileMetadata | Directory;

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

function replacePathPrefix(path: string, oldPath: string, newPath: string) {
  if (path === oldPath) {
    return newPath;
  }

  if (isDescendantPath(path, oldPath)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }

  return path;
}

const useFileDirectory = (dir: string) => {
  const { data, error, isLoading, mutate } = useSWR<Entry[]>(["file-directory", dir], async () => {
    const entries = await readDir(dir);
    const allEntries = processEntriesRecursively(dir, entries);

    return allEntries;
  });
  return {
    files: data,
    isLoading,
    error,
    mutate,
  };
};

function FilesPage() {
  const { t } = useTranslation();

  const { documentDir } = useLoaderData({ from: "/files" });
  const { files, isLoading, error, mutate } = useFileDirectory(documentDir);
  const setTabs = useSetAtom(tabsAtom);
  const setRecentFiles = useSetAtom(recentFilesAtom);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [renameTarget, setRenameTarget] = useState<Entry | null>(null);
  const [games, setGames] = useState<Map<number, string>>(new Map());
  const [filter, setFilter] = useState<FileType | null>(null);

  const [deleteModal, toggleDeleteModal] = useToggle();
  const [createModal, toggleCreateModal] = useToggle();
  const [createDirModal, toggleCreateDirModal] = useToggle();
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

  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const folderRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const rootDropzoneRef = useRef<HTMLDivElement>(null);

  const registerFolder = useCallback((path: string, ref: HTMLDivElement | null) => {
    if (ref) {
      folderRefs.current.set(path, ref);
    } else {
      folderRefs.current.delete(path);
    }
  }, []);

  const getDropTarget = useCallback(
    (clientX: number, clientY: number, activeDraggingPath = draggingPath) => {
      let hovered: string | null = null;
      let minArea = Infinity;
      let blockedByInvalidFolder = false;

      // Check all folder row bounding rects
      // Since child folders are visually inside their parent's bounding box sometimes depending
      // on DOM flow, we want the most specific (smallest) matched box
      for (const [path, ref] of folderRefs.current.entries()) {
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

          const area = rect.width * rect.height;
          if (area < minArea) {
            minArea = area;
            hovered = path;
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
          hovered = documentDir;
        }
      }

      return hovered;
    },
    [documentDir, draggingPath],
  );

  const checkHover = useCallback(
    (clientX: number, clientY: number, activeDraggingPath?: string | null) => {
      setHoverPath(getDropTarget(clientX, clientY, activeDraggingPath));
    },
    [getDropTarget],
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
    },
    [setRecentFiles, setTabs],
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
      await remove(selected.path.replace(".pgn", ".info")).catch(() => {});
    }

    await mutate();
    toggleDeleteModal();
    setSelected(null);
  }, [selected, mutate, toggleDeleteModal]);

  const dragContextValue = useMemo(
    () => ({
      draggingPath,
      setDraggingPath,
      hoverPath,
      setHoverPath,
      registerFolder,
      getDropTarget,
      checkHover,
      documentDir,
    }),
    [draggingPath, hoverPath, registerFolder, getDropTarget, checkHover, documentDir],
  );

  const isRootDropActive = draggingPath !== null && hoverPath === documentDir;

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
      <RenameModal
        opened={renameModal}
        setOpened={closeRenameModal}
        entry={renameTarget}
        mutate={mutate}
        setSelected={setSelected}
        onRenamed={handleRenamed}
      />
      {selected && files && selected.type === "file" && (
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
            </Group>
            <Divider />
            <Group px="xs" py={6} gap={4} wrap="wrap">
              {FILE_TYPES.map((type) => (
                <Chip
                  variant="outline"
                  key={type}
                  size="sm"
                  checked={filter === type}
                  onChange={(checked) => setFilter(checked ? type : null)}
                >
                  {t(`Files.FileType.${capitalize(type)}`)}
                </Chip>
              ))}
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
                    selectedFile={selected}
                    setSelectedFile={setSelected}
                    onRequestDelete={requestDelete}
                    onRequestRename={requestRename}
                    search={search}
                    filter={filter || ""}
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
                      {(selected as Directory).children.length === 1
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
