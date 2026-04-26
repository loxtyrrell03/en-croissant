import { Paper, Portal, Stack, Tabs } from "@mantine/core";
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
  allEnabledAtom,
  autoSaveAtom,
  currentPracticeTabAtom,
  currentTabAtom,
  currentTabSelectedAtom,
  deckAtomFamily,
  enableAllAtom,
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
import BoardControls from "./BoardControls";
import EditingCard from "./EditingCard";
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

  const [, enable] = useAtom(enableAllAtom);
  const allEnabled = useAtomValue(allEnabledAtom);

  const keyMap = useAtomValue(keyMapAtom);

  const [currentTabSelected, setCurrentTabSelected] = useAtom(currentTabSelectedAtom);
  const practiceTabSelected = useAtomValue(currentPracticeTabAtom);
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
    [
      keyMap.TOGGLE_ALL_ENGINES.keys,
      (e) => {
        enable(!allEnabled);
        e.preventDefault();
      },
    ],
  ]);

  return (
    <>
      <EvalListener active={selectedPanel === "analysis" || selectedPanel === "compare"} />
      <Portal target="#left" style={{ height: "100%" }}>
        <Stack h="100%" gap="xs" style={{ minHeight: 0, overflow: "hidden" }}>
          <Stack flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
            <Board
              practicing={practicing}
              editingMode={editingMode}
              boardRef={boardRef}
              selectedPiece={selectedPiece}
            />
          </Stack>
          <Paper
            withBorder
            h="15rem"
            mah="35%"
            style={{ minHeight: "10rem", overflow: "hidden", flexShrink: 0 }}
          >
            <AnnotationPanel />
          </Paper>
        </Stack>
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
                  <Tabs.Tab value="practice" leftSection={<IconTargetArrow size="1rem" />}>
                    {t("Board.Tabs.Practice")}
                  </Tabs.Tab>
                )}
                <Tabs.Tab value="analysis" leftSection={<IconZoomCheck size="1rem" />}>
                  {t("Board.Tabs.Analysis")}
                </Tabs.Tab>
                <Tabs.Tab value="database" leftSection={<IconDatabase size="1rem" />}>
                  {t("Board.Tabs.Database")}
                </Tabs.Tab>
                <Tabs.Tab value="plan-explorer" leftSection={<IconRoute size="1rem" />}>
                  Plan Explorer
                </Tabs.Tab>
                <Tabs.Tab value="engine-plans" leftSection={<IconBulb size="1rem" />}>
                  Engine Plans
                </Tabs.Tab>
                <Tabs.Tab value="compare" leftSection={<IconGitCompare size="1rem" />}>
                  Compare
                </Tabs.Tab>
                <Tabs.Tab value="info" leftSection={<IconInfoCircle size="1rem" />}>
                  {t("Board.Tabs.Info")}
                </Tabs.Tab>
              </Tabs.List>
              {showPracticeTab && (
                <Tabs.Panel value="practice" flex={1} style={scrollablePanelStyle}>
                  <PracticePanel />
                </Tabs.Panel>
              )}
              <Tabs.Panel value="info" flex={1} style={scrollablePanelStyle}>
                <InfoPanel addGame={addGame} />
              </Tabs.Panel>
              <Tabs.Panel value="database" flex={1} style={scrollablePanelStyle}>
                <DatabasePanel />
              </Tabs.Panel>
              <Tabs.Panel value="plan-explorer" flex={1} style={scrollablePanelStyle}>
                <PlanExplorerPanel />
              </Tabs.Panel>
              <Tabs.Panel value="engine-plans" flex={1} style={scrollablePanelStyle}>
                <EnginePlanExplorerPanel />
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
