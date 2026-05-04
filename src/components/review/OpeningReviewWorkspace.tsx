import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Portal,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import {
  IconArrowBack,
  IconBook,
  IconBulb,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconGitCompare,
  IconEye,
  IconInfoCircle,
  IconPencil,
  IconRobot,
  IconRoute,
  IconSettings,
  IconTarget,
  IconTargetArrow,
  IconTrash,
  IconZoomCheck,
  IconX,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useVirtualizer } from "@tanstack/react-virtual";
import { makeUci, parseUci, type Move } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import dayjs from "dayjs";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { createEmptyCard, formatDate } from "ts-fsrs";
import { useStore } from "zustand";
import { commands } from "@/bindings";
import { Chessground } from "@/chessground/Chessground";
import Board from "@/components/boards/Board";
import { BoardWithAnnotationLayout } from "@/components/boards/BoardWithAnnotationLayout";
import EngineDockedPanel from "@/components/boards/EngineDockedPanel";
import EngineKeyboardShortcuts from "@/components/boards/EngineKeyboardShortcuts";
import EvalListener from "@/components/boards/EvalListener";
import DetachedEval from "@/components/common/DetachedEval";
import GameNotation from "@/components/common/GameNotation";
import MoveControls from "@/components/common/MoveControls";
import { ResponsivePanel } from "@/components/common/ResponsivePanel";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { usePracticeAgainstBot } from "@/hooks/usePracticeAgainstBot";
import {
  formatReviewInterval,
  getNextReviewTimes,
  getStats,
  type Position,
  updateCardPerformance,
} from "@/components/files/opening";
import AnalysisPanel from "@/components/panels/analysis/AnalysisPanel";
import AnnotationPanel from "@/components/panels/annotation/AnnotationPanel";
import ComparePanel from "@/components/panels/compare/ComparePanel";
import DatabasePanel from "@/components/panels/database/DatabasePanel";
import EnginePlanExplorerPanel from "@/components/panels/enginePlan/EnginePlanExplorerPanel";
import RepertoireGapsPanel from "@/components/panels/gaps/RepertoireGapsPanel";
import InfoPanel from "@/components/panels/info/InfoPanel";
import { OpeningReviewAutoUpdateBanner } from "@/components/review/OpeningReviewAutoUpdateBanner";
import PlanExplorerPanel from "@/components/panels/plan/PlanExplorerPanel";
import {
  currentTabSelectedAtom,
  currentEvalOpenAtom,
  currentInvisibleAtom,
  currentShowCommentsAtom,
  dailyGoalCompletionPromptAtom,
  dailyGoalDeckRevisionAtom,
  deckAtomFamily,
  getDeckStorageKey,
  openingReviewHideMovesDuringPracticeAtom,
  openingReviewAutoUpdateStateAtom,
  mistakeReviewAutoUpdateStateAtom,
  practiceAutoDifficultyAtom,
  practiceCardStartTimeAtom,
  practiceSessionStatsAtom,
  type PracticeState,
  practiceStateAtom,
} from "@/state/atoms";
import type { TreeStore } from "@/state/store/tree";
import type { Tab } from "@/utils/tabs";
import { getTabPracticeKey } from "@/utils/tabs";
import { positionFromFen } from "@/utils/chessops";
import {
  createNode,
  defaultTree,
  findFen,
  getNodeAtPath,
  type GameHeaders,
  type TreeNode,
  type TreeState,
} from "@/utils/treeReducer";
import {
  type OpeningReviewAutoUpdateConfig,
  getOpeningReviewDailyBatch,
  getOpeningReviewDailyProgress,
  readOpeningReviewDeck,
  type OpeningReviewDailySettings,
  type OpeningReviewDeck,
  writeOpeningReviewDeck,
} from "@/utils/openingReview";
import {
  DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
  formatMistakeReviewMoveTime,
  formatMistakeReviewLastSeen,
  getMistakeReviewDailyBatch,
  getMistakeReviewDailyProgress,
  getMistakeReviewPhaseBatch,
  getMistakeReviewPhaseCounts,
  getMistakeReviewTimeManagementBatch,
  MISTAKE_REVIEW_PHASES,
  type MistakeReviewDailySettings,
  mistakeReviewSeverityLabel,
  type MistakeReviewPhase,
  readMistakeReviewDeck,
  type MistakeReviewDeck,
  writeMistakeReviewDeck,
} from "@/utils/mistakeReview";
import {
  formatOpeningReviewLastPlayed,
  openingReviewPositionExplanation,
  openingReviewUrgencyColor,
  parseOpeningReviewDate,
  rankOpeningReviewPositions,
} from "@/utils/openingReviewAutoUpdate";
import { getReviewPositionsForPath, sameReviewPosition } from "@/utils/openingReviewPersistence";
import {
  getOpeningReviewMoveSequenceLabel,
  getOpeningReviewStatsPerspectiveSide,
} from "@/utils/openingReviewOpenings";
import {
  OPENING_HEALTH_DATE_RANGE_OPTIONS,
  formatOpeningHealthDateFilter,
  getOpeningHealthDateBounds,
  openingHealthDbDateToInput,
  openingHealthDateBoundsAreActive,
  openingHealthDateMatches,
  type OpeningHealthDateRange,
} from "@/utils/openingHealthDateFilter";
import { isOpeningReviewSavedMove } from "@/utils/openingReviewPractice";
import resultClasses from "@/components/panels/database/OpeningsTable.module.css";

const scrollablePanelStyle = {
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
} as const;

const openingReviewPanelModeControlStyle = {
  position: "sticky",
  top: 0,
  zIndex: 3,
  flexShrink: 0,
  paddingBottom: "var(--mantine-spacing-xs)",
  background: "var(--mantine-color-body)",
} as const;

const OPENING_REVIEW_PREVIEW_BOARD_SIZE = 168;

const DAILY_REVIEW_GAME_PERIOD_OPTIONS = [
  { value: "all", label: "All games" },
  { value: "week", label: "Last week" },
  { value: "2weeks", label: "Last 2 weeks" },
  { value: "month", label: "Last month" },
  { value: "3months", label: "Last 3 months" },
  { value: "6months", label: "Last 6 months" },
  { value: "year", label: "Last year" },
] satisfies { value: OpeningReviewDailySettings["gamePeriod"]; label: string }[];

const reviewWorkspaceTabs = new Set([
  "review",
  "analysis",
  "database",
  "plan-explorer",
  "engine-plans",
  "compare",
  "info",
]);

type ReviewBoardMoveCandidate = {
  fen: string;
  san: string;
  uci: string;
};

type OpeningReviewPanelView = "review" | "stats" | "analyze";
type OpeningReviewPositionSort =
  | "urgency"
  | "imported"
  | "lastPlayed"
  | "colour"
  | "opening"
  | "due"
  | "move";
type OpeningReviewColourFilter = "any" | "white" | "black";
type OpeningReviewOpeningInfo = {
  rawName: string;
  family: string;
  variation: string | null;
  line: string;
  isVariation: boolean;
};
type OpeningReviewResolvedOpeningNames = Record<string, string>;
type OpeningReviewPositionRow = ReturnType<typeof rankOpeningReviewPositions>[number] & {
  opening: OpeningReviewOpeningInfo;
};
type OpeningReviewInitialPractice = {
  mode: "due" | "all";
  indices: number[];
  label?: string;
  source?: "daily-goals";
  goalId?: string;
  goalTitle?: string;
};
type ReviewDeckSaveSnapshot = {
  deckInfo: OpeningReviewDeck | MistakeReviewDeck;
  deckPath: string;
  isMistakeReview: boolean;
  positions: Position[];
  logs: OpeningReviewDeck["logs"] | MistakeReviewDeck["logs"];
};
type OpeningReviewStatsResultFilter = "wins" | "draws" | "losses";
type OpeningReviewStatsGroupBy = "family" | "line";
type OpeningReviewStatsSort = "planGap" | "scoreDesc" | "scoreAsc" | "reviewDesc" | "gamesDesc";

const openingReviewOpeningNameCache = new Map<string, string>();

export default function OpeningReviewWorkspace({ tab }: { tab: Tab }) {
  const boardRef = useRef(null);
  const deckPath = getTabPracticeKey(tab);
  const isMistakeReview = tab.gameOrigin.kind === "mistake_review";
  const [deck, setDeck] = useAtom(deckAtomFamily({ file: deckPath, game: 0 }));
  const [deckInfo, setDeckInfo] = useState<OpeningReviewDeck | MistakeReviewDeck | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedReviewPositionIndex, setLoadedReviewPositionIndex] = useState<number | null>(null);
  const [boardMoveCandidate, setBoardMoveCandidate] = useState<ReviewBoardMoveCandidate | null>(
    null,
  );
  const [currentTabSelected, setCurrentTabSelected] = useAtom(currentTabSelectedAtom);
  const [practiceState, setPracticeState] = useAtom(practiceStateAtom);
  const setDailyGoalDeckRevision = useSetAtom(dailyGoalDeckRevisionAtom);
  const openingAutoUpdateState = useAtomValue(openingReviewAutoUpdateStateAtom);
  const mistakeAutoUpdateState = useAtomValue(mistakeReviewAutoUpdateStateAtom);
  const autoUpdateState = isMistakeReview ? mistakeAutoUpdateState : openingAutoUpdateState;
  const practicing = currentTabSelected === "review" && practiceState.phase !== "idle";
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const positionPath = useStore(store, (s) => s.position);
  const treeDirty = useStore(store, (s) => s.dirty);
  const goToNext = useStore(store, (s) => s.goToNext);
  const goToPrevious = useStore(store, (s) => s.goToPrevious);
  const goToMove = useStore(store, (s) => s.goToMove);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  const setState = useStore(store, (s) => s.setState);
  const setInvisible = useSetAtom(currentInvisibleAtom);
  const setShowComments = useSetAtom(currentShowCommentsAtom);
  const setEvalOpen = useSetAtom(currentEvalOpenAtom);
  const practiceAgainstBot = usePracticeAgainstBot();
  const autoUpdateRevisionRef = useRef(0);
  const latestReviewSaveRef = useRef<ReviewDeckSaveSnapshot | null>(null);
  const initialPractice =
    tab.gameOrigin.kind === "opening_review" || tab.gameOrigin.kind === "mistake_review"
      ? tab.gameOrigin.initialPractice
      : undefined;
  const openingReviewDeckMode = isMistakeReview
    ? undefined
    : (deckInfo as OpeningReviewDeck | null)?.mode;
  const scopedReviewPositionIndex =
    practiceState.positionIndex !== undefined
      ? practiceState.positionIndex
      : loadedReviewPositionIndex;

  const activeReviewPositions = useMemo(
    () => getReviewPositionsForPath(deck.positions, root, positionPath, scopedReviewPositionIndex),
    [deck.positions, positionPath, root, scopedReviewPositionIndex],
  );
  const activeReviewPosition = activeReviewPositions[activeReviewPositions.length - 1] ?? null;
  const activeReviewIndex = activeReviewPosition?.positionIndex ?? -1;
  const canGoPrevious = loaded && !loadError && activeReviewIndex > 0;
  const canGoNext =
    loaded &&
    !loadError &&
    deck.positions.length > 0 &&
    activeReviewIndex < deck.positions.length - 1;

  const loadDeckPosition = useCallback(
    (positionIndex: number) => {
      const position = deck.positions[positionIndex];
      if (!position) return;

      setLoadedReviewPositionIndex(positionIndex);
      loadReviewPositionOnBoard({
        position,
        headers,
        root,
        store,
        goToMove,
        setHeaders,
        setState,
      });
      setPracticePath(null);
      setPracticeState({ phase: "idle" });
      setInvisible(false);
      setShowComments(true);
      setEvalOpen(true);
      setBoardMoveCandidate(null);
    },
    [
      deck.positions,
      goToMove,
      headers,
      root,
      setEvalOpen,
      setHeaders,
      setInvisible,
      setPracticePath,
      setPracticeState,
      setShowComments,
      setState,
      store,
    ],
  );

  const goToPreviousReviewPosition = useCallback(() => {
    if (!canGoPrevious) return;
    loadDeckPosition(activeReviewIndex - 1);
  }, [activeReviewIndex, canGoPrevious, loadDeckPosition]);

  const goToNextReviewPosition = useCallback(() => {
    if (!canGoNext) return;
    loadDeckPosition(activeReviewIndex === -1 ? 0 : activeReviewIndex + 1);
  }, [activeReviewIndex, canGoNext, loadDeckPosition]);

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

  useEffect(() => {
    const initialTab =
      tab.gameOrigin.kind === "opening_review" || tab.gameOrigin.kind === "mistake_review"
        ? tab.gameOrigin.initialTab
        : null;
    setCurrentTabSelected(
      initialTab && reviewWorkspaceTabs.has(initialTab) ? initialTab : "review",
    );
  }, [setCurrentTabSelected, tab.gameOrigin]);

  useEffect(() => {
    let disposed = false;
    setLoaded(false);
    setLoadError(null);
    setLoadedReviewPositionIndex(null);
    localStorage.removeItem(getDeckStorageKey(deckPath, 0));

    async function loadDeck() {
      try {
        const nextDeck = isMistakeReview
          ? await readMistakeReviewDeck(deckPath)
          : await readOpeningReviewDeck(deckPath);
        if (disposed) return;
        setDeckInfo(nextDeck);
        setDeck({ positions: nextDeck.positions, logs: nextDeck.logs });
        setLoaded(true);
      } catch (error) {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoaded(true);
      }
    }

    void loadDeck();
    return () => {
      disposed = true;
    };
  }, [deckPath, isMistakeReview, setDeck]);

  useEffect(() => {
    if (!loaded || !deckInfo || loadError) return undefined;

    latestReviewSaveRef.current = {
      deckInfo,
      deckPath,
      isMistakeReview,
      positions: deck.positions,
      logs: deck.logs,
    };

    const timeout = window.setTimeout(() => {
      const nextDeck = {
        ...deckInfo,
        positions: deck.positions,
        logs: deck.logs,
      };
      const savePromise = isMistakeReview
        ? writeMistakeReviewDeck(deckPath, nextDeck as MistakeReviewDeck)
        : writeOpeningReviewDeck(deckPath, nextDeck as OpeningReviewDeck);
      void savePromise
        .then(() => {
          setDailyGoalDeckRevision((revision) => revision + 1);
        })
        .catch((error) => {
          notifications.show({
            title: "Could not save review progress",
            message: error instanceof Error ? error.message : String(error),
            color: "red",
          });
        });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [deck, deckInfo, deckPath, isMistakeReview, loadError, loaded, setDailyGoalDeckRevision]);

  useEffect(
    () => () => {
      const snapshot = latestReviewSaveRef.current;
      if (!snapshot) return;

      const nextDeck = {
        ...snapshot.deckInfo,
        positions: snapshot.positions,
        logs: snapshot.logs,
      };
      const savePromise = snapshot.isMistakeReview
        ? writeMistakeReviewDeck(snapshot.deckPath, nextDeck as MistakeReviewDeck)
        : writeOpeningReviewDeck(snapshot.deckPath, nextDeck as OpeningReviewDeck);
      void savePromise
        .then(() => {
          setDailyGoalDeckRevision((revision) => revision + 1);
        })
        .catch(() => {
          // The normal debounced save path reports failures while the workspace is mounted.
        });
    },
    [setDailyGoalDeckRevision],
  );

  useEffect(() => {
    if (
      !loaded ||
      loadError ||
      autoUpdateState.revision === autoUpdateRevisionRef.current ||
      !autoUpdateState.updatedDeckPaths.includes(deckPath)
    ) {
      return;
    }

    autoUpdateRevisionRef.current = autoUpdateState.revision;
    let disposed = false;

    const reader = isMistakeReview ? readMistakeReviewDeck : readOpeningReviewDeck;
    reader(deckPath)
      .then((nextDeck) => {
        if (disposed) return;
        setDeckInfo(nextDeck);
        setDeck({ positions: nextDeck.positions, logs: nextDeck.logs });
      })
      .catch((error) => {
        notifications.show({
          title: "Could not refresh review deck",
          message: error instanceof Error ? error.message : String(error),
          color: "red",
        });
      });

    return () => {
      disposed = true;
    };
  }, [
    autoUpdateState.revision,
    autoUpdateState.updatedDeckPaths,
    deckPath,
    isMistakeReview,
    loadError,
    loaded,
    setDeck,
  ]);

  const setDeckAutoUpdateEnabled = useCallback(
    (enabled: boolean) => {
      if (isMistakeReview) return;
      setDeckInfo((current) => {
        const openingDeck = current as OpeningReviewDeck | null;
        return openingDeck?.autoUpdate
          ? {
              ...openingDeck,
              autoUpdate: {
                ...openingDeck.autoUpdate,
                enabled,
                updatedAt: Date.now(),
                lastError: enabled ? openingDeck.autoUpdate.lastError : null,
              },
            }
          : current;
      });
    },
    [isMistakeReview],
  );

  const setOpeningDailySettings = useCallback(
    (daily: OpeningReviewDailySettings) => {
      if (isMistakeReview) return;
      setDeckInfo((current) =>
        current
          ? ({ ...(current as OpeningReviewDeck), daily } satisfies OpeningReviewDeck)
          : current,
      );
    },
    [isMistakeReview],
  );

  const setMistakeDailySettings = useCallback(
    (daily: MistakeReviewDailySettings) => {
      if (!isMistakeReview) return;
      setDeckInfo((current) =>
        current
          ? ({ ...(current as MistakeReviewDeck), daily } satisfies MistakeReviewDeck)
          : current,
      );
    },
    [isMistakeReview],
  );

  const selectedToolTab = reviewWorkspaceTabs.has(currentTabSelected)
    ? currentTabSelected
    : "review";

  useEffect(() => {
    if (selectedToolTab !== currentTabSelected) {
      setCurrentTabSelected(selectedToolTab);
    }
  }, [currentTabSelected, selectedToolTab, setCurrentTabSelected]);

  useEffect(() => {
    if (!loaded || loadError || !treeDirty || activeReviewPositions.length === 0) return;

    const nextReviewTrees = activeReviewPositions.map((reviewPosition) => ({
      ...reviewPosition,
      reviewTree: cloneReviewTreeNode(reviewPosition.node),
    }));

    setDeck((current) => {
      let positions = current.positions;
      let changed = false;

      for (const reviewPosition of nextReviewTrees) {
        const position = positions[reviewPosition.positionIndex];
        if (!position || !sameReviewPosition(position.fen, reviewPosition.node.fen)) {
          continue;
        }

        const nextPosition = withReviewTree(position, reviewPosition.reviewTree);
        if (sameReviewPersistence(position, nextPosition)) continue;

        if (!changed) {
          positions = [...positions];
          changed = true;
        }
        positions[reviewPosition.positionIndex] = nextPosition;
      }

      return changed ? { ...current, positions } : current;
    });
  }, [activeReviewPositions, loadError, loaded, setDeck, treeDirty]);

  return (
    <>
      <EvalListener active />
      <EngineKeyboardShortcuts />
      <Portal target="#left" style={{ height: "100%" }}>
        <BoardWithAnnotationLayout
          board={
            <Board
              practicing={practicing}
              editingMode={false}
              boardRef={boardRef}
              onMove={(uci, fen, san) => setBoardMoveCandidate({ fen, san, uci })}
            />
          }
          controls={
            <Group gap="xs" wrap="nowrap">
              <Box flex={1}>
                <OpeningReviewBoardNavigation
                  positionIndex={activeReviewIndex}
                  total={deck.positions.length}
                  canGoPrevious={canGoPrevious}
                  canGoNext={canGoNext}
                  onPrevious={goToPreviousReviewPosition}
                  onNext={goToNextReviewPosition}
                />
              </Box>
              <Tooltip label="Practice against bot">
                <ActionIcon variant="default" onClick={practiceAgainstBot} mr="xs">
                  <IconRobot size="1rem" />
                </ActionIcon>
              </Tooltip>
            </Group>
          }
          annotation={<AnnotationPanel />}
        />
      </Portal>
      <Portal target="#topRight" style={{ height: "100%" }}>
        <Paper withBorder h="100%" pos="relative">
          <ResponsivePanel>
            <Tabs
              w="100%"
              h="100%"
              value={selectedToolTab}
              onChange={(value) => setCurrentTabSelected(value || "review")}
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
                <Tabs.Tab value="review" leftSection={<IconTargetArrow size="1rem" />}>
                  Review
                </Tabs.Tab>
                <Tabs.Tab value="analysis" leftSection={<IconZoomCheck size="1rem" />}>
                  Analysis
                </Tabs.Tab>
                <Tabs.Tab value="database" leftSection={<IconDatabase size="1rem" />}>
                  Database
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
                  Info
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="review" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel contentPadding="sm">
                  <OpeningReviewPanel
                    deckName={deckInfo?.name ?? tab.name}
                    deckPath={deckPath}
                    deckMode={openingReviewDeckMode}
                    autoUpdateConfig={
                      isMistakeReview
                        ? undefined
                        : (deckInfo as OpeningReviewDeck | null)?.autoUpdate
                    }
                    onAutoUpdateEnabledChange={setDeckAutoUpdateEnabled}
                    initialView={
                      tab.gameOrigin.kind === "opening_review" &&
                      tab.gameOrigin.initialTab === "gaps"
                        ? "analyze"
                        : "review"
                    }
                    isMistakeReview={isMistakeReview}
                    initialPractice={initialPractice}
                    openingDailySettings={
                      isMistakeReview ? undefined : (deckInfo as OpeningReviewDeck | null)?.daily
                    }
                    mistakeDailySettings={
                      isMistakeReview ? (deckInfo as MistakeReviewDeck | null)?.daily : undefined
                    }
                    mistakeTimeManagementSettings={
                      isMistakeReview
                        ? (deckInfo as MistakeReviewDeck | null)?.settings.timeManagement
                        : undefined
                    }
                    mistakeAutoUpdateConfig={
                      isMistakeReview
                        ? (deckInfo as MistakeReviewDeck | null)?.autoUpdate
                        : undefined
                    }
                    onOpeningDailySettingsChange={setOpeningDailySettings}
                    onMistakeDailySettingsChange={setMistakeDailySettings}
                    boardMoveCandidate={boardMoveCandidate}
                    onClearBoardMoveCandidate={() => setBoardMoveCandidate(null)}
                    onLoadPosition={loadDeckPosition}
                    loadError={loadError}
                    loaded={loaded}
                  />
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel value="analysis" flex={1} style={scrollablePanelStyle}>
                <AnalysisPanel />
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
              <Tabs.Panel value="info" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <InfoPanel />
                </EngineDockedPanel>
              </Tabs.Panel>
            </Tabs>
          </ResponsivePanel>
        </Paper>
      </Portal>
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        <Stack h="100%" gap="xs">
          <DetachedEval />
          <GameNotation topBar />
          <MoveControls />
        </Stack>
      </Portal>
    </>
  );
}

function OpeningReviewMiniBoard({
  position,
  onClick,
}: {
  position: Position;
  onClick: () => void;
}) {
  const orientation = getOpeningReviewMoveSide(position);

  return (
    <Tooltip label="Load position on board" withArrow>
      <Box
        role="button"
        tabIndex={0}
        aria-label={`Load ${position.answer} review position`}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
        w={OPENING_REVIEW_PREVIEW_BOARD_SIZE}
        miw={OPENING_REVIEW_PREVIEW_BOARD_SIZE}
        style={{
          borderRadius: 4,
          overflow: "hidden",
          cursor: "pointer",
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

function OpeningReviewBoardNavigation({
  positionIndex,
  total,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
}: {
  positionIndex: number;
  total: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const label =
    total === 0
      ? "No review positions"
      : positionIndex >= 0
        ? `Position ${positionIndex + 1} / ${total}`
        : `${total} review position${total === 1 ? "" : "s"}`;

  return (
    <Group justify="space-between" gap="xs" wrap="nowrap" px="xs" style={{ flexShrink: 0 }}>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconChevronLeft size={14} />}
        disabled={!canGoPrevious}
        onClick={onPrevious}
      >
        Back
      </Button>
      <Text size="xs" c="dimmed" ta="center" lineClamp={1}>
        {label}
      </Text>
      <Button
        size="xs"
        variant="default"
        rightSection={<IconChevronRight size={14} />}
        disabled={!canGoNext}
        onClick={onNext}
      >
        Next
      </Button>
    </Group>
  );
}

function loadReviewPositionOnBoard({
  position,
  headers,
  root,
  store,
  goToMove,
  setHeaders,
  setState,
}: {
  position: Position;
  headers: GameHeaders;
  root: TreeNode;
  store: TreeStore;
  goToMove: (move: number[]) => void;
  setHeaders: (headers: GameHeaders) => void;
  setState: (state: TreeState) => void;
}) {
  const reviewLine = createReviewPositionLineState(position, headers);
  if (reviewLine) {
    setState(reviewLine.state);
    return reviewLine.path;
  }

  const path = findFen(position.fen, root);
  if (path.length === 0 && !sameReviewPosition(root.fen, position.fen)) {
    setHeaders(getReviewPositionHeaders(position, headers, position.fen));
    applyReviewPositionMetadata(store, position);
    return [];
  }

  goToMove(path);
  setHeaders(getReviewPositionHeaders(position, headers, headers.fen));
  applyReviewPositionMetadata(store, position);
  return path;
}

function getReviewPositionHeaders(
  position: Position,
  headers: GameHeaders,
  fen: string,
): GameHeaders {
  const mistake = position.mistakeReview;
  if (!mistake) {
    return {
      ...headers,
      fen,
      orientation: getOpeningReviewMoveSide(position),
      result: "*",
    };
  }

  const playerColor = mistake.playerColor ?? position.sideToMove ?? "white";
  const playerName =
    normalizeMistakeReviewName(mistake.playerName) ||
    normalizeMistakeReviewName(playerColor === "white" ? mistake.whiteName : mistake.blackName) ||
    "You";
  const opponentName =
    normalizeMistakeReviewName(mistake.opponent) ||
    normalizeMistakeReviewName(playerColor === "white" ? mistake.blackName : mistake.whiteName) ||
    "Opponent";
  const whiteName =
    normalizeMistakeReviewName(mistake.whiteName) ||
    (playerColor === "white" ? playerName : opponentName);
  const blackName =
    normalizeMistakeReviewName(mistake.blackName) ||
    (playerColor === "black" ? playerName : opponentName);

  return {
    ...headers,
    fen,
    white: whiteName,
    black: blackName,
    white_elo: normalizeMistakeReviewRating(mistake.whiteElo),
    black_elo: normalizeMistakeReviewRating(mistake.blackElo),
    date: mistake.date ?? headers.date,
    result: normalizeReviewResult(mistake.gameResult),
    time_control: mistake.timeControl ?? headers.time_control,
    orientation: playerColor,
  };
}

function applyReviewPositionMetadata(store: TreeStore, position: Position) {
  const state = store.getState();
  const nextState = cloneTreeState(state);
  const node = getNodeAtPath(nextState.root, nextState.position);
  applyReviewPositionToNode(node, position);
  state.setState(nextState);
}

function createReviewPositionLineState(position: Position, headers: GameHeaders) {
  const moveSequence = position.moveSequence?.trim();
  if (!moveSequence) {
    const tree = defaultTree(position.fen);
    tree.headers = getReviewPositionHeaders(position, headers, tree.root.fen);
    tree.dirty = false;
    applyReviewPositionToNode(tree.root, position);
    return { state: tree, path: [] };
  }

  const tree = defaultTree();
  tree.headers = getReviewPositionHeaders(position, headers, tree.root.fen);
  tree.dirty = false;

  const [chess] = positionFromFen(tree.root.fen);
  if (!chess) return null;

  let currentNode = tree.root;
  const path: number[] = [];
  for (const token of tokenizeReviewMoveSequence(moveSequence)) {
    const move = parseSan(chess, token);
    if (!move) return null;
    const san = makeSan(chess, move);
    chess.play(move);
    const node = createNode({
      fen: makeFen(chess.toSetup()),
      move,
      san,
      halfMoves: currentNode.halfMoves + 1,
    });
    currentNode.children = [node];
    currentNode = node;
    path.push(0);
  }

  if (!sameReviewPosition(currentNode.fen, position.fen)) return null;

  currentNode.fen = position.fen;
  applyReviewPositionToNode(currentNode, position);
  tree.position = path;
  return { state: tree, path };
}

function applyReviewPositionToNode(node: TreeNode, position: Position) {
  const reviewTree = position.reviewTree ? cloneReviewTreeNode(position.reviewTree) : null;
  if (reviewTree) {
    node.children = reviewTree.children;
    node.score = reviewTree.score;
    node.depth = reviewTree.depth;
    node.annotations = reviewTree.annotations;
    node.comment = reviewTree.comment;
    node.shapes = reviewTree.shapes;
    if (reviewTree.clock !== undefined) {
      node.clock = reviewTree.clock;
    } else {
      delete node.clock;
    }
    return;
  }

  node.annotations = position.annotations ?? [];
  node.comment = position.comment ?? "";
  node.shapes = position.shapes ?? [];
}

function withReviewTree(position: Position, reviewTree: TreeNode): Position {
  const hasContent = hasReviewTreeContent(reviewTree);
  return {
    ...position,
    comment: reviewTree.comment || undefined,
    annotations: reviewTree.annotations.length > 0 ? reviewTree.annotations : undefined,
    shapes: reviewTree.shapes.length > 0 ? reviewTree.shapes : undefined,
    reviewTree: hasContent ? reviewTree : undefined,
  };
}

function hasReviewTreeContent(node: TreeNode) {
  return (
    node.children.length > 0 ||
    node.annotations.length > 0 ||
    node.shapes.length > 0 ||
    node.comment.trim().length > 0
  );
}

function sameReviewPersistence(left: Position, right: Position) {
  return (
    JSON.stringify(reviewPersistenceSnapshot(left)) ===
    JSON.stringify(reviewPersistenceSnapshot(right))
  );
}

function reviewPersistenceSnapshot(position: Position) {
  return {
    comment: position.comment || undefined,
    annotations: position.annotations?.length ? position.annotations : undefined,
    shapes: position.shapes?.length ? position.shapes : undefined,
    reviewTree: position.reviewTree ? cloneReviewTreeNode(position.reviewTree) : undefined,
  };
}

function cloneTreeState(state: TreeState): TreeState {
  return {
    root: cloneReviewTreeNode(state.root),
    headers: {
      ...state.headers,
      start: state.headers.start ? [...state.headers.start] : undefined,
      other: state.headers.other ? { ...state.headers.other } : undefined,
    },
    position: [...state.position],
    dirty: state.dirty,
    report: { ...state.report },
  };
}

function cloneReviewTreeNode(node: TreeNode): TreeNode {
  return {
    fen: node.fen,
    move: cloneJson(node.move) ?? null,
    san: node.san ?? null,
    children: node.children.map(cloneReviewTreeNode),
    score: cloneJson(node.score) ?? null,
    depth: node.depth ?? null,
    halfMoves: node.halfMoves,
    shapes: cloneJson(node.shapes ?? []),
    annotations: [...(node.annotations ?? [])],
    comment: node.comment ?? "",
    ...(node.clock !== undefined ? { clock: node.clock } : {}),
  };
}

function cloneJson<T>(value: T): T {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function tokenizeReviewMoveSequence(moveSequence: string) {
  return moveSequence
    .split(/\s+/)
    .map((token) => token.replace(/^\d+\.(\.\.)?/, "").trim())
    .filter(
      (token) =>
        token && !/^\d+\.(\.\.)?$/.test(token) && !["1-0", "0-1", "1/2-1/2", "*"].includes(token),
    );
}

function mistakeReviewAttemptColor(
  label: NonNullable<PracticeState["mistakeReviewLabel"]> | undefined,
  phase: PracticeState["phase"],
) {
  switch (label) {
    case "best":
      return "green";
    case "good":
      return "teal";
    case "okay":
      return "blue";
    case "inaccuracy":
      return "yellow";
    case "mistake":
      return "orange";
    case "blunder":
      return "red";
    default:
      return phase === "correct" ? "green" : "red";
  }
}

function parseReviewCorrectMove(position: Position, value: string) {
  const input = value.trim();
  if (!input) return null;

  const [pos] = positionFromFen(position.fen);
  if (!pos) return null;

  let move: Move | undefined | null = parseSan(pos, input);
  if (!move) {
    const uciMove = parseUci(input);
    if (uciMove && pos.isLegal(uciMove)) {
      move = uciMove;
    }
  }
  if (!move || !pos.isLegal(move)) return null;

  return {
    san: makeSan(pos, move),
    uci: makeUci(move),
  };
}

function OpeningReviewPanel({
  deckName,
  deckPath,
  deckMode,
  autoUpdateConfig,
  onAutoUpdateEnabledChange,
  initialView,
  isMistakeReview = false,
  initialPractice,
  openingDailySettings,
  mistakeDailySettings,
  mistakeTimeManagementSettings,
  mistakeAutoUpdateConfig,
  onOpeningDailySettingsChange,
  onMistakeDailySettingsChange,
  boardMoveCandidate,
  onClearBoardMoveCandidate,
  onLoadPosition,
  loadError,
  loaded,
}: {
  deckName: string;
  deckPath: string;
  deckMode?: "self" | "opponent";
  autoUpdateConfig?: OpeningReviewAutoUpdateConfig;
  onAutoUpdateEnabledChange: (enabled: boolean) => void;
  initialView: OpeningReviewPanelView;
  isMistakeReview?: boolean;
  initialPractice?: OpeningReviewInitialPractice;
  openingDailySettings?: OpeningReviewDeck["daily"];
  mistakeDailySettings?: MistakeReviewDeck["daily"];
  mistakeTimeManagementSettings?: MistakeReviewDeck["settings"]["timeManagement"];
  mistakeAutoUpdateConfig?: MistakeReviewDeck["autoUpdate"];
  onOpeningDailySettingsChange?: (daily: OpeningReviewDailySettings) => void;
  onMistakeDailySettingsChange?: (daily: MistakeReviewDailySettings) => void;
  boardMoveCandidate: ReviewBoardMoveCandidate | null;
  onClearBoardMoveCandidate: () => void;
  onLoadPosition: (positionIndex: number) => void;
  loadError: string | null;
  loaded: boolean;
}) {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const goToMove = useStore(store, (s) => s.goToMove);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  const setState = useStore(store, (s) => s.setState);
  const currentFen = useStore(store, (s) => s.currentNode().fen);

  const [deck, setDeck] = useAtom(deckAtomFamily({ file: deckPath, game: 0 }));
  const stats = getStats(deck.positions);
  const dailyBatch = useMemo(() => {
    if (isMistakeReview && mistakeDailySettings) {
      return getMistakeReviewDailyBatch(deck.positions, mistakeDailySettings);
    }
    if (!isMistakeReview && openingDailySettings) {
      return getOpeningReviewDailyBatch(deck.positions, openingDailySettings);
    }
    return [];
  }, [deck.positions, isMistakeReview, mistakeDailySettings, openingDailySettings]);
  const dailyProgress = useMemo(() => {
    if (isMistakeReview && mistakeDailySettings) {
      return getMistakeReviewDailyProgress(deck.positions, mistakeDailySettings);
    }
    if (!isMistakeReview && openingDailySettings) {
      return getOpeningReviewDailyProgress(deck.positions, openingDailySettings);
    }
    return null;
  }, [deck.positions, isMistakeReview, mistakeDailySettings, openingDailySettings]);
  const dailyScopeIndices = useMemo(
    () =>
      dailyBatch
        .map((position) => deck.positions.indexOf(position))
        .filter((positionIndex) => positionIndex >= 0),
    [dailyBatch, deck.positions],
  );
  const mistakePhaseCounts = useMemo(
    () => (isMistakeReview ? getMistakeReviewPhaseCounts(deck.positions) : null),
    [deck.positions, isMistakeReview],
  );
  const timeManagementMinMoveSeconds =
    mistakeTimeManagementSettings?.minMoveSeconds ??
    DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds;
  const timeManagementScopeIndices = useMemo(() => {
    if (!isMistakeReview) return [];
    const indexByPosition = new Map<Position, number>();
    deck.positions.forEach((position, index) => indexByPosition.set(position, index));
    return getMistakeReviewTimeManagementBatch(deck.positions, {
      minMoveSeconds: timeManagementMinMoveSeconds,
    })
      .map((position) => indexByPosition.get(position) ?? -1)
      .filter((positionIndex) => positionIndex >= 0);
  }, [deck.positions, isMistakeReview, timeManagementMinMoveSeconds]);
  const setInvisible = useSetAtom(currentInvisibleAtom);
  const setShowComments = useSetAtom(currentShowCommentsAtom);
  const setEvalOpen = useSetAtom(currentEvalOpenAtom);
  const setDailyGoalCompletionPrompt = useSetAtom(dailyGoalCompletionPromptAtom);
  const [practiceState, setPracticeState] = useAtom(practiceStateAtom);
  const [sessionStats, setSessionStats] = useAtom(practiceSessionStatsAtom);
  const setCardStartTime = useSetAtom(practiceCardStartTimeAtom);
  const practiceAutoDifficulty = useAtomValue(practiceAutoDifficultyAtom);
  const hideMovesDuringPractice = useAtomValue(openingReviewHideMovesDuringPracticeAtom);
  const [positionsOpen, setPositionsOpen] = useToggle();
  const [panelView, setPanelView] = useState<OpeningReviewPanelView>(initialView);
  const [dailySettingsOpen, setDailySettingsOpen] = useState(false);
  const initialPracticeStartedRef = useRef(false);
  const activeDailyGoalSessionRef = useRef<OpeningReviewInitialPractice | null>(null);
  const dailyGoalCompletionPromptTimerRef = useRef<number | null>(null);
  const persistOpeningNames = useCallback(
    (namesByKey: OpeningReviewResolvedOpeningNames) => {
      setDeck((current) => {
        const positions = applyOpeningReviewResolvedOpeningNames(current.positions, namesByKey);
        return positions === current.positions ? current : { ...current, positions };
      });
    },
    [setDeck],
  );
  const playedOverrideCandidate = useMemo(() => {
    if (
      practiceState.positionIndex !== undefined &&
      practiceState.currentFen &&
      practiceState.playedMove &&
      practiceState.playedMoveUci
    ) {
      return {
        positionIndex: practiceState.positionIndex,
        fen: practiceState.currentFen,
        san: practiceState.playedMove,
        uci: practiceState.playedMoveUci,
      };
    }

    if (!boardMoveCandidate) return null;
    const positionIndex = deck.positions.findIndex(
      (position) => position.fen === boardMoveCandidate.fen,
    );
    if (positionIndex === -1) return null;

    return {
      positionIndex,
      ...boardMoveCandidate,
    };
  }, [
    boardMoveCandidate,
    deck.positions,
    practiceState.currentFen,
    practiceState.playedMove,
    practiceState.playedMoveUci,
    practiceState.positionIndex,
  ]);
  const playedOverridePosition =
    playedOverrideCandidate && deck.positions[playedOverrideCandidate.positionIndex]
      ? deck.positions[playedOverrideCandidate.positionIndex]
      : null;
  const playedMoveMatchesBestValidatedMove =
    playedOverrideCandidate &&
    playedOverridePosition &&
    (playedOverrideCandidate.uci === practiceState.bestMoveUci ||
      playedOverrideCandidate.uci === playedOverridePosition.engine?.bestMoveUci ||
      playedOverrideCandidate.san === practiceState.bestMove ||
      playedOverrideCandidate.san === playedOverridePosition.engine?.bestMoveSan);
  const canOverridePlayedMove =
    playedOverrideCandidate &&
    playedOverridePosition &&
    !playedMoveMatchesBestValidatedMove &&
    !isOpeningReviewSavedMove(playedOverridePosition, playedOverrideCandidate);
  const currentPracticePositionIndex =
    practiceState.positionIndex ??
    (practiceState.currentFen
      ? deck.positions.findIndex((position) =>
          sameReviewPosition(position.fen, practiceState.currentFen ?? ""),
        )
      : -1);
  const currentPracticePosition =
    practiceState.phase !== "idle" && currentPracticePositionIndex >= 0
      ? (deck.positions[currentPracticePositionIndex] ?? null)
      : null;
  const attemptPosition =
    (practiceState.phase === "correct" || practiceState.phase === "incorrect") &&
    practiceState.positionIndex !== undefined
      ? (deck.positions[practiceState.positionIndex] ?? null)
      : null;
  const attemptPlayedMove = practiceState.playedMove ?? null;
  const currentBoardPosition = useMemo(
    () => deck.positions.find((position) => sameReviewPosition(position.fen, currentFen)) ?? null,
    [currentFen, deck.positions],
  );
  const mistakeReviewInfoPosition = isMistakeReview
    ? (attemptPosition ??
      currentPracticePosition ??
      currentBoardPosition ??
      deck.positions.find((position) => position.mistakeReview) ??
      null)
    : null;

  const updateCorrectMove = useCallback(
    (positionIndex: number, move: { san: string; uci: string }) => {
      setDeck((current) => {
        const position = current.positions[positionIndex];
        if (!position) return current;
        const sameMove = isOpeningReviewSavedMove(position, move);
        const positions = [...current.positions];
        positions[positionIndex] = {
          ...position,
          answer: move.san,
          answerUci: move.uci,
          reviewKey: `${position.fen}|${move.uci || move.san}`,
          card: sameMove ? position.card : createEmptyCard(),
        };
        return {
          ...current,
          positions,
        };
      });

      if (practiceState.phase === "incorrect" && practiceState.positionIndex === positionIndex) {
        setSessionStats((current) => ({
          ...current,
          incorrect: Math.max(0, current.incorrect - 1),
        }));
        setPracticeState((current) => ({
          ...current,
          phase: "correct",
          answer: move.san,
          playedMove: move.san,
          playedMoveUci: move.uci,
          resultRecorded: false,
        }));
      }

      onClearBoardMoveCandidate();
      notifications.show({
        title: "Correct move updated",
        message: `${move.san} is now the move trained for this position.`,
        color: "green",
      });
    },
    [
      onClearBoardMoveCandidate,
      practiceState.phase,
      practiceState.positionIndex,
      setDeck,
      setPracticeState,
      setSessionStats,
    ],
  );

  const stopPractice = useCallback(() => {
    setPracticeState({ phase: "idle" });
    setPracticePath(null);
    setInvisible(false);
    setShowComments(true);
    setEvalOpen(true);
    onClearBoardMoveCandidate();
    activeDailyGoalSessionRef.current = null;
  }, [
    onClearBoardMoveCandidate,
    setEvalOpen,
    setInvisible,
    setPracticePath,
    setPracticeState,
    setShowComments,
  ]);

  const completePracticeSession = useCallback(() => {
    const dailyGoalSession = activeDailyGoalSessionRef.current;
    setPracticeState({ phase: "idle" });
    setPracticePath(null);
    setInvisible(false);
    setShowComments(true);
    setEvalOpen(true);
    onClearBoardMoveCandidate();
    activeDailyGoalSessionRef.current = null;

    if (dailyGoalSession?.source === "daily-goals") {
      if (dailyGoalCompletionPromptTimerRef.current !== null) {
        window.clearTimeout(dailyGoalCompletionPromptTimerRef.current);
      }
      dailyGoalCompletionPromptTimerRef.current = window.setTimeout(() => {
        setDailyGoalCompletionPrompt({
          completedGoalTitle:
            dailyGoalSession.goalTitle ?? (isMistakeReview ? "Mistake review" : "Opening gaps"),
          completedGoalKind: isMistakeReview ? "mistake-review" : "opening-review",
          completedAt: Date.now(),
        });
        dailyGoalCompletionPromptTimerRef.current = null;
      }, 700);
    }
  }, [
    isMistakeReview,
    onClearBoardMoveCandidate,
    setDailyGoalCompletionPrompt,
    setEvalOpen,
    setInvisible,
    setPracticePath,
    setPracticeState,
    setShowComments,
  ]);

  useEffect(
    () => () => {
      if (dailyGoalCompletionPromptTimerRef.current !== null) {
        window.clearTimeout(dailyGoalCompletionPromptTimerRef.current);
      }
    },
    [],
  );

  const newPractice = useCallback(
    (
      nextStats?: Partial<typeof sessionStats>,
      options?: { positions?: Position[]; scopeIndices?: number[] },
    ) => {
      const positions = options?.positions ?? deck.positions;
      if (positions.length === 0) {
        completePracticeSession();
        return;
      }

      const mode = nextStats?.mode ?? sessionStats.mode;
      const remaining = nextStats?.remainingPositions ?? sessionStats.remainingPositions;
      const positionIndex =
        mode === "full" || mode === "srs-list"
          ? (remaining[0] ?? -1)
          : getNextDueOpeningReviewPositionIndex(
              positions,
              remaining.length > 0 ? remaining : options?.scopeIndices,
            );
      const position = positionIndex >= 0 ? (positions[positionIndex] ?? null) : null;

      if (!position) {
        completePracticeSession();
        return;
      }
      onClearBoardMoveCandidate();

      const path = loadReviewPositionOnBoard({
        position,
        headers,
        root,
        store,
        goToMove,
        setHeaders,
        setState,
      });
      setPracticePath(path);
      setInvisible(hideMovesDuringPractice);
      setShowComments(false);
      setEvalOpen(false);
      setCardStartTime(Date.now());
      setPracticeState({ phase: "waiting", currentFen: position.fen, positionIndex });
    },
    [
      deck.positions,
      goToMove,
      headers,
      root,
      sessionStats.mode,
      sessionStats.remainingPositions,
      setCardStartTime,
      setEvalOpen,
      setHeaders,
      setInvisible,
      setPracticePath,
      setPracticeState,
      setState,
      setShowComments,
      store,
      onClearBoardMoveCandidate,
      completePracticeSession,
      hideMovesDuringPractice,
    ],
  );

  const deleteCurrentReviewPosition = useCallback(() => {
    if (!currentPracticePosition || currentPracticePositionIndex < 0) return;

    const nextPositions = deck.positions.filter(
      (_, positionIndex) => positionIndex !== currentPracticePositionIndex,
    );
    const hasScopedRemainingPositions = sessionStats.remainingPositions.length > 0;
    const nextRemainingPositions =
      sessionStats.mode === "full" || hasScopedRemainingPositions
        ? sessionStats.remainingPositions
            .filter((positionIndex) => positionIndex !== currentPracticePositionIndex)
            .map((positionIndex) =>
              positionIndex > currentPracticePositionIndex ? positionIndex - 1 : positionIndex,
            )
        : sessionStats.remainingPositions;

    setDeck((current) => ({
      ...current,
      positions: current.positions.filter(
        (_, positionIndex) => positionIndex !== currentPracticePositionIndex,
      ),
    }));

    if (sessionStats.mode === "full" || hasScopedRemainingPositions) {
      setSessionStats((current) => ({
        ...current,
        remainingPositions: nextRemainingPositions,
      }));
    }

    notifications.show({
      title: "Position removed",
      message: `${currentPracticePosition.answer} was removed from this review deck.`,
      color: "blue",
    });
    onClearBoardMoveCandidate();
    newPractice(
      sessionStats.mode === "full" || hasScopedRemainingPositions
        ? { mode: sessionStats.mode, remainingPositions: nextRemainingPositions }
        : undefined,
      { positions: nextPositions },
    );
  }, [
    currentPracticePosition,
    currentPracticePositionIndex,
    deck.positions,
    newPractice,
    onClearBoardMoveCandidate,
    sessionStats.mode,
    sessionStats.remainingPositions,
    setDeck,
    setSessionStats,
  ]);

  const startDuePractice = useCallback(
    (
      scopeIndices?: number[],
      scopeLabel?: string,
      options?: { dailyGoalSession?: OpeningReviewInitialPractice },
    ) => {
      if (scopeIndices && scopeIndices.length === 0) {
        notifications.show({
          title: "No due positions to train",
          message: "The selected opening and colour filters do not have any due positions.",
          color: "yellow",
        });
        return;
      }

      activeDailyGoalSessionRef.current = options?.dailyGoalSession ?? null;
      const nextStats = {
        mode: "anki" as const,
        remainingPositions: scopeIndices ?? [],
        correct: 0,
        incorrect: 0,
        streak: 0,
        bestStreak: 0,
      };
      setSessionStats((current) => ({ ...current, ...nextStats }));
      newPractice(nextStats, scopeIndices ? { scopeIndices } : undefined);
      if (scopeIndices) {
        notifications.show({
          title: "Focused review started",
          message: `Training due gaps in ${scopeLabel ?? "the selected filter"}.`,
          color: "blue",
        });
      }
    },
    [newPractice, setSessionStats],
  );

  const startFullPractice = useCallback(
    (
      scopeIndices?: number[],
      scopeLabel?: string,
      options?: { dailyGoalSession?: OpeningReviewInitialPractice },
    ) => {
      const remainingPositions = scopeIndices ?? deck.positions.map((_, index) => index);
      if (remainingPositions.length === 0) {
        notifications.show({
          title: "No positions to train",
          message: "The selected opening and colour filters do not match any positions.",
          color: "yellow",
        });
        return;
      }

      activeDailyGoalSessionRef.current = options?.dailyGoalSession ?? null;
      const nextStats = {
        mode: "full" as const,
        remainingPositions,
        correct: 0,
        incorrect: 0,
        streak: 0,
        bestStreak: 0,
      };
      setSessionStats((current) => ({ ...current, ...nextStats }));
      newPractice(nextStats);
      if (scopeIndices) {
        notifications.show({
          title: "Focused review started",
          message: `Training ${remainingPositions.length} gap${
            remainingPositions.length === 1 ? "" : "s"
          } in ${scopeLabel ?? "the selected filter"}.`,
          color: "blue",
        });
      }
    },
    [deck.positions, newPractice, setSessionStats],
  );

  const startMistakePhasePractice = useCallback(
    (phase: MistakeReviewPhase) => {
      if (!isMistakeReview) return;

      const label =
        MISTAKE_REVIEW_PHASES.find((phaseOption) => phaseOption.id === phase)?.label ?? "Phase";
      const phaseBatch = getMistakeReviewPhaseBatch(deck.positions, phase);
      const remainingPositions = phaseBatch
        .map((position) => deck.positions.indexOf(position))
        .filter((positionIndex) => positionIndex >= 0);

      if (remainingPositions.length === 0) {
        notifications.show({
          title: "No positions to train",
          message: `No ${label.toLowerCase()} mistakes found in this set yet.`,
          color: "yellow",
        });
        return;
      }

      const nextStats = {
        mode: "srs-list" as const,
        remainingPositions,
        correct: 0,
        incorrect: 0,
        streak: 0,
        bestStreak: 0,
      };
      setSessionStats((current) => ({ ...current, ...nextStats }));
      newPractice(nextStats);
      notifications.show({
        title: "Train by phase started",
        message: `Training ${remainingPositions.length} ${label.toLowerCase()} mistake${
          remainingPositions.length === 1 ? "" : "s"
        }.`,
        color: "blue",
      });
    },
    [deck.positions, isMistakeReview, newPractice, setSessionStats],
  );

  const startMistakeTimeManagementPractice = useCallback(() => {
    if (!isMistakeReview) return;

    if (timeManagementScopeIndices.length === 0) {
      notifications.show({
        title: "No time-management cards yet",
        message:
          "This deck does not have long-think clock data yet. Create or update it from online games with clock comments.",
        color: "yellow",
      });
      return;
    }

    const nextStats = {
      mode: "srs-list" as const,
      remainingPositions: timeManagementScopeIndices,
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStats((current) => ({ ...current, ...nextStats }));
    newPractice(nextStats);
    notifications.show({
      title: "Time management training started",
      message: `Training ${timeManagementScopeIndices.length} long-think mistake${
        timeManagementScopeIndices.length === 1 ? "" : "s"
      }.`,
      color: "orange",
    });
  }, [isMistakeReview, newPractice, setSessionStats, timeManagementScopeIndices]);

  useEffect(() => {
    if (
      initialPracticeStartedRef.current ||
      !initialPractice ||
      !loaded ||
      deck.positions.length === 0
    ) {
      return;
    }

    initialPracticeStartedRef.current = true;
    const indices = initialPractice.indices.filter(
      (index) => index >= 0 && index < deck.positions.length,
    );
    if (initialPractice.mode === "due") {
      startDuePractice(indices, initialPractice.label, {
        dailyGoalSession:
          initialPractice.source === "daily-goals" ? initialPractice : undefined,
      });
    } else {
      startFullPractice(indices, initialPractice.label, {
        dailyGoalSession:
          initialPractice.source === "daily-goals" ? initialPractice : undefined,
      });
    }
  }, [deck.positions.length, initialPractice, loaded, startDuePractice, startFullPractice]);

  function handleQualityRating(grade: 1 | 2 | 3 | 4) {
    if (
      (practiceState.phase !== "correct" &&
        !(isMistakeReview && practiceState.phase === "incorrect")) ||
      practiceState.positionIndex === undefined
    ) {
      return;
    }

    const positionIndex = practiceState.positionIndex;
    const position = deck.positions[positionIndex];
    if (!position) return;

    const remainingPositions =
      sessionStats.remainingPositions.length > 0
        ? sessionStats.remainingPositions.filter((index) => index !== positionIndex)
        : sessionStats.remainingPositions;
    const wasCorrect = practiceState.phase === "correct";

    updateCardPerformance(setDeck, positionIndex, position.card, grade);
    setSessionStats((current) => ({
      ...current,
      remainingPositions,
      correct: wasCorrect ? current.correct + 1 : current.correct,
      incorrect: wasCorrect ? current.incorrect : current.incorrect + 1,
      streak: wasCorrect ? current.streak + 1 : 0,
      bestStreak: wasCorrect
        ? Math.max(current.bestStreak, current.streak + 1)
        : current.bestStreak,
    }));
    newPractice(
      { mode: sessionStats.mode, remainingPositions },
      sessionStats.remainingPositions.length > 0 ? { scopeIndices: remainingPositions } : undefined,
    );
  }

  function skipCard() {
    if (sessionStats.mode === "full" && sessionStats.remainingPositions.length > 0) {
      const remainingPositions = sessionStats.remainingPositions.slice(1);
      setSessionStats((current) => ({ ...current, remainingPositions }));
      newPractice({ remainingPositions, mode: "full" });
      return;
    }

    if (sessionStats.remainingPositions.length > 0 && practiceState.positionIndex !== undefined) {
      const remainingPositions = sessionStats.remainingPositions.filter(
        (index) => index !== practiceState.positionIndex,
      );
      setSessionStats((current) => ({ ...current, remainingPositions }));
      newPractice(
        { remainingPositions, mode: sessionStats.mode },
        { scopeIndices: remainingPositions },
      );
      return;
    }

    newPractice();
  }

  const advanceFullPracticeCorrect = useCallback(() => {
    const remainingPositions = sessionStats.remainingPositions.slice(1);
    setSessionStats((current) => ({
      ...current,
      remainingPositions,
      correct: current.correct + 1,
      streak: current.streak + 1,
      bestStreak: Math.max(current.bestStreak, current.streak + 1),
    }));
    newPractice({ remainingPositions, mode: "full" });
  }, [newPractice, sessionStats.remainingPositions, setSessionStats]);

  const advanceMistakeReviewCorrect = useCallback(() => {
    if (
      practiceState.phase === "correct" &&
      practiceState.positionIndex !== undefined &&
      !practiceState.resultRecorded
    ) {
      const positionIndex = practiceState.positionIndex;
      const position = deck.positions[positionIndex];
      if (position) {
        if (sessionStats.mode !== "full") {
          updateCardPerformance(setDeck, positionIndex, position.card, 3);
        }
        setSessionStats((current) => ({
          ...current,
          correct: current.correct + 1,
          streak: current.streak + 1,
          bestStreak: Math.max(current.bestStreak, current.streak + 1),
        }));
      }
    }

    if (sessionStats.mode === "full") {
      const remainingPositions = sessionStats.remainingPositions.slice(1);
      setSessionStats((current) => ({
        ...current,
        remainingPositions,
      }));
      newPractice({ remainingPositions, mode: "full" });
      return;
    }

    newPractice();
  }, [
    deck.positions,
    newPractice,
    practiceState.phase,
    practiceState.positionIndex,
    practiceState.resultRecorded,
    sessionStats.mode,
    sessionStats.remainingPositions,
    setDeck,
    setSessionStats,
  ]);

  const canRateAttempt =
    sessionStats.mode !== "full" &&
    (practiceState.phase === "correct" || (isMistakeReview && practiceState.phase === "incorrect"));

  useEffect(() => {
    if (isMistakeReview || practiceState.phase !== "correct") return undefined;

    if (sessionStats.mode === "full") {
      return undefined;
    }

    if (practiceAutoDifficulty !== "none" && practiceState.positionIndex !== undefined) {
      const positionIndex = practiceState.positionIndex;
      const timer = window.setTimeout(() => {
        const remainingPositions =
          sessionStats.remainingPositions.length > 0
            ? sessionStats.remainingPositions.filter((index) => index !== positionIndex)
            : sessionStats.remainingPositions;
        updateCardPerformance(
          setDeck,
          positionIndex,
          deck.positions[positionIndex].card,
          Number(practiceAutoDifficulty) as 1 | 2 | 3 | 4,
        );
        setSessionStats((current) => ({
          ...current,
          correct: current.correct + 1,
          streak: current.streak + 1,
          bestStreak: Math.max(current.bestStreak, current.streak + 1),
        }));
        newPractice(
          { mode: sessionStats.mode, remainingPositions },
          sessionStats.remainingPositions.length > 0
            ? { scopeIndices: remainingPositions }
            : undefined,
        );
      }, 300);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [
    deck.positions,
    isMistakeReview,
    newPractice,
    practiceAutoDifficulty,
    practiceState.phase,
    practiceState.positionIndex,
    sessionStats.mode,
    sessionStats.remainingPositions,
    setDeck,
    setSessionStats,
  ]);

  useHotkeys("1", () => handleQualityRating(1), {
    enabled: canRateAttempt,
  });
  useHotkeys("2", () => handleQualityRating(2), {
    enabled: canRateAttempt,
  });
  useHotkeys("3", () => handleQualityRating(3), {
    enabled: canRateAttempt,
  });
  useHotkeys("4", () => handleQualityRating(4), {
    enabled: canRateAttempt,
  });
  useHotkeys("space", () => skipCard(), {
    enabled: practiceState.phase === "incorrect" && !canRateAttempt,
  });
  useHotkeys("space", () => advanceMistakeReviewCorrect(), {
    enabled: isMistakeReview && practiceState.phase === "correct" && sessionStats.mode === "full",
  });
  useHotkeys("space", () => advanceFullPracticeCorrect(), {
    enabled: !isMistakeReview && practiceState.phase === "correct" && sessionStats.mode === "full",
  });

  useEffect(() => {
    if (practiceState.phase === "correct" || practiceState.phase === "incorrect") {
      setInvisible(false);
      setShowComments(true);
    }
  }, [practiceState.phase, setInvisible, setShowComments]);

  if (!loaded) {
    return <Alert color="blue">Loading review deck...</Alert>;
  }

  if (loadError) {
    return (
      <Alert color="red" title="Could not open review deck">
        {loadError}
      </Alert>
    );
  }

  const panelModeControl = isMistakeReview ? null : (
    <Box style={openingReviewPanelModeControlStyle}>
      <SegmentedControl
        size="xs"
        fullWidth
        value={panelView}
        onChange={(value) => setPanelView(value as OpeningReviewPanelView)}
        data={[
          { value: "review", label: "Review positions" },
          { value: "stats", label: "Stats" },
          { value: "analyze", label: "Analyze repertoire" },
        ]}
      />
    </Box>
  );

  if (!isMistakeReview && panelView === "analyze") {
    return (
      <Stack h="100%" gap="sm">
        {panelModeControl}
        <RepertoireGapsPanel />
      </Stack>
    );
  }

  if (!isMistakeReview && panelView === "stats") {
    return (
      <Stack h="100%" gap="sm">
        {panelModeControl}
        <OpeningReviewStatsPage
          positions={deck.positions}
          deckMode={deckMode}
          onOpeningNamesResolved={persistOpeningNames}
          onReviewOpening={(indices, label) => startFullPractice(indices, label)}
        />
      </Stack>
    );
  }

  const isBestAlternative = practiceState.moveAssessment === "best";
  const isOkAlternative = practiceState.moveAssessment === "ok";
  const mistakeFeedbackColor = mistakeReviewAttemptColor(
    practiceState.mistakeReviewLabel,
    practiceState.phase,
  );
  const feedbackColor = isMistakeReview
    ? mistakeFeedbackColor
    : isBestAlternative
      ? "green"
      : isOkAlternative
        ? "blue"
        : "red";
  const correctFeedbackColor = isMistakeReview
    ? mistakeFeedbackColor
    : !isMistakeReview && isOkAlternative
      ? "blue"
      : "green";
  const correctFeedbackTitle =
    isMistakeReview && practiceState.mistakeReviewLabel
      ? mistakeReviewSeverityLabel(practiceState.mistakeReviewLabel)
      : !isMistakeReview && isOkAlternative && practiceState.playedMove
        ? `${practiceState.playedMove} is good`
        : !isMistakeReview && isBestAlternative && practiceState.playedMove
          ? `${practiceState.playedMove} is best`
          : "Correct";
  const correctFeedbackDetail =
    isMistakeReview && practiceState.bestMove
      ? `Best move: ${practiceState.bestMove}`
      : !isMistakeReview && isOkAlternative && practiceState.bestMove
        ? `${practiceState.bestMove} is best.`
        : undefined;
  const feedbackTitle = isMistakeReview
    ? practiceState.mistakeReviewLabel
      ? mistakeReviewSeverityLabel(practiceState.mistakeReviewLabel)
      : "Incorrect"
    : isBestAlternative
      ? "Best"
      : isOkAlternative
        ? "OK"
        : "Incorrect";
  const roundedMoveLoss =
    practiceState.moveLossCp === undefined ? undefined : Math.round(practiceState.moveLossCp);
  const isTraining = practiceState.phase !== "idle";
  const sessionCompleted = sessionStats.correct + sessionStats.incorrect;
  const sessionRemaining =
    sessionStats.mode === "full" || sessionStats.remainingPositions.length > 0
      ? sessionStats.remainingPositions.length
      : Math.max(0, stats.due + stats.unseen);
  const sessionTotal = sessionCompleted + sessionRemaining;
  const sessionProgress = sessionTotal > 0 ? (sessionCompleted / sessionTotal) * 100 : 0;
  const ratingPanelDetail =
    isMistakeReview && practiceState.phase === "incorrect"
      ? `Best move: ${practiceState.bestMove ?? practiceState.answer ?? "-"}`
      : correctFeedbackDetail;
  const ratingPanelIcon =
    isMistakeReview && practiceState.phase === "incorrect"
      ? "x"
      : !isMistakeReview && isOkAlternative
        ? "bulb"
        : "check";
  const updateMistakeDailySettings = (partial: Partial<MistakeReviewDailySettings>) => {
    if (!mistakeDailySettings || !onMistakeDailySettingsChange) return;
    onMistakeDailySettingsChange({ ...mistakeDailySettings, ...partial });
  };
  const updateOpeningDailySettings = (partial: Partial<OpeningReviewDailySettings>) => {
    if (!openingDailySettings || !onOpeningDailySettingsChange) return;
    onOpeningDailySettingsChange({ ...openingDailySettings, ...partial });
  };
  const dailyReviewScopeLabel = isMistakeReview
    ? "today's mistake review"
    : "today's opening review";
  const timeManagementThresholdText =
    formatMistakeReviewMoveTime(timeManagementMinMoveSeconds) ?? `${timeManagementMinMoveSeconds}s`;

  return (
    <>
      <Stack h="100%" gap={8}>
        {panelModeControl}
        {!isMistakeReview && <OpeningReviewAutoUpdateBanner deckPath={deckPath} />}
        <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
          <Stack gap={0} miw={0}>
            <Text size="sm" fw={700} truncate>
              {deckName}
            </Text>
            <Text size="xs" c="dimmed">
              {deck.positions.length}{" "}
              {isMistakeReview
                ? `mistake card${deck.positions.length === 1 ? "" : "s"}`
                : `saved position${deck.positions.length === 1 ? "" : "s"}`}
            </Text>
          </Stack>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconEye size={14} />}
            onClick={() => setPositionsOpen(true)}
          >
            Positions
          </Button>
        </Group>
        {isMistakeReview && !isTraining && (
          <MistakeReviewDeckSyncStatus config={mistakeAutoUpdateConfig} deckPath={deckPath} />
        )}
        {!isMistakeReview && !isTraining && (
          <OpeningReviewDeckAutoUpdateControl
            config={autoUpdateConfig}
            onEnabledChange={onAutoUpdateEnabledChange}
          />
        )}

        {isTraining ? (
          <Paper px="xs" py={6} withBorder>
            <Stack gap={4}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" fw={700}>
                  Review session
                </Text>
                <Text size="xs" c="dimmed">
                  {sessionCompleted}
                  {sessionTotal > 0 ? ` / ${sessionTotal}` : ""} complete
                </Text>
              </Group>
              <Progress value={sessionProgress} size="xs" />
              <Group gap={6} grow>
                <Badge size="sm" variant="light" color="green">
                  {sessionStats.correct} correct
                </Badge>
                <Badge size="sm" variant="light" color="red">
                  {sessionStats.incorrect} retry
                </Badge>
                <Badge size="sm" variant="light" color="blue">
                  {sessionRemaining} left
                </Badge>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <>
            <Stack gap={3}>
              <Group justify="space-between">
                <Text size="xs" fw={600}>
                  Review progress
                </Text>
                <Text size="xs" c="dimmed">
                  {stats.total > 0 ? Math.round((stats.practiced / stats.total) * 100) : 0}%
                </Text>
              </Group>
              <Progress.Root size="xs">
                <Progress.Section
                  value={stats.total ? (stats.practiced / stats.total) * 100 : 0}
                  color="blue"
                />
                <Progress.Section
                  value={stats.total ? (stats.due / stats.total) * 100 : 0}
                  color="yellow"
                />
                <Progress.Section
                  value={stats.total ? (stats.unseen / stats.total) * 100 : 0}
                  color="gray"
                />
              </Progress.Root>
            </Stack>

            <SimpleGrid cols={3} spacing={6}>
              <ReviewStat label="Due" value={stats.due} color="yellow" />
              <ReviewStat label="Unseen" value={stats.unseen} color="gray" />
              <ReviewStat label="Done" value={stats.practiced} color="blue" />
            </SimpleGrid>

            <OpeningReviewPrioritySummary
              positions={deck.positions}
              onOpenPositions={() => setPositionsOpen(true)}
            />
          </>
        )}

        {practiceState.phase === "idle" && (
          <Stack gap="xs">
            {(isMistakeReview ? mistakeDailySettings : openingDailySettings) && (
              <Stack gap={4}>
                <Group gap={6} align="stretch">
                  <Group
                    gap={0}
                    wrap="nowrap"
                    align="stretch"
                    style={{ flex: "1 1 190px", minWidth: 0 }}
                  >
                    <Button
                      variant="light"
                      leftSection={<IconTarget size={18} />}
                      onClick={() => startDuePractice(dailyScopeIndices, dailyReviewScopeLabel)}
                      justify="space-between"
                      disabled={dailyScopeIndices.length === 0}
                      rightSection={<Badge variant="white">{dailyScopeIndices.length}</Badge>}
                      style={{
                        flex: 1,
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                      }}
                    >
                      Daily review
                    </Button>
                    <Tooltip label="Daily review settings">
                      <ActionIcon
                        aria-label="Daily review settings"
                        variant="light"
                        color="blue"
                        onClick={() => setDailySettingsOpen(true)}
                        style={{
                          alignSelf: "stretch",
                          height: "auto",
                          minWidth: 42,
                          borderTopLeftRadius: 0,
                          borderBottomLeftRadius: 0,
                        }}
                      >
                        <IconSettings size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  {isMistakeReview && (
                    <Tooltip
                      label={
                        timeManagementScopeIndices.length === 0
                          ? "No long-think clock data in this deck yet"
                          : `${timeManagementThresholdText}+ long-think mistakes`
                      }
                    >
                      <Box style={{ flex: "1 1 180px", minWidth: 0 }}>
                        <Button
                          fullWidth
                          variant="light"
                          color="orange"
                          leftSection={<IconClock size={18} />}
                          onClick={startMistakeTimeManagementPractice}
                          justify="space-between"
                          disabled={timeManagementScopeIndices.length === 0}
                          rightSection={
                            <Badge variant="white">{timeManagementScopeIndices.length}</Badge>
                          }
                        >
                          Train time management
                        </Button>
                      </Box>
                    </Tooltip>
                  )}
                  {isMistakeReview && mistakePhaseCounts && (
                    <Menu width={260} position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Button
                          variant="light"
                          color="teal"
                          leftSection={<IconTargetArrow size={18} />}
                          rightSection={<IconChevronDown size={16} />}
                          disabled={MISTAKE_REVIEW_PHASES.every(
                            (phase) => mistakePhaseCounts[phase.id].total === 0,
                          )}
                          style={{ flex: "1 1 150px" }}
                        >
                          Train by phase
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {MISTAKE_REVIEW_PHASES.map((phase) => {
                          const count = mistakePhaseCounts[phase.id];
                          return (
                            <Menu.Item
                              key={phase.id}
                              disabled={count.total === 0}
                              onClick={() => startMistakePhasePractice(phase.id)}
                              rightSection={
                                <Group gap={4} wrap="nowrap">
                                  <Badge size="xs" variant="light" color="yellow">
                                    {count.due} due
                                  </Badge>
                                  <Badge size="xs" variant="light" color="gray">
                                    {count.total}
                                  </Badge>
                                </Group>
                              }
                            >
                              {phase.label}
                            </Menu.Item>
                          );
                        })}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
                {dailyProgress && (
                  <Text size="xs" c="dimmed">
                    {Math.min(dailyProgress.completed, dailyProgress.target)} /{" "}
                    {dailyProgress.target} done today
                  </Text>
                )}
              </Stack>
            )}
            {stats.due === 0 && stats.unseen === 0 ? (
              <Paper p="sm" withBorder>
                <Stack gap="xs" align="center">
                  <ThemeIcon size="xl" radius="xl" color="green" variant="light">
                    <IconCheck size={24} />
                  </ThemeIcon>
                  <Text ta="center" fw={600}>
                    Everything due is done
                  </Text>
                  {stats.nextDue && (
                    <Text ta="center" size="sm" c="dimmed">
                      Next review {dayjs(stats.nextDue).format("MMM D, HH:mm")}
                    </Text>
                  )}
                </Stack>
              </Paper>
            ) : (
              <Button
                fullWidth
                variant="light"
                leftSection={<IconTarget size={18} />}
                onClick={() => startDuePractice()}
                justify="space-between"
                rightSection={<Badge variant="white">{stats.due + stats.unseen}</Badge>}
              >
                Train due positions
              </Button>
            )}
            <Button
              fullWidth
              variant="light"
              color="gray"
              leftSection={<IconBook size={18} />}
              onClick={() => startFullPractice()}
              justify="space-between"
              rightSection={<Badge variant="white">{deck.positions.length}</Badge>}
            >
              Train all positions
            </Button>
          </Stack>
        )}

        {practiceState.phase === "waiting" && (
          <Paper p="sm" withBorder>
            {practiceState.currentFen && currentFen !== practiceState.currentFen ? (
              <Stack gap="xs" align="center">
                <Text ta="center" size="sm" c="dimmed">
                  Return to the review position before moving.
                </Text>
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconArrowBack size={14} />}
                  onClick={() => {
                    if (!practiceState.currentFen) return;
                    const position = deck.positions.find(
                      (deckPosition) => deckPosition.fen === practiceState.currentFen,
                    );
                    if (position) {
                      const path = loadReviewPositionOnBoard({
                        position,
                        headers,
                        root,
                        store,
                        goToMove,
                        setHeaders,
                        setState,
                      });
                      setPracticePath(path);
                    } else if (
                      findFen(practiceState.currentFen, root).length === 0 &&
                      !sameReviewPosition(root.fen, practiceState.currentFen)
                    ) {
                      setHeaders({ ...headers, fen: practiceState.currentFen, result: "*" });
                      setPracticePath([]);
                    } else {
                      const path = findFen(practiceState.currentFen, root);
                      goToMove(path);
                      setPracticePath(path);
                    }
                    setInvisible(hideMovesDuringPractice);
                  }}
                >
                  Go back
                </Button>
              </Stack>
            ) : (
              <Group justify="center" gap="xs">
                <Text size="sm" c="dimmed">
                  Play the move you want to remember.
                </Text>
                <Button size="compact-xs" variant="light" color="red" onClick={stopPractice}>
                  Stop
                </Button>
              </Group>
            )}
          </Paper>
        )}

        {canRateAttempt && (
          <ReviewQualityPanel
            onRate={handleQualityRating}
            title={correctFeedbackTitle}
            detail={ratingPanelDetail}
            color={correctFeedbackColor}
            icon={ratingPanelIcon}
            card={
              practiceState.positionIndex !== undefined
                ? deck.positions[practiceState.positionIndex].card
                : undefined
            }
            timeTaken={practiceState.timeTaken}
          />
        )}

        {practiceState.phase === "correct" && sessionStats.mode === "full" && (
          <Paper p="sm" withBorder>
            <Stack gap="xs" align="center">
              <Group gap="xs">
                <ThemeIcon size="md" color="green" variant="light" radius="xl">
                  <IconCheck size={16} />
                </ThemeIcon>
                <Text fw={600} c="green">
                  Correct
                </Text>
              </Group>
              <Button
                variant="light"
                size="sm"
                onClick={isMistakeReview ? advanceMistakeReviewCorrect : advanceFullPracticeCorrect}
              >
                Next position
              </Button>
            </Stack>
          </Paper>
        )}

        {practiceState.phase === "incorrect" && !canRateAttempt && (
          <Paper p="sm" withBorder>
            <Stack gap="xs" align="center">
              <Group gap="xs">
                <ThemeIcon size="md" color={feedbackColor} variant="light" radius="xl">
                  {isBestAlternative ? (
                    <IconCheck size={16} />
                  ) : isOkAlternative ? (
                    <IconBulb size={16} />
                  ) : (
                    <IconX size={16} />
                  )}
                </ThemeIcon>
                <Text fw={600} c={feedbackColor}>
                  {feedbackTitle}
                </Text>
              </Group>
              {isMistakeReview ? (
                <Text size="sm" c="dimmed" ta="center">
                  Best move: {practiceState.bestMove ?? practiceState.answer}
                </Text>
              ) : isBestAlternative && practiceState.playedMove ? (
                <Text size="sm" c="dimmed" ta="center">
                  ChessDB has {practiceState.playedMove} as best.
                </Text>
              ) : isOkAlternative && practiceState.playedMove ? (
                <Text size="sm" c="dimmed" ta="center">
                  {practiceState.playedMove} is OK; {practiceState.bestMove ?? practiceState.answer}{" "}
                  is best.
                </Text>
              ) : (
                <Text size="sm" c="dimmed">
                  Correct move: {practiceState.answer}
                </Text>
              )}
              {!isMistakeReview &&
                !isBestAlternative &&
                !isOkAlternative &&
                practiceState.playedMove && (
                  <Text size="sm" c="dimmed">
                    You played: {practiceState.playedMove}
                  </Text>
                )}
              {isMistakeReview && practiceState.playedMove && (
                <Text size="sm" c="dimmed">
                  You played: {practiceState.playedMove}
                </Text>
              )}
              {isMistakeReview && (
                <Stack gap={2} align="center">
                  {(roundedMoveLoss !== undefined ||
                    practiceState.winProbabilityDrop !== undefined) && (
                    <Text size="xs" c="dimmed">
                      {roundedMoveLoss !== undefined
                        ? `${roundedMoveLoss} cp loss`
                        : "Centipawn loss unknown"}
                      {practiceState.winProbabilityDrop !== undefined
                        ? `, ${practiceState.winProbabilityDrop.toFixed(1)}% win-prob drop`
                        : ""}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    {formatMistakeReviewDepthTransparency(practiceState)}
                  </Text>
                </Stack>
              )}
              {!isMistakeReview && isOkAlternative && roundedMoveLoss !== undefined && (
                <Text size="xs" c="dimmed">
                  {roundedMoveLoss > 0
                    ? `ChessDB has it about ${roundedMoveLoss} cp behind.`
                    : "ChessDB has it essentially level with the top move."}
                </Text>
              )}
              <Button variant="light" size="sm" onClick={skipCard}>
                Next position
              </Button>
            </Stack>
          </Paper>
        )}

        {currentPracticePosition && (
          <CurrentReviewPositionActions
            position={currentPracticePosition}
            onDelete={deleteCurrentReviewPosition}
          />
        )}

        {canOverridePlayedMove && playedOverrideCandidate && (
          <Paper p="sm" withBorder>
            <Group justify="space-between" gap="sm" align="center">
              <Stack gap={2}>
                <Text size="sm" fw={700}>
                  Make {playedOverrideCandidate.san} the correct move?
                </Text>
                <Text size="xs" c="dimmed">
                  This replaces the saved answer for this review card.
                </Text>
              </Stack>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPencil size={14} />}
                onClick={() =>
                  updateCorrectMove(playedOverrideCandidate.positionIndex, {
                    san: playedOverrideCandidate.san,
                    uci: playedOverrideCandidate.uci,
                  })
                }
              >
                Use my move
              </Button>
            </Group>
          </Paper>
        )}

        {attemptPosition && (
          <OpeningReviewAttemptDetails
            position={attemptPosition}
            deckMode={deckMode}
            playedMove={attemptPlayedMove}
          />
        )}

        <Group gap="xs">
          <SessionBadge label="Correct" value={sessionStats.correct} color="green" />
          <SessionBadge label="Incorrect" value={sessionStats.incorrect} color="red" />
          <SessionBadge label="Streak" value={sessionStats.streak} color="orange" />
        </Group>

        {isMistakeReview && <MistakeReviewGameInfoPanel position={mistakeReviewInfoPosition} />}
      </Stack>

      {!isMistakeReview && openingDailySettings && (
        <OpeningReviewDailySettingsModal
          opened={dailySettingsOpen}
          onClose={() => setDailySettingsOpen(false)}
          settings={openingDailySettings}
          dailyCount={dailyScopeIndices.length}
          onUpdate={updateOpeningDailySettings}
        />
      )}

      {isMistakeReview && mistakeDailySettings && (
        <MistakeReviewDailySettingsModal
          opened={dailySettingsOpen}
          onClose={() => setDailySettingsOpen(false)}
          settings={mistakeDailySettings}
          dailyCount={dailyScopeIndices.length}
          onUpdate={updateMistakeDailySettings}
        />
      )}

      <OpeningReviewPositionsModal
        opened={positionsOpen}
        onClose={() => setPositionsOpen(false)}
        deckPath={deckPath}
        onTrainDue={startDuePractice}
        onTrainAll={startFullPractice}
        onLoadPosition={onLoadPosition}
      />
    </>
  );
}

function ReviewStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Paper px="xs" py={6} withBorder radius="sm">
      <Text size="xs" c="dimmed" fw={600}>
        {label}
      </Text>
      <Text size="md" fw={700} c={color} lh={1.1}>
        {value}
      </Text>
    </Paper>
  );
}

function MistakeReviewDeckSyncStatus({
  config,
  deckPath,
}: {
  config?: MistakeReviewDeck["autoUpdate"];
  deckPath: string;
}) {
  const state = useAtomValue(mistakeReviewAutoUpdateStateAtom);
  const syncingThisDeck = state.running && state.deckPath === deckPath;
  const lastRun = config?.lastRunAt ?? null;
  const databaseUpdate = config?.lastUpdatedDatabaseAt ?? null;
  const addedText = formatMistakeReviewSyncAdded(config?.lastAdded);

  const badgeLabel = syncingThisDeck ? "Syncing" : config?.enabled ? "Auto sync" : "Sync off";
  const badgeColor = config?.lastError ? "red" : syncingThisDeck ? "blue" : "gray";
  const primary = config?.lastError
    ? `Last sync failed: ${config.lastError}`
    : syncingThisDeck
      ? `Checking ${state.databaseTitle ?? "the database"} for new mistakes`
      : lastRun
        ? `Last synced ${formatMistakeReviewSyncTimestamp(lastRun)} - ${addedText}`
        : config
          ? "Database sync has not run yet"
          : "No database sync is configured for this deck";
  const secondary = databaseUpdate
    ? `Database updated ${formatMistakeReviewSyncTimestamp(databaseUpdate)}`
    : config
      ? "Database update time unknown"
      : null;

  return (
    <Paper px="xs" py={6} withBorder radius="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Group gap={6} wrap="nowrap" miw={0}>
          <Badge size="xs" color={badgeColor} variant="light">
            {badgeLabel}
          </Badge>
          <Text size="xs" c={config?.lastError ? "red" : "dimmed"} truncate>
            {primary}
          </Text>
        </Group>
        {secondary && (
          <Text size="xs" c="dimmed" truncate style={{ flexShrink: 0, maxWidth: "42%" }}>
            {secondary}
          </Text>
        )}
      </Group>
    </Paper>
  );
}

type OpeningReviewStatsGroup = {
  key: string;
  name: string;
  previewPosition: Position;
  side: "white" | "black";
  indices: number[];
  positions: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number | null;
  winRate: number | null;
  referenceWins: number;
  referenceDraws: number;
  referenceLosses: number;
  referenceScore: number | null;
  referenceWinRate: number | null;
  normalScore: number | null;
  normalWinRate: number | null;
  winRateGap: number | null;
  scoreGap: number | null;
  reviewScore: number | null;
  trained: number;
  due: number;
  unseen: number;
  attempts: number;
  lapses: number;
  urgency: number;
  timeControls: string[];
};
type OpeningReviewStatsAccumulator = {
  key: string;
  name: string;
  previewPosition: Position;
  previewUrgency: number;
  whiteSideWeight: number;
  blackSideWeight: number;
  indices: number[];
  positions: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scoreTotal: number;
  scoreWeight: number;
  referenceWins: number;
  referenceDraws: number;
  referenceLosses: number;
  referenceScoreTotal: number;
  referenceScoreWeight: number;
  trained: number;
  due: number;
  unseen: number;
  attempts: number;
  lapses: number;
  urgencyTotal: number;
  timeControls: Set<string>;
};

function OpeningReviewStatsPage({
  positions,
  deckMode,
  onOpeningNamesResolved,
  onReviewOpening,
}: {
  positions: Position[];
  deckMode?: "self" | "opponent";
  onOpeningNamesResolved: (namesByKey: OpeningReviewResolvedOpeningNames) => void;
  onReviewOpening: (indices: number[], label: string) => void;
}) {
  const [colourFilter, setColourFilter] = useState<OpeningReviewColourFilter>("any");
  const [resultFilters, setResultFilters] = useState<OpeningReviewStatsResultFilter[]>([]);
  const [timeControlFilter, setTimeControlFilter] = useState("all");
  const [dateRange, setDateRange] = useState<OpeningHealthDateRange>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [groupBy, setGroupBy] = useState<OpeningReviewStatsGroupBy>("family");
  const [sortBy, setSortBy] = useState<OpeningReviewStatsSort>("planGap");
  const [minGames, setMinGames] = useState(3);
  const [openingNamesByKey, setOpeningNamesByKey] = useState<Record<string, string>>({});
  const dateBounds = useMemo(
    () => getOpeningHealthDateBounds(dateRange, customStartDate, customEndDate),
    [customEndDate, customStartDate, dateRange],
  );

  useEffect(() => {
    let disposed = false;
    const missing = positions
      .map((position) => ({
        key: getOpeningReviewOpeningCacheKey(position),
        position,
      }))
      .filter(({ key, position }) => {
        const storedName = getOpeningReviewStoredOpeningName(position);
        if (storedName) {
          openingReviewOpeningNameCache.set(key, storedName);
          return false;
        }
        return !openingReviewOpeningNameCache.has(key);
      });

    if (missing.length === 0) return;

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

        for (const { key, name } of resolved) {
          openingReviewOpeningNameCache.set(key, name);
        }
        onOpeningNamesResolved(Object.fromEntries(resolved.map(({ key, name }) => [key, name])));
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
  }, [onOpeningNamesResolved, positions]);

  const rowsWithOpenings = useMemo<OpeningReviewPositionRow[]>(
    () =>
      rankOpeningReviewPositions(positions).map((row) => {
        const key = getOpeningReviewOpeningCacheKey(row.position);
        return {
          ...row,
          opening: getOpeningReviewOpeningInfo(
            row.position,
            openingNamesByKey[key] ?? openingReviewOpeningNameCache.get(key),
          ),
        };
      }),
    [openingNamesByKey, positions],
  );

  const timeControlOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rowsWithOpenings) {
      const timeControl = getOpeningReviewStatsTimeControl(row.position);
      counts.set(timeControl, (counts.get(timeControl) ?? 0) + 1);
    }

    return [
      { value: "all", label: "All time controls" },
      ...Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({
          value,
          label: `${value} (${count})`,
        })),
    ];
  }, [rowsWithOpenings]);

  useEffect(() => {
    if (timeControlFilter === "all") return;
    if (timeControlOptions.some((option) => option.value === timeControlFilter)) return;
    setTimeControlFilter("all");
  }, [timeControlFilter, timeControlOptions]);

  const filteredRows = useMemo(
    () =>
      rowsWithOpenings.filter((row) => {
        const colourMatches =
          colourFilter === "any" ||
          getOpeningReviewStatsSide(row.position, deckMode, row.opening) === colourFilter;
        const timeMatches =
          timeControlFilter === "all" ||
          getOpeningReviewStatsTimeControl(row.position) === timeControlFilter;
        const resultMatches =
          resultFilters.length === 0 ||
          resultFilters.some((filter) =>
            openingReviewStatsPositionMatchesResult(row.position, filter, deckMode, row.opening),
          );
        const dateMatches = openingHealthDateMatches(
          row.position.openingHealth?.lastPlayed,
          dateBounds,
        );
        return colourMatches && timeMatches && resultMatches && dateMatches;
      }),
    [colourFilter, dateBounds, deckMode, resultFilters, rowsWithOpenings, timeControlFilter],
  );

  const groupedStats = useMemo(
    () => buildOpeningReviewStatsGroups(filteredRows, groupBy, deckMode),
    [deckMode, filteredRows, groupBy],
  );
  const summary = useMemo(() => summarizeOpeningReviewStatsGroups(groupedStats), [groupedStats]);
  const statsRows = useMemo(
    () => applyOpeningReviewStatsPlanSignals(groupedStats, summary),
    [groupedStats, summary],
  );
  const sampleRows = useMemo(
    () => statsRows.filter((row) => row.games >= minGames || row.attempts > 0),
    [minGames, statsRows],
  );
  const rankedRows = useMemo(
    () => sortOpeningReviewStatsRows(sampleRows, sortBy),
    [sampleRows, sortBy],
  );
  const bestRows = useMemo(
    () =>
      [...sampleRows]
        .filter((row) => row.games > 0 && row.score !== null)
        .sort((a, b) => compareNullableNumber(b.score, a.score) || b.games - a.games)
        .slice(0, 5),
    [sampleRows],
  );
  const worstRows = useMemo(
    () =>
      [...sampleRows]
        .filter((row) => row.games > 0 && row.score !== null)
        .sort((a, b) => compareNullableNumber(a.score, b.score) || b.games - a.games)
        .slice(0, 5),
    [sampleRows],
  );
  const planGapRows = useMemo(
    () =>
      [...sampleRows]
        .filter(
          (row) =>
            row.games > 0 &&
            row.normalWinRate !== null &&
            row.winRate !== null &&
            (row.reviewScore ?? 0) >= 0.7 &&
            ((row.winRateGap ?? row.scoreGap ?? 0) >= 0.06 ||
              (row.scoreGap !== null && row.scoreGap >= 0.08)),
        )
        .sort(
          (a, b) =>
            compareNullableNumber(b.winRateGap ?? b.scoreGap, a.winRateGap ?? a.scoreGap) ||
            compareNullableNumber(b.reviewScore, a.reviewScore) ||
            b.games - a.games,
        )
        .slice(0, 5),
    [sampleRows],
  );

  if (positions.length === 0) {
    return <Alert color="blue">Save opening review positions before viewing stats.</Alert>;
  }

  return (
    <Stack gap="sm" style={scrollablePanelStyle}>
      <Paper p="xs" withBorder>
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Stack gap={0}>
              <Text fw={700}>Opening stats</Text>
            </Stack>
            <Badge variant="light">{filteredRows.length} positions</Badge>
          </Group>
          <Stack gap="xs">
            <SegmentedControl
              value={colourFilter}
              onChange={(value) => setColourFilter(value as OpeningReviewColourFilter)}
              data={[
                { value: "any", label: "All" },
                { value: "white", label: "White" },
                { value: "black", label: "Black" },
              ]}
            />
            <Group gap="xs" grow align="flex-end">
              <MultiSelect
                label="Results"
                value={resultFilters}
                onChange={(values) => setResultFilters(values as OpeningReviewStatsResultFilter[])}
                data={[
                  { value: "wins", label: "Wins" },
                  { value: "draws", label: "Draws" },
                  { value: "losses", label: "Losses" },
                ]}
                placeholder="All results"
                clearable
              />
              <Select
                label="Time control"
                value={timeControlFilter}
                onChange={(value) => setTimeControlFilter(value ?? "all")}
                data={timeControlOptions}
                searchable
                allowDeselect={false}
              />
            </Group>
            <Group gap="xs" grow align="flex-end">
              <Select
                label="Last played"
                value={dateRange}
                onChange={(value) => setDateRange((value as OpeningHealthDateRange) ?? "all")}
                data={OPENING_HEALTH_DATE_RANGE_OPTIONS}
                allowDeselect={false}
              />
              {dateRange === "custom" && (
                <>
                  <TextInput
                    label="From"
                    type="date"
                    value={openingHealthDbDateToInput(customStartDate)}
                    onChange={(event) => setCustomStartDate(event.currentTarget.value)}
                  />
                  <TextInput
                    label="To"
                    type="date"
                    value={openingHealthDbDateToInput(customEndDate)}
                    onChange={(event) => setCustomEndDate(event.currentTarget.value)}
                  />
                </>
              )}
            </Group>
            <Group gap="xs" grow align="flex-end">
              <Select
                label="Group"
                value={groupBy}
                onChange={(value) => setGroupBy((value as OpeningReviewStatsGroupBy) ?? "family")}
                data={[
                  { value: "family", label: "Opening family" },
                  { value: "line", label: "Exact line" },
                ]}
                allowDeselect={false}
              />
              <Select
                label="Sort"
                value={sortBy}
                onChange={(value) => setSortBy((value as OpeningReviewStatsSort) ?? "planGap")}
                data={[
                  { value: "planGap", label: "Plan gaps" },
                  { value: "scoreAsc", label: "Worst score" },
                  { value: "scoreDesc", label: "Best score" },
                  { value: "reviewDesc", label: "Best review" },
                  { value: "gamesDesc", label: "Most games" },
                ]}
                allowDeselect={false}
              />
              <NumberInput
                label="Min games"
                value={minGames}
                min={0}
                max={999}
                onChange={(value) => setMinGames(Math.max(0, Math.round(Number(value) || 0)))}
              />
            </Group>
          </Stack>
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        <OpeningReviewStatsMetric
          label="Opening groups"
          value={formatReviewNumber(statsRows.length)}
          detail={`${formatReviewNumber(summary.positions)} review cards after filters`}
        />
        <OpeningReviewStatsMetric
          label="Game score"
          value={formatNullableReviewPercent(summary.score)}
          detail={`${formatReviewRecord(summary)}; win=1, draw=0.5, loss=0`}
        />
        <OpeningReviewStatsMetric
          label="Win rate"
          value={formatNullableReviewPercent(summary.winRate)}
          detail={`${formatReviewNumber(summary.wins)} wins from ${formatReviewNumber(
            summary.games,
          )} games`}
        />
        <OpeningReviewStatsMetric
          label="Review recall"
          value={formatNullableReviewPercent(summary.reviewScore)}
          detail={formatOpeningReviewStatsReviewDetail(summary.attempts, summary.lapses)}
        />
      </SimpleGrid>

      <OpeningReviewStatsList
        title="Plan gaps"
        rows={planGapRows}
        empty="No obvious plan gaps with these filters."
        mode="gap"
      />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <OpeningReviewStatsList
          title="Best openings"
          rows={bestRows}
          empty="No result data yet."
          mode="score"
        />
        <OpeningReviewStatsList
          title="Worst openings"
          rows={worstRows}
          empty="No result data yet."
          mode="score"
        />
      </SimpleGrid>

      <Paper p="xs" withBorder>
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text fw={700}>Opening performance</Text>
            <Badge variant="light">{rankedRows.length} shown</Badge>
          </Group>
          <Box style={{ overflowX: "auto" }}>
            <Table miw={1320}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Position</Table.Th>
                  <Table.Th>Opening</Table.Th>
                  <Table.Th>
                    <OpeningReviewStatsColumnHeader
                      label="Your games"
                      detail="Win/draw/loss after reaching this opening"
                    />
                  </Table.Th>
                  <Table.Th>
                    <OpeningReviewStatsColumnHeader
                      label="Reference games"
                      detail="Normal result from the reference database"
                    />
                  </Table.Th>
                  <Table.Th>
                    <OpeningReviewStatsColumnHeader
                      label="Review recall"
                      detail="Remembered / attempts"
                    />
                  </Table.Th>
                  <Table.Th>What it means</Table.Th>
                  <Table.Th>Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rankedRows.slice(0, 40).map((row) => (
                  <Table.Tr key={row.key}>
                    <Table.Td>
                      <OpeningReviewStatsBoard position={row.previewPosition} side={row.side} />
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm" fw={700} lineClamp={2}>
                          {row.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {formatReviewRecord(row)} from {formatReviewNumber(row.games)} games
                        </Text>
                        <Text size="xs" c="dimmed">
                          {row.positions} review card
                          {row.positions === 1 ? "" : "s"}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <OpeningReviewWdlBar
                        label="Your record"
                        wins={row.wins}
                        draws={row.draws}
                        losses={row.losses}
                        score={row.score}
                        winRate={row.winRate}
                        side={row.side}
                        empty="No saved games for this opening."
                      />
                    </Table.Td>
                    <Table.Td>
                      <OpeningReviewWdlBar
                        label="Reference record"
                        wins={row.referenceWins}
                        draws={row.referenceDraws}
                        losses={row.referenceLosses}
                        score={row.referenceScore}
                        winRate={row.referenceWinRate}
                        side={row.side}
                        empty="No reference W/D/L data saved for this opening."
                      />
                    </Table.Td>
                    <Table.Td>
                      <OpeningReviewScoreMeter
                        value={row.reviewScore}
                        detail={formatOpeningReviewStatsReviewDetail(row.attempts, row.lapses)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <OpeningReviewStatsSignal row={row} />
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs"
                        variant="light"
                        onClick={() => onReviewOpening(row.indices, row.name)}
                      >
                        Review
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {rankedRows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={7}>
                      <Text c="dimmed" ta="center" py="sm">
                        No openings match those filters.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  );
}

function OpeningReviewStatsMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Paper p="xs" withBorder radius="sm">
      <Text size="xs" c="dimmed" fw={600}>
        {label}
      </Text>
      <Text fw={800}>{value}</Text>
      <Text size="xs" c="dimmed">
        {detail}
      </Text>
    </Paper>
  );
}

function OpeningReviewStatsColumnHeader({ label, detail }: { label: string; detail: string }) {
  return (
    <Stack gap={0}>
      <Text size="sm" fw={700}>
        {label}
      </Text>
      <Text size="xs" c="dimmed" fw={400}>
        {detail}
      </Text>
    </Stack>
  );
}

function OpeningReviewStatsBoard({
  position,
  side,
}: {
  position: Position;
  side: "white" | "black";
}) {
  return (
    <Tooltip label="Representative review position" withArrow>
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
          orientation={side}
          turnColor={side}
        />
      </Box>
    </Tooltip>
  );
}

function OpeningReviewStatsList({
  title,
  rows,
  empty,
  mode,
}: {
  title: string;
  rows: OpeningReviewStatsGroup[];
  empty: string;
  mode: "score" | "gap";
}) {
  return (
    <Paper p="xs" withBorder>
      <Stack gap="xs">
        <Text fw={700}>{title}</Text>
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            {empty}
          </Text>
        ) : (
          <Stack gap="xs">
            {rows.map((row) => {
              const metric =
                mode === "gap"
                  ? formatSignedReviewPercent(row.winRateGap ?? row.scoreGap)
                  : formatNullableReviewPercent(row.score);
              const detail =
                mode === "gap"
                  ? `Your win rate ${formatNullableReviewPercent(
                      row.winRate,
                    )}; reference win rate ${formatNullableReviewPercent(row.normalWinRate)}`
                  : `Game score ${formatNullableReviewPercent(row.score)} from ${formatReviewRecord(
                      row,
                    )}`;

              return (
                <Group key={row.key} justify="space-between" gap="xs" wrap="nowrap" align="center">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <OpeningReviewStatsBoard position={row.previewPosition} side={row.side} />
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} lineClamp={2}>
                        {row.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {detail}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {mode === "gap"
                          ? `${formatSignedReviewPercent(
                              row.winRateGap ?? row.scoreGap,
                            )} win-rate gap; ${formatOpeningReviewStatsReviewDetail(
                              row.attempts,
                              row.lapses,
                            )}`
                          : `${formatNullableReviewPercent(row.winRate)} win rate; ${formatReviewNumber(
                              row.games,
                            )} games`}
                      </Text>
                      {mode === "gap" && (
                        <Stack gap={6} mt={4} w="100%">
                          <OpeningReviewWdlBar
                            label="Your games"
                            wins={row.wins}
                            draws={row.draws}
                            losses={row.losses}
                            score={row.score}
                            winRate={row.winRate}
                            side={row.side}
                            empty="No saved games."
                          />
                          <OpeningReviewWdlBar
                            label="Reference games"
                            wins={row.referenceWins}
                            draws={row.referenceDraws}
                            losses={row.referenceLosses}
                            score={row.referenceScore}
                            winRate={row.referenceWinRate}
                            side={row.side}
                            empty="No reference games."
                          />
                        </Stack>
                      )}
                      {mode === "score" && (
                        <Stack gap={6} mt={4} w="100%">
                          <OpeningReviewWdlBar
                            label="Your games"
                            wins={row.wins}
                            draws={row.draws}
                            losses={row.losses}
                            score={row.score}
                            winRate={row.winRate}
                            side={row.side}
                            empty="No saved games."
                            compact
                          />
                        </Stack>
                      )}
                    </Stack>
                  </Group>
                  <Stack gap={2} align="flex-end">
                    <Badge
                      color={mode === "gap" ? "orange" : openingReviewStatsScoreColor(row.score)}
                    >
                      {metric}
                    </Badge>
                    <Text size="xs" c="dimmed" ta="right">
                      {mode === "gap" ? "gap" : "score"}
                    </Text>
                  </Stack>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function OpeningReviewScoreMeter({ value, detail }: { value: number | null; detail: string }) {
  if (value === null) {
    return (
      <Stack gap={2}>
        <Text size="sm" c="dimmed">
          No data
        </Text>
        <Text size="xs" c="dimmed">
          {detail}
        </Text>
      </Stack>
    );
  }

  const percent = clamp(Math.round(value * 100), 0, 100);
  return (
    <Stack gap={2}>
      <Group gap="xs" wrap="nowrap">
        <Progress.Root w={70} size="sm">
          <Progress.Section value={percent} color={openingReviewStatsScoreColor(value)} />
        </Progress.Root>
        <Text size="sm" fw={600}>
          {percent}%
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {detail}
      </Text>
    </Stack>
  );
}

function OpeningReviewStatsSignal({ row }: { row: OpeningReviewStatsGroup }) {
  const gap = row.winRateGap ?? row.scoreGap;
  if (row.games === 0 || row.score === null) {
    return (
      <Stack gap={2}>
        <Badge variant="light">No game data</Badge>
        <Text size="xs" c="dimmed">
          This opening has review cards but no saved results.
        </Text>
      </Stack>
    );
  }

  if ((row.reviewScore ?? 0) >= 0.7 && gap !== null && gap >= 0.06) {
    return (
      <Stack gap={2}>
        <Badge color="orange" variant="light">
          Plan gap
        </Badge>
        <Text size="xs" c="dimmed">
          Your win rate is {formatOpeningReviewStatsGapBelow(gap)} reference/normal while review
          recall is {formatNullableReviewPercent(row.reviewScore)}.
        </Text>
      </Stack>
    );
  }

  if (row.score >= 0.55) {
    return (
      <Stack gap={2}>
        <Badge color="green" variant="light">
          Performing well
        </Badge>
        <Text size="xs" c="dimmed">
          Game score is above 55%.
        </Text>
      </Stack>
    );
  }

  if (row.score <= 0.45) {
    return (
      <Stack gap={2}>
        <Badge color="red" variant="light">
          Needs work
        </Badge>
        <Text size="xs" c="dimmed">
          Game score is 45% or lower from {formatReviewNumber(row.games)} games.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={2}>
      <Badge variant="light">Neutral</Badge>
      <Text size="xs" c="dimmed">
        Game score is near the middle.
      </Text>
    </Stack>
  );
}

function OpeningReviewWdlBar({
  label,
  wins,
  draws,
  losses,
  score,
  winRate,
  side,
  empty,
  compact = false,
}: {
  label: string;
  wins: number;
  draws: number;
  losses: number;
  score: number | null;
  winRate: number | null;
  side: "white" | "black";
  empty: string;
  compact?: boolean;
}) {
  const total = wins + draws + losses;
  if (total === 0) {
    return (
      <Stack gap={2}>
        <Text size="xs" fw={700}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {empty}
        </Text>
      </Stack>
    );
  }

  const winPercent = (wins / total) * 100;
  const drawPercent = (draws / total) * 100;
  const lossPercent = (losses / total) * 100;
  const whiteResultPercent = side === "black" ? lossPercent : winPercent;
  const blackResultPercent = side === "black" ? winPercent : lossPercent;
  const scoreText = score === null ? "Score unknown" : `Score ${formatReviewPercent(score)}`;
  const winRateText =
    winRate === null ? "Win rate unknown" : `Win rate ${formatReviewPercent(winRate)}`;
  const recordText = `${formatReviewNumber(wins)} win${wins === 1 ? "" : "s"}, ${formatReviewNumber(
    draws,
  )} draw${draws === 1 ? "" : "s"}, ${formatReviewNumber(losses)} loss${losses === 1 ? "" : "es"}`;

  return (
    <Stack gap={4} miw={compact ? 0 : 260} w="100%">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="xs" fw={700}>
          {winRateText}
        </Text>
      </Group>
      <Tooltip withArrow label={`${recordText}. ${winRateText}. ${scoreText}.`}>
        <Progress.Root size={compact ? "lg" : "xl"} className={resultClasses.result}>
          <Progress.Section
            value={whiteResultPercent}
            className={resultClasses.whiteResultsSection}
          >
            <Progress.Label c="black">
              {whiteResultPercent > 10 ? `${whiteResultPercent.toFixed(1)}%` : ""}
            </Progress.Label>
          </Progress.Section>
          <Progress.Section value={drawPercent} color="gray">
            <Progress.Label>{drawPercent > 10 ? `${drawPercent.toFixed(1)}%` : ""}</Progress.Label>
          </Progress.Section>
          <Progress.Section value={blackResultPercent} color="black">
            <Progress.Label>
              {blackResultPercent > 10 ? `${blackResultPercent.toFixed(1)}%` : ""}
            </Progress.Label>
          </Progress.Section>
        </Progress.Root>
      </Tooltip>
      <Text size="xs" c="dimmed">
        {recordText}. {scoreText}.
      </Text>
    </Stack>
  );
}

function buildOpeningReviewStatsGroups(
  rows: OpeningReviewPositionRow[],
  groupBy: OpeningReviewStatsGroupBy,
  deckMode?: "self" | "opponent",
): OpeningReviewStatsGroup[] {
  const groups = new Map<string, OpeningReviewStatsAccumulator>();
  const now = new Date();

  for (const row of rows) {
    const key = groupBy === "line" ? row.opening.line : row.opening.family;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: key,
        previewPosition: row.position,
        previewUrgency: row.urgency,
        whiteSideWeight: 0,
        blackSideWeight: 0,
        indices: [],
        positions: 0,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        scoreTotal: 0,
        scoreWeight: 0,
        referenceWins: 0,
        referenceDraws: 0,
        referenceLosses: 0,
        referenceScoreTotal: 0,
        referenceScoreWeight: 0,
        trained: 0,
        due: 0,
        unseen: 0,
        attempts: 0,
        lapses: 0,
        urgencyTotal: 0,
        timeControls: new Set<string>(),
      };
      groups.set(key, group);
    } else if (row.urgency > group.previewUrgency) {
      group.previewPosition = row.position;
      group.previewUrgency = row.urgency;
    }

    const result = getOpeningReviewStatsResult(row.position, deckMode, row.opening);
    const review = getOpeningReviewStatsReview(row.position, now);
    const timeControl = getOpeningReviewStatsTimeControl(row.position);
    const sideWeight = result.games > 0 ? result.games : 1;

    group.indices.push(row.index);
    group.positions += 1;
    group.games += result.games;
    group.wins += result.wins;
    group.draws += result.draws;
    group.losses += result.losses;
    if (result.side === "white") {
      group.whiteSideWeight += sideWeight;
    } else {
      group.blackSideWeight += sideWeight;
    }
    group.scoreTotal += result.scoreTotal;
    group.scoreWeight += result.scoreWeight;
    group.referenceWins += result.referenceWins;
    group.referenceDraws += result.referenceDraws;
    group.referenceLosses += result.referenceLosses;
    group.referenceScoreTotal += result.referenceScoreTotal;
    group.referenceScoreWeight += result.referenceScoreWeight;
    group.trained += review.trained ? 1 : 0;
    group.due += review.due ? 1 : 0;
    group.unseen += review.unseen ? 1 : 0;
    group.attempts += review.attempts;
    group.lapses += review.lapses;
    group.urgencyTotal += row.urgency;
    group.timeControls.add(timeControl);
  }

  return Array.from(groups.values()).map(finalizeOpeningReviewStatsGroup);
}

function finalizeOpeningReviewStatsGroup(group: OpeningReviewStatsAccumulator) {
  const countedGames = group.wins + group.draws + group.losses;
  const referenceCountedGames = group.referenceWins + group.referenceDraws + group.referenceLosses;
  const score =
    countedGames > 0
      ? (group.wins + group.draws * 0.5) / countedGames
      : group.scoreWeight > 0
        ? group.scoreTotal / group.scoreWeight
        : null;
  const winRate = countedGames > 0 ? group.wins / countedGames : null;
  const referenceScore =
    referenceCountedGames > 0
      ? (group.referenceWins + group.referenceDraws * 0.5) / referenceCountedGames
      : group.referenceScoreWeight > 0
        ? group.referenceScoreTotal / group.referenceScoreWeight
        : null;
  const referenceWinRate =
    referenceCountedGames > 0 ? group.referenceWins / referenceCountedGames : null;
  const reviewScore =
    group.attempts > 0 ? Math.max(0, group.attempts - group.lapses) / group.attempts : null;
  const side = group.blackSideWeight > group.whiteSideWeight ? "black" : "white";

  return {
    key: group.key,
    name: group.name,
    previewPosition: group.previewPosition,
    side,
    indices: group.indices,
    positions: group.positions,
    games: group.games,
    wins: group.wins,
    draws: group.draws,
    losses: group.losses,
    score,
    winRate,
    referenceWins: group.referenceWins,
    referenceDraws: group.referenceDraws,
    referenceLosses: group.referenceLosses,
    referenceScore,
    referenceWinRate,
    normalScore: null,
    normalWinRate: null,
    winRateGap: null,
    scoreGap: null,
    reviewScore,
    trained: group.trained,
    due: group.due,
    unseen: group.unseen,
    attempts: group.attempts,
    lapses: group.lapses,
    urgency: group.positions > 0 ? group.urgencyTotal / group.positions : 0,
    timeControls: Array.from(group.timeControls).sort(),
  } satisfies OpeningReviewStatsGroup;
}

function summarizeOpeningReviewStatsGroups(groups: OpeningReviewStatsGroup[]) {
  const summary = groups.reduce(
    (acc, row) => {
      acc.positions += row.positions;
      acc.games += row.games;
      acc.wins += row.wins;
      acc.draws += row.draws;
      acc.losses += row.losses;
      acc.attempts += row.attempts;
      acc.lapses += row.lapses;
      return acc;
    },
    { positions: 0, games: 0, wins: 0, draws: 0, losses: 0, attempts: 0, lapses: 0 },
  );
  const countedGames = summary.wins + summary.draws + summary.losses;
  const score = countedGames > 0 ? (summary.wins + summary.draws * 0.5) / countedGames : null;
  const winRate = countedGames > 0 ? summary.wins / countedGames : null;
  const reviewScore =
    summary.attempts > 0 ? Math.max(0, summary.attempts - summary.lapses) / summary.attempts : null;

  return {
    ...summary,
    score,
    winRate,
    reviewScore,
  };
}

function applyOpeningReviewStatsPlanSignals(
  groups: OpeningReviewStatsGroup[],
  summary: ReturnType<typeof summarizeOpeningReviewStatsGroups>,
) {
  return groups.map((group) => {
    const normalWinRate = group.referenceWinRate ?? summary.winRate;
    const normalScore = group.referenceScore ?? summary.score;
    const winRateGap =
      group.winRate !== null && normalWinRate !== null ? normalWinRate - group.winRate : null;
    const scoreGap =
      group.score !== null && normalScore !== null ? normalScore - group.score : null;

    return {
      ...group,
      normalScore,
      normalWinRate,
      winRateGap,
      scoreGap,
    };
  });
}

function sortOpeningReviewStatsRows(
  rows: OpeningReviewStatsGroup[],
  sortBy: OpeningReviewStatsSort,
) {
  return [...rows].sort((a, b) => {
    switch (sortBy) {
      case "scoreAsc":
        return compareNullableNumber(a.score, b.score) || b.games - a.games;
      case "scoreDesc":
        return compareNullableNumber(b.score, a.score) || b.games - a.games;
      case "reviewDesc":
        return compareNullableNumber(b.reviewScore, a.reviewScore) || b.games - a.games;
      case "gamesDesc":
        return b.games - a.games || compareNullableNumber(b.score, a.score);
      case "planGap":
        return (
          compareNullableNumber(b.winRateGap ?? b.scoreGap, a.winRateGap ?? a.scoreGap) ||
          compareNullableNumber(b.reviewScore, a.reviewScore) ||
          b.games - a.games
        );
    }
  });
}

function getOpeningReviewStatsResult(
  position: Position,
  deckMode?: "self" | "opponent",
  opening?: OpeningReviewOpeningInfo,
) {
  const health = position.openingHealth;
  const white = health?.white ?? 0;
  const draw = health?.draw ?? 0;
  const black = health?.black ?? 0;
  const countedGames = white + draw + black;
  const games = countedGames > 0 ? countedGames : (health?.games ?? 0);
  const colour = getOpeningReviewStatsSide(position, deckMode, opening);
  const wins = colour === "white" ? white : black;
  const losses = colour === "white" ? black : white;
  const score = typeof health?.score === "number" ? health.score : null;

  const strongWhite = health?.strongWhite ?? null;
  const strongDraw = health?.strongDraw ?? null;
  const strongBlack = health?.strongBlack ?? null;
  const referenceCountedGames =
    strongWhite !== null && strongDraw !== null && strongBlack !== null
      ? strongWhite + strongDraw + strongBlack
      : 0;
  const referenceWins =
    referenceCountedGames > 0 ? (colour === "white" ? (strongWhite ?? 0) : (strongBlack ?? 0)) : 0;
  const referenceLosses =
    referenceCountedGames > 0 ? (colour === "white" ? (strongBlack ?? 0) : (strongWhite ?? 0)) : 0;
  const referenceDraws = referenceCountedGames > 0 ? (strongDraw ?? 0) : 0;
  const referenceScore = typeof health?.strongScore === "number" ? health.strongScore : null;
  const referenceWeight =
    referenceCountedGames > 0 ? referenceCountedGames : (health?.strongGames ?? 0);

  return {
    side: colour,
    games,
    wins: countedGames > 0 ? wins : 0,
    draws: countedGames > 0 ? draw : 0,
    losses: countedGames > 0 ? losses : 0,
    scoreTotal: score !== null && games > 0 ? score * games : 0,
    scoreWeight: score !== null && games > 0 ? games : 0,
    referenceWins,
    referenceDraws,
    referenceLosses,
    referenceScoreTotal:
      referenceScore !== null && referenceWeight > 0 ? referenceScore * referenceWeight : 0,
    referenceScoreWeight: referenceScore !== null && referenceWeight > 0 ? referenceWeight : 0,
  };
}

function getOpeningReviewStatsReview(position: Position, now: Date) {
  const reps = position.card.reps ?? 0;
  const lapses = position.card.lapses ?? 0;
  const due = new Date(position.card.due) <= now;

  return {
    trained: reps > 0,
    unseen: reps === 0,
    due,
    attempts: reps,
    lapses,
  };
}

function openingReviewStatsPositionMatchesResult(
  position: Position,
  result: OpeningReviewStatsResultFilter,
  deckMode?: "self" | "opponent",
  opening?: OpeningReviewOpeningInfo,
) {
  const stats = getOpeningReviewStatsResult(position, deckMode, opening);
  switch (result) {
    case "wins":
      return stats.wins > 0;
    case "draws":
      return stats.draws > 0;
    case "losses":
      return stats.losses > 0;
  }
}

function getOpeningReviewStatsTimeControl(position: Position) {
  const raw =
    position.openingHealth?.timeControl ?? position.openingHealth?.timeControls?.[0] ?? "";
  return normalizeOpeningReviewStatsTimeControl(raw);
}

function normalizeOpeningReviewStatsTimeControl(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return "Unknown";

  const lower = raw.toLowerCase();
  if (lower.includes("ultra")) return "Ultra bullet";
  if (lower.includes("bullet")) return "Bullet";
  if (lower.includes("blitz")) return "Blitz";
  if (lower.includes("rapid")) return "Rapid";
  if (lower.includes("classical")) return "Classical";
  if (lower.includes("correspondence") || lower.includes("daily")) return "Correspondence";

  if (/^\d+(\+\d+)?$/.test(raw)) {
    const [initialRaw, incrementRaw = "0"] = raw.split("+");
    const initial = Number(initialRaw);
    const increment = Number(incrementRaw);
    const total = initial + increment * 40;
    if (total < 30) return "Ultra bullet";
    if (total < 180) return "Bullet";
    if (total < 480) return "Blitz";
    if (total < 1500) return "Rapid";
    return "Classical";
  }

  return raw;
}

function formatNullableReviewPercent(value: number | null) {
  return value === null ? "Unknown" : formatReviewPercent(value);
}

function formatSignedReviewPercent(value: number | null) {
  if (value === null) return "Unknown";
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded} percentage points`;
}

function formatOpeningReviewStatsGapBelow(value: number) {
  return `${Math.abs(Math.round(value * 100))} percentage points below`;
}

function formatReviewRecord(value: { wins: number; draws: number; losses: number }) {
  return `${formatReviewNumber(value.wins)}W-${formatReviewNumber(value.draws)}D-${formatReviewNumber(
    value.losses,
  )}L`;
}

function formatOpeningReviewStatsReviewDetail(attempts: number, lapses: number) {
  if (attempts === 0) return "No review attempts yet.";
  const remembered = Math.max(0, attempts - lapses);
  return `${formatReviewNumber(remembered)} remembered / ${formatReviewNumber(
    attempts,
  )} review attempts.`;
}

function openingReviewStatsScoreColor(value: number | null) {
  if (value === null) return "gray";
  if (value >= 0.55) return "green";
  if (value >= 0.48) return "blue";
  if (value >= 0.42) return "yellow";
  return "red";
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  return a === b ? 0 : a - b;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function SessionBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Badge color={color} variant="light">
      {label} {value}
    </Badge>
  );
}

function OpeningReviewDailySettingsModal({
  opened,
  onClose,
  settings,
  dailyCount,
  onUpdate,
}: {
  opened: boolean;
  onClose: () => void;
  settings: OpeningReviewDailySettings;
  dailyCount: number;
  onUpdate: (partial: Partial<OpeningReviewDailySettings>) => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title="Daily review settings" centered>
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">
            Tune the batch without taking over the review panel.
          </Text>
          <Badge variant="light">{dailyCount} in today's batch</Badge>
        </Group>
        <SimpleGrid cols={2} spacing="sm">
          <NumberInput
            label="Reviews per day"
            value={settings.reviewsPerDay}
            min={0}
            onChange={(value) =>
              onUpdate({
                reviewsPerDay: Math.max(0, Math.round(Number(value) || 0)),
              })
            }
          />
          <NumberInput
            label="New per day"
            value={settings.newItemsPerDay}
            min={0}
            onChange={(value) =>
              onUpdate({
                newItemsPerDay: Math.max(0, Math.round(Number(value) || 0)),
              })
            }
          />
          <Select
            label="Last played"
            data={DAILY_REVIEW_GAME_PERIOD_OPTIONS}
            value={settings.gamePeriod}
            onChange={(value) =>
              value &&
              onUpdate({
                gamePeriod: value as OpeningReviewDailySettings["gamePeriod"],
              })
            }
            allowDeselect={false}
          />
          <NumberInput
            label="Min urgency"
            suffix="/100"
            value={settings.minUrgency}
            min={0}
            max={100}
            onChange={(value) =>
              onUpdate({
                minUrgency: Math.max(0, Math.min(100, Math.round(Number(value) || 0))),
              })
            }
          />
        </SimpleGrid>
        <Group grow>
          <Switch
            label="White"
            checked={settings.includeWhite}
            onChange={(event) =>
              onUpdate({
                includeWhite: event.currentTarget.checked,
              })
            }
          />
          <Switch
            label="Black"
            checked={settings.includeBlack}
            onChange={(event) =>
              onUpdate({
                includeBlack: event.currentTarget.checked,
              })
            }
          />
        </Group>
      </Stack>
    </Modal>
  );
}

function MistakeReviewDailySettingsModal({
  opened,
  onClose,
  settings,
  dailyCount,
  onUpdate,
}: {
  opened: boolean;
  onClose: () => void;
  settings: MistakeReviewDailySettings;
  dailyCount: number;
  onUpdate: (partial: Partial<MistakeReviewDailySettings>) => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title="Daily review settings" centered>
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">
            Tune the batch without taking over the review panel.
          </Text>
          <Badge variant="light">{dailyCount} in today's batch</Badge>
        </Group>
        <SimpleGrid cols={2} spacing="sm">
          <NumberInput
            label="Reviews per day"
            value={settings.reviewsPerDay}
            min={0}
            onChange={(value) =>
              onUpdate({
                reviewsPerDay: Math.max(0, Math.round(Number(value) || 0)),
              })
            }
          />
          <NumberInput
            label="New per day"
            value={settings.newItemsPerDay}
            min={0}
            onChange={(value) =>
              onUpdate({
                newItemsPerDay: Math.max(0, Math.round(Number(value) || 0)),
              })
            }
          />
          <Select
            label="Game period"
            data={DAILY_REVIEW_GAME_PERIOD_OPTIONS}
            value={settings.gamePeriod}
            onChange={(value) =>
              value &&
              onUpdate({
                gamePeriod: value as MistakeReviewDailySettings["gamePeriod"],
              })
            }
            allowDeselect={false}
          />
          <NumberInput
            label="Min win-prob drop"
            suffix="%"
            value={settings.minWinProbabilityDrop}
            min={0}
            max={100}
            onChange={(value) =>
              onUpdate({
                minWinProbabilityDrop: Math.max(0, Number(value) || 0),
              })
            }
          />
        </SimpleGrid>
        <Group grow>
          <Switch
            label="Inaccuracies"
            checked={settings.includeInaccuracies}
            onChange={(event) =>
              onUpdate({
                includeInaccuracies: event.currentTarget.checked,
              })
            }
          />
          <Switch
            label="Mistakes"
            checked={settings.includeMistakes}
            onChange={(event) => onUpdate({ includeMistakes: event.currentTarget.checked })}
          />
          <Switch
            label="Blunders"
            checked={settings.includeBlunders}
            onChange={(event) => onUpdate({ includeBlunders: event.currentTarget.checked })}
          />
        </Group>
      </Stack>
    </Modal>
  );
}

function MistakeReviewGameInfoPanel({ position }: { position: Position | null }) {
  const [expanded, setExpanded] = useState(false);
  const mistake = position?.mistakeReview;
  if (!mistake) {
    return (
      <Paper px="xs" py={6} withBorder radius="sm">
        <Stack gap={1}>
          <Text size="xs" fw={700}>
            Game information
          </Text>
          <Text size="xs" c="dimmed">
            Load a mistake card to see the game, opponent, ratings, and time control.
          </Text>
        </Stack>
      </Paper>
    );
  }

  const playerColor = mistake.playerColor ?? position?.sideToMove ?? "white";
  const playerName =
    normalizeMistakeReviewName(mistake.playerName) ||
    normalizeMistakeReviewName(playerColor === "white" ? mistake.whiteName : mistake.blackName) ||
    "You";
  const opponentName =
    normalizeMistakeReviewName(mistake.opponent) ||
    normalizeMistakeReviewName(playerColor === "white" ? mistake.blackName : mistake.whiteName) ||
    "Opponent";
  const playerRating = getMistakeReviewRatingForColor(mistake, playerColor);
  const opponentRating = getMistakeReviewRatingForColor(
    mistake,
    playerColor === "white" ? "black" : "white",
  );

  return (
    <Paper px="xs" py={6} withBorder radius="sm">
      <Stack gap={expanded ? "xs" : 0}>
        <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
          <Stack gap={2} miw={0}>
            <Text size="xs" fw={700}>
              Game information
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {playerName} vs {opponentName}
            </Text>
          </Stack>
          <Group gap={4} wrap="nowrap">
            <Badge size="xs" variant="light">
              {mistakeReviewSeverityLabel(mistake.severity ?? "mistake")}
            </Badge>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={
                expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
              }
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
            >
              {expanded ? "Hide" : "Show"}
            </Button>
          </Group>
        </Group>
        {expanded && (
          <SimpleGrid cols={2} spacing="xs">
            <ReviewDetail label="Played" value={formatMistakeReviewGameDate(mistake.date)} />
            <ReviewDetail label="Time control" value={formatMistakeReviewTimeControl(mistake)} />
            <ReviewDetail label="Opponent" value={opponentName} />
            <ReviewDetail label="Your side" value={formatMistakeReviewColor(playerColor)} />
            <ReviewDetail label="Your rating" value={formatMistakeReviewRating(playerRating)} />
            <ReviewDetail
              label="Opponent rating"
              value={formatMistakeReviewRating(opponentRating)}
            />
            <ReviewDetail
              label="Result"
              value={formatMistakeReviewRelativeResult(mistake.gameResult, playerColor)}
            />
            <ReviewDetail
              label="Move"
              value={`${mistake.moveNumber ? `${mistake.moveNumber}. ` : ""}${mistake.playedMoveSan ?? "-"}`}
            />
            <ReviewDetail label="Think time" value={formatMistakeReviewThinkTime(mistake)} />
            <ReviewDetail label="Last seen" value={formatMistakeReviewLastSeen(position)} />
          </SimpleGrid>
        )}
      </Stack>
    </Paper>
  );
}

function CurrentReviewPositionActions({
  position,
  onDelete,
}: {
  position: Position;
  onDelete: () => void;
}) {
  return (
    <Paper p="xs" withBorder>
      <Group justify="space-between" gap="sm" wrap="nowrap" align="center">
        <Stack gap={0} miw={0}>
          <Text size="xs" c="dimmed" fw={600}>
            Current position
          </Text>
          <Text size="sm" fw={700} truncate>
            {formatOpeningReviewPositionAnswer(position)}
          </Text>
        </Stack>
        <Button
          size="xs"
          variant="light"
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={onDelete}
          style={{ flexShrink: 0 }}
        >
          Delete
        </Button>
      </Group>
    </Paper>
  );
}

function OpeningReviewDeckAutoUpdateControl({
  config,
  onEnabledChange,
}: {
  config?: OpeningReviewAutoUpdateConfig;
  onEnabledChange: (enabled: boolean) => void;
}) {
  if (!config) return null;

  const lastRun = config.lastRunAt ? dayjs(config.lastRunAt).format("MMM D, YYYY HH:mm") : "Never";
  const lastGamesUpdate = config.lastUpdatedDatabaseAt
    ? dayjs(config.lastUpdatedDatabaseAt).format("MMM D, YYYY HH:mm")
    : "Unknown";
  const lastAdded =
    config.lastAdded === null || config.lastAdded === undefined ? "" : `, ${config.lastAdded} new`;
  const maxPositions = config.maxPositions ?? config.limit ?? 0;

  return (
    <Paper p="xs" withBorder>
      <Stack gap="xs">
        <Group justify="space-between" gap="sm" wrap="nowrap" align="center">
          <Stack gap={2} miw={0}>
            <Text size="sm" fw={700}>
              Automatic deck updates
            </Text>
            <Text size="xs" c={config.lastError ? "red" : "dimmed"} lineClamp={2}>
              {config.lastError ? config.lastError : `Last gap update: ${lastRun}${lastAdded}.`}
            </Text>
          </Stack>
          <Switch
            checked={config.enabled}
            onChange={(event) => onEnabledChange(event.currentTarget.checked)}
            aria-label="Toggle automatic Opening Review deck updates"
          />
        </Group>
        <SimpleGrid cols={3} spacing="xs">
          <ReviewDetail label="Last gap update" value={lastRun} />
          <ReviewDetail label="Games database update" value={lastGamesUpdate} />
          <ReviewDetail
            label="Deck cap"
            value={maxPositions > 0 ? `${maxPositions} positions` : "No cap"}
          />
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}

function OpeningReviewPrioritySummary({
  positions,
  onOpenPositions,
}: {
  positions: Position[];
  onOpenPositions: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ranked = useMemo(() => rankOpeningReviewPositions(positions), [positions]);
  const hasRankingData = positions.some(
    (position) => position.priority !== undefined || position.openingHealth,
  );
  if (!hasRankingData || ranked.length === 0) return null;

  return (
    <Paper px="xs" py={6} withBorder radius="sm">
      <Stack gap="xs">
        <Group justify="space-between" gap="xs">
          <Stack gap={0}>
            <Text size="xs" fw={700}>
              Urgency ranking
            </Text>
            <Text size="xs" c="dimmed">
              {ranked.length} ranked position{ranked.length === 1 ? "" : "s"}
            </Text>
          </Stack>
          <Group gap={4}>
            {expanded && (
              <Button size="compact-xs" variant="subtle" onClick={onOpenPositions}>
                See all
              </Button>
            )}
            <Button
              size="compact-xs"
              variant="light"
              leftSection={
                expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
              }
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "Hide" : "Show"}
            </Button>
          </Group>
        </Group>
        {expanded &&
          ranked.slice(0, 4).map(({ position, rank, urgency }) => (
            <Group key={`${position.reviewKey ?? position.fen}-${rank}`} gap="xs" wrap="nowrap">
              <Badge color={openingReviewUrgencyColor(urgency)} variant="light" miw={68}>
                #{rank} {urgency}
              </Badge>
              <Stack gap={0} miw={0}>
                <Text size="sm" fw={700} truncate>
                  {formatOpeningReviewPositionAnswer(position)}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={2}>
                  {openingReviewPositionExplanation(position)}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatReviewPositionLastPlayed(position)}
                </Text>
                <Text size="xs" c="dimmed">
                  Imported {formatImportedAt(position.importedAt)}
                </Text>
              </Stack>
            </Group>
          ))}
      </Stack>
    </Paper>
  );
}

function OpeningReviewAttemptDetails({
  position,
  deckMode,
  playedMove,
}: {
  position: Position;
  deckMode?: "self" | "opponent";
  playedMove: string | null;
}) {
  if (position.mistakeReview) {
    const mistake = position.mistakeReview;
    const depthText = formatMistakeReviewDepthTransparency({
      requestedDepth: mistake.requestedDepth,
      reachedDepth: mistake.reachedDepth,
      engineName: mistake.engineName,
    });

    return (
      <Paper p="xs" withBorder>
        <Stack gap="xs">
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text size="sm" fw={700}>
                Mistake evidence
              </Text>
              <Text size="xs" c="dimmed">
                Latest game against {mistake.opponent || "Unknown"}
                {mistake.date ? ` on ${mistake.date}` : ""}
              </Text>
            </Stack>
            <Badge variant="light">
              {mistakeReviewSeverityLabel(mistake.severity ?? "mistake")}
            </Badge>
          </Group>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing={6}>
            <ReviewDetail label="You played" value={playedMove || mistake.playedMoveSan || "-"} />
            <ReviewDetail label="Best move" value={mistake.bestMoveSan || position.answer} />
            <ReviewDetail label="Occurrences" value={`${mistake.occurrenceCount ?? 1}`} />
            <ReviewDetail label="Last seen" value={formatMistakeReviewLastSeen(position)} />
          </SimpleGrid>
          <SimpleGrid cols={2} spacing={6}>
            <ReviewDetail
              label="Centipawn loss"
              value={mistake.cpLoss === undefined ? "-" : `${Math.round(mistake.cpLoss)} cp`}
            />
            <ReviewDetail
              label="Win-prob drop"
              value={
                mistake.winProbabilityDrop === undefined
                  ? "-"
                  : `${mistake.winProbabilityDrop.toFixed(1)}%`
              }
            />
            <ReviewDetail label="Think time" value={formatMistakeReviewThinkTime(mistake)} />
            <ReviewDetail
              label="Clock after"
              value={formatMistakeReviewClock(mistake.clockAfterSeconds)}
            />
          </SimpleGrid>
          <ReviewDetail label="Stockfish source" value={depthText} />
        </Stack>
      </Paper>
    );
  }

  const health = position.openingHealth;
  const mode = deckMode ?? health?.mode ?? "self";
  const side = getOpeningReviewPositionColour(position, deckMode);
  const ownerLabel = mode === "opponent" ? "Opponent games" : "My games";
  const usualMoveLabel = mode === "opponent" ? "They usually played" : "I usually played";
  const databaseMove = health?.topMoveSan ?? position.answer;
  const strongHasBreakdown =
    health?.strongWhite !== null &&
    health?.strongWhite !== undefined &&
    health?.strongDraw !== null &&
    health?.strongDraw !== undefined &&
    health?.strongBlack !== null &&
    health?.strongBlack !== undefined;

  return (
    <Paper p="xs" withBorder>
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text size="sm" fw={700}>
              Position evidence
            </Text>
            <Text size="xs" c="dimmed">
              {position.moveSequence || "Starting position"}
            </Text>
          </Stack>
          <Badge variant="light">{side === "white" ? "White to move" : "Black to move"}</Badge>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing={6}>
          <ReviewDetail label="You played" value={playedMove || "-"} />
          <ReviewDetail label="Engine best move" value={formatReviewEngineBestMove(position)} />
          <ReviewDetail label="Database strong move" value={databaseMove || "-"} />
          <ReviewDetail label={usualMoveLabel} value={health?.usualMoveSan ?? "-"} />
        </SimpleGrid>

        {health ? (
          <>
            <OpeningReviewResultBars
              label={`${ownerLabel} (${formatReviewNumber(health.games ?? 0)} games)`}
              white={health.white ?? 0}
              draw={health.draw ?? 0}
              black={health.black ?? 0}
              score={health.score}
              side={side}
            />
            {strongHasBreakdown ? (
              <OpeningReviewResultBars
                label={`Strong games (${formatReviewNumber(health.strongGames ?? 0)} games)`}
                white={health.strongWhite ?? 0}
                draw={health.strongDraw ?? 0}
                black={health.strongBlack ?? 0}
                score={health.strongScore}
                side={side}
              />
            ) : (
              <Text size="xs" c="dimmed">
                Strong games:{" "}
                {health.strongScore === null || health.strongScore === undefined
                  ? "-"
                  : formatReviewPercent(health.strongScore)}
                {health.strongGames
                  ? ` across ${formatReviewNumber(health.strongGames)} games`
                  : ""}
              </Text>
            )}
            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing={6}>
              <ReviewDetail
                label="Last seen"
                value={formatOpeningReviewLastPlayed(health.lastPlayed)}
              />
              <ReviewDetail
                label="Engine source"
                value={formatReviewEngineSourceForPosition(position)}
              />
              <ReviewDetail label="Imported" value={formatImportedAt(position.importedAt)} />
            </SimpleGrid>
          </>
        ) : (
          <Text size="sm" c="dimmed">
            {position.reason ||
              position.evidence ||
              "No Analyze Repertoire evidence was saved for this card."}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function ReviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={1}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={700} lh={1.25} lineClamp={2}>
        {value}
      </Text>
    </Stack>
  );
}

function formatMistakeReviewSyncTimestamp(value: number) {
  return dayjs(value).format("MMM D, YYYY HH:mm");
}

function formatMistakeReviewSyncAdded(value?: number | null) {
  if (value === null || value === undefined) return "new mistake count unknown";
  if (value === 0) return "no new mistakes added";
  return `${value} new mistake${value === 1 ? "" : "s"} added`;
}

function normalizeMistakeReviewName(value?: string | null) {
  const name = value?.trim();
  if (!name || name === "?" || name === "-") return "";
  return name;
}

function normalizeMistakeReviewRating(value?: number | null) {
  if (value === undefined || value === null || value <= 0) return null;
  return value;
}

function normalizeReviewResult(value?: string | null): GameHeaders["result"] {
  return value === "1-0" || value === "0-1" || value === "1/2-1/2" || value === "*" ? value : "*";
}

function getMistakeReviewRatingForColor(
  mistake: NonNullable<Position["mistakeReview"]>,
  color: "white" | "black",
) {
  return color === "white"
    ? normalizeMistakeReviewRating(mistake.whiteElo)
    : normalizeMistakeReviewRating(mistake.blackElo);
}

function formatMistakeReviewRating(value?: number | null) {
  return value ? `${value}` : "Unknown";
}

function formatMistakeReviewColor(value: "white" | "black") {
  return value === "white" ? "White" : "Black";
}

function formatMistakeReviewGameDate(value?: string | null) {
  if (!value) return "Unknown";
  const parsed = dayjs(value.replace(/\./g, "-").replace(/\?/g, "0"));
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : value;
}

function formatMistakeReviewTimeControl(mistake: NonNullable<Position["mistakeReview"]>) {
  const raw = mistake.timeControl?.trim();
  if (raw && raw !== "-" && raw !== "?") return formatPgnTimeControl(raw);
  const buckets = mistake.timeControls?.filter(Boolean) ?? [];
  if (buckets.length > 0) return buckets.map(formatMistakeReviewTimeBucket).join(", ");
  return "Unknown";
}

function formatMistakeReviewThinkTime(mistake: NonNullable<Position["mistakeReview"]>) {
  const timeText = formatMistakeReviewMoveTime(mistake.moveTimeSeconds);
  if (!timeText) return "Unknown";

  const threshold = mistake.longThinkThresholdSeconds;
  if (
    mistake.timeManagement?.enabled &&
    typeof threshold === "number" &&
    Number.isFinite(threshold)
  ) {
    const thresholdText = formatMistakeReviewMoveTime(threshold);
    return thresholdText ? `${timeText} (${thresholdText}+ target)` : timeText;
  }

  return timeText;
}

function formatMistakeReviewClock(seconds: number | null | undefined) {
  return formatMistakeReviewMoveTime(seconds) ?? "Unknown";
}

function formatPgnTimeControl(value: string) {
  if (value.includes("/")) return "Correspondence";
  const [initialText, incrementText] = value.split("+");
  const initialSeconds = Number(initialText);
  if (!Number.isFinite(initialSeconds)) return value;

  const incrementSeconds = Number(incrementText ?? 0);
  const initialDisplay =
    initialSeconds >= 60 && initialSeconds % 60 === 0
      ? `${initialSeconds / 60}`
      : `${initialSeconds}s`;
  if (!Number.isFinite(incrementSeconds) || incrementSeconds <= 0) {
    return initialSeconds >= 60 && initialSeconds % 60 === 0
      ? `${initialDisplay} min`
      : initialDisplay;
  }
  return `${initialDisplay}+${incrementSeconds}`;
}

function formatMistakeReviewTimeBucket(value: string) {
  switch (value) {
    case "bullet":
      return "Bullet";
    case "blitz":
      return "Blitz";
    case "rapid":
      return "Rapid";
    case "classical":
      return "Classical";
    case "correspondence":
      return "Correspondence";
    default:
      return "Unknown";
  }
}

function formatMistakeReviewRelativeResult(
  result: string | null | undefined,
  playerColor: "white" | "black",
) {
  if (result === "1/2-1/2") return "Draw";
  if (result === "1-0") return playerColor === "white" ? "Win" : "Loss";
  if (result === "0-1") return playerColor === "black" ? "Win" : "Loss";
  return "Unknown";
}

function formatReviewEngineBestMove(position: Position) {
  const engine = position.engine;
  if (engine?.bestMoveSan) {
    return engine.bestMoveSan;
  }

  const health = position.openingHealth;
  if (health?.topMoveSan) return health.topMoveSan;

  return "Not checked";
}

function formatReviewEngineSourceForPosition(position: Position) {
  if (position.engine) return formatReviewEngineSource(position.engine);
  if (position.openingHealth?.topMoveSan) return "Database scan";
  return "Not checked";
}

function formatReviewEngineSource(engine: Position["engine"] | undefined) {
  if (!engine) return "Not checked";

  const parts = [reviewEngineSourceLabel(engine.source)];
  if (engine.depth) parts.push(`depth ${engine.depth}`);
  if (engine.lossCp !== undefined) parts.push(`${Math.round(engine.lossCp)} cp vs database`);

  return parts.join(", ");
}

function formatMistakeReviewDepthTransparency(state: {
  requestedDepth?: number;
  reachedDepth?: number;
  engineName?: string;
}) {
  const engine = state.engineName || "Stockfish";
  if (!state.requestedDepth && !state.reachedDepth) {
    return `Analyzed with ${engine}`;
  }
  if (state.requestedDepth && state.reachedDepth && state.requestedDepth !== state.reachedDepth) {
    return `Analyzed with ${engine} depth ${state.reachedDepth} (requested ${state.requestedDepth})`;
  }
  return `Analyzed with ${engine} depth ${state.reachedDepth ?? state.requestedDepth}`;
}

function OpeningReviewResultBars({
  label,
  white,
  draw,
  black,
  score,
  side,
}: {
  label: string;
  white: number;
  draw: number;
  black: number;
  score?: number | null;
  side: "white" | "black";
}) {
  const total = white + draw + black;
  const whitePercent = total > 0 ? (white / total) * 100 : 0;
  const drawPercent = total > 0 ? (draw / total) * 100 : 0;
  const blackPercent = total > 0 ? (black / total) * 100 : 0;
  const scoreLabel =
    score === null || score === undefined
      ? "-"
      : `${side === "white" ? "White" : "Black"} score ${formatReviewPercent(score)}`;

  return (
    <Stack gap={3}>
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="xs" fw={700}>
          {scoreLabel}
        </Text>
      </Group>
      <Tooltip
        withArrow
        label={`White ${whitePercent.toFixed(1)}% / Draw ${drawPercent.toFixed(
          1,
        )}% / Black ${blackPercent.toFixed(1)}%`}
      >
        <Progress.Root size="lg" className={resultClasses.result}>
          <Progress.Section value={whitePercent} className={resultClasses.whiteResultsSection}>
            <Progress.Label c="black">
              {whitePercent > 18 ? `${whitePercent.toFixed(0)}%` : ""}
            </Progress.Label>
          </Progress.Section>
          <Progress.Section value={drawPercent} color="gray">
            <Progress.Label>{drawPercent > 18 ? `${drawPercent.toFixed(0)}%` : ""}</Progress.Label>
          </Progress.Section>
          <Progress.Section value={blackPercent} color="black">
            <Progress.Label>
              {blackPercent > 18 ? `${blackPercent.toFixed(0)}%` : ""}
            </Progress.Label>
          </Progress.Section>
        </Progress.Root>
      </Tooltip>
    </Stack>
  );
}

function formatReviewPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatReviewNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatImportedAt(value: number | null | undefined) {
  return value ? dayjs(value).format("MMM D, YYYY HH:mm") : "Unknown";
}

function getNextDueOpeningReviewPositionIndex(positions: Position[], scopeIndices?: number[]) {
  const now = new Date();
  const indices = scopeIndices ?? positions.map((_, index) => index);

  return (
    indices.find((index) => {
      const position = positions[index];
      return position ? new Date(position.card.due) <= now : false;
    }) ?? -1
  );
}

function getOpeningReviewPositionColour(
  position: Position,
  deckMode?: "self" | "opponent",
): "white" | "black" {
  const health = position.openingHealth;
  const savedSide = normalizeOpeningReviewSide(
    health?.sideToMove ?? position.sideToMove ?? position.fen.split(" ")[1],
  );
  const mode = deckMode ?? health?.mode;

  if (mode && savedSide) {
    return mode === "opponent" ? oppositeOpeningReviewSide(savedSide) : savedSide;
  }

  const reviewSide = normalizeOpeningReviewSide(health?.reviewSide);
  if (reviewSide) return reviewSide;

  return savedSide ?? "white";
}

function getOpeningReviewMoveSide(position: Position): "white" | "black" {
  return (
    normalizeOpeningReviewSide(
      position.sideToMove ?? position.openingHealth?.sideToMove ?? position.fen.split(" ")[1],
    ) ??
    normalizeOpeningReviewSide(position.openingHealth?.reviewSide) ??
    "white"
  );
}

function formatOpeningReviewPositionAnswer(position: Position) {
  const moveSequence = getOpeningReviewMoveSequenceLabel(position);
  return moveSequence ? `${position.answer} - ${moveSequence}` : position.answer;
}

function formatOpeningReviewLastPlayedColumn(value: string | null | undefined) {
  const formatted = formatOpeningReviewLastPlayed(value);
  if (formatted === "Last played unknown") return "Unknown";
  return formatted.replace(/^Last played /, "");
}

function getReviewPositionLastPlayedDate(position: Position) {
  return position.mistakeReview?.date ?? position.openingHealth?.lastPlayed;
}

function getReviewPositionLastPlayedTime(position: Position) {
  const time = position.mistakeReview?.time?.trim();
  return time || null;
}

function formatReviewPositionLastPlayed(position: Position) {
  if (!position.mistakeReview) {
    return formatOpeningReviewLastPlayedColumn(position.openingHealth?.lastPlayed);
  }

  const date = position.mistakeReview.date;
  if (!date) return "Unknown";

  const parsed = parseOpeningReviewDate(date);
  const dateText = parsed ? dayjs(parsed).format("MMM D, YYYY") : date.replace(/\./g, "-");
  const time = getReviewPositionLastPlayedTime(position);
  return time ? `${dateText} ${time.slice(0, 5)}` : dateText;
}

function getReviewPositionLastPlayedSortTime(position: Position) {
  const date = parseOpeningReviewDate(getReviewPositionLastPlayedDate(position));
  if (!date) return 0;

  const time = getReviewPositionLastPlayedTime(position);
  if (!time) return date.getTime();

  const [hours = 0, minutes = 0, seconds = 0] = time.split(":").map((part) => Number(part));
  if (![hours, minutes, seconds].every(Number.isFinite)) return date.getTime();

  const withTime = new Date(date);
  withTime.setUTCHours(hours, minutes, seconds, 0);
  return withTime.getTime();
}

function getOpeningReviewStatsSide(
  position: Position,
  deckMode?: "self" | "opponent",
  opening?: OpeningReviewOpeningInfo,
): "white" | "black" {
  return getOpeningReviewStatsPerspectiveSide(
    position,
    deckMode,
    opening?.rawName ?? position.openingHealth?.openingName,
  );
}

function oppositeOpeningReviewSide(side: "white" | "black") {
  return side === "white" ? "black" : "white";
}

function normalizeOpeningReviewSide(value: unknown): "white" | "black" | null {
  if (value === "white" || value === "w") return "white";
  if (value === "black" || value === "b") return "black";
  return null;
}

function getOpeningReviewOpeningInfo(
  position: Position,
  resolvedName?: string,
): OpeningReviewOpeningInfo {
  const rawName =
    normalizeOpeningReviewResolvedOpeningName(position, position.mistakeReview?.openingName) ??
    normalizeOpeningReviewResolvedOpeningName(position, resolvedName) ??
    getOpeningReviewStoredOpeningName(position) ??
    inferOpeningReviewOpeningName(position);
  const family = getOpeningReviewOpeningFamily(rawName);
  const variation = getOpeningReviewOpeningVariation(rawName, family);
  const line = variation ? `${family}: ${variation}` : family;

  return {
    rawName,
    family,
    variation,
    line,
    isVariation: variation !== null,
  };
}

function cleanOpeningReviewOpeningName(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeOpeningReviewResolvedOpeningName(
  position: Position,
  value: string | null | undefined,
) {
  const name = cleanOpeningReviewOpeningName(value);
  if (
    name?.toLowerCase() === "starting position" &&
    !isOpeningReviewStartingPosition(position) &&
    !getOpeningReviewMoveSequenceLabel(position)
  ) {
    return null;
  }
  return name;
}

function inferOpeningReviewOpeningName(position: Position) {
  const moves = tokenizeReviewMoveSequence(getOpeningReviewMoveSequenceLabel(position) ?? "");
  if (moves.length === 0) {
    return isOpeningReviewStartingPosition(position) ? "Starting position" : "Unknown opening";
  }

  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = moves;
  if (first === "e4" && second === "c6") return "Caro-Kann Defense";
  if (first === "e4" && second === "c5") return "Sicilian Defense";
  if (first === "e4" && second === "e5") return "Open Game";
  if (first === "e4" && second === "e6") return "French Defense";
  if (first === "e4" && second === "d6") return "Pirc Defense";
  if (first === "d4" && second === "Nf6" && third === "c4" && fourth === "g6") {
    return "King's Indian Defense";
  }
  if (first === "d4" && second === "Nf6" && third === "c4" && fourth === "e6") {
    return "Indian Game";
  }
  if (first === "d4" && second === "d5" && third === "c4") {
    if (fourth === "c6") return "Slav Defense";
    if (
      fourth === "e6" &&
      sixth === "Nf6" &&
      [fifth, seventh].includes("Nc3") &&
      [fifth, seventh].includes("Nf3")
    ) {
      return eighth?.startsWith("Bb4")
        ? "Queen's Gambit Declined: Ragozin Defense"
        : "Queen's Gambit";
    }
    if (fourth === "e6") return "Queen's Gambit";
    if (fourth === "dxc4") return "Queen's Gambit Accepted";
    return "Queen's Gambit";
  }

  return formatOpeningReviewMovePrefix(moves.slice(0, Math.min(4, moves.length)));
}

function isOpeningReviewStartingPosition(position: Position) {
  return openingReviewFenKey(position.fen) === openingReviewFenKey(INITIAL_FEN);
}

function openingReviewFenKey(fen: string) {
  return fen.split(" ").slice(0, 4).join(" ");
}

function getOpeningReviewOpeningFamily(openingName: string) {
  const base = openingName.split(":")[0]?.trim() || openingName;
  const lowerBase = base.toLowerCase();

  if (lowerBase.startsWith("semi-slav defense")) return "Semi-Slav Defense";
  if (lowerBase.startsWith("slav defense")) return "Slav Defense";
  if (lowerBase.startsWith("queen's gambit") || lowerBase.startsWith("queens gambit")) {
    return "Queen's Gambit";
  }
  if (lowerBase.startsWith("caro-kann defense") || lowerBase.startsWith("caro kann defense")) {
    return "Caro-Kann Defense";
  }

  return base;
}

function getOpeningReviewOpeningVariation(openingName: string, family: string) {
  const parts = openingName
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  const base = parts[0] ?? openingName;
  const namedVariation = parts.slice(1).join(": ");

  if (family === "Queen's Gambit") {
    if (namedVariation) return namedVariation;
    const suffix = base.replace(/^Queen'?s Gambit/i, "").trim();
    return suffix || null;
  }

  return namedVariation || null;
}

function getOpeningReviewOpeningCacheKey(position: Position) {
  return `${position.fen.split(" ").slice(0, 4).join(" ")}|${position.moveSequence ?? ""}`;
}

function getOpeningReviewStoredOpeningName(position: Position) {
  return (
    normalizeOpeningReviewResolvedOpeningName(position, position.mistakeReview?.openingName) ??
    normalizeOpeningReviewResolvedOpeningName(position, position.openingHealth?.openingName)
  );
}

function applyOpeningReviewResolvedOpeningNames(
  positions: Position[],
  namesByKey: OpeningReviewResolvedOpeningNames,
) {
  let changed = false;
  const nextPositions = positions.map((position) => {
    const name = cleanOpeningReviewOpeningName(
      namesByKey[getOpeningReviewOpeningCacheKey(position)],
    );
    if (!name || position.openingHealth?.openingName === name) return position;

    changed = true;
    return {
      ...position,
      openingHealth: {
        ...position.openingHealth,
        openingName: name,
      },
    };
  });

  return changed ? nextPositions : positions;
}

function getOpeningReviewPositionFenLine(position: Position) {
  const fens = [INITIAL_FEN];
  const moves = tokenizeReviewMoveSequence(position.moveSequence ?? "");
  const [chess] = positionFromFen(INITIAL_FEN);
  if (!chess) return [position.fen];

  for (const token of moves) {
    const move = parseSan(chess, token);
    if (!move) break;
    chess.play(move);
    fens.push(makeFen(chess.toSetup()));
  }

  if (!fens.some((fen) => sameReviewPosition(fen, position.fen))) {
    fens.push(position.fen);
  }

  return fens;
}

async function resolveOpeningReviewOpeningName(position: Position) {
  const fallback = inferOpeningReviewOpeningName(position);

  try {
    const result = await commands.getOpeningFromFens(getOpeningReviewPositionFenLine(position));
    return (
      normalizeOpeningReviewResolvedOpeningName(
        position,
        result.status === "ok" ? result.data : null,
      ) ?? fallback
    );
  } catch {
    return fallback;
  }
}

function openingReviewFamilyFilterValue(family: string) {
  return `family:${family}`;
}

function openingReviewLineFilterValue(line: string) {
  return `line:${line}`;
}

function openingReviewFilterMatchesOpening(filter: string, opening: OpeningReviewOpeningInfo) {
  if (filter === "all") return true;
  if (filter.startsWith("family:")) return opening.family === filter.slice("family:".length);
  if (filter.startsWith("line:")) return opening.line === filter.slice("line:".length);
  return opening.line === filter || opening.family === filter;
}

function openingReviewFilterDisplayName(filter: string) {
  if (filter === "all") return "all openings";
  if (filter.startsWith("family:")) return filter.slice("family:".length);
  if (filter.startsWith("line:")) return filter.slice("line:".length);
  return filter;
}

function openingReviewFiltersDisplayName(filters: string[]) {
  if (filters.length === 0) return "all openings";
  if (filters.length === 1) return openingReviewFilterDisplayName(filters[0]!);
  return `${filters.length} openings`;
}

function formatOpeningReviewMovePrefix(moves: string[]) {
  return moves
    .map((move, index) => (index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ${move}` : move))
    .join(" ");
}

function openingReviewPositionSortValue(
  row: OpeningReviewPositionRow,
  sort: OpeningReviewPositionSort,
) {
  switch (sort) {
    case "urgency":
      return row.rank;
    case "imported":
      return -(row.position.importedAt ?? 0);
    case "lastPlayed":
      return -getReviewPositionLastPlayedSortTime(row.position);
    case "colour":
      return getOpeningReviewMoveSide(row.position) === "white" ? 0 : 1;
    case "opening":
      return row.opening.line;
    case "due":
      return new Date(row.position.card.due).getTime();
    case "move":
      return row.position.answer;
  }
}

function compareOpeningReviewPositionRows(
  a: OpeningReviewPositionRow,
  b: OpeningReviewPositionRow,
  sort: OpeningReviewPositionSort,
) {
  const aValue = openingReviewPositionSortValue(a, sort);
  const bValue = openingReviewPositionSortValue(b, sort);

  if (typeof aValue === "number" && typeof bValue === "number" && aValue !== bValue) {
    return aValue - bValue;
  }
  if (typeof aValue === "string" && typeof bValue === "string" && aValue !== bValue) {
    return aValue.localeCompare(bValue);
  }

  return a.rank - b.rank;
}

function reviewEngineSourceLabel(source: NonNullable<Position["engine"]>["source"] | undefined) {
  switch (source) {
    case "lichess":
      return "Lichess Cloud";
    case "chessdb":
    case "cloud":
      return "ChessDB";
    case "local":
      return "Stockfish";
    default:
      return "Engine";
  }
}

function ReviewQualityPanel({
  onRate,
  title,
  detail,
  color,
  icon,
  card,
  timeTaken,
}: {
  onRate: (grade: 1 | 2 | 3 | 4) => void;
  title?: string;
  detail?: string;
  color?: "blue" | "green" | "orange" | "red" | "teal" | "yellow";
  icon?: "bulb" | "check" | "x";
  card?: import("ts-fsrs").Card;
  timeTaken?: number;
}) {
  const reviewTimes = card ? getNextReviewTimes(card) : null;
  const feedbackColor = color ?? "green";

  return (
    <Paper p="xs" withBorder>
      <Stack gap={8} align="center">
        <Group gap="xs">
          <ThemeIcon size="sm" color={feedbackColor} variant="light" radius="xl">
            {icon === "bulb" ? (
              <IconBulb size={14} />
            ) : icon === "x" ? (
              <IconX size={14} />
            ) : (
              <IconCheck size={14} />
            )}
          </ThemeIcon>
          <Text size="sm" fw={700} c={feedbackColor}>
            {title ?? "Correct"}
          </Text>
          {timeTaken !== undefined && (
            <Text size="xs" c="dimmed">
              ({(timeTaken / 1000).toFixed(1)}s)
            </Text>
          )}
        </Group>
        {detail && (
          <Text size="xs" c="dimmed" ta="center">
            {detail}
          </Text>
        )}
        <SimpleGrid cols={4} spacing={8} w="100%">
          {[
            { grade: 1 as const, label: "Again", color: "red" },
            { grade: 2 as const, label: "Hard", color: "orange" },
            { grade: 3 as const, label: "Good", color: "blue" },
            { grade: 4 as const, label: "Easy", color: "green" },
          ].map((item) => (
            <Button
              key={item.grade}
              color={item.color}
              variant="light"
              size="compact-sm"
              onClick={() => onRate(item.grade)}
              style={{ height: "auto", minHeight: 44, padding: "5px 0" }}
            >
              <Stack gap={0} align="center">
                <Text size="xs" fw={600}>
                  {item.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[item.grade]) : ""}
                </Text>
              </Stack>
            </Button>
          ))}
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}

function OpeningReviewPositionsModal({
  opened,
  onClose,
  deckPath,
  onTrainDue,
  onTrainAll,
  onLoadPosition,
}: {
  opened: boolean;
  onClose: () => void;
  deckPath: string;
  onTrainDue: (indices?: number[], label?: string) => void;
  onTrainAll: (indices?: number[], label?: string) => void;
  onLoadPosition: (positionIndex: number) => void;
}) {
  const [deck, setDeck] = useAtom(deckAtomFamily({ file: deckPath, game: 0 }));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [moveInput, setMoveInput] = useState("");
  const [sortBy, setSortBy] = useState<OpeningReviewPositionSort>("urgency");
  const [colourFilter, setColourFilter] = useState<OpeningReviewColourFilter>("any");
  const [openingFilters, setOpeningFilters] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<OpeningHealthDateRange>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [positionsScrollElement, setPositionsScrollElement] = useState<HTMLDivElement | null>(null);
  const [openingNamesByKey, setOpeningNamesByKey] = useState<Record<string, string>>({});
  const mistakeReviewMetadataBackfillKeysRef = useRef<Set<string>>(new Set());
  const dateBounds = useMemo(
    () => getOpeningHealthDateBounds(dateRange, customStartDate, customEndDate),
    [customEndDate, customStartDate, dateRange],
  );
  const editingPosition = useMemo(
    () => (editingIndex === null ? null : (deck.positions[editingIndex] ?? null)),
    [deck.positions, editingIndex],
  );
  const rankedPositions = useMemo(
    () => rankOpeningReviewPositions(deck.positions),
    [deck.positions],
  );
  const openingInfoByIndex = useMemo(
    () =>
      deck.positions.map((position) => {
        const key = getOpeningReviewOpeningCacheKey(position);
        return getOpeningReviewOpeningInfo(
          position,
          openingNamesByKey[key] ?? openingReviewOpeningNameCache.get(key),
        );
      }),
    [deck.positions, openingNamesByKey],
  );
  const rowsWithOpenings = useMemo<OpeningReviewPositionRow[]>(
    () =>
      rankedPositions.map((row) => ({
        ...row,
        opening: openingInfoByIndex[row.index] ?? getOpeningReviewOpeningInfo(row.position),
      })),
    [openingInfoByIndex, rankedPositions],
  );
  const colourFilteredRows = useMemo(
    () =>
      rowsWithOpenings.filter(
        ({ position }) =>
          (colourFilter === "any" || getOpeningReviewMoveSide(position) === colourFilter) &&
          openingHealthDateMatches(getReviewPositionLastPlayedDate(position), dateBounds),
      ),
    [colourFilter, dateBounds, rowsWithOpenings],
  );
  const openingOptions = useMemo(() => {
    const familyCounts = new Map<string, number>();
    const lineCounts = new Map<string, number>();

    for (const row of colourFilteredRows) {
      familyCounts.set(row.opening.family, (familyCounts.get(row.opening.family) ?? 0) + 1);
      if (row.opening.isVariation) {
        lineCounts.set(row.opening.line, (lineCounts.get(row.opening.line) ?? 0) + 1);
      }
    }

    const familyOptions = Array.from(familyCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([family, count]) => ({
        value: openingReviewFamilyFilterValue(family),
        label: `${family} (${count})`,
      }));
    const variationOptions = Array.from(lineCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([line, count]) => ({
        value: openingReviewLineFilterValue(line),
        label: `${line} (${count})`,
      }));

    return [...familyOptions, ...variationOptions];
  }, [colourFilteredRows]);
  const visibleRows = useMemo(
    () =>
      colourFilteredRows
        .filter(
          (row) =>
            openingFilters.length === 0 ||
            openingFilters.some((filter) => openingReviewFilterMatchesOpening(filter, row.opening)),
        )
        .sort((a, b) => compareOpeningReviewPositionRows(a, b, sortBy)),
    [colourFilteredRows, openingFilters, sortBy],
  );
  const visibleIndices = useMemo(() => visibleRows.map((row) => row.index), [visibleRows]);
  const visibleDueCount = useMemo(() => {
    const now = new Date();
    return visibleRows.filter(({ position }) => new Date(position.card.due) <= now).length;
  }, [visibleRows]);
  const dateFilterActive = openingHealthDateBoundsAreActive(dateBounds);
  const hasActivePositionFilter =
    openingFilters.length > 0 || colourFilter !== "any" || dateFilterActive;
  const baseTrainingScopeLabel =
    openingFilters.length === 0
      ? colourFilter === "any"
        ? "all openings"
        : `${colourFilter} openings`
      : `${openingReviewFiltersDisplayName(openingFilters)}${
          colourFilter === "any" ? "" : `, ${colourFilter}`
        }`;
  const trainingScopeLabel = dateFilterActive
    ? `${baseTrainingScopeLabel}, last played ${formatOpeningHealthDateFilter(dateBounds)}`
    : baseTrainingScopeLabel;
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => positionsScrollElement,
    estimateSize: () => 198,
    initialRect: { width: 1320, height: 640 },
    overscan: 6,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const topSpacerHeight = virtualRows[0]?.start ?? 0;
  const bottomSpacerHeight =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1]!.end
      : 0;

  useEffect(() => {
    setMoveInput(editingPosition?.answer ?? "");
  }, [editingPosition]);

  useEffect(() => {
    if (!opened) return;

    let disposed = false;
    const missing = deck.positions
      .map((position) => ({
        key: getOpeningReviewOpeningCacheKey(position),
        position,
      }))
      .filter(({ key, position }) => {
        const storedName = getOpeningReviewStoredOpeningName(position);
        if (storedName) {
          openingReviewOpeningNameCache.set(key, storedName);
          return false;
        }
        return !openingReviewOpeningNameCache.has(key);
      });

    if (missing.length === 0) return;

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

        for (const { key, name } of resolved) {
          openingReviewOpeningNameCache.set(key, name);
        }
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
  }, [deck.positions, opened]);

  useEffect(() => {
    if (!opened) return;

    const requestsByDb = new Map<string, Set<number>>();
    for (const position of deck.positions) {
      const metadata = position.mistakeReview;
      const playerDb = metadata?.playerDb;
      const gameId = metadata?.lastGameId ?? metadata?.gameId;
      if (!playerDb || !gameId) continue;
      if (metadata.date && metadata.time && metadata.openingName) continue;

      const key = `${playerDb}|${gameId}`;
      if (mistakeReviewMetadataBackfillKeysRef.current.has(key)) continue;
      mistakeReviewMetadataBackfillKeysRef.current.add(key);

      const ids = requestsByDb.get(playerDb) ?? new Set<number>();
      ids.add(gameId);
      requestsByDb.set(playerDb, ids);
    }

    if (requestsByDb.size === 0) return;

    let disposed = false;

    async function backfillMistakeReviewMetadata() {
      const metadataByKey = new Map<
        string,
        { date: string | null; time: string | null; openingName: string | null }
      >();

      for (const [playerDb, ids] of requestsByDb) {
        const result = await commands.getMistakeReviewGameMetadata(playerDb, Array.from(ids));
        if (disposed || result.status === "error") continue;

        for (const item of result.data) {
          metadataByKey.set(`${playerDb}|${item.gameId}`, {
            date: item.date,
            time: item.time,
            openingName: item.openingName,
          });
        }
      }

      if (disposed || metadataByKey.size === 0) return;

      setDeck((current) => {
        let changed = false;
        const positions = current.positions.map((position) => {
          const metadata = position.mistakeReview;
          const playerDb = metadata?.playerDb;
          const gameId = metadata?.lastGameId ?? metadata?.gameId;
          if (!metadata || !playerDb || !gameId) return position;

          const gameMetadata = metadataByKey.get(`${playerDb}|${gameId}`);
          if (!gameMetadata) return position;

          const nextMetadata = {
            ...metadata,
            date: metadata.date ?? gameMetadata.date,
            time: metadata.time ?? gameMetadata.time,
            openingName: metadata.openingName ?? gameMetadata.openingName,
          };
          if (
            nextMetadata.date === metadata.date &&
            nextMetadata.time === metadata.time &&
            nextMetadata.openingName === metadata.openingName
          ) {
            return position;
          }

          changed = true;
          return {
            ...position,
            mistakeReview: nextMetadata,
          };
        });

        return changed ? { ...current, positions } : current;
      });
    }

    void backfillMistakeReviewMetadata();

    return () => {
      disposed = true;
    };
  }, [deck.positions, opened, setDeck]);

  useEffect(() => {
    const validValues = new Set(openingOptions.map((option) => option.value));
    setOpeningFilters((current) => {
      const next = current.filter((filter) => validValues.has(filter));
      return next.length === current.length ? current : next;
    });
  }, [openingOptions]);

  useEffect(() => {
    if (!opened || !positionsScrollElement) return;
    rowVirtualizer.measure();
  }, [opened, positionsScrollElement, rowVirtualizer, visibleRows.length]);

  const loadReviewPosition = useCallback(
    (positionIndex: number) => {
      onLoadPosition(positionIndex);
      onClose();
    },
    [onClose, onLoadPosition],
  );

  const deleteReviewPosition = useCallback(
    (index: number) => {
      const position = deck.positions[index];
      setDeck((current) => ({
        ...current,
        positions: current.positions.filter((_, positionIndex) => positionIndex !== index),
      }));
      notifications.show({
        title: "Position removed",
        message: position ? `${position.answer} was removed from this review deck.` : undefined,
        color: "blue",
      });
      if (editingIndex === index) {
        setEditingIndex(null);
      }
    },
    [deck.positions, editingIndex, setDeck],
  );

  const saveEditedMove = useCallback(() => {
    if (editingIndex === null || !editingPosition) return;
    const parsed = parseReviewCorrectMove(editingPosition, moveInput);
    if (!parsed) {
      notifications.show({
        title: "Move not recognised",
        message: "Type a legal move from this position, for example Nf3 or g1f3.",
        color: "red",
      });
      return;
    }

    setDeck((current) => {
      const position = current.positions[editingIndex];
      if (!position) return current;
      const sameMove = isOpeningReviewSavedMove(position, parsed);
      const positions = [...current.positions];
      positions[editingIndex] = {
        ...position,
        answer: parsed.san,
        answerUci: parsed.uci,
        reviewKey: `${position.fen}|${parsed.uci || parsed.san}`,
        card: sameMove ? position.card : createEmptyCard(),
      };
      return {
        ...current,
        positions,
      };
    });
    setEditingIndex(null);
    notifications.show({
      title: "Correct move updated",
      message: `${parsed.san} is now the move trained for this position.`,
      color: "green",
    });
  }, [editingIndex, editingPosition, moveInput, setDeck]);

  return (
    <Modal opened={opened} onClose={onClose} title={<b>Review positions</b>} size="xl">
      <Stack gap="sm" mb="sm">
        <Group gap="xs" align="flex-end">
          <Select
            label="Sort"
            value={sortBy}
            onChange={(value) => setSortBy((value as OpeningReviewPositionSort) ?? "urgency")}
            data={[
              { value: "urgency", label: "Urgency" },
              { value: "imported", label: "Imported newest" },
              { value: "lastPlayed", label: "Last played newest" },
              { value: "colour", label: "Colour" },
              { value: "opening", label: "Opening" },
              { value: "due", label: "Due date" },
              { value: "move", label: "Correct move" },
            ]}
            w={170}
            allowDeselect={false}
          />
          <MultiSelect
            label="Openings"
            value={openingFilters}
            onChange={setOpeningFilters}
            data={openingOptions}
            searchable
            clearable
            placeholder="All openings"
            w={300}
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
          <Select
            label="Last played"
            value={dateRange}
            onChange={(value) => setDateRange((value as OpeningHealthDateRange) ?? "all")}
            data={OPENING_HEALTH_DATE_RANGE_OPTIONS}
            allowDeselect={false}
            w={165}
          />
          {dateRange === "custom" && (
            <>
              <TextInput
                label="From"
                type="date"
                value={openingHealthDbDateToInput(customStartDate)}
                onChange={(event) => setCustomStartDate(event.currentTarget.value)}
                w={135}
              />
              <TextInput
                label="To"
                type="date"
                value={openingHealthDbDateToInput(customEndDate)}
                onChange={(event) => setCustomEndDate(event.currentTarget.value)}
                w={135}
              />
            </>
          )}
          <Button
            variant="light"
            leftSection={<IconTarget size={16} />}
            disabled={visibleDueCount === 0}
            onClick={() => {
              onTrainDue(visibleIndices, trainingScopeLabel);
              onClose();
            }}
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
            onClick={() => {
              onTrainAll(visibleIndices, trainingScopeLabel);
              onClose();
            }}
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
          {dateFilterActive && (
            <Badge variant="light">Last played: {formatOpeningHealthDateFilter(dateBounds)}</Badge>
          )}
        </Group>
      </Stack>
      <Box ref={setPositionsScrollElement} mah={640} style={{ overflow: "auto" }}>
        <Table miw={1320}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Position</Table.Th>
              <Table.Th>Urgency</Table.Th>
              <Table.Th>Opening</Table.Th>
              <Table.Th>Correct move</Table.Th>
              <Table.Th>Last played</Table.Th>
              <Table.Th>Imported</Table.Th>
              <Table.Th>Why</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {topSpacerHeight > 0 && (
              <Table.Tr>
                <Table.Td colSpan={9} style={{ height: topSpacerHeight, padding: 0 }} />
              </Table.Tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = visibleRows[virtualRow.index];
              if (!row) return null;
              const { position, index, rank, urgency, opening } = row;
              const due = new Date(position.card.due);
              const status =
                position.card.reps === 0 ? "Unseen" : due <= new Date() ? "Due" : "Scheduled";
              const colour = getOpeningReviewMoveSide(position);
              const moveSequence = getOpeningReviewMoveSequenceLabel(position);
              const openingDetail =
                opening.variation ?? (opening.rawName !== opening.family ? opening.rawName : null);
              return (
                <Table.Tr
                  key={`${position.reviewKey ?? position.fen}-${index}`}
                  ref={rowVirtualizer.measureElement}
                >
                  <Table.Td>
                    <OpeningReviewMiniBoard
                      position={position}
                      onClick={() => loadReviewPosition(index)}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      <Badge color={openingReviewUrgencyColor(urgency)} variant="light">
                        #{rank}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {urgency}/100
                      </Text>
                    </Stack>
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
                      <Badge size="xs" variant="light" color={colour === "white" ? "gray" : "dark"}>
                        {colour === "white" ? "White" : "Black"} side
                      </Badge>
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={0}>
                      <Text fw={700}>{position.answer}</Text>
                      {moveSequence && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {moveSequence}
                        </Text>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {formatReviewPositionLastPlayed(position)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {formatImportedAt(position.importedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {openingReviewPositionExplanation(position)}
                    </Text>
                    {position.evidence && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {position.evidence}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      <Badge variant="light">{status}</Badge>
                      <Text size="xs" c="dimmed">
                        Due {formatDate(due)}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Load on board">
                        <ActionIcon
                          aria-label="Load position on board"
                          size="sm"
                          variant="subtle"
                          onClick={() => loadReviewPosition(index)}
                        >
                          <IconTarget size="1rem" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Edit correct move">
                        <ActionIcon
                          aria-label="Edit correct move"
                          size="sm"
                          variant="subtle"
                          onClick={() => setEditingIndex(index)}
                        >
                          <IconPencil size="1rem" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete from deck">
                        <ActionIcon
                          aria-label="Delete from deck"
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() => deleteReviewPosition(index)}
                        >
                          <IconTrash size="1rem" />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {bottomSpacerHeight > 0 && (
              <Table.Tr>
                <Table.Td colSpan={9} style={{ height: bottomSpacerHeight, padding: 0 }} />
              </Table.Tr>
            )}
            {visibleRows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={9}>
                  <Text c="dimmed" ta="center" py="md">
                    No review positions match those filters.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Box>
      <Group gap={4} mt="sm">
        <IconInfoCircle size={14} />
        <Text size="xs" c="dimmed">
          Deck progress, notes, arrows, and move edits are saved back to the review file
          automatically.
        </Text>
      </Group>

      <Modal
        opened={editingIndex !== null}
        onClose={() => setEditingIndex(null)}
        title={<b>Edit correct move</b>}
        size="sm"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Type the move you want this card to train from the saved position.
          </Text>
          <TextInput
            label="Correct move"
            value={moveInput}
            onChange={(event) => setMoveInput(event.currentTarget.value)}
            placeholder="Nf3"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                saveEditedMove();
              }
            }}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setEditingIndex(null)}>
              Cancel
            </Button>
            <Button onClick={saveEditedMove} disabled={!moveInput.trim()}>
              Save move
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
