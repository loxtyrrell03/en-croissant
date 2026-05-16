import { ActionIcon, Center, Loader, Paper, Portal, Stack, Tabs, Tooltip } from "@mantine/core";
import { useHotkeys, useToggle } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconBulb,
  IconDatabase,
  IconDeviceFloppy,
  IconGitCompare,
  IconInfoCircle,
  IconRoute,
  IconTarget,
  IconTargetArrow,
  IconTimeline,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { Piece } from "chessops";
import { useAtom, useAtomValue } from "jotai";
import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import {
  autoSaveAtom,
  currentPracticeTabAtom,
  currentTabAtom,
  currentTabSelectedAtom,
  deckAtomFamily,
  practiceStateAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { defaultPGN } from "@/utils/chess";
import { getTabFile, getTabGameNumber, getTabPracticeKey, saveToFile } from "@/utils/tabs";
import DetachedEval from "../common/DetachedEval";
import { ResponsivePanel } from "../common/ResponsivePanel";
import { TreeStateContext } from "../common/TreeStateContext";
import Board from "./Board";
import { BoardWithAnnotationLayout } from "./BoardWithAnnotationLayout";
import BoardControls from "./BoardControls";
import EditingCard from "./EditingCard";
import EngineDockedPanel from "./EngineDockedPanel";
import EngineKeyboardShortcuts from "./EngineKeyboardShortcuts";
import EvalListener from "./EvalListener";
import classes from "./BoardAnalysis.module.css";

const AnalysisPanel = lazy(() => import("../panels/analysis/AnalysisPanel"));
const ComparePanel = lazy(() => import("../panels/compare/ComparePanel"));
const DatabasePanel = lazy(() => import("../panels/database/DatabasePanel"));
const EnginePlanExplorerPanel = lazy(() => import("../panels/enginePlan/EnginePlanExplorerPanel"));
const GameNotation = lazy(() => import("../common/GameNotation"));
const InfoPanel = lazy(() => import("../panels/info/InfoPanel"));
const MoveControls = lazy(() => import("../common/MoveControls"));
const OpponentPrepPanel = lazy(() => import("../panels/prep/OpponentPrepPanel"));
const PlanExplorerPanel = lazy(() => import("../panels/plan/PlanExplorerPanel"));
const PracticePanel = lazy(() => import("../panels/practice/PracticePanel"));
const PawnStructurePanel = lazy(() => import("../panels/structure/PawnStructurePanel"));

const scrollablePanelStyle = {
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
} as const;

function PanelFallback() {
  return (
    <Center h="100%">
      <Loader size="sm" />
    </Center>
  );
}

function DeferredPanel({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PanelFallback />}>{children}</Suspense>;
}

function NotationFallback() {
  return <Paper withBorder flex={1} />;
}

function BoardAnalysisTab({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Tabs.Tab
      aria-label={label}
      className={classes.boardTab}
      data-tooltip-label={label}
      leftSection={icon}
      title={label}
      value={value}
    >
      {label}
    </Tabs.Tab>
  );
}

function BoardAnalysis() {
  const { t } = useTranslation();

  const [editingMode, toggleEditingMode] = useToggle();
  const [savingCopy, setSavingCopy] = useState(false);
  const [selectedPiece, setSelectedPiece] = useState<Piece | null>(null);
  const [topBarActionsTarget, setTopBarActionsTarget] = useState<HTMLElement | null>(null);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const tabFile = getTabFile(currentTab);
  const trainingDeck = useAtomValue(
    deckAtomFamily({
      file: getTabPracticeKey(currentTab),
      game: getTabGameNumber(currentTab),
    }),
  );
  const hasPersistentOrigin =
    currentTab?.gameOrigin.kind !== "none" &&
    currentTab?.gameOrigin.kind !== "opening_review" &&
    currentTab?.gameOrigin.kind !== "mistake_review";
  const autoSave = useAtomValue(autoSaveAtom);
  const { documentDir } = useLoaderData({ from: "/" });
  const boardRef = useRef(null);

  const store = useContext(TreeStateContext)!;

  const dirty = useStore(store, (s) => s.dirty);

  const reset = useStore(store, (s) => s.reset);
  const clearShapes = useStore(store, (s) => s.clearShapes);
  const setAnnotation = useStore(store, (s) => s.setAnnotation);
  const goToNext = useStore(store, (s) => s.goToNext);
  const goToPrevious = useStore(store, (s) => s.goToPrevious);

  useEffect(() => {
    setTopBarActionsTarget(document.getElementById("analysisTopLeftActions"));
  }, []);

  const saveFile = useCallback(async () => {
    saveToFile({
      dir: documentDir,
      setCurrentTab,
      tab: currentTab,
      store,
    });
  }, [setCurrentTab, currentTab, documentDir, store]);
  const userSaveFile = useCallback(async () => {
    saveToFile({
      dir: documentDir,
      setCurrentTab,
      tab: currentTab,
      store,
      isUserSave: true,
    });
  }, [setCurrentTab, currentTab, documentDir, store]);
  const saveGameCopy = useCallback(async () => {
    if (savingCopy) return;
    setSavingCopy(true);
    try {
      const saved = await saveToFile({
        dir: documentDir,
        setCurrentTab,
        tab: currentTab,
        store,
        isUserSave: true,
        forceSaveAs: true,
      });
      if (saved) {
        notifications.show({
          title: "Game saved",
          message: "A PGN copy was saved to your files.",
          color: "green",
        });
      }
    } catch (error) {
      notifications.show({
        title: "Could not save game",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setSavingCopy(false);
    }
  }, [currentTab, documentDir, savingCopy, setCurrentTab, store]);
  useEffect(() => {
    if (hasPersistentOrigin && autoSave && dirty) {
      saveFile();
    }
  }, [hasPersistentOrigin, saveFile, autoSave, dirty]);

  const addGame = useCallback(() => {
    if (!tabFile) return;
    setCurrentTab((prev) => {
      if (prev.gameOrigin.kind !== "file" && prev.gameOrigin.kind !== "temp_file") {
        return prev;
      }
      return {
        ...prev,
        gameOrigin: {
          ...prev.gameOrigin,
          gameNumber: prev.gameOrigin.file.numGames,
          file: {
            ...prev.gameOrigin.file,
            numGames: prev.gameOrigin.file.numGames + 1,
          },
        },
      };
    });
    reset();
    writeTextFile(tabFile.path, `\n\n${defaultPGN()}\n\n`, {
      append: true,
    });
  }, [setCurrentTab, reset, tabFile]);

  const keyMap = useAtomValue(keyMapAtom);

  const [currentTabSelected, setCurrentTabSelected] = useAtom(currentTabSelectedAtom);
  const practiceTabSelected = useAtomValue(currentPracticeTabAtom);
  const tabLabels = {
    practice: t("Board.Tabs.Practice"),
    analysis: t("Board.Tabs.Analysis"),
    database: t("Board.Tabs.Database"),
    prep: "Prep",
    structures: "Structures",
    planExplorer: "Plan Explorer",
    enginePlans: "Engine Plans",
    compare: "Compare",
    info: t("Board.Tabs.Info"),
  };
  const isRepertoire = tabFile?.metadata.type === "repertoire";
  const showPracticeTab = isRepertoire || trainingDeck.positions.length > 0;
  const selectedPanel =
    currentTabSelected === "gaps" ||
    currentTabSelected === "review" ||
    (currentTabSelected === "practice" && !showPracticeTab)
      ? "analysis"
      : currentTabSelected;
  const practicing =
    showPracticeTab && selectedPanel === "practice" && practiceTabSelected === "train";
  const practiceState = useAtomValue(practiceStateAtom);
  const isPracticeRating = practicing && practiceState.phase === "correct";

  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  useEffect(() => {
    if (!practicing) {
      setPracticePath(null);
    }
  }, [practicing, setPracticePath]);

  useEffect(() => {
    if (selectedPanel !== currentTabSelected) {
      setCurrentTabSelected(selectedPanel);
    }
  }, [currentTabSelected, selectedPanel, setCurrentTabSelected]);

  useEffect(() => {
    const navigateWithArrowKeys = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.key === "ArrowRight") {
        goToNext();
      } else {
        goToPrevious();
      }
    };

    window.addEventListener("keydown", navigateWithArrowKeys, { capture: true });
    return () => window.removeEventListener("keydown", navigateWithArrowKeys, { capture: true });
  }, [goToNext, goToPrevious]);

  useHotkeys([
    [keyMap.SAVE_FILE.keys, () => userSaveFile()],
    [keyMap.CLEAR_SHAPES.keys, () => clearShapes()],
  ]);
  useHotkeys([
    [keyMap.ANNOTATION_BRILLIANT.keys, () => !isPracticeRating && setAnnotation("!!")],
    [keyMap.ANNOTATION_GOOD.keys, () => !isPracticeRating && setAnnotation("!")],
    [keyMap.ANNOTATION_INTERESTING.keys, () => !isPracticeRating && setAnnotation("!?")],
    [keyMap.ANNOTATION_DUBIOUS.keys, () => !isPracticeRating && setAnnotation("?!")],
    [keyMap.ANNOTATION_MISTAKE.keys, () => !isPracticeRating && setAnnotation("?")],
    [keyMap.ANNOTATION_BLUNDER.keys, () => !isPracticeRating && setAnnotation("??")],
    [
      keyMap.PRACTICE_TAB.keys,
      () => {
        if (isRepertoire) {
          setCurrentTabSelected("practice");
        }
      },
    ],
    [keyMap.ANALYSIS_TAB.keys, () => setCurrentTabSelected("analysis")],
    [keyMap.DATABASE_TAB.keys, () => setCurrentTabSelected("database")],
    [keyMap.INFO_TAB.keys, () => setCurrentTabSelected("info")],
  ]);

  return (
    <>
      <EvalListener active />
      <EngineKeyboardShortcuts />
      {topBarActionsTarget && (
        <Portal target={topBarActionsTarget}>
          <Tooltip label="Save game to files">
            <ActionIcon
              aria-label="Save game to files"
              loading={savingCopy}
              size="sm"
              variant="default"
              onClick={() => void saveGameCopy()}
            >
              <IconDeviceFloppy size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Portal>
      )}
      <Portal target="#left" style={{ height: "100%" }}>
        <BoardWithAnnotationLayout
          board={
            <Board
              practicing={practicing}
              editingMode={editingMode}
              boardRef={boardRef}
              selectedPiece={selectedPiece}
            />
          }
          underBoard={
            editingMode ? (
              <EditingCard
                boardRef={boardRef}
                setEditingMode={toggleEditingMode}
                selectedPiece={selectedPiece}
                setSelectedPiece={setSelectedPiece}
              />
            ) : (
              <Stack h="100%" gap="xs">
                <DetachedEval />
                <Suspense fallback={<NotationFallback />}>
                  <GameNotation
                    topBar
                    controls={
                      <BoardControls
                        editingMode={editingMode}
                        toggleEditingMode={toggleEditingMode}
                        dirty={dirty}
                        saveFile={userSaveFile}
                      />
                    }
                  />
                </Suspense>
                <Suspense fallback={null}>
                  <MoveControls />
                </Suspense>
              </Stack>
            )
          }
        />
      </Portal>
      <Portal target="#topRight" style={{ height: "100%" }}>
        <Paper
          withBorder
          style={{
            height: "100%",
          }}
          pos="relative"
        >
          <ResponsivePanel>
            <Tabs
              w="100%"
              h="100%"
              value={selectedPanel}
              onChange={(v) => setCurrentTabSelected(v || "info")}
              keepMounted={false}
              activateTabWithKeyboard={false}
              style={{
                display: "flex",
                flexDirection: "column",
              }}
              styles={{
                tabLabel: {
                  flex: 0,
                },
                tab: {
                  display: "flex",
                  justifyContent: "center",
                  gap: "0.3rem",
                },
              }}
            >
              <Tabs.List className={classes.boardTabList} grow>
                {showPracticeTab && (
                  <BoardAnalysisTab
                    icon={<IconTargetArrow size="1rem" />}
                    label={tabLabels.practice}
                    value="practice"
                  />
                )}
                <BoardAnalysisTab
                  icon={<IconZoomCheck size="1rem" />}
                  label={tabLabels.analysis}
                  value="analysis"
                />
                <BoardAnalysisTab
                  icon={<IconDatabase size="1rem" />}
                  label={tabLabels.database}
                  value="database"
                />
                <BoardAnalysisTab
                  icon={<IconTarget size="1rem" />}
                  label={tabLabels.prep}
                  value="prep"
                />
                <BoardAnalysisTab
                  icon={<IconTimeline size="1rem" />}
                  label={tabLabels.structures}
                  value="structures"
                />
                <BoardAnalysisTab
                  icon={<IconRoute size="1rem" />}
                  label={tabLabels.planExplorer}
                  value="plan-explorer"
                />
                <BoardAnalysisTab
                  icon={<IconBulb size="1rem" />}
                  label={tabLabels.enginePlans}
                  value="engine-plans"
                />
                <BoardAnalysisTab
                  icon={<IconGitCompare size="1rem" />}
                  label={tabLabels.compare}
                  value="compare"
                />
                <BoardAnalysisTab
                  icon={<IconInfoCircle size="1rem" />}
                  label={tabLabels.info}
                  value="info"
                />
              </Tabs.List>
              {showPracticeTab && (
                <Tabs.Panel value="practice" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                  <EngineDockedPanel>
                    <DeferredPanel>
                      <PracticePanel />
                    </DeferredPanel>
                  </EngineDockedPanel>
                </Tabs.Panel>
              )}
              <Tabs.Panel value="info" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <DeferredPanel>
                    <InfoPanel addGame={addGame} />
                  </DeferredPanel>
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel value="database" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <DeferredPanel>
                    <DatabasePanel />
                  </DeferredPanel>
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel value="prep" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <DeferredPanel>
                    <OpponentPrepPanel />
                  </DeferredPanel>
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel value="structures" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <DeferredPanel>
                    <PawnStructurePanel />
                  </DeferredPanel>
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel
                value="plan-explorer"
                flex={1}
                style={{ minHeight: 0, overflow: "hidden" }}
              >
                <EngineDockedPanel>
                  <DeferredPanel>
                    <PlanExplorerPanel />
                  </DeferredPanel>
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel
                value="engine-plans"
                flex={1}
                style={{ minHeight: 0, overflow: "hidden" }}
              >
                <EngineDockedPanel>
                  <DeferredPanel>
                    <EnginePlanExplorerPanel />
                  </DeferredPanel>
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel value="compare" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <DeferredPanel>
                  <ComparePanel />
                </DeferredPanel>
              </Tabs.Panel>
              <Tabs.Panel value="analysis" flex={1} style={scrollablePanelStyle}>
                <DeferredPanel>
                  <AnalysisPanel />
                </DeferredPanel>
              </Tabs.Panel>
            </Tabs>
          </ResponsivePanel>
        </Paper>
      </Portal>
    </>
  );
}

export default BoardAnalysis;
