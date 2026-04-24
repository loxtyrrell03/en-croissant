import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { ActionIcon, ScrollArea, Tabs } from "@mantine/core";
import { useHotkeys, useToggle } from "@mantine/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { commands } from "@/bindings";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { createTab, genID, isPersistentGameOrigin, type Tab } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import BoardAnalysis from "../boards/BoardAnalysis";
import BoardGame from "../boards/BoardGame";
import { TreeStateProvider } from "../common/TreeStateContext";
import Puzzles from "../puzzles/Puzzles";
import { BoardTab } from "./BoardTab";
import ConfirmChangesModal from "./ConfirmChangesModal";
import NewTabHome from "./NewTabHome";
import { platform } from "@tauri-apps/plugin-os";
import { atomWithStorage } from "jotai/utils";
import classes from "./BoardsPage.module.css";

export default function BoardsPage() {
  const { t } = useTranslation();

  const [tabs, setTabs] = useAtom(tabsAtom);
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  const [saveModalOpened, toggleSaveModal] = useToggle();

  useEffect(() => {
    if (tabs.length === 0) {
      createTab({
        tab: { name: t("Tab.NewTab"), type: "new" },
        setTabs,
        setActiveTab,
      });
    }
  }, [tabs, setActiveTab, setTabs, t]);

  const closeTab = useCallback(
    async (value: string | null, forced?: boolean) => {
      if (value !== null) {
        const closedTab = tabs.find((tab) => tab.value === value);
        const tabState = JSON.parse(sessionStorage.getItem(value) || "{}");
        if (tabState && isPersistentGameOrigin(closedTab) && tabState.state.dirty && !forced) {
          toggleSaveModal();
          return;
        }
        if (value === activeTab) {
          const index = tabs.findIndex((tab) => tab.value === value);
          if (tabs.length > 1) {
            if (index === tabs.length - 1) {
              startTransition(() => setActiveTab(tabs[index - 1].value));
            } else {
              startTransition(() => setActiveTab(tabs[index + 1].value));
            }
          } else {
            startTransition(() => setActiveTab(null));
          }
        }
        setTabs((prev) => prev.filter((tab) => tab.value !== value));
        unwrap(await commands.killEngines(value));
        await commands.abortGame(`${value}-game`);
      }
    },
    [tabs, activeTab, setTabs, toggleSaveModal, setActiveTab],
  );

  function selectTab(index: number) {
    setActiveTab(tabs[Math.min(index, tabs.length - 1)].value);
  }

  function cycleTabs(reverse = false) {
    const index = tabs.findIndex((tab) => tab.value === activeTab);
    if (reverse) {
      if (index === 0) {
        setActiveTab(tabs[tabs.length - 1].value);
      } else {
        setActiveTab(tabs[index - 1].value);
      }
    } else {
      if (index === tabs.length - 1) {
        setActiveTab(tabs[0].value);
      } else {
        setActiveTab(tabs[index + 1].value);
      }
    }
  }

  const renameTab = useCallback(
    (value: string, name: string) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.value === value) {
            return { ...tab, name };
          }
          return tab;
        }),
      );
    },
    [setTabs],
  );

  const duplicateTab = useCallback(
    (value: string) => {
      const id = genID();
      const tab = tabs.find((tab) => tab.value === value);
      if (sessionStorage.getItem(value)) {
        sessionStorage.setItem(id, sessionStorage.getItem(value) || "");
      }

      if (tab) {
        setTabs((prev) => [
          ...prev,
          {
            name: tab.name,
            value: id,
            type: tab.type,
            gameOrigin: tab.gameOrigin,
          },
        ]);
        startTransition(() => setActiveTab(id));
      }
    },
    [tabs, setTabs, setActiveTab],
  );

  useEffect(() => {
    if (platform() !== "macos") return;

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        e.stopPropagation();
        closeTab(activeTab);
      }
    };

    window.addEventListener("keydown", handler, { capture: true });

    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [activeTab, closeTab]);

  const keyMap = useAtomValue(keyMapAtom);

  const handleSetActiveTab = useCallback(
    (v: string) => {
      startTransition(() => setActiveTab(v));
    },
    [setActiveTab],
  );
  useHotkeys([
    [keyMap.CLOSE_TAB.keys, () => closeTab(activeTab)],
    [keyMap.CYCLE_TABS.keys, () => cycleTabs()],
    [keyMap.REVERSE_CYCLE_TABS.keys, () => cycleTabs(true)],
    ["alt+1", () => selectTab(0)],
    ["ctrl+1", () => selectTab(0)],
    ["alt+2", () => selectTab(1)],
    ["ctrl+2", () => selectTab(1)],
    ["alt+3", () => selectTab(2)],
    ["ctrl+3", () => selectTab(2)],
    ["alt+4", () => selectTab(3)],
    ["ctrl+4", () => selectTab(3)],
    ["alt+5", () => selectTab(4)],
    ["ctrl+5", () => selectTab(4)],
    ["alt+6", () => selectTab(5)],
    ["ctrl+6", () => selectTab(5)],
    ["alt+7", () => selectTab(6)],
    ["ctrl+7", () => selectTab(6)],
    ["alt+8", () => selectTab(7)],
    ["ctrl+8", () => selectTab(7)],
    ["alt+9", () => selectTab(tabs.length - 1)],
    ["ctrl+9", () => selectTab(tabs.length - 1)],
  ]);

  return (
    <Tabs
      value={activeTab}
      onChange={(v) => setActiveTab(v)}
      keepMounted={false}
      className={classes.tabsContainer}
    >
      <ScrollArea scrollbarSize={6} className={classes.tabsHeader}>
        <DragDropContext
          onDragEnd={({ destination, source }) =>
            destination?.index !== undefined &&
            setTabs((prev) => {
              const result = Array.from(prev);
              const [removed] = result.splice(source.index, 1);
              result.splice(destination.index, 0, removed);
              return result;
            })
          }
        >
          <Droppable droppableId="droppable" direction="horizontal">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} style={{ display: "flex" }}>
                {tabs.map((tab, i) => (
                  <Draggable key={tab.value} draggableId={tab.value} index={i}>
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                      >
                        <BoardTab
                          tab={tab}
                          tabType={tab.type}
                          setActiveTab={handleSetActiveTab}
                          closeTab={closeTab}
                          renameTab={renameTab}
                          duplicateTab={duplicateTab}
                          selected={activeTab === tab.value}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
                <ActionIcon
                  variant="default"
                  radius={0}
                  onClick={() =>
                    createTab({
                      tab: {
                        name: t("Tab.NewTab"),
                        type: "new",
                      },
                      setTabs,
                      setActiveTab,
                    })
                  }
                  classNames={{
                    root: classes.newTab,
                  }}
                >
                  <IconPlus />
                </ActionIcon>
                <div className={classes.tabsFiller} />
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </ScrollArea>
      {tabs.map((tab) => (
        <Tabs.Panel key={tab.value} value={tab.value} h="100%" w="100%" pb="sm" px="xs">
          <TabSwitch
            tab={tab}
            saveModalOpened={saveModalOpened}
            toggleSaveModal={toggleSaveModal}
            closeTab={closeTab}
            activeTab={activeTab}
          />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

interface WorkspaceLayoutState {
  rightWidthPercent: number;
  topRightHeight: number | null;
  bottomRightHeight: number | null;
}

const workspaceLayoutAtom = atomWithStorage<WorkspaceLayoutState>("boardWorkspaceLayout", {
  rightWidthPercent: 54,
  topRightHeight: null,
  bottomRightHeight: null,
});

const MIN_LEFT_WIDTH = 360;
const MIN_RIGHT_WIDTH = 420;
const MIN_TOP_RIGHT_HEIGHT = 180;
const MIN_BOTTOM_RIGHT_HEIGHT = 120;
const DEFAULT_TOP_RIGHT_RATIO = 0.76;
const DEFAULT_BOTTOM_RIGHT_RATIO = 0.3;

function BoardWorkspaceLayout() {
  const [layout, setLayout] = useAtom(workspaceLayoutAtom);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setContainerSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const availableHeight = Math.max(containerSize.height - 10, 0);
  const defaultTopHeight = Math.max(
    MIN_TOP_RIGHT_HEIGHT,
    Math.round(availableHeight * DEFAULT_TOP_RIGHT_RATIO),
  );
  const defaultBottomHeight = Math.max(
    MIN_BOTTOM_RIGHT_HEIGHT,
    Math.round(availableHeight * DEFAULT_BOTTOM_RIGHT_RATIO),
  );
  const topRightHeight = Math.max(MIN_TOP_RIGHT_HEIGHT, layout.topRightHeight ?? defaultTopHeight);
  const bottomRightHeight = Math.max(
    MIN_BOTTOM_RIGHT_HEIGHT,
    layout.bottomRightHeight ?? defaultBottomHeight,
  );

  const clampedRightWidthPercent = clampRightWidthPercent(
    layout.rightWidthPercent,
    containerSize.width,
  );

  const startColumnResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    event.preventDefault();

    const rect = container.getBoundingClientRect();
    const startX = event.clientX;
    const startRightWidth = (clampedRightWidthPercent / 100) * rect.width;

    startDragCursor("col-resize");

    const onPointerMove = (moveEvent: PointerEvent) => {
      const bounds = getRightWidthBounds(rect.width);
      const nextRightWidth = clamp(
        startRightWidth - (moveEvent.clientX - startX),
        bounds.min,
        bounds.max,
      );

      setLayout((current) => ({
        ...current,
        rightWidthPercent: (nextRightWidth / rect.width) * 100,
      }));
    };

    const stop = () => {
      stopDragCursor();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const startRightPaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startY = event.clientY;
    const startTopHeight = topRightHeight;
    const startBottomHeight = bottomRightHeight;

    startDragCursor("row-resize");

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;

      setLayout((current) => ({
        ...current,
        topRightHeight: Math.max(MIN_TOP_RIGHT_HEIGHT, startTopHeight + deltaY),
        bottomRightHeight: Math.max(MIN_BOTTOM_RIGHT_HEIGHT, startBottomHeight - deltaY),
      }));
    };

    const stop = () => {
      stopDragCursor();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return (
    <div className={classes.workspaceLayout} ref={containerRef}>
      <div
        id="left"
        className={classes.leftPane}
        style={{
          flexBasis: `${100 - clampedRightWidthPercent}%`,
        }}
      />
      <div
        className={classes.columnResizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize board and side panels"
        onPointerDown={startColumnResize}
      />
      <div
        className={classes.rightColumn}
        style={{
          flexBasis: `${clampedRightWidthPercent}%`,
        }}
      >
        <div className={classes.rightColumnScroller}>
          <div
            id="topRight"
            className={classes.rightPane}
            style={{
              height: topRightHeight,
            }}
          />
          <div
            className={classes.rowResizeHandle}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize right side panels"
            onPointerDown={startRightPaneResize}
          />
          <div
            id="bottomRight"
            className={classes.rightPane}
            style={{
              height: bottomRightHeight,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampRightWidthPercent(percent: number, containerWidth: number) {
  if (containerWidth <= 0) return percent;

  const bounds = getRightWidthBounds(containerWidth);
  const minPercent = (bounds.min / containerWidth) * 100;
  const maxPercent = (bounds.max / containerWidth) * 100;

  if (maxPercent < minPercent) return 50;
  return clamp(percent, minPercent, maxPercent);
}

function getRightWidthBounds(containerWidth: number) {
  const min = Math.min(MIN_RIGHT_WIDTH, containerWidth / 2);
  const minLeftWidth = Math.min(MIN_LEFT_WIDTH, containerWidth - min);
  const max = Math.max(min, containerWidth - minLeftWidth);

  return { min, max };
}

function startDragCursor(cursor: string) {
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
}

function stopDragCursor() {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

function TabSwitch({
  tab,
  saveModalOpened,
  toggleSaveModal,
  closeTab,
  activeTab,
}: {
  tab: Tab;
  saveModalOpened: boolean;
  toggleSaveModal: () => void;
  closeTab: (value: string | null, forced?: boolean) => void;
  activeTab: string | null;
}) {
  return match(tab.type)
    .with("new", () => <NewTabHome id={tab.value} />)
    .with("play", () => (
      <TreeStateProvider id={tab.value}>
        <BoardWorkspaceLayout />
        <BoardGame />
      </TreeStateProvider>
    ))
    .with("analysis", () => (
      <TreeStateProvider id={tab.value}>
        <BoardWorkspaceLayout />
        <BoardAnalysis />
        <ConfirmChangesModal
          opened={saveModalOpened}
          toggle={toggleSaveModal}
          closeTab={() => closeTab(activeTab, true)}
        />
      </TreeStateProvider>
    ))
    .with("puzzles", () => (
      <TreeStateProvider id={tab.value}>
        <BoardWorkspaceLayout />
        <Puzzles id={tab.value} />
      </TreeStateProvider>
    ))
    .exhaustive();
}
