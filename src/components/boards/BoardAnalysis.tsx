import { Paper, Portal, Stack, Tabs, Tooltip } from "@mantine/core";
import { useHotkeys, useToggle } from "@mantine/hooks";
import {
  IconBulb,
  IconDatabase,
  IconGitCompare,
  IconInfoCircle,
  IconRoute,
  IconTargetArrow,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { Piece } from "chessops";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
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
import GameNotation from "../common/GameNotation";
import MoveControls from "../common/MoveControls";
import { ResponsivePanel } from "../common/ResponsivePanel";
import { TreeStateContext } from "../common/TreeStateContext";
import AnalysisPanel from "../panels/analysis/AnalysisPanel";
import AnnotationPanel from "../panels/annotation/AnnotationPanel";
import ComparePanel from "../panels/compare/ComparePanel";
import DatabasePanel from "../panels/database/DatabasePanel";
import EnginePlanExplorerPanel from "../panels/enginePlan/EnginePlanExplorerPanel";
import InfoPanel from "../panels/info/InfoPanel";
import PlanExplorerPanel from "../panels/plan/PlanExplorerPanel";
import PracticePanel from "../panels/practice/PracticePanel";
import Board from "./Board";
import { BoardWithAnnotationLayout } from "./BoardWithAnnotationLayout";
import BoardControls from "./BoardControls";
import EditingCard from "./EditingCard";
import EngineDockedPanel from "./EngineDockedPanel";
import EngineKeyboardShortcuts from "./EngineKeyboardShortcuts";
import EvalListener from "./EvalListener";

const scrollablePanelStyle = {
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
} as const;

function BoardAnalysis() {
  const { t } = useTranslation();

  const [editingMode, toggleEditingMode] = useToggle();
  const [selectedPiece, setSelectedPiece] = useState<Piece | null>(null);
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
          annotation={<AnnotationPanel />}
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
              <Tabs.List grow>
                {showPracticeTab && (
                  <Tooltip label={tabLabels.practice} position="bottom" withArrow withinPortal>
                    <Tabs.Tab value="practice" leftSection={<IconTargetArrow size="1rem" />}>
                      {tabLabels.practice}
                    </Tabs.Tab>
                  </Tooltip>
                )}
                <Tooltip label={tabLabels.analysis} position="bottom" withArrow withinPortal>
                  <Tabs.Tab value="analysis" leftSection={<IconZoomCheck size="1rem" />}>
                    {tabLabels.analysis}
                  </Tabs.Tab>
                </Tooltip>
                <Tooltip label={tabLabels.database} position="bottom" withArrow withinPortal>
                  <Tabs.Tab value="database" leftSection={<IconDatabase size="1rem" />}>
                    {tabLabels.database}
                  </Tabs.Tab>
                </Tooltip>
                <Tooltip label={tabLabels.planExplorer} position="bottom" withArrow withinPortal>
                  <Tabs.Tab value="plan-explorer" leftSection={<IconRoute size="1rem" />}>
                    {tabLabels.planExplorer}
                  </Tabs.Tab>
                </Tooltip>
                <Tooltip label={tabLabels.enginePlans} position="bottom" withArrow withinPortal>
                  <Tabs.Tab value="engine-plans" leftSection={<IconBulb size="1rem" />}>
                    {tabLabels.enginePlans}
                  </Tabs.Tab>
                </Tooltip>
                <Tooltip label={tabLabels.compare} position="bottom" withArrow withinPortal>
                  <Tabs.Tab value="compare" leftSection={<IconGitCompare size="1rem" />}>
                    {tabLabels.compare}
                  </Tabs.Tab>
                </Tooltip>
                <Tooltip label={tabLabels.info} position="bottom" withArrow withinPortal>
                  <Tabs.Tab value="info" leftSection={<IconInfoCircle size="1rem" />}>
                    {tabLabels.info}
                  </Tabs.Tab>
                </Tooltip>
              </Tabs.List>
              {showPracticeTab && (
                <Tabs.Panel value="practice" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                  <EngineDockedPanel>
                    <PracticePanel />
                  </EngineDockedPanel>
                </Tabs.Panel>
              )}
              <Tabs.Panel value="info" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <InfoPanel addGame={addGame} />
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel value="database" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <DatabasePanel />
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel
                value="plan-explorer"
                flex={1}
                style={{ minHeight: 0, overflow: "hidden" }}
              >
                <EngineDockedPanel>
                  <PlanExplorerPanel />
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel
                value="engine-plans"
                flex={1}
                style={{ minHeight: 0, overflow: "hidden" }}
              >
                <EngineDockedPanel>
                  <EnginePlanExplorerPanel />
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel value="compare" flex={1} style={scrollablePanelStyle}>
                <ComparePanel />
              </Tabs.Panel>
              <Tabs.Panel value="analysis" flex={1} style={scrollablePanelStyle}>
                <AnalysisPanel />
              </Tabs.Panel>
            </Tabs>
          </ResponsivePanel>
        </Paper>
      </Portal>
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        {editingMode ? (
          <EditingCard
            boardRef={boardRef}
            setEditingMode={toggleEditingMode}
            selectedPiece={selectedPiece}
            setSelectedPiece={setSelectedPiece}
          />
        ) : (
          <Stack h="100%" gap="xs">
            <DetachedEval />
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
            <MoveControls />
          </Stack>
        )}
      </Portal>
    </>
  );
}

export default BoardAnalysis;
