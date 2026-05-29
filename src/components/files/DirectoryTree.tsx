import { Badge, Box, Loader, Text } from "@mantine/core";
import {
  IconChevronRight,
  IconEdit,
  IconEye,
  IconFolder,
  IconFolderOpen,
  IconPinned,
  IconPinnedOff,
  IconTarget,
  IconTrash,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { basename, join, sep } from "@tauri-apps/api/path";
import { rename } from "@tauri-apps/plugin-fs";
import clsx from "clsx";
import Fuse from "fuse.js";
import { useAtom, useSetAtom } from "jotai";
import { useContextMenu } from "mantine-contextmenu";
import Draggable, { type DraggableEvent } from "react-draggable";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import {
  activeTabAtom,
  deckAtomFamily,
  tabsAtom,
  expandedDirectoriesAtom,
  pinnedFileEntriesAtom,
  type FilesSortMode,
} from "@/state/atoms";
import { openFile } from "@/utils/files";
import classes from "./DirectoryTree.module.css";
import { getFileExtension, isPdfFile, isPgnFile, stripSupportedFileExtension } from "./file";
import type { Directory, FileMetadata } from "./file";
import { getStats } from "./opening";
import { FileIcon } from "./FileIcon";

type DragContextType = {
  draggingPath: string | null;
  setDraggingPath: (path: string | null) => void;
  hoverPath: string | null;
  setHoverPath: (path: string | null) => void;
  registerFolder: (path: string, ref: HTMLDivElement | null) => void;
  getDropTarget: (clientX: number, clientY: number, draggingPath?: string | null) => string | null;
  checkHover: (clientX: number, clientY: number, draggingPath?: string | null) => void;
  documentDir: string;
};

export const DragContext = createContext<DragContextType | null>(null);

const DRAG_START_THRESHOLD_PX = 8;
const TREE_BASE_PADDING_PX = 8;
const TREE_INDENT_PX = 16;
type Entry = FileMetadata | Directory;
type ShowContextMenu = ReturnType<typeof useContextMenu>["showContextMenu"];

function flattenFiles(files: Entry[]): Entry[] {
  return files.flatMap((f) => (f.type === "directory" ? flattenFiles(f.children) : [f]));
}

function filterTree(files: Entry[], predicate: (file: FileMetadata) => boolean): Entry[] {
  return files
    .map((file) => {
      if (file.type === "file") {
        return predicate(file) ? file : null;
      }

      const children = filterTree(file.children, predicate);
      return children.length > 0 ? { ...file, children } : null;
    })
    .filter((file): file is Entry => file !== null);
}

function getEventPoint(event: DraggableEvent): { x: number; y: number } | null {
  if ("clientX" in event && "clientY" in event) {
    return { x: event.clientX, y: event.clientY };
  }

  if ("touches" in event && event.touches.length > 0) {
    const touch = event.touches[0];
    return { x: touch.clientX, y: touch.clientY };
  }

  return null;
}

function getEntryTimestamp(entry: Entry): number {
  return entry.lastModified;
}

function replacePathPrefix(path: string, oldPath: string, newPath: string) {
  if (path === oldPath) {
    return newPath;
  }

  if (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }

  return path;
}

function recursiveSort(
  files: Entry[],
  pruneEmpty = false,
  pinnedPaths: ReadonlySet<string> = new Set(),
  sortMode: FilesSortMode = "newest",
): Entry[] {
  return files
    .map((f) => {
      if (f.type === "file") return f;
      return {
        ...f,
        children: recursiveSort(f.children, pruneEmpty, pinnedPaths, sortMode),
      };
    })
    .filter((f) => {
      return f.type === "file" || !pruneEmpty || f.children.length > 0;
    })
    .sort((a, b) => {
      const pinnedDifference = Number(pinnedPaths.has(b.path)) - Number(pinnedPaths.has(a.path));
      if (pinnedDifference !== 0) {
        return pinnedDifference;
      }

      const modeDifference = compareEntriesByMode(a, b, sortMode);

      if (modeDifference !== 0) {
        return modeDifference;
      }

      return compareNames(a, b, "asc");
    });
}

function compareEntriesByMode(a: Entry, b: Entry, sortMode: FilesSortMode): number {
  switch (sortMode) {
    case "oldest":
      return getEntryTimestamp(a) - getEntryTimestamp(b);
    case "name-asc":
      return compareNames(a, b, "asc");
    case "name-desc":
      return compareNames(a, b, "desc");
    case "type": {
      const typeDifference = getEntryTypeLabel(a).localeCompare(getEntryTypeLabel(b), "en", {
        numeric: true,
        sensitivity: "base",
      });
      return typeDifference || compareNames(a, b, "asc");
    }
    case "newest":
    default:
      return getEntryTimestamp(b) - getEntryTimestamp(a);
  }
}

function compareNames(a: Entry, b: Entry, direction: "asc" | "desc") {
  const result = a.name.localeCompare(b.name, "en", {
    numeric: true,
    sensitivity: "base",
  });

  return direction === "asc" ? result : -result;
}

function getEntryTypeLabel(entry: Entry) {
  return entry.type === "directory" ? "folder" : entry.metadata.type;
}

export default function DirectoryTree({
  files,
  refreshDirectory,
  loadDirectory,
  loadingDirectories,
  isDeepLoading,
  selectedFile,
  setSelectedFile,
  onRequestDelete,
  onRequestRename,
  search,
  filter,
  sortMode,
}: {
  files: Entry[] | undefined;
  refreshDirectory: () => Promise<unknown>;
  loadDirectory: (path: string) => Promise<void>;
  loadingDirectories: Set<string>;
  isDeepLoading: boolean;
  selectedFile: Entry | null;
  setSelectedFile: (file: Entry | null) => void;
  onRequestDelete: (file: Entry) => void;
  onRequestRename: (file: Entry) => void;
  search: string;
  filter: string;
  sortMode: FilesSortMode;
}) {
  const [pinnedPaths, setPinnedPaths] = useAtom(pinnedFileEntriesAtom);
  const pinnedPathSet = useMemo(() => new Set(pinnedPaths), [pinnedPaths]);
  const flattedFiles = useMemo(() => flattenFiles(files ?? []), [files]);
  const fuse = useMemo(
    () =>
      new Fuse(flattedFiles ?? [], {
        keys: ["name"],
      }),
    [flattedFiles],
  );

  const filteredFiles = useMemo(() => {
    let next = files ?? [];

    if (search) {
      const searchMatches = new Set(fuse.search(search).map((result) => result.item.path));
      next = filterTree(next, (file) => searchMatches.has(file.path));
    }

    if (filter) {
      next = filterTree(next, (file) => file.metadata.type === filter);
    }

    return recursiveSort(next, !!(search || filter), pinnedPathSet, sortMode);
  }, [files, search, filter, fuse, pinnedPathSet, sortMode]);

  return (
    <Box className={classes.tree}>
      {isDeepLoading && (search || filter) && (
        <Box px="xs" py={4}>
          <Text size="xs" c="dimmed">
            Loading folders for search...
          </Text>
        </Box>
      )}
      <Tree
        files={filteredFiles}
        refreshDirectory={refreshDirectory}
        loadDirectory={loadDirectory}
        loadingDirectories={loadingDirectories}
        depth={0}
        selected={selectedFile}
        setSelectedFile={setSelectedFile}
        onRequestDelete={onRequestDelete}
        onRequestRename={onRequestRename}
        pinnedPaths={pinnedPathSet}
        setPinnedPaths={setPinnedPaths}
        expandedByDefault={!!(search || filter)}
      />
    </Box>
  );
}

function Tree({
  files,
  depth,
  refreshDirectory,
  loadDirectory,
  loadingDirectories,
  selected,
  setSelectedFile,
  onRequestDelete,
  onRequestRename,
  pinnedPaths,
  setPinnedPaths,
  expandedByDefault,
}: {
  files: Entry[];
  depth: number;
  refreshDirectory: () => Promise<unknown>;
  loadDirectory: (path: string) => Promise<void>;
  loadingDirectories: Set<string>;
  selected: Entry | null;
  setSelectedFile: (file: Entry | null) => void;
  onRequestDelete: (file: Entry) => void;
  onRequestRename: (file: Entry) => void;
  pinnedPaths: ReadonlySet<string>;
  setPinnedPaths: React.Dispatch<React.SetStateAction<string[]>>;
  expandedByDefault?: boolean;
}) {
  const [expandedIds, setExpandedIds] = useAtom(expandedDirectoriesAtom);
  const navigate = useNavigate();
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const { showContextMenu } = useContextMenu();

  const handleOpenFile = useCallback(
    async (record: FileMetadata) => {
      if (isPdfFile(record)) {
        setSelectedFile(record);
        return;
      }

      await openFile(record, setTabs, setActiveTab);
      void navigate({ to: "/" });
    },
    [setActiveTab, setTabs, navigate, setSelectedFile],
  );

  const toggleExpand = (node: Entry, event: React.MouseEvent) => {
    event.stopPropagation();
    const isCurrentlyExpanded = expandedIds.includes(node.path);
    setExpandedIds((prev) => {
      const next = [...prev];
      const index = next.indexOf(node.path);
      if (index >= 0) {
        next.splice(index, 1);
      } else {
        next.push(node.path);
      }
      return next;
    });

    if (!isCurrentlyExpanded && node.type === "directory" && node.childrenLoaded !== true) {
      void loadDirectory(node.path);
    }
  };

  useEffect(() => {
    if (expandedByDefault) {
      return;
    }

    for (const node of files) {
      if (
        node.type === "directory" &&
        expandedIds.includes(node.path) &&
        node.childrenLoaded !== true &&
        !loadingDirectories.has(node.path)
      ) {
        void loadDirectory(node.path);
      }
    }
  }, [expandedByDefault, expandedIds, files, loadDirectory, loadingDirectories]);

  return (
    <>
      {files.map((node) => {
        const isExpanded = expandedByDefault || expandedIds.includes(node.path);
        const isSelected = selected?.path === node.path;

        return (
          <DirectoryNode
            key={node.path}
            node={node}
            depth={depth}
            isSelected={isSelected}
            selectedFile={selected}
            isExpanded={isExpanded}
            setExpandedIds={setExpandedIds}
            toggleExpand={(e) => toggleExpand(node, e)}
            setSelectedFile={setSelectedFile}
            handleOpenFile={handleOpenFile}
            onRequestDelete={onRequestDelete}
            onRequestRename={onRequestRename}
            pinnedPaths={pinnedPaths}
            setPinnedPaths={setPinnedPaths}
            refreshDirectory={refreshDirectory}
            showContextMenu={showContextMenu}
          >
            {node.type === "directory" &&
              isExpanded &&
              (loadingDirectories.has(node.path) ? (
                <LoadingDirectoryRow depth={depth + 1} />
              ) : (
                node.children.length > 0 && (
                  <Tree
                    files={node.children}
                    refreshDirectory={refreshDirectory}
                    loadDirectory={loadDirectory}
                    loadingDirectories={loadingDirectories}
                    depth={depth + 1}
                    selected={selected}
                    setSelectedFile={setSelectedFile}
                    onRequestDelete={onRequestDelete}
                    onRequestRename={onRequestRename}
                    pinnedPaths={pinnedPaths}
                    setPinnedPaths={setPinnedPaths}
                    expandedByDefault={expandedByDefault}
                  />
                )
              ))}
          </DirectoryNode>
        );
      })}
    </>
  );
}

function LoadingDirectoryRow({ depth }: { depth: number }) {
  return (
    <div
      className={classes.row}
      style={{
        paddingLeft: TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX,
      }}
    >
      <div className={classes.iconContainer}>
        <Loader size={12} />
      </div>
      <Text component="span" size="xs" c="dimmed" className={classes.label}>
        Loading...
      </Text>
    </div>
  );
}

function DirectoryNode({
  node,
  depth,
  isSelected,
  selectedFile,
  isExpanded,
  setExpandedIds,
  toggleExpand,
  setSelectedFile,
  handleOpenFile,
  onRequestDelete,
  onRequestRename,
  pinnedPaths,
  setPinnedPaths,
  refreshDirectory,
  showContextMenu,
  children,
}: {
  node: Entry;
  depth: number;
  isSelected: boolean;
  selectedFile: Entry | null;
  isExpanded: boolean;
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>;
  toggleExpand: (e: React.MouseEvent) => void;
  setSelectedFile: (file: Entry | null) => void;
  handleOpenFile: (file: FileMetadata) => Promise<void>;
  onRequestDelete: (file: Entry) => void;
  onRequestRename: (file: Entry) => void;
  pinnedPaths: ReadonlySet<string>;
  setPinnedPaths: React.Dispatch<React.SetStateAction<string[]>>;
  refreshDirectory: () => Promise<unknown>;
  showContextMenu: ShowContextMenu;
  children?: React.ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const suppressClickRef = useRef(false);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragContext = useContext(DragContext);

  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const isPinned = pinnedPaths.has(node.path);

  const togglePin = useCallback(() => {
    setPinnedPaths((current) => {
      if (current.includes(node.path)) {
        return current.filter((path) => path !== node.path);
      }

      return [...current, node.path];
    });
  }, [node.path, setPinnedPaths]);

  useEffect(() => {
    if (!dragContext || node.type !== "directory") {
      return;
    }

    dragContext.registerFolder(node.path, rowRef.current);

    return () => {
      dragContext.registerFolder(node.path, null);
    };
  }, [node.path, node.type, dragContext]);

  const onDragStart = (e: DraggableEvent) => {
    didDragRef.current = false;
    dragStartPointRef.current = getEventPoint(e);
  };

  const onDragMove = (e: DraggableEvent) => {
    if (!dragContext) return;

    const point = getEventPoint(e);
    if (!point) {
      return;
    }

    if (!didDragRef.current && dragStartPointRef.current) {
      const dx = point.x - dragStartPointRef.current.x;
      const dy = point.y - dragStartPointRef.current.y;
      const distance = Math.hypot(dx, dy);

      if (distance >= DRAG_START_THRESHOLD_PX) {
        didDragRef.current = true;
        dragContext.setDraggingPath(node.path);
        setIsDraggingNode(true);
      }
    }

    if (!didDragRef.current) {
      return;
    }

    if (!isDraggingNode) setIsDraggingNode(true);
    dragContext.checkHover(point.x, point.y, node.path);
  };

  const onDragStop = (e: DraggableEvent) => {
    if (!dragContext) return;
    const wasDragging = didDragRef.current;
    didDragRef.current = false;
    dragStartPointRef.current = null;
    setIsDraggingNode(false);
    suppressClickRef.current = wasDragging;
    if (wasDragging) {
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }

    dragContext.setDraggingPath(null);
    const point = getEventPoint(e);
    const targetId = point
      ? dragContext.getDropTarget(point.x, point.y, node.path)
      : dragContext.hoverPath;
    dragContext.setHoverPath(null);

    if (!wasDragging || !targetId) return;

    const sourcePath = node.path;
    if (sourcePath === targetId) return;

    const handleDrop = async () => {
      const separator = sep();
      if (targetId!.startsWith(sourcePath + separator)) return;

      const sourceBasename = await basename(sourcePath);
      const targetPath = await join(targetId!, sourceBasename);

      if (sourcePath === targetPath) return;

      try {
        await rename(sourcePath, targetPath);
        if (node.type !== "directory" && isPgnFile(node)) {
          await rename(
            sourcePath.replace(/\.pgn$/i, ".info"),
            targetPath.replace(/\.pgn$/i, ".info"),
          ).catch(() => {});
        }
        await refreshDirectory();
        setPinnedPaths((current) =>
          Array.from(
            new Set(current.map((path) => replacePathPrefix(path, sourcePath, targetPath))),
          ),
        );
        if (targetId !== dragContext.documentDir) {
          setExpandedIds((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]));
        }

        if (selectedFile) {
          if (selectedFile.path === sourcePath) {
            setSelectedFile(
              selectedFile.type === "file"
                ? {
                    ...selectedFile,
                    path: targetPath,
                    name: stripSupportedFileExtension(sourceBasename),
                    extension: getFileExtension(selectedFile),
                  }
                : {
                    ...selectedFile,
                    path: targetPath,
                    name: sourceBasename,
                  },
            );
          } else if (selectedFile.path.startsWith(sourcePath + separator)) {
            const trailingPath = selectedFile.path.slice(sourcePath.length + separator.length);
            const newPath = await join(targetPath, trailingPath);
            setSelectedFile({ ...selectedFile, path: newPath });
          }
        }
      } catch (err) {
        console.error("Drop failed", err);
      }
    };

    void handleDrop();
  };

  const isOver =
    dragContext?.hoverPath === node.path &&
    node.type === "directory" &&
    dragContext?.draggingPath !== node.path &&
    !node.path.startsWith(dragContext?.draggingPath + "/") &&
    !node.path.startsWith(dragContext?.draggingPath + "\\");

  const contextMenuHandler = showContextMenu([
    {
      key: "pin-entry",
      icon: isPinned ? <IconPinnedOff size={16} /> : <IconPinned size={16} />,
      title: isPinned ? "Unpin" : "Pin",
      onClick: togglePin,
    },
    {
      key: "open-file",
      icon: <IconEye size={16} />,
      title: "Open",
      disabled: node.type === "directory",
      onClick: () => {
        if (node.type === "directory") return;
        void handleOpenFile(node);
      },
    },
    {
      key: "rename-file",
      icon: <IconEdit size={16} />,
      title: "Rename",
      onClick: () => {
        onRequestRename(node);
      },
    },
    {
      key: "delete-file",
      icon: <IconTrash size={16} />,
      title: "Delete",
      color: "red",
      onClick: () => {
        onRequestDelete(node);
      },
    },
  ]);

  return (
    <>
      <Draggable
        position={{ x: 0, y: 0 }}
        onStart={onDragStart}
        onDrag={onDragMove}
        onStop={onDragStop}
        scale={1}
        nodeRef={rowRef as React.RefObject<HTMLElement>}
      >
        <div
          ref={rowRef}
          data-files-tree-row="true"
          className={clsx(classes.row, {
            [classes.selected]: isSelected,
            [classes.dragOver]: isOver,
          })}
          style={{
            paddingLeft: TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX,
            opacity: isDraggingNode ? 0.5 : 1,
            zIndex: isDraggingNode ? 50 : undefined,
            position: "relative",
          }}
          onClick={(e) => {
            if (suppressClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }

            if (node.type === "directory") {
              toggleExpand(e);
              setSelectedFile(node);
            } else {
              setSelectedFile(node);
            }
          }}
          onDoubleClick={() => {
            if (node.type === "file") {
              void handleOpenFile(node);
            }
          }}
          onContextMenu={(event) => {
            setSelectedFile(node);
            contextMenuHandler(event);
          }}
        >
          {depth > 0 && (
            <div
              aria-hidden
              className={classes.guides}
              style={{
                left: TREE_BASE_PADDING_PX + TREE_INDENT_PX / 2,
                width: depth * TREE_INDENT_PX,
              }}
            />
          )}
          <div
            className={classes.iconContainer}
            onClick={(e) => {
              if (node.type === "directory") {
                toggleExpand(e);
              }
            }}
          >
            {node.type === "directory" && (
              <IconChevronRight
                className={clsx(classes.expandIcon, {
                  [classes.expandIconRotated]: isExpanded,
                })}
              />
            )}
          </div>
          {node.type === "directory" ? (
            isExpanded ? (
              <IconFolderOpen className={classes.typeIcon} />
            ) : (
              <IconFolder className={classes.typeIcon} />
            )
          ) : (
            <FileIcon type={node.metadata.type} className={classes.typeIcon} />
          )}
          <span className={classes.label}>{node.name}</span>
          {(isPinned || (node.type === "file" && node.metadata.type === "repertoire")) && (
            <div className={classes.badge}>
              {isPinned && <IconPinned size={12} />}
              {node.type === "file" && node.metadata.type === "repertoire" && (
                <DuePositions file={node.path} />
              )}
            </div>
          )}
        </div>
      </Draggable>
      {children}
    </>
  );
}

function DuePositions({ file }: { file: string }) {
  const [deck] = useAtom(
    deckAtomFamily({
      file,
      game: 0,
    }),
  );

  const stats = getStats(deck.positions);

  if (stats.due + stats.unseen === 0) return null;

  return (
    <Badge size="xs" variant="light" leftSection={<IconTarget size={10} />}>
      {stats.due + stats.unseen}
    </Badge>
  );
}
