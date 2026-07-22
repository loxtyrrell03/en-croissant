import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Collapse,
  Group,
  Loader,
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
  IconFilter,
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
import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  scheduleSm2Card,
  type Position,
} from "@/components/files/opening";
import { OpeningReviewAutoUpdateBanner } from "@/components/review/OpeningReviewAutoUpdateBanner";
import {
  currentTabSelectedAtom,
  currentEvalOpenAtom,
  currentInvisibleAtom,
  currentShowCommentsAtom,
  dailyGoalCompletionPromptAtom,
  dailyGoalDeckRevisionAtom,
  deckAtomFamily,
  getDeckStorageKey,
  onlineDatabaseUpdatesAtom,
  openingReviewHideMovesDuringPracticeAtom,
  openingReviewAutoUpdateStateAtom,
  mistakeReviewAutoUpdateStateAtom,
  practiceAutoDifficultyAtom,
  practiceCardStartTimeAtom,
  practiceSessionStatsAtom,
  type PracticeData,
  type PracticeSessionStats,
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
  getOpeningReviewDailyBatchIndices,
  getOpeningReviewDailyProgress,
  readOpeningReviewDeck,
  type OpeningReviewDailySettings,
  type OpeningReviewDeck,
  writeOpeningReviewDeck,
} from "@/utils/openingReview";
import {
  DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
  formatMistakeReviewMoveTime,
  formatMistakeReviewTimeManagementFeedback,
  formatMistakeReviewLastSeen,
  getMistakeReviewDailyBatchIndices,
  getMistakeReviewDailyProgress,
  getMistakeReviewNature,
  getMistakeReviewNatureBatchIndices,
  getMistakeReviewNatureConfidence,
  getMistakeReviewNatureCounts,
  getMistakeReviewPhase,
  getMistakeReviewPhaseBatchIndices,
  getMistakeReviewPhaseCounts,
  getMistakeReviewSeverityWeight,
  getMistakeReviewTimeManagementBatchIndices,
  getMistakeReviewTimeManagementSummary,
  isMistakeReviewTimeManagementPosition,
  migrateMistakeReviewDeckNatureClassifications,
  mistakeReviewPositionKey,
  needsMistakeReviewDeckNatureMigration,
  mistakeReviewNatureColor,
  mistakeReviewNatureLabel,
  MISTAKE_REVIEW_NATURES,
  MISTAKE_REVIEW_PHASES,
  type MistakeReviewAttemptLabel,
  type MistakeReviewDailySettings,
  type MistakeReviewTimeManagementSettings,
  mistakeReviewSeverityLabel,
  type MistakeReviewNature,
  type MistakeReviewPhase,
  readMistakeReviewDeck,
  type MistakeReviewDeck,
  writeMistakeReviewDeck,
} from "@/utils/mistakeReview";
import { hydrateMistakeReviewClockData } from "@/utils/mistakeReviewClockHydration";
import {
  formatOpeningReviewLastPlayed,
  getOpeningReviewGapTrainingType,
  getOpeningReviewPlanGapTrainingIndices,
  openingReviewGapTrainingTypeColor,
  openingReviewGapTrainingTypeDescription,
  openingReviewGapTrainingTypeLabel,
  openingReviewGapTrainingTypePluralLabel,
  openingReviewPositionExplanation,
  openingReviewUrgencyColor,
  parseOpeningReviewDate,
  rankOpeningReviewPositions,
  type OpeningReviewGapTrainingType,
} from "@/utils/openingReviewAutoUpdate";
import {
  createReviewPositionFenIndex,
  findReviewPositionIndexForFen,
  getReviewPositionsForPath,
  sameReviewPosition,
  type ReviewPositionTreeMatch,
} from "@/utils/openingReviewPersistence";
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
import {
  formatOpeningReviewMoveSource,
  isOpeningReviewSavedMove,
} from "@/utils/openingReviewPractice";
import { BoundedMap } from "@/utils/boundedCache";
import resultClasses from "@/components/panels/database/OpeningsTable.module.css";
import classes from "./OpeningReviewWorkspace.module.css";

const AnalysisPanel = lazy(() => import("@/components/panels/analysis/AnalysisPanel"));
const ComparePanel = lazy(() => import("@/components/panels/compare/ComparePanel"));
const DatabasePanel = lazy(() => import("@/components/panels/database/DatabasePanel"));
const EnginePlanExplorerPanel = lazy(
  () => import("@/components/panels/enginePlan/EnginePlanExplorerPanel"),
);
const InfoPanel = lazy(() => import("@/components/panels/info/InfoPanel"));
const PlanExplorerPanel = lazy(() => import("@/components/panels/plan/PlanExplorerPanel"));
const RepertoireGapsPanel = lazy(() => import("@/components/panels/gaps/RepertoireGapsPanel"));

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

const openingReviewPanelModeControlStyle = {
  position: "sticky",
  top: 0,
  zIndex: 3,
  flexShrink: 0,
  paddingBottom: "var(--mantine-spacing-xs)",
  background: "var(--mantine-color-body)",
} as const;

const OPENING_REVIEW_PREVIEW_BOARD_SIZE = 168;
const OPENING_REVIEW_STATS_LIST_BOARD_SIZE = 92;
const OPENING_REVIEW_STATS_TABLE_BOARD_SIZE = 116;

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
  | "move"
  | "severity"
  | "moveTime"
  | "cpLoss"
  | "winProbabilityDrop"
  | "opponent";
type OpeningReviewColourFilter = "any" | "white" | "black";
type OpeningReviewGapFilter = "all" | Exclude<OpeningReviewGapTrainingType, "other">;
type MistakeReviewPhaseFilter = "all" | MistakeReviewPhase;
type MistakeReviewNatureFilter = "all" | MistakeReviewNature;
type MistakeReviewThinkTimeFilter = "all" | "known" | "long" | "missing";
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
type ReviewCardPerformanceUpdate = {
  positionIndex: number;
  fen: string;
  grade: 1 | 2 | 3 | 4;
  reviewedAt: Date;
};
type OpeningReviewStatsResultFilter = "wins" | "draws" | "losses";
type OpeningReviewStatsGroupBy = "family" | "line";
type OpeningReviewStatsSort =
  | "relevance"
  | "planGap"
  | "scoreDesc"
  | "scoreAsc"
  | "reviewDesc"
  | "gamesDesc";

const MISTAKE_REVIEW_POSITION_SEVERITIES: MistakeReviewAttemptLabel[] = [
  "blunder",
  "mistake",
  "inaccuracy",
  "okay",
  "good",
  "best",
];

const openingReviewOpeningNameCache = new BoundedMap<string, string>(2000);
type ReviewLineStateCacheEntry = {
  path: number[];
  state: TreeState;
  reviewTree: Position["reviewTree"];
  annotations: Position["annotations"];
  comment: Position["comment"];
  shapes: Position["shapes"];
};
// Keyed by position content rather than object identity so cache hits survive
// the deck updates (grading, persistence) that recreate Position objects.
const reviewPositionLineStateCache = new BoundedMap<string, ReviewLineStateCacheEntry>(120);
const REVIEW_DECK_SAVE_DEBOUNCE_MS = 1200;
const REVIEW_POSITION_PREWARM_LIMIT = 3;

type ReviewPositionTreeUpdate = ReviewPositionTreeMatch & { reviewTree: TreeNode };

function scheduleReviewDeckSave(callback: () => void) {
  let idleId: number | null = null;
  const timeoutId = window.setTimeout(() => {
    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(callback, { timeout: 3000 });
    } else {
      idleId = globalThis.setTimeout(callback, 0) as unknown as number;
    }
  }, REVIEW_DECK_SAVE_DEBOUNCE_MS);

  return () => {
    window.clearTimeout(timeoutId);
    if (idleId === null) return;

    if ("cancelIdleCallback" in window) {
      window.cancelIdleCallback(idleId);
    } else {
      globalThis.clearTimeout(idleId);
    }
  };
}

function scheduleReviewPositionPrewarm(callback: () => void) {
  if ("requestIdleCallback" in window) {
    const idleId = window.requestIdleCallback(callback, { timeout: 1800 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = globalThis.setTimeout(callback, 80);
  return () => globalThis.clearTimeout(timeoutId);
}

function scheduleReviewTreePersistence(callback: () => void) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 1600 });
    return;
  }

  globalThis.setTimeout(callback, 80);
}

function createReviewCardPerformanceUpdate(
  positionIndex: number,
  position: Position,
  grade: 1 | 2 | 3 | 4,
): ReviewCardPerformanceUpdate {
  return {
    positionIndex,
    fen: position.fen,
    grade,
    reviewedAt: new Date(),
  };
}

function applyReviewCardPerformanceUpdates(
  data: PracticeData,
  updates: readonly ReviewCardPerformanceUpdate[],
): PracticeData {
  if (updates.length === 0) return data;

  let positions = data.positions;
  let logs = data.logs;
  let changed = false;

  for (const update of updates) {
    const currentPosition = positions[update.positionIndex];
    if (!currentPosition || currentPosition.fen !== update.fen) continue;

    const previousReps = getReviewCardReps(currentPosition);
    const { card: newCard, log } = scheduleSm2Card(
      currentPosition.card,
      update.grade,
      update.reviewedAt,
    );
    if (!changed) {
      positions = [...positions];
      logs = [...logs];
      changed = true;
    }
    positions[update.positionIndex] = markReviewPositionAttempt(
      { ...currentPosition, card: newCard },
      update.reviewedAt.getTime(),
      previousReps,
    );
    logs.push({ ...log, fen: currentPosition.fen });
  }

  return changed ? { positions, logs } : data;
}

function getReviewCardReps(position: Position) {
  return Math.max(0, Math.trunc(Number(position.card.reps) || 0));
}

function markReviewPositionAttempt(
  position: Position,
  attemptedAt: number,
  attemptedCardReps: number,
): Position {
  if (position.mistakeReview) {
    return {
      ...position,
      mistakeReview: {
        ...position.mistakeReview,
        lastAttemptedAt: attemptedAt,
        lastAttemptedCardReps: attemptedCardReps,
      },
    };
  }

  return {
    ...position,
    openingReview: {
      ...position.openingReview,
      lastAttemptedAt: attemptedAt,
      lastAttemptedCardReps: attemptedCardReps,
    },
  };
}

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
  const onlineDatabaseUpdates = useAtomValue(onlineDatabaseUpdatesAtom);
  const autoUpdateState = isMistakeReview ? mistakeAutoUpdateState : openingAutoUpdateState;
  const practicing = practiceState.phase !== "idle";
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
  const clockHydrationRef = useRef("");
  const natureMigrationRef = useRef("");
  const latestReviewSaveRef = useRef<ReviewDeckSaveSnapshot | null>(null);
  const reviewSaveReadyRef = useRef(false);
  const pendingReviewCardUpdatesRef = useRef<ReviewCardPerformanceUpdate[]>([]);
  const pendingReviewTreePersistenceRef = useRef<Map<number, ReviewPositionTreeMatch>>(new Map());
  const reviewTreePersistenceScheduledRef = useRef(false);
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
  const deferredBackgroundPositions = useDeferredValue(deck.positions);
  const reviewPositionFenIndex = useMemo(
    () => createReviewPositionFenIndex(deck.positions),
    [deck.positions],
  );

  const activeReviewPositions = useMemo(
    () =>
      getReviewPositionsForPath(
        deck.positions,
        root,
        positionPath,
        scopedReviewPositionIndex,
        reviewPositionFenIndex,
      ),
    [deck.positions, positionPath, reviewPositionFenIndex, root, scopedReviewPositionIndex],
  );
  const activeReviewPosition = activeReviewPositions[activeReviewPositions.length - 1] ?? null;
  const activeReviewIndex = activeReviewPosition?.positionIndex ?? -1;
  const canGoPrevious = loaded && !loadError && activeReviewIndex > 0;
  const canGoNext =
    loaded &&
    !loadError &&
    deck.positions.length > 0 &&
    activeReviewIndex < deck.positions.length - 1;
  const missingMistakeLineDataCount = useMemo(
    () =>
      isMistakeReview
        ? deferredBackgroundPositions.filter(
            (position) =>
              position.mistakeReview &&
              ((!position.moveSequence?.trim() && position.mistakeReview.ply !== 0) ||
                position.mistakeReview.moveTimeSeconds == null ||
                position.mistakeReview.clockAfterSeconds == null),
          ).length
        : 0,
    [deferredBackgroundPositions, isMistakeReview],
  );
  const mistakeDatabaseUpdatedAt =
    isMistakeReview && deckInfo
      ? (onlineDatabaseUpdates[(deckInfo as MistakeReviewDeck).settings.playerDb]?.lastUpdatedAt ??
        0)
      : 0;

  const queueReviewCardPerformanceUpdate = useCallback(
    (positionIndex: number, position: Position, grade: 1 | 2 | 3 | 4) => {
      pendingReviewCardUpdatesRef.current.push(
        createReviewCardPerformanceUpdate(positionIndex, position, grade),
      );
    },
    [],
  );

  const flushPendingReviewCardUpdates = useCallback(
    (options: { transition?: boolean } = {}) => {
      const updates = pendingReviewCardUpdatesRef.current;
      if (updates.length === 0) return false;

      pendingReviewCardUpdatesRef.current = [];
      const snapshot = latestReviewSaveRef.current;
      if (snapshot) {
        const reviewData = applyReviewCardPerformanceUpdates(
          { positions: snapshot.positions, logs: snapshot.logs },
          updates,
        );
        latestReviewSaveRef.current = {
          ...snapshot,
          positions: reviewData.positions,
          logs: reviewData.logs,
        };
      }

      const applyUpdates = () => {
        setDeck((current) => applyReviewCardPerformanceUpdates(current, updates));
      };

      if (options.transition === false) {
        applyUpdates();
      } else {
        startTransition(applyUpdates);
      }

      return true;
    },
    [setDeck],
  );

  useEffect(() => {
    const flushForPageLifecycle = () => {
      flushPendingReviewCardUpdates({ transition: false });
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flushForPageLifecycle();
      }
    };

    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("beforeunload", flushForPageLifecycle);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("beforeunload", flushForPageLifecycle);
    };
  }, [flushPendingReviewCardUpdates]);

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
    reviewSaveReadyRef.current = false;
    latestReviewSaveRef.current = null;
    pendingReviewCardUpdatesRef.current = [];
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
    if (!isMistakeReview || !loaded || loadError || !deckInfo || practicing) return;

    const currentDeck: MistakeReviewDeck = {
      ...(deckInfo as MistakeReviewDeck),
      positions: deferredBackgroundPositions,
      logs: deck.logs as MistakeReviewDeck["logs"],
    };

    const migrationKey = `${deckPath}:${currentDeck.positions.length}:${currentDeck.updatedAt}`;
    if (natureMigrationRef.current === migrationKey) return;
    natureMigrationRef.current = migrationKey;

    let disposed = false;
    let migrationStarted = false;
    const timer = window.setTimeout(() => {
      migrationStarted = true;
      if (!needsMistakeReviewDeckNatureMigration(currentDeck)) return;

      void migrateMistakeReviewDeckNatureClassifications(currentDeck, { chunkSize: 4 })
        .then((result) => {
          if (disposed || result.updatedCount === 0) return;

          const migratedByKey = new Map(
            result.deck.positions.map((position) => [mistakeReviewPositionKey(position), position]),
          );
          startTransition(() => {
            setDeck((current) => ({
              positions: current.positions.map((position) => {
                const migrated = migratedByKey.get(mistakeReviewPositionKey(position));
                const migratedMistake = migrated?.mistakeReview;
                if (!migratedMistake || !position.mistakeReview) return position;
                if (
                  position.mistakeReview.natureClassifierVersion ===
                  migratedMistake.natureClassifierVersion
                ) {
                  return position;
                }

                return {
                  ...position,
                  tags: migrated.tags,
                  evidence: migrated.evidence,
                  mistakeReview: {
                    ...position.mistakeReview,
                    nature: migratedMistake.nature,
                    natureConfidence: migratedMistake.natureConfidence,
                    natureReason: migratedMistake.natureReason,
                    tacticalSignals: migratedMistake.tacticalSignals,
                    natureAspect: migratedMistake.natureAspect,
                    allowedNature: migratedMistake.allowedNature,
                    allowedNatureReason: migratedMistake.allowedNatureReason,
                    missedNature: migratedMistake.missedNature,
                    missedNatureReason: migratedMistake.missedNatureReason,
                    natureClassifierVersion: migratedMistake.natureClassifierVersion,
                  },
                };
              }),
              logs: current.logs,
            }));
          });
        })
        .catch(() => {
          // Classification migration is best-effort; new scans still save fresh metadata.
        });
    }, 300);

    return () => {
      disposed = true;
      if (!migrationStarted && natureMigrationRef.current === migrationKey) {
        natureMigrationRef.current = "";
      }
      window.clearTimeout(timer);
    };
  }, [
    deck.logs,
    deferredBackgroundPositions,
    deckInfo,
    deckPath,
    isMistakeReview,
    loadError,
    loaded,
    practicing,
    setDeck,
  ]);

  useEffect(() => {
    if (
      !isMistakeReview ||
      !loaded ||
      loadError ||
      !deckInfo ||
      practicing ||
      missingMistakeLineDataCount === 0
    ) {
      return;
    }

    const hydrationKey = `${deckPath}:${mistakeDatabaseUpdatedAt}:${missingMistakeLineDataCount}`;
    if (clockHydrationRef.current === hydrationKey) return;
    clockHydrationRef.current = hydrationKey;
    let disposed = false;
    let hydrationStarted = false;

    const timer = window.setTimeout(() => {
      hydrationStarted = true;
      if (disposed) return;
      const currentDeck = {
        ...(deckInfo as MistakeReviewDeck),
        positions: deferredBackgroundPositions,
        logs: deck.logs as MistakeReviewDeck["logs"],
      };

      hydrateMistakeReviewClockData(currentDeck)
        .then((result) => {
          if (disposed || result.updatedCount === 0) return;
          startTransition(() => {
            setDeckInfo(result.deck);
            setDeck({ positions: result.deck.positions, logs: result.deck.logs });
          });
        })
        .catch(() => {
          // Missing local databases should not block opening the deck.
        });
    }, 1500);

    return () => {
      disposed = true;
      if (!hydrationStarted && clockHydrationRef.current === hydrationKey) {
        clockHydrationRef.current = "";
      }
      window.clearTimeout(timer);
    };
  }, [
    deck.logs,
    deferredBackgroundPositions,
    deckInfo,
    deckPath,
    isMistakeReview,
    loadError,
    loaded,
    missingMistakeLineDataCount,
    mistakeDatabaseUpdatedAt,
    practicing,
    setDeck,
  ]);

  useEffect(() => {
    if (!loaded || !deckInfo || loadError) return undefined;

    latestReviewSaveRef.current = {
      deckInfo,
      deckPath,
      isMistakeReview,
      positions: deck.positions,
      logs: deck.logs,
    };

    if (!reviewSaveReadyRef.current) {
      reviewSaveReadyRef.current = true;
      return undefined;
    }

    return scheduleReviewDeckSave(() => {
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
    });
  }, [deck, deckInfo, deckPath, isMistakeReview, loadError, loaded, setDailyGoalDeckRevision]);

  useEffect(
    () => () => {
      const snapshot = latestReviewSaveRef.current;
      if (!snapshot) return;
      const pendingUpdates = pendingReviewCardUpdatesRef.current;
      pendingReviewCardUpdatesRef.current = [];
      const reviewData = applyReviewCardPerformanceUpdates(
        { positions: snapshot.positions, logs: snapshot.logs },
        pendingUpdates,
      );

      const nextDeck = {
        ...snapshot.deckInfo,
        positions: reviewData.positions,
        logs: reviewData.logs,
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

  const setMistakeTimeManagementSettings = useCallback(
    (timeManagement: MistakeReviewTimeManagementSettings) => {
      if (!isMistakeReview) return;
      setDeckInfo((current) => {
        if (!current) return current;

        const mistakeDeck = current as MistakeReviewDeck;
        const minMoveSeconds = Math.max(
          1,
          Math.min(3600, Math.round(timeManagement.minMoveSeconds)),
        );
        const nextTimeManagement = {
          ...mistakeDeck.settings.timeManagement,
          ...timeManagement,
          minMoveSeconds,
        };
        const updatedAt = Date.now();

        return {
          ...mistakeDeck,
          updatedAt,
          settings: {
            ...mistakeDeck.settings,
            timeManagement: nextTimeManagement,
          },
          autoUpdate: mistakeDeck.autoUpdate
            ? {
                ...mistakeDeck.autoUpdate,
                updatedAt,
                timeManagement: {
                  ...mistakeDeck.autoUpdate.timeManagement,
                  ...nextTimeManagement,
                },
              }
            : mistakeDeck.autoUpdate,
        } satisfies MistakeReviewDeck;
      });
    },
    [isMistakeReview],
  );

  const selectedToolTab = reviewWorkspaceTabs.has(currentTabSelected)
    ? currentTabSelected
    : "review";
  const selectedToolTabSupportsEngineOutput = selectedToolTab !== "compare";
  // Keep analysis requests alive anywhere the review workspace can show engine controls.
  // While a new hidden-answer card is waiting on the Review tab, avoid starting
  // interactive analysis that can contend with the next-card paint on large decks.
  const waitingOnHiddenReviewCard =
    practicing && selectedToolTab === "review" && practiceState.phase === "waiting";
  const evalListenerActive =
    !waitingOnHiddenReviewCard && (!practicing || selectedToolTabSupportsEngineOutput);

  useEffect(() => {
    if (selectedToolTab !== currentTabSelected) {
      setCurrentTabSelected(selectedToolTab);
    }
  }, [currentTabSelected, selectedToolTab, setCurrentTabSelected]);

  useEffect(() => {
    if (!loaded || loadError || !treeDirty || activeReviewPositions.length === 0) return;

    const persistReviewTrees =
      (nextReviewTrees: ReviewPositionTreeUpdate[]) => (current: PracticeData) => {
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
      };

    if (practicing) {
      for (const reviewPosition of activeReviewPositions) {
        pendingReviewTreePersistenceRef.current.set(reviewPosition.positionIndex, reviewPosition);
      }
      if (reviewTreePersistenceScheduledRef.current) return;
      reviewTreePersistenceScheduledRef.current = true;
      scheduleReviewTreePersistence(() => {
        const pendingReviewPositions = Array.from(pendingReviewTreePersistenceRef.current.values());
        pendingReviewTreePersistenceRef.current.clear();
        reviewTreePersistenceScheduledRef.current = false;
        const nextReviewTrees = pendingReviewPositions.map((reviewPosition) => ({
          ...reviewPosition,
          reviewTree: cloneReviewTreeNode(reviewPosition.node),
        }));
        startTransition(() => setDeck(persistReviewTrees(nextReviewTrees)));
      });
      return;
    }

    const nextReviewTrees = activeReviewPositions.map((reviewPosition) => ({
      ...reviewPosition,
      reviewTree: cloneReviewTreeNode(reviewPosition.node),
    }));
    setDeck(persistReviewTrees(nextReviewTrees));
  }, [activeReviewPositions, loadError, loaded, practicing, setDeck, treeDirty]);

  useEffect(() => {
    if (!isMistakeReview || practiceState.phase === "idle" || practiceState.phase === "waiting") {
      return;
    }

    setPracticePath(null);
  }, [isMistakeReview, practiceState.phase, setPracticePath]);

  useEffect(() => {
    if (!loaded || loadError || treeDirty) return;
    if (practiceState.phase === "waiting") return;

    const positionIndex = scopedReviewPositionIndex;
    const position =
      positionIndex !== undefined && positionIndex !== null && positionIndex >= 0
        ? deck.positions[positionIndex]
        : null;
    if (!position || !hasReviewPositionDeferredBoardDetails(position)) return;
    if (!sameReviewPosition(root.fen, position.fen) || root.children.length > 0) return;

    return scheduleReviewPositionPrewarm(() => {
      const currentState = store.getState();
      if (
        !sameReviewPosition(currentState.root.fen, position.fen) ||
        currentState.root.children.length > 0
      ) {
        return;
      }

      const path = loadReviewPositionOnBoard({
        position,
        headers,
        root: currentState.root,
        store,
        goToMove,
        setHeaders,
        setState,
      });

      if (practiceState.currentFen && sameReviewPosition(practiceState.currentFen, position.fen)) {
        setPracticePath(path);
      }
    });
  }, [
    deck.positions,
    goToMove,
    headers,
    loadError,
    loaded,
    practiceState.currentFen,
    practiceState.phase,
    root,
    scopedReviewPositionIndex,
    setHeaders,
    setPracticePath,
    setState,
    store,
    treeDirty,
  ]);

  return (
    <>
      <EvalListener active={evalListenerActive} />
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
          underBoard={
            !isMistakeReview && practiceState.phase !== "waiting" ? <ReviewMovesBox /> : null
          }
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
                  flex: "0 1 auto",
                },
                tab: {
                  display: "flex",
                  justifyContent: "center",
                  gap: "0.25rem",
                },
              }}
            >
              <Tabs.List grow>
                <Tabs.Tab
                  value="review"
                  leftSection={<IconTargetArrow size="1rem" />}
                  title="Review"
                >
                  Rev
                </Tabs.Tab>
                <Tabs.Tab
                  value="analysis"
                  leftSection={<IconZoomCheck size="1rem" />}
                  title="Analysis"
                >
                  Eval
                </Tabs.Tab>
                <Tabs.Tab
                  value="database"
                  leftSection={<IconDatabase size="1rem" />}
                  title="Database"
                >
                  DB
                </Tabs.Tab>
                <Tabs.Tab
                  value="plan-explorer"
                  leftSection={<IconRoute size="1rem" />}
                  title="Plan Explorer"
                >
                  Plan
                </Tabs.Tab>
                <Tabs.Tab
                  value="engine-plans"
                  leftSection={<IconBulb size="1rem" />}
                  title="Engine Plans"
                >
                  Eng
                </Tabs.Tab>
                <Tabs.Tab
                  value="compare"
                  leftSection={<IconGitCompare size="1rem" />}
                  title="Compare"
                >
                  Vs
                </Tabs.Tab>
                <Tabs.Tab value="info" leftSection={<IconInfoCircle size="1rem" />} title="Info">
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
                    onMistakeTimeManagementSettingsChange={setMistakeTimeManagementSettings}
                    boardMoveCandidate={boardMoveCandidate}
                    onClearBoardMoveCandidate={() => setBoardMoveCandidate(null)}
                    onLoadPosition={loadDeckPosition}
                    onQueueCardPerformanceUpdate={queueReviewCardPerformanceUpdate}
                    onFlushCardPerformanceUpdates={flushPendingReviewCardUpdates}
                    reviewPositionFenIndex={reviewPositionFenIndex}
                    loadError={loadError}
                    loaded={loaded}
                  />
                </EngineDockedPanel>
              </Tabs.Panel>
              <Tabs.Panel value="analysis" flex={1} style={scrollablePanelStyle}>
                <DeferredPanel>
                  <AnalysisPanel />
                </DeferredPanel>
              </Tabs.Panel>
              <Tabs.Panel value="database" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <DeferredPanel>
                    <DatabasePanel />
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
              <Tabs.Panel value="info" flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
                <EngineDockedPanel>
                  <DeferredPanel>
                    <InfoPanel />
                  </DeferredPanel>
                </EngineDockedPanel>
              </Tabs.Panel>
            </Tabs>
          </ResponsivePanel>
        </Paper>
      </Portal>
    </>
  );
}

function ReviewMovesBox({ rightPanel = false }: { rightPanel?: boolean }) {
  if (rightPanel) {
    return (
      <Stack gap={4}>
        <GameNotation topBar compact grow={false} className={classes.reviewMovesPanel} />
        <MoveControls readOnly />
      </Stack>
    );
  }

  return (
    <Stack
      h="100%"
      gap="xs"
      style={{
        minHeight: 0,
        flexShrink: 0,
      }}
    >
      <DetachedEval />
      <GameNotation topBar />
      <MoveControls />
    </Stack>
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
  deferBoardDetails = false,
}: {
  position: Position;
  headers: GameHeaders;
  root: TreeNode;
  store: TreeStore;
  goToMove: (move: number[]) => void;
  setHeaders: (headers: GameHeaders) => void;
  setState: (state: TreeState) => void;
  deferBoardDetails?: boolean;
}) {
  if (deferBoardDetails && hasReviewPositionDeferredBoardDetails(position)) {
    const reviewPosition = createReviewPositionFenState(position, headers, {
      includeReviewTree: false,
    });
    setState(reviewPosition.state);
    return reviewPosition.path;
  }

  const reviewLine = getReviewPositionLineState(position, headers);
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

function getReviewPositionLineState(position: Position, headers: GameHeaders) {
  const headersKey = reviewLineHeadersCacheKey(headers);
  const cacheKey = `${position.fen}|${position.moveSequence ?? ""}|${headersKey}`;

  const cached = reviewPositionLineStateCache.get(cacheKey);
  if (cached && reviewLineStateCacheEntryMatches(cached, position)) {
    return {
      path: [...cached.path],
      state: cloneTreeState(cached.state),
    };
  }

  const reviewLine = createReviewPositionLineState(position, headers);
  if (!reviewLine) {
    reviewPositionLineStateCache.delete(cacheKey);
    return null;
  }

  reviewPositionLineStateCache.set(cacheKey, {
    path: [...reviewLine.path],
    state: cloneTreeState(reviewLine.state),
    reviewTree: position.reviewTree,
    annotations: position.annotations,
    comment: position.comment,
    shapes: position.shapes,
  });

  return {
    path: [...reviewLine.path],
    state: reviewLine.state,
  };
}

function reviewLineStateCacheEntryMatches(entry: ReviewLineStateCacheEntry, position: Position) {
  // Reference checks: deck updates spread Position objects, so unchanged
  // annotation state keeps the same references.
  return (
    entry.reviewTree === position.reviewTree &&
    entry.annotations === position.annotations &&
    entry.comment === position.comment &&
    entry.shapes === position.shapes
  );
}

function reviewLineHeadersCacheKey(headers: GameHeaders) {
  return [
    headers.fen,
    headers.orientation ?? "",
    headers.white,
    headers.black,
    headers.result,
    headers.date ?? "",
    headers.time_control ?? "",
  ].join("|");
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
    return createReviewPositionFenState(position, headers);
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

function hasReviewPositionDeferredBoardDetails(position: Position) {
  return Boolean(position.moveSequence?.trim() || position.reviewTree);
}

function createReviewPositionFenState(
  position: Position,
  headers: GameHeaders,
  options: { includeReviewTree?: boolean } = {},
) {
  const tree = defaultTree(position.fen);
  tree.headers = getReviewPositionHeaders(position, headers, tree.root.fen);
  tree.dirty = false;
  applyReviewPositionToNode(tree.root, position, options);
  return { state: tree, path: [] };
}

function applyReviewPositionToNode(
  node: TreeNode,
  position: Position,
  options: { includeReviewTree?: boolean } = {},
) {
  const reviewTree =
    options.includeReviewTree !== false && position.reviewTree
      ? cloneReviewTreeNode(position.reviewTree)
      : null;
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
    // Compared via JSON.stringify — serializing the tree directly is enough,
    // cloning it first would just double the work.
    reviewTree: position.reviewTree ?? undefined,
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
    move: node.move ? { ...node.move } : null,
    san: node.san ?? null,
    children: node.children.map(cloneReviewTreeNode),
    score: node.score ? structuredClone(node.score) : null,
    depth: node.depth ?? null,
    halfMoves: node.halfMoves,
    shapes: node.shapes?.length ? node.shapes.map((shape) => ({ ...shape })) : [],
    annotations: [...(node.annotations ?? [])],
    comment: node.comment ?? "",
    ...(node.clock !== undefined ? { clock: node.clock } : {}),
  };
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
  label:
    | NonNullable<PracticeState["mistakeReviewLabel"] | PracticeState["moveQualityLabel"]>
    | undefined,
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

function normalizeReviewPracticeMoveSan(move: string | null | undefined) {
  return (move ?? "")
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .replace(/[!?]+/g, "");
}

function reviewPracticeMovesSameSan(
  firstMove: string | null | undefined,
  secondMove: string | null | undefined,
) {
  const first = normalizeReviewPracticeMoveSan(firstMove);
  const second = normalizeReviewPracticeMoveSan(secondMove);
  return Boolean(first && second && first === second);
}

function formatOpeningPracticeFeedbackTitle(
  practiceState: PracticeState,
  attemptLabel: PracticeState["moveQualityLabel"],
  fallback: string,
) {
  if (!attemptLabel) return fallback;

  if (attemptLabel === "good" && practiceState.followedRepertoire === false) {
    return "Good move, not repertoire";
  }

  if (attemptLabel === "okay" && practiceState.followedRepertoire === false) {
    return "Okay move, not repertoire";
  }

  if (attemptLabel === "best" && practiceState.followedRepertoire === true) {
    return "Correct repertoire move";
  }

  return mistakeReviewSeverityLabel(attemptLabel);
}

function formatOpeningPracticeFeedbackDetail(
  practiceState: PracticeState,
  source: string | null,
  attemptLabel: PracticeState["moveQualityLabel"],
) {
  const repertoireMove = practiceState.repertoireMove ?? practiceState.answer;
  const bestMove = practiceState.bestMove;
  const parts: string[] = [];

  if (repertoireMove) {
    if (practiceState.followedRepertoire === false && practiceState.playedMove) {
      parts.push(
        `Repertoire move: ${repertoireMove}. You played ${practiceState.playedMove}, so this is a deviation.`,
      );
    } else if (practiceState.followedRepertoire === true) {
      parts.push(`Repertoire move: ${repertoireMove}. You stayed in repertoire.`);
    } else {
      parts.push(`Repertoire move: ${repertoireMove}.`);
    }
  }

  const shouldShowObjectiveBest =
    bestMove &&
    (source !== "Saved answer" || !reviewPracticeMovesSameSan(bestMove, repertoireMove));

  if (shouldShowObjectiveBest) {
    if (
      attemptLabel === "best" &&
      practiceState.playedMove &&
      reviewPracticeMovesSameSan(bestMove, practiceState.playedMove)
    ) {
      parts.push(`${source ?? "Engine"} ranks ${practiceState.playedMove} best.`);
    } else if (
      (attemptLabel === "good" || attemptLabel === "okay") &&
      practiceState.followedRepertoire === false &&
      practiceState.playedMove
    ) {
      const movePhrase = attemptLabel === "good" ? "Good move" : "Playable move";
      parts.push(
        `${movePhrase}: ${practiceState.playedMove}, but ${source ?? "Engine"} has ${bestMove} as best.`,
      );
    } else {
      parts.push(`${source ?? "Engine"} has ${bestMove} as best.`);
    }
  }

  if (practiceState.moveLossCp !== undefined && attemptLabel !== "best") {
    parts.push(
      `${Math.round(practiceState.moveLossCp)} cp behind${
        practiceState.chessDbRank ? `, rank ${practiceState.chessDbRank}` : ""
      }.`,
    );
  }

  return parts.join(" ");
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
  onMistakeTimeManagementSettingsChange,
  boardMoveCandidate,
  onClearBoardMoveCandidate,
  onLoadPosition,
  onQueueCardPerformanceUpdate,
  onFlushCardPerformanceUpdates,
  reviewPositionFenIndex,
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
  onMistakeTimeManagementSettingsChange?: (settings: MistakeReviewTimeManagementSettings) => void;
  boardMoveCandidate: ReviewBoardMoveCandidate | null;
  onClearBoardMoveCandidate: () => void;
  onLoadPosition: (positionIndex: number) => void;
  onQueueCardPerformanceUpdate: (
    positionIndex: number,
    position: Position,
    grade: 1 | 2 | 3 | 4,
  ) => void;
  onFlushCardPerformanceUpdates: (options?: { transition?: boolean }) => boolean;
  reviewPositionFenIndex: ReturnType<typeof createReviewPositionFenIndex>;
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
  const [practiceState, setPracticeState] = useAtom(practiceStateAtom);
  const [sessionStats, setSessionStats] = useAtom(practiceSessionStatsAtom);
  const setSessionStatsInTransition = useCallback<typeof setSessionStats>(
    (value) => {
      startTransition(() => {
        setSessionStats(value);
      });
    },
    [setSessionStats],
  );
  const practicing = practiceState.phase !== "idle";
  const [summaryPositionsSnapshot, setSummaryPositionsSnapshot] = useState(deck.positions);
  useEffect(() => {
    if (!loaded || !practicing) {
      setSummaryPositionsSnapshot(deck.positions);
    }
  }, [deck.positions, loaded, practicing]);
  const deferredSummaryPositions = useDeferredValue(summaryPositionsSnapshot);
  const summaryPositions = loaded ? deferredSummaryPositions : deck.positions;
  const stats = useMemo(() => getStats(summaryPositions), [summaryPositions]);
  const dailyProgress = useMemo(() => {
    if (isMistakeReview && mistakeDailySettings) {
      return getMistakeReviewDailyProgress(summaryPositions, mistakeDailySettings);
    }
    if (!isMistakeReview && openingDailySettings) {
      return getOpeningReviewDailyProgress(summaryPositions, openingDailySettings);
    }
    return null;
  }, [summaryPositions, isMistakeReview, mistakeDailySettings, openingDailySettings]);
  const dailyScopeIndices = useMemo(() => {
    if (isMistakeReview && mistakeDailySettings) {
      return getMistakeReviewDailyBatchIndices(summaryPositions, mistakeDailySettings);
    }
    if (!isMistakeReview && openingDailySettings) {
      return getOpeningReviewDailyBatchIndices(summaryPositions, openingDailySettings);
    }
    return [];
  }, [summaryPositions, isMistakeReview, mistakeDailySettings, openingDailySettings]);
  const mistakePhaseCounts = useMemo(
    () => (isMistakeReview ? getMistakeReviewPhaseCounts(summaryPositions) : null),
    [summaryPositions, isMistakeReview],
  );
  const mistakeNatureCounts = useMemo(
    () => (isMistakeReview ? getMistakeReviewNatureCounts(summaryPositions) : null),
    [summaryPositions, isMistakeReview],
  );
  const timeManagementMinMoveSeconds =
    mistakeTimeManagementSettings?.minMoveSeconds ??
    DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds;
  const timeManagementThresholdText =
    formatMistakeReviewMoveTime(timeManagementMinMoveSeconds) ?? `${timeManagementMinMoveSeconds}s`;
  const timeManagementSummary = useMemo(
    () =>
      isMistakeReview
        ? getMistakeReviewTimeManagementSummary(summaryPositions, {
            minMoveSeconds: timeManagementMinMoveSeconds,
          })
        : { readyCount: 0, clockDataCount: 0 },
    [summaryPositions, isMistakeReview, timeManagementMinMoveSeconds],
  );
  const timeManagementScopeCount = timeManagementSummary.readyCount;
  const timeManagementClockDataCount = timeManagementSummary.clockDataCount;
  const openingPlanGapScopeIndices = useMemo(
    () => (isMistakeReview ? [] : getOpeningReviewPlanGapTrainingIndices(summaryPositions)),
    [summaryPositions, isMistakeReview],
  );
  const setInvisible = useSetAtom(currentInvisibleAtom);
  const setShowComments = useSetAtom(currentShowCommentsAtom);
  const setEvalOpen = useSetAtom(currentEvalOpenAtom);
  const setDailyGoalCompletionPrompt = useSetAtom(dailyGoalCompletionPromptAtom);
  const setCardStartTime = useSetAtom(practiceCardStartTimeAtom);
  const practiceAutoDifficulty = useAtomValue(practiceAutoDifficultyAtom);
  const hideMovesDuringPractice = useAtomValue(openingReviewHideMovesDuringPracticeAtom);
  const [positionsOpen, setPositionsOpen] = useToggle();
  const [panelView, setPanelView] = useState<OpeningReviewPanelView>(initialView);
  const [dailySettingsOpen, setDailySettingsOpen] = useState(false);
  const [timeManagementSettingsOpen, setTimeManagementSettingsOpen] = useState(false);
  const [mistakeMovesOpen, setMistakeMovesOpen] = useState(true);
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
    const positionIndex = findReviewPositionIndexForFen(
      deck.positions,
      boardMoveCandidate.fen,
      undefined,
      reviewPositionFenIndex,
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
    reviewPositionFenIndex,
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
    practiceState.phase !== "waiting" &&
    playedOverrideCandidate &&
    playedOverridePosition &&
    !playedMoveMatchesBestValidatedMove &&
    !isOpeningReviewSavedMove(playedOverridePosition, playedOverrideCandidate);
  const currentPracticePositionIndex =
    practiceState.positionIndex ??
    (practiceState.currentFen
      ? findReviewPositionIndexForFen(
          deck.positions,
          practiceState.currentFen,
          undefined,
          reviewPositionFenIndex,
        )
      : -1);
  const currentPracticePosition =
    practiceState.phase !== "idle" && currentPracticePositionIndex >= 0
      ? (deck.positions[currentPracticePositionIndex] ?? null)
      : null;
  const revealCurrentPracticeAnswer = practiceState.phase !== "waiting";
  useEffect(() => {
    if (!loaded || practiceState.phase === "idle" || deck.positions.length === 0) return;

    const indices = getReviewPrewarmPositionIndices(
      deck.positions,
      sessionStats,
      currentPracticePositionIndex,
    );
    if (indices.length === 0) return;

    return scheduleReviewPositionPrewarm(() => {
      for (const index of indices) {
        const position = deck.positions[index];
        if (
          position &&
          (practiceState.phase !== "waiting" || !hasReviewPositionDeferredBoardDetails(position))
        ) {
          getReviewPositionLineState(position, headers);
        }
      }
    });
  }, [
    currentPracticePositionIndex,
    deck.positions,
    headers,
    loaded,
    practiceState.phase,
    sessionStats,
  ]);
  const attemptPosition =
    (practiceState.phase === "correct" || practiceState.phase === "incorrect") &&
    practiceState.positionIndex !== undefined
      ? (deck.positions[practiceState.positionIndex] ?? null)
      : null;
  const attemptPlayedMove = practiceState.playedMove ?? null;
  const currentBoardPosition = useMemo(() => {
    const positionIndex = findReviewPositionIndexForFen(
      deck.positions,
      currentFen,
      undefined,
      reviewPositionFenIndex,
    );
    return positionIndex >= 0 ? (deck.positions[positionIndex] ?? null) : null;
  }, [currentFen, deck.positions, reviewPositionFenIndex]);
  const mistakeReviewInfoPosition = isMistakeReview
    ? (attemptPosition ??
      currentPracticePosition ??
      currentBoardPosition ??
      deck.positions.find((position) => position.mistakeReview) ??
      null)
    : null;

  const updateCorrectMove = useCallback(
    (positionIndex: number, move: { san: string; uci: string }) => {
      onFlushCardPerformanceUpdates({ transition: false });
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
        setSessionStatsInTransition((current) => ({
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
      onFlushCardPerformanceUpdates,
      practiceState.phase,
      practiceState.positionIndex,
      setDeck,
      setPracticeState,
      setSessionStatsInTransition,
    ],
  );

  const stopPractice = useCallback(() => {
    onFlushCardPerformanceUpdates({ transition: false });
    setPracticeState({ phase: "idle" });
    setPracticePath(null);
    setInvisible(false);
    setShowComments(true);
    setEvalOpen(true);
    onClearBoardMoveCandidate();
    activeDailyGoalSessionRef.current = null;
  }, [
    onFlushCardPerformanceUpdates,
    onClearBoardMoveCandidate,
    setEvalOpen,
    setInvisible,
    setPracticePath,
    setPracticeState,
    setShowComments,
  ]);

  const completePracticeSession = useCallback(() => {
    const dailyGoalSession = activeDailyGoalSessionRef.current;
    onFlushCardPerformanceUpdates({ transition: false });
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
    onFlushCardPerformanceUpdates,
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
      options?: { positions?: Position[]; scopeIndices?: number[]; excludePositionIndex?: number },
    ) => {
      const positions = options?.positions ?? deck.positions;
      if (positions.length === 0) {
        completePracticeSession();
        return;
      }

      const queueKind = nextStats?.queueKind ?? sessionStats.queueKind;
      const mode = nextStats?.mode ?? sessionStats.mode;
      const remaining = nextStats?.remainingPositions ?? sessionStats.remainingPositions;
      const queueSession = { mode, remainingPositions: remaining, queueKind };
      const queueOffset = clampReviewQueueOffset(
        nextStats?.queueOffset ?? sessionStats.queueOffset,
        getReviewQueueLength(queueSession, positions.length),
      );
      const excludePositionIndex = options?.excludePositionIndex;
      let positionIndex = -1;
      if (isReviewAllPositionQueue(queueSession)) {
        positionIndex = getNextAllReviewPositionIndex(positions, queueOffset, excludePositionIndex);
      } else if (remaining.length > 0) {
        positionIndex = getNextQueuedReviewPositionIndex(
          remaining,
          queueOffset,
          excludePositionIndex,
        );
      } else {
        positionIndex = getNextDueOpeningReviewPositionIndex(
          positions,
          options?.scopeIndices,
          excludePositionIndex,
        );
      }
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
        deferBoardDetails: true,
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
      sessionStats.queueKind,
      sessionStats.queueOffset,
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

    onFlushCardPerformanceUpdates({ transition: false });
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
    const nextQueueOffset =
      nextRemainingPositions.length > 0
        ? clampReviewQueueOffset(sessionStats.queueOffset, nextRemainingPositions.length)
        : sessionStats.queueOffset;

    setDeck((current) => ({
      ...current,
      positions: current.positions.filter(
        (_, positionIndex) => positionIndex !== currentPracticePositionIndex,
      ),
    }));

    if (sessionStats.mode === "full" || hasScopedRemainingPositions) {
      setSessionStatsInTransition((current) => ({
        ...current,
        remainingPositions: nextRemainingPositions,
        queueOffset: nextQueueOffset,
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
        ? {
            mode: sessionStats.mode,
            remainingPositions: nextRemainingPositions,
            queueOffset: nextQueueOffset,
          }
        : undefined,
      { positions: nextPositions },
    );
  }, [
    currentPracticePosition,
    currentPracticePositionIndex,
    deck.positions,
    newPractice,
    onClearBoardMoveCandidate,
    onFlushCardPerformanceUpdates,
    sessionStats.mode,
    sessionStats.queueOffset,
    sessionStats.remainingPositions,
    setDeck,
    setSessionStatsInTransition,
  ]);

  const startDuePractice = useCallback(
    (
      scopeIndices?: number[],
      scopeLabel?: string,
      options?: { dailyGoalSession?: OpeningReviewInitialPractice },
    ) => {
      const remainingPositions = scopeIndices ?? getDueReviewPositionIndices(deck.positions);
      if (remainingPositions.length === 0) {
        notifications.show({
          title: "No due positions to train",
          message: scopeIndices
            ? "The selected opening and colour filters do not have any due positions."
            : "This deck does not have any due positions right now.",
          color: "yellow",
        });
        return;
      }

      activeDailyGoalSessionRef.current = options?.dailyGoalSession ?? null;
      const nextStats = {
        mode: "anki" as const,
        remainingPositions,
        queueKind: "indices" as const,
        queueOffset: 0,
        correct: 0,
        incorrect: 0,
        streak: 0,
        bestStreak: 0,
      };
      setSessionStatsInTransition((current) => ({ ...current, ...nextStats }));
      newPractice(nextStats, { scopeIndices: remainingPositions });
      if (scopeIndices) {
        notifications.show({
          title: "Focused review started",
          message: `Training due ${
            isMistakeReview ? "mistakes" : "gaps"
          } in ${scopeLabel ?? "the selected filter"}.`,
          color: "blue",
        });
      }
    },
    [deck.positions, isMistakeReview, newPractice, setSessionStatsInTransition],
  );

  const startFullPractice = useCallback(
    (
      scopeIndices?: number[],
      scopeLabel?: string,
      options?: { dailyGoalSession?: OpeningReviewInitialPractice },
    ) => {
      const allPositions = scopeIndices === undefined;
      const remainingPositions = scopeIndices ?? [];
      const positionCount = allPositions ? deck.positions.length : remainingPositions.length;
      if (positionCount === 0) {
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
        queueKind: allPositions ? ("all" as const) : ("indices" as const),
        queueOffset: 0,
        correct: 0,
        incorrect: 0,
        streak: 0,
        bestStreak: 0,
      };
      setSessionStatsInTransition((current) => ({ ...current, ...nextStats }));
      newPractice(nextStats);
      if (scopeIndices) {
        notifications.show({
          title: "Focused review started",
          message: `Training ${positionCount} ${isMistakeReview ? "mistake" : "gap"}${
            positionCount === 1 ? "" : "s"
          } in ${scopeLabel ?? "the selected filter"}.`,
          color: "blue",
        });
      }
    },
    [deck.positions, isMistakeReview, newPractice, setSessionStatsInTransition],
  );

  const startOpeningPlanGapPractice = useCallback(() => {
    if (isMistakeReview) return;

    if (openingPlanGapScopeIndices.length === 0) {
      notifications.show({
        title: "No plan gaps to train",
        message: "This review deck does not have any saved opening plan gaps yet.",
        color: "yellow",
      });
      return;
    }

    const nextStats = {
      mode: "srs-list" as const,
      remainingPositions: openingPlanGapScopeIndices,
      queueKind: "indices" as const,
      queueOffset: 0,
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStatsInTransition((current) => ({ ...current, ...nextStats }));
    newPractice(nextStats);
    notifications.show({
      title: "Plan gap training started",
      message: `Training ${openingPlanGapScopeIndices.length} opening plan gap${
        openingPlanGapScopeIndices.length === 1 ? "" : "s"
      }.`,
      color: "blue",
    });
  }, [isMistakeReview, newPractice, openingPlanGapScopeIndices, setSessionStatsInTransition]);

  const startMistakePhasePractice = useCallback(
    (phase: MistakeReviewPhase) => {
      if (!isMistakeReview) return;

      const label =
        MISTAKE_REVIEW_PHASES.find((phaseOption) => phaseOption.id === phase)?.label ?? "Phase";
      const remainingPositions = getMistakeReviewPhaseBatchIndices(deck.positions, phase);

      if (remainingPositions.length === 0) {
        const hasPhasePositions = deck.positions.some(
          (position) => position.mistakeReview && getMistakeReviewPhase(position) === phase,
        );
        notifications.show({
          title: hasPhasePositions ? "Nothing ready to train" : "No positions to train",
          message: hasPhasePositions
            ? `No due or new ${label.toLowerCase()} mistakes are ready right now.`
            : `No ${label.toLowerCase()} mistakes found in this set yet.`,
          color: "yellow",
        });
        return;
      }

      const nextStats = {
        mode: "srs-list" as const,
        remainingPositions,
        queueKind: "indices" as const,
        queueOffset: 0,
        correct: 0,
        incorrect: 0,
        streak: 0,
        bestStreak: 0,
      };
      setSessionStatsInTransition((current) => ({ ...current, ...nextStats }));
      newPractice(nextStats);
      notifications.show({
        title: "Train by phase started",
        message: `Training ${remainingPositions.length} ${label.toLowerCase()} mistake${
          remainingPositions.length === 1 ? "" : "s"
        }.`,
        color: "blue",
      });
    },
    [deck.positions, isMistakeReview, newPractice, setSessionStatsInTransition],
  );

  const startMistakeNaturePractice = useCallback(
    (nature: MistakeReviewNature) => {
      if (!isMistakeReview) return;

      const label =
        MISTAKE_REVIEW_NATURES.find((natureOption) => natureOption.id === nature)?.label ??
        "Mistake type";
      const remainingPositions = getMistakeReviewNatureBatchIndices(deck.positions, nature);

      if (remainingPositions.length === 0) {
        const hasNaturePositions = deck.positions.some(
          (position) => position.mistakeReview && getMistakeReviewNature(position) === nature,
        );
        notifications.show({
          title: hasNaturePositions ? "Nothing ready to train" : "No positions to train",
          message: hasNaturePositions
            ? `No due or new ${label.toLowerCase()} mistakes are ready right now.`
            : `No ${label.toLowerCase()} mistakes found in this set yet.`,
          color: "yellow",
        });
        return;
      }

      const nextStats = {
        mode: "srs-list" as const,
        remainingPositions,
        queueKind: "indices" as const,
        queueOffset: 0,
        correct: 0,
        incorrect: 0,
        streak: 0,
        bestStreak: 0,
      };
      setSessionStatsInTransition((current) => ({ ...current, ...nextStats }));
      newPractice(nextStats);
      notifications.show({
        title: "Train by type started",
        message: `Training ${remainingPositions.length} ${label.toLowerCase()} mistake${
          remainingPositions.length === 1 ? "" : "s"
        }.`,
        color: mistakeReviewNatureColor(nature),
      });
    },
    [deck.positions, isMistakeReview, newPractice, setSessionStatsInTransition],
  );

  const startMistakeTimeManagementPractice = useCallback(() => {
    if (!isMistakeReview) return;

    const remainingPositions = getMistakeReviewTimeManagementBatchIndices(deck.positions, {
      minMoveSeconds: timeManagementMinMoveSeconds,
    });

    if (remainingPositions.length === 0) {
      notifications.show({
        title: "No time-management cards yet",
        message:
          timeManagementClockDataCount === 0
            ? "This deck does not have long-think clock data yet. Create or update it from online games with clock comments."
            : `No due or new long-think mistakes at ${timeManagementThresholdText}+ are ready right now.`,
        color: "yellow",
      });
      return;
    }

    const nextStats = {
      mode: "srs-list" as const,
      remainingPositions,
      queueKind: "indices" as const,
      queueOffset: 0,
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStatsInTransition((current) => ({ ...current, ...nextStats }));
    newPractice(nextStats);
    notifications.show({
      title: "Time management training started",
      message: `Training ${remainingPositions.length} due or new long-think mistake${
        remainingPositions.length === 1 ? "" : "s"
      }.`,
      color: "orange",
    });
  }, [
    deck.positions,
    isMistakeReview,
    newPractice,
    setSessionStatsInTransition,
    timeManagementClockDataCount,
    timeManagementMinMoveSeconds,
    timeManagementThresholdText,
  ]);

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
        dailyGoalSession: initialPractice.source === "daily-goals" ? initialPractice : undefined,
      });
    } else {
      startFullPractice(indices, initialPractice.label, {
        dailyGoalSession: initialPractice.source === "daily-goals" ? initialPractice : undefined,
      });
    }
  }, [deck.positions.length, initialPractice, loaded, startDuePractice, startFullPractice]);

  function handleQualityRating(grade: 1 | 2 | 3 | 4) {
    const canRateIncorrect =
      practiceState.phase === "incorrect" &&
      (isMistakeReview || Boolean(practiceState.moveQualityLabel));
    if (
      (practiceState.phase !== "correct" && !canRateIncorrect) ||
      practiceState.positionIndex === undefined
    ) {
      return;
    }

    const positionIndex = practiceState.positionIndex;
    const position = deck.positions[positionIndex];
    if (!position) return;

    const queueLength = getReviewQueueLength(sessionStats, deck.positions.length);
    const advancesStableQueue = queueLength > 0;
    const nextQueueOffset = advancesStableQueue
      ? clampReviewQueueOffset(sessionStats.queueOffset, queueLength) + 1
      : sessionStats.queueOffset;
    const remainingPositions = sessionStats.remainingPositions;
    const wasCorrect = practiceState.phase === "correct";

    onQueueCardPerformanceUpdate(positionIndex, position, grade);
    setSessionStatsInTransition((current) => ({
      ...current,
      remainingPositions,
      queueOffset: nextQueueOffset,
      correct: wasCorrect ? current.correct + 1 : current.correct,
      incorrect: wasCorrect ? current.incorrect : current.incorrect + 1,
      streak: wasCorrect ? current.streak + 1 : 0,
      bestStreak: wasCorrect
        ? Math.max(current.bestStreak, current.streak + 1)
        : current.bestStreak,
    }));
    newPractice(
      { mode: sessionStats.mode, remainingPositions, queueOffset: nextQueueOffset },
      { excludePositionIndex: positionIndex },
    );
  }

  function skipCard() {
    const wasIncorrect = practiceState.phase === "incorrect";
    const queueLength = getReviewQueueLength(sessionStats, deck.positions.length);
    if (queueLength > 0) {
      const nextQueueOffset = clampReviewQueueOffset(sessionStats.queueOffset, queueLength) + 1;
      setSessionStatsInTransition((current) => ({
        ...current,
        queueOffset: nextQueueOffset,
        incorrect: wasIncorrect ? current.incorrect + 1 : current.incorrect,
        streak: wasIncorrect ? 0 : current.streak,
      }));
      newPractice({
        remainingPositions: sessionStats.remainingPositions,
        mode: sessionStats.mode,
        queueOffset: nextQueueOffset,
      });
      return;
    }

    if (wasIncorrect) {
      setSessionStatsInTransition((current) => ({
        ...current,
        incorrect: current.incorrect + 1,
        streak: 0,
      }));
    }
    newPractice(undefined, {
      excludePositionIndex: practiceState.positionIndex,
    });
  }

  const advanceFullPracticeCorrect = useCallback(() => {
    const queueLength = getReviewQueueLength(sessionStats, deck.positions.length);
    const nextQueueOffset = clampReviewQueueOffset(sessionStats.queueOffset, queueLength) + 1;
    setSessionStatsInTransition((current) => ({
      ...current,
      queueOffset: nextQueueOffset,
      correct: current.correct + 1,
      streak: current.streak + 1,
      bestStreak: Math.max(current.bestStreak, current.streak + 1),
    }));
    newPractice({
      remainingPositions: sessionStats.remainingPositions,
      mode: "full",
      queueOffset: nextQueueOffset,
    });
  }, [deck.positions.length, newPractice, sessionStats, setSessionStatsInTransition]);

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
          onQueueCardPerformanceUpdate(positionIndex, position, 3);
        }
        setSessionStatsInTransition((current) => ({
          ...current,
          correct: current.correct + 1,
          streak: current.streak + 1,
          bestStreak: Math.max(current.bestStreak, current.streak + 1),
        }));
      }
    }

    if (sessionStats.mode === "full") {
      const queueLength = getReviewQueueLength(sessionStats, deck.positions.length);
      const nextQueueOffset = clampReviewQueueOffset(sessionStats.queueOffset, queueLength) + 1;
      setSessionStatsInTransition((current) => ({
        ...current,
        queueOffset: nextQueueOffset,
      }));
      newPractice({
        remainingPositions: sessionStats.remainingPositions,
        mode: "full",
        queueOffset: nextQueueOffset,
      });
      return;
    }

    const queueLength = getReviewQueueLength(sessionStats, deck.positions.length);
    if (queueLength > 0) {
      const nextQueueOffset = clampReviewQueueOffset(sessionStats.queueOffset, queueLength) + 1;
      setSessionStatsInTransition((current) => ({
        ...current,
        queueOffset: nextQueueOffset,
      }));
      newPractice(
        {
          remainingPositions: sessionStats.remainingPositions,
          mode: sessionStats.mode,
          queueOffset: nextQueueOffset,
        },
        { excludePositionIndex: practiceState.positionIndex },
      );
      return;
    }

    newPractice(undefined, {
      excludePositionIndex: practiceState.positionIndex,
    });
  }, [
    deck.positions,
    newPractice,
    onQueueCardPerformanceUpdate,
    practiceState.phase,
    practiceState.positionIndex,
    practiceState.resultRecorded,
    sessionStats,
    setSessionStatsInTransition,
  ]);

  const canRateAttempt =
    (isMistakeReview || sessionStats.mode !== "full") &&
    (practiceState.phase === "correct" ||
      (practiceState.phase === "incorrect" &&
        (isMistakeReview || Boolean(practiceState.moveQualityLabel))));

  useEffect(() => {
    if (isMistakeReview || practiceState.phase !== "correct") return undefined;

    if (sessionStats.mode === "full") {
      return undefined;
    }

    if (practiceAutoDifficulty !== "none" && practiceState.positionIndex !== undefined) {
      const positionIndex = practiceState.positionIndex;
      const timer = window.setTimeout(() => {
        const queueLength = getReviewQueueLength(sessionStats, deck.positions.length);
        const advancesStableQueue = queueLength > 0;
        const nextQueueOffset = advancesStableQueue
          ? clampReviewQueueOffset(sessionStats.queueOffset, queueLength) + 1
          : sessionStats.queueOffset;
        const remainingPositions = advancesStableQueue
          ? sessionStats.remainingPositions
          : sessionStats.remainingPositions;
        const position = deck.positions[positionIndex];
        if (!position) return;
        onQueueCardPerformanceUpdate(
          positionIndex,
          position,
          Number(practiceAutoDifficulty) as 1 | 2 | 3 | 4,
        );
        setSessionStatsInTransition((current) => ({
          ...current,
          queueOffset: nextQueueOffset,
          correct: current.correct + 1,
          streak: current.streak + 1,
          bestStreak: Math.max(current.bestStreak, current.streak + 1),
        }));
        newPractice(
          { mode: sessionStats.mode, remainingPositions, queueOffset: nextQueueOffset },
          { excludePositionIndex: positionIndex },
        );
      }, 300);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [
    deck.positions,
    isMistakeReview,
    newPractice,
    onQueueCardPerformanceUpdate,
    practiceAutoDifficulty,
    practiceState.phase,
    practiceState.positionIndex,
    sessionStats,
    setSessionStatsInTransition,
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
    enabled:
      isMistakeReview &&
      practiceState.phase === "correct" &&
      sessionStats.mode === "full" &&
      !canRateAttempt,
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

  // Analyze → train handoff: when scan gaps are saved into THIS tab's deck,
  // reload it and land on Review positions so training starts immediately.
  const onAnalyzeDeckSaved = useCallback(
    (savedPath: string) => {
      if (savedPath !== deckPath || isMistakeReview) return;
      readOpeningReviewDeck(deckPath)
        .then((nextDeck) => {
          setDeck({ positions: nextDeck.positions, logs: nextDeck.logs });
          setPanelView("review");
        })
        .catch(() => {
          // The deck refresh effect will catch up; stay on the analyze view.
        });
    },
    [deckPath, isMistakeReview, setDeck],
  );

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
      <Stack h="100%" gap="sm" style={{ minHeight: 0 }}>
        {panelModeControl}
        <Box style={{ flex: 1, minHeight: 0 }}>
          <DeferredPanel>
            <RepertoireGapsPanel onDeckSaved={onAnalyzeDeckSaved} />
          </DeferredPanel>
        </Box>
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
          onReviewOpening={(indices, label) => {
            startFullPractice(indices, label);
            setPanelView("review");
          }}
        />
      </Stack>
    );
  }

  const isBestAlternative = practiceState.moveAssessment === "best";
  const isOkAlternative = practiceState.moveAssessment === "ok";
  const openingAttemptLabel = isMistakeReview ? undefined : practiceState.moveQualityLabel;
  const activeAttemptLabel = isMistakeReview
    ? practiceState.mistakeReviewLabel
    : openingAttemptLabel;
  const attemptFeedbackColor = mistakeReviewAttemptColor(activeAttemptLabel, practiceState.phase);
  const feedbackColor = attemptFeedbackColor;
  const correctFeedbackColor = attemptFeedbackColor;
  const openingFeedbackTitle = !isMistakeReview
    ? formatOpeningPracticeFeedbackTitle(
        practiceState,
        openingAttemptLabel,
        isBestAlternative ? "Best" : isOkAlternative ? "Good move, not repertoire" : "Incorrect",
      )
    : undefined;
  const correctFeedbackTitle =
    isMistakeReview && practiceState.mistakeReviewLabel
      ? mistakeReviewSeverityLabel(practiceState.mistakeReviewLabel)
      : !isMistakeReview
        ? (openingFeedbackTitle ?? "Correct")
        : "Correct";
  const mistakeTimeManagementFeedback = isMistakeReview
    ? formatMistakeReviewTimeManagementFeedback(attemptPosition?.mistakeReview)
    : null;
  const mistakeBestMoveFeedback =
    isMistakeReview && (practiceState.bestMove || practiceState.answer)
      ? `Best move: ${practiceState.bestMove ?? practiceState.answer}`
      : null;
  const mistakeFeedbackDetail = [mistakeTimeManagementFeedback, mistakeBestMoveFeedback]
    .filter(Boolean)
    .join(" ");
  const openingBestMoveSource = !isMistakeReview
    ? formatOpeningReviewMoveSource(practiceState.bestMoveSource)
    : null;
  const openingFeedbackDetail = !isMistakeReview
    ? formatOpeningPracticeFeedbackDetail(practiceState, openingBestMoveSource, openingAttemptLabel)
    : undefined;
  const correctFeedbackDetail = isMistakeReview
    ? mistakeFeedbackDetail || undefined
    : openingFeedbackDetail;
  const feedbackTitle = isMistakeReview
    ? practiceState.mistakeReviewLabel
      ? mistakeReviewSeverityLabel(practiceState.mistakeReviewLabel)
      : "Incorrect"
    : (openingFeedbackTitle ??
      (isBestAlternative ? "Best" : isOkAlternative ? "Good move, not repertoire" : "Incorrect"));
  const roundedMoveLoss =
    practiceState.moveLossCp === undefined ? undefined : Math.round(practiceState.moveLossCp);
  const isTraining = practiceState.phase !== "idle";
  const sessionCompleted = sessionStats.correct + sessionStats.incorrect;
  const sessionRemaining =
    sessionStats.mode === "full" || sessionStats.mode === "srs-list"
      ? getRemainingReviewQueueLength(sessionStats, deck.positions.length)
      : sessionStats.remainingPositions.length > 0
        ? getRemainingReviewQueueLength(sessionStats, deck.positions.length)
        : Math.max(0, stats.due + stats.unseen);
  const sessionTotal = sessionCompleted + sessionRemaining;
  const sessionProgress = sessionTotal > 0 ? (sessionCompleted / sessionTotal) * 100 : 0;
  const ratingPanelDetail =
    isMistakeReview && practiceState.phase === "incorrect"
      ? mistakeFeedbackDetail ||
        `Best move: ${practiceState.bestMove ?? practiceState.answer ?? "-"}`
      : correctFeedbackDetail;
  const ratingPanelIcon =
    practiceState.phase === "incorrect" &&
    activeAttemptLabel !== "okay" &&
    activeAttemptLabel !== "inaccuracy"
      ? "x"
      : isOkAlternative || activeAttemptLabel === "inaccuracy"
        ? "bulb"
        : "check";
  const updateMistakeDailySettings = (partial: Partial<MistakeReviewDailySettings>) => {
    if (!mistakeDailySettings || !onMistakeDailySettingsChange) return;
    onMistakeDailySettingsChange({ ...mistakeDailySettings, ...partial });
  };
  const updateMistakeTimeManagementSettings = (
    partial: Partial<MistakeReviewTimeManagementSettings>,
  ) => {
    if (!mistakeTimeManagementSettings || !onMistakeTimeManagementSettingsChange) return;
    const minMoveSeconds =
      typeof partial.minMoveSeconds === "number" && Number.isFinite(partial.minMoveSeconds)
        ? Math.max(1, Math.min(3600, Math.round(partial.minMoveSeconds)))
        : mistakeTimeManagementSettings.minMoveSeconds;
    onMistakeTimeManagementSettingsChange({
      ...mistakeTimeManagementSettings,
      ...partial,
      minMoveSeconds,
    });
  };
  const updateOpeningDailySettings = (partial: Partial<OpeningReviewDailySettings>) => {
    if (!openingDailySettings || !onOpeningDailySettingsChange) return;
    onOpeningDailySettingsChange({ ...openingDailySettings, ...partial });
  };
  const dailyReviewScopeLabel = isMistakeReview
    ? "today's mistake review"
    : "today's opening review";
  return (
    <>
      <Stack h="100%" gap={6} className={classes.reviewPanelRoot}>
        {panelModeControl}
        {!isMistakeReview && <OpeningReviewAutoUpdateBanner deckPath={deckPath} />}
        <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
          <Stack gap={0} miw={0}>
            <Text size="sm" fw={700} truncate>
              {deckName}
            </Text>
            <Text size="xs" c="dimmed">
              {formatReviewCount(deck.positions.length)}{" "}
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
          <Paper px="sm" py="xs" withBorder className={classes.reviewSection}>
            <Stack gap={4}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" fw={700}>
                  Review session
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    {sessionCompleted}
                    {sessionTotal > 0 ? ` / ${sessionTotal}` : ""} complete
                  </Text>
                  {currentPracticePosition && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={13} />}
                      onClick={deleteCurrentReviewPosition}
                    >
                      Delete card
                    </Button>
                  )}
                </Group>
              </Group>
              <Progress value={sessionProgress} size="xs" />
              <Group gap={6} grow>
                <Badge size="sm" variant="light" color="green">
                  {sessionStats.correct} correct
                </Badge>
                <Badge size="sm" variant="light" color="red">
                  {sessionStats.incorrect} retry
                </Badge>
                <Badge size="sm" variant="light" color="orange">
                  {sessionStats.streak} streak
                </Badge>
                <Badge size="sm" variant="light" color="blue">
                  {sessionRemaining} left
                </Badge>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <>
            <Paper px="sm" py="xs" withBorder radius="sm" className={classes.reviewSection}>
              <Stack gap={6}>
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
                <Group gap="md" wrap="wrap">
                  <ReviewStat label="due" value={stats.due} color="yellow" />
                  <ReviewStat label="unseen" value={stats.unseen} color="gray" />
                  <ReviewStat label="done" value={stats.practiced} color="blue" />
                </Group>
              </Stack>
            </Paper>

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
                <Group gap={0} wrap="nowrap" align="stretch" className={classes.reviewSplitButton}>
                  <Button
                    className={classes.reviewActionButton}
                    variant="light"
                    leftSection={<IconTarget size={18} />}
                    onClick={() => startDuePractice(dailyScopeIndices, dailyReviewScopeLabel)}
                    justify="space-between"
                    disabled={dailyScopeIndices.length === 0}
                    rightSection={
                      <Badge variant="white" className={classes.reviewActionCountBadge}>
                        {formatReviewCount(dailyScopeIndices.length)}
                      </Badge>
                    }
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
                {dailyProgress && (
                  <Text size="xs" c="dimmed">
                    {Math.min(dailyProgress.completed, dailyProgress.target)} /{" "}
                    {dailyProgress.target} done today
                  </Text>
                )}
                {!isMistakeReview && (
                  <Tooltip
                    label={
                      openingPlanGapScopeIndices.length === 0
                        ? "No opening plan gaps saved in this deck yet"
                        : "Train lines where your usual move is playable but results trail the reference"
                    }
                  >
                    <Box style={{ minWidth: 0 }}>
                      <Button
                        className={classes.reviewActionButton}
                        fullWidth
                        variant="light"
                        color="blue"
                        leftSection={<IconRoute size={18} />}
                        onClick={startOpeningPlanGapPractice}
                        justify="space-between"
                        disabled={openingPlanGapScopeIndices.length === 0}
                        rightSection={
                          <Badge variant="white" className={classes.reviewActionCountBadge}>
                            {formatReviewCount(openingPlanGapScopeIndices.length)}
                          </Badge>
                        }
                      >
                        Train plan gaps
                      </Button>
                    </Box>
                  </Tooltip>
                )}
                {isMistakeReview && (
                  <Stack gap={4} mt={2}>
                    <Text size="xs" fw={600} c="dimmed">
                      Focused training
                    </Text>
                    <Box className={classes.reviewFocusGrid}>
                      {mistakeNatureCounts && (
                        <Menu width={280} position="bottom-start" withinPortal>
                          <Menu.Target>
                            <Button
                              className={classes.reviewActionButton}
                              fullWidth
                              variant="light"
                              color="red"
                              rightSection={<IconChevronDown size={14} />}
                              disabled={MISTAKE_REVIEW_NATURES.every(
                                (nature) => mistakeNatureCounts[nature.id].total === 0,
                              )}
                            >
                              By type
                            </Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {MISTAKE_REVIEW_NATURES.map((nature) => {
                              const count = mistakeNatureCounts[nature.id];
                              return (
                                <Menu.Item
                                  key={nature.id}
                                  disabled={count.total === 0}
                                  onClick={() => startMistakeNaturePractice(nature.id)}
                                  rightSection={
                                    <Group gap={4} wrap="nowrap">
                                      <Badge size="xs" variant="light" color="yellow">
                                        {formatReviewCount(count.due)} due
                                      </Badge>
                                      <Badge size="xs" variant="light" color="gray">
                                        {formatReviewCount(count.total)}
                                      </Badge>
                                    </Group>
                                  }
                                >
                                  <Stack gap={0}>
                                    <Text size="sm">{nature.label}</Text>
                                    <Text size="xs" c="dimmed" lineClamp={1}>
                                      {nature.description}
                                    </Text>
                                  </Stack>
                                </Menu.Item>
                              );
                            })}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                      {mistakePhaseCounts && (
                        <Menu width={260} position="bottom" withinPortal>
                          <Menu.Target>
                            <Button
                              className={classes.reviewActionButton}
                              fullWidth
                              variant="light"
                              color="teal"
                              rightSection={<IconChevronDown size={14} />}
                              disabled={MISTAKE_REVIEW_PHASES.every(
                                (phase) => mistakePhaseCounts[phase.id].total === 0,
                              )}
                            >
                              By phase
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
                                        {formatReviewCount(count.due)} due
                                      </Badge>
                                      <Badge size="xs" variant="light" color="gray">
                                        {formatReviewCount(count.total)}
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
                      <Menu width={280} position="bottom-end" withinPortal>
                        <Menu.Target>
                          <Button
                            className={classes.reviewActionButton}
                            fullWidth
                            variant="light"
                            color="orange"
                            rightSection={<IconChevronDown size={14} />}
                          >
                            Long thinks
                          </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconClock size={16} />}
                            disabled={timeManagementScopeCount === 0}
                            onClick={startMistakeTimeManagementPractice}
                            rightSection={
                              <Badge size="xs" variant="light" color="orange">
                                {formatReviewCount(timeManagementScopeCount)}
                              </Badge>
                            }
                          >
                            <Stack gap={0}>
                              <Text size="sm">Train long thinks</Text>
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                {timeManagementScopeCount === 0
                                  ? timeManagementClockDataCount === 0
                                    ? "No clock data in this deck yet"
                                    : `Nothing due at ${timeManagementThresholdText}+ yet`
                                  : `Mistakes made after thinking ${timeManagementThresholdText}+`}
                              </Text>
                            </Stack>
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            leftSection={<IconSettings size={16} />}
                            onClick={() => setTimeManagementSettingsOpen(true)}
                          >
                            Long-think settings
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Box>
                  </Stack>
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
                className={classes.reviewActionButton}
                fullWidth
                variant="light"
                leftSection={<IconTarget size={18} />}
                onClick={() => startDuePractice()}
                justify="space-between"
                rightSection={
                  <Badge variant="white" className={classes.reviewActionCountBadge}>
                    {formatReviewCount(stats.due + stats.unseen)}
                  </Badge>
                }
              >
                Train due positions
              </Button>
            )}
            <Button
              className={classes.reviewActionButton}
              fullWidth
              variant="light"
              color="gray"
              leftSection={<IconBook size={18} />}
              onClick={() => startFullPractice()}
              justify="space-between"
              rightSection={
                <Badge variant="white" className={classes.reviewActionCountBadge}>
                  {formatReviewCount(deck.positions.length)}
                </Badge>
              }
            >
              Train all positions
            </Button>
          </Stack>
        )}

        {isTraining && !isMistakeReview && currentPracticePosition && (
          <OpeningReviewGapTypeCallout
            position={currentPracticePosition}
            revealMoves={practiceState.phase !== "waiting"}
          />
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
                        deferBoardDetails: true,
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

        {!isMistakeReview && practiceState.phase === "correct" && sessionStats.mode === "full" && (
          <Paper p="sm" withBorder>
            <Stack gap="xs" align="center">
              <Group gap="xs">
                <ThemeIcon size="md" color={correctFeedbackColor} variant="light" radius="xl">
                  {ratingPanelIcon === "bulb" ? (
                    <IconBulb size={16} />
                  ) : ratingPanelIcon === "x" ? (
                    <IconX size={16} />
                  ) : (
                    <IconCheck size={16} />
                  )}
                </ThemeIcon>
                <Text fw={600} c={correctFeedbackColor}>
                  {correctFeedbackTitle}
                </Text>
              </Group>
              {ratingPanelDetail && (
                <Text size="sm" c="dimmed" ta="center">
                  {ratingPanelDetail}
                </Text>
              )}
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
                  {ratingPanelIcon === "bulb" ? (
                    <IconBulb size={16} />
                  ) : ratingPanelIcon === "check" ? (
                    <IconCheck size={16} />
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
              ) : openingFeedbackDetail ? (
                <Text size="sm" c="dimmed" ta="center">
                  {openingFeedbackDetail}
                </Text>
              ) : (
                <Text size="sm" c="dimmed">
                  {openingBestMoveSource}: {practiceState.answer}
                </Text>
              )}
              {!isMistakeReview && !openingFeedbackDetail && practiceState.playedMove && (
                <Text size="sm" c="dimmed">
                  You played: {practiceState.playedMove}
                </Text>
              )}
              {isMistakeReview && practiceState.playedMove && (
                <Text size="sm" c="dimmed">
                  You played: {practiceState.playedMove}
                </Text>
              )}
              {isMistakeReview && mistakeTimeManagementFeedback && (
                <Text size="sm" c="dimmed" ta="center">
                  {mistakeTimeManagementFeedback}
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
              {!isMistakeReview &&
                !openingFeedbackDetail &&
                isOkAlternative &&
                roundedMoveLoss !== undefined && (
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

        {isMistakeReview && (
          <>
            <MistakeReviewGameInfoPanel
              position={mistakeReviewInfoPosition}
              revealAnswer={revealCurrentPracticeAnswer}
            />
            {mistakeMovesOpen && revealCurrentPracticeAnswer ? (
              <Stack gap={4} className={classes.reviewMovesExpanded}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" fw={700}>
                    Moves
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconChevronDown size={14} />}
                    onClick={() => setMistakeMovesOpen(false)}
                  >
                    Hide
                  </Button>
                </Group>
                <ReviewMovesBox rightPanel />
              </Stack>
            ) : revealCurrentPracticeAnswer ? (
              <Paper px="sm" py="xs" withBorder radius="sm" className={classes.reviewSection}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Stack gap={0}>
                    <Text size="xs" fw={700}>
                      Moves
                    </Text>
                  </Stack>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconChevronRight size={14} />}
                    onClick={() => setMistakeMovesOpen(true)}
                  >
                    Show
                  </Button>
                </Group>
              </Paper>
            ) : null}
          </>
        )}
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

      {isMistakeReview && mistakeTimeManagementSettings && (
        <MistakeReviewTimeManagementSettingsModal
          opened={timeManagementSettingsOpen}
          onClose={() => setTimeManagementSettingsOpen(false)}
          settings={mistakeTimeManagementSettings}
          thresholdText={timeManagementThresholdText}
          matchCount={timeManagementScopeCount}
          clockDataCount={timeManagementClockDataCount}
          onUpdate={updateMistakeTimeManagementSettings}
        />
      )}

      {positionsOpen && (
        <OpeningReviewPositionsModal
          opened={positionsOpen}
          onClose={() => setPositionsOpen(false)}
          deckPath={deckPath}
          isMistakeReview={isMistakeReview}
          mistakeLongThinkMinSeconds={timeManagementMinMoveSeconds}
          onTrainDue={startDuePractice}
          onTrainAll={startFullPractice}
          onLoadPosition={onLoadPosition}
        />
      )}
    </>
  );
}

function formatReviewCount(value: number) {
  return value.toLocaleString("en-US");
}

function ReviewStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Group gap={5} wrap="nowrap">
      <Box
        w={8}
        h={8}
        bg={`var(--mantine-color-${color}-5)`}
        style={{ borderRadius: "50%", flexShrink: 0 }}
      />
      <Text size="xs" fw={700}>
        {formatReviewCount(value)}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

function OpeningReviewGapTypeCallout({
  position,
  revealMoves = true,
}: {
  position: Position;
  revealMoves?: boolean;
}) {
  const gapType = getOpeningReviewGapTrainingType(position);
  if (gapType === "other" || position.mistakeReview) return null;

  const color = openingReviewGapTrainingTypeColor(gapType);
  const Icon = gapType === "planGap" ? IconRoute : IconTargetArrow;

  return (
    <Paper px="sm" py="xs" withBorder radius="sm" className={classes.reviewSection}>
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <ThemeIcon size="md" radius="xl" color={color} variant="light">
          <Icon size={16} />
        </ThemeIcon>
        <Stack gap={1} miw={0}>
          <Group gap={6} wrap="nowrap">
            <Badge color={color} variant="filled">
              {openingReviewGapTrainingTypeLabel(gapType)}
            </Badge>
            <Text size="xs" fw={700} truncate>
              {gapType === "planGap"
                ? "Same move, learn the plan"
                : "Different move, fix the choice"}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {openingReviewGapTrainingTypeDescription(gapType, position, { revealMoves })}
          </Text>
        </Stack>
      </Group>
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
    <Tooltip label={secondary} disabled={!secondary} openDelay={300} withinPortal>
      <Group gap={6} wrap="nowrap" miw={0}>
        <Badge size="xs" color={badgeColor} variant="light" style={{ flexShrink: 0 }}>
          {badgeLabel}
        </Badge>
        <Text size="xs" c={config?.lastError ? "red" : "dimmed"} truncate>
          {primary}
        </Text>
      </Group>
    </Tooltip>
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
  moveGapCards: number;
  planGapCards: number;
  lastPlayed: string | null;
  lastPlayedTime: number;
  recency: number;
  gamesShare: number;
  relevance: number;
  estPointsLost: number | null;
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
  moveGapCards: number;
  planGapCards: number;
  lastPlayed: string | null;
  lastPlayedTime: number;
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
  const [sortBy, setSortBy] = useState<OpeningReviewStatsSort>("relevance");
  const [minGames, setMinGames] = useState(3);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const priorityRows = useMemo(
    () =>
      [...sampleRows]
        .filter(
          (row) =>
            (row.winRateGap ?? row.scoreGap ?? 0) > 0.02 ||
            (row.score !== null && row.games > 0 && row.score < 0.5) ||
            row.due > 0,
        )
        .sort(
          (a, b) =>
            b.relevance - a.relevance ||
            compareNullableNumber(b.winRateGap ?? b.scoreGap, a.winRateGap ?? a.scoreGap) ||
            b.games - a.games,
        )
        .slice(0, 6),
    [sampleRows],
  );
  const totalPointsLost = useMemo(
    () => statsRows.reduce((total, row) => total + (row.estPointsLost ?? 0), 0),
    [statsRows],
  );
  const gapTypeBreakdown = useMemo(() => {
    const now = new Date();
    const breakdown = {
      moveGap: { indices: [] as number[], due: 0 },
      planGap: { indices: [] as number[], due: 0 },
    };
    for (const row of filteredRows) {
      const type = getOpeningReviewGapTrainingType(row.position);
      if (type === "other") continue;
      const bucket = type === "planGap" ? breakdown.planGap : breakdown.moveGap;
      bucket.indices.push(row.index);
      if (getOpeningReviewStatsReview(row.position, now).due) bucket.due += 1;
    }
    return breakdown;
  }, [filteredRows]);
  const activeFilterCount = useMemo(
    () =>
      [
        colourFilter !== "any",
        resultFilters.length > 0,
        timeControlFilter !== "all",
        openingHealthDateBoundsAreActive(dateBounds),
        groupBy !== "family",
        minGames !== 3,
      ].filter(Boolean).length,
    [colourFilter, dateBounds, groupBy, minGames, resultFilters.length, timeControlFilter],
  );

  if (positions.length === 0) {
    return <Alert color="blue">Save opening review positions before viewing stats.</Alert>;
  }

  return (
    <Stack gap="sm" style={scrollablePanelStyle} className={classes.openingStatsPanel}>
      <Paper p="xs" withBorder>
        <Stack gap="xs">
          <Group justify="space-between" align="center" gap="xs">
            <SegmentedControl
              size="xs"
              value={colourFilter}
              onChange={(value) => setColourFilter(value as OpeningReviewColourFilter)}
              data={[
                { value: "any", label: "Both colours" },
                { value: "white", label: "As White" },
                { value: "black", label: "As Black" },
              ]}
            />
            <Group gap={6} wrap="nowrap">
              <Tooltip
                label={`Showing ${formatReviewNumber(filteredRows.length)} of ${formatReviewNumber(
                  positions.length,
                )} saved positions with the current filters.`}
                withArrow
              >
                <Badge variant="light">
                  {formatReviewNumber(filteredRows.length)} / {formatReviewNumber(positions.length)}{" "}
                  positions
                </Badge>
              </Tooltip>
              <Button
                size="compact-xs"
                variant={activeFilterCount > 0 ? "light" : "default"}
                leftSection={<IconFilter size={13} />}
                rightSection={
                  <IconChevronDown
                    size={13}
                    style={{
                      transform: filtersOpen ? "rotate(180deg)" : undefined,
                      transition: "transform 150ms ease",
                    }}
                  />
                }
                onClick={() => setFiltersOpen((open) => !open)}
              >
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </Button>
            </Group>
          </Group>
          {!filtersOpen && (
            <OpeningReviewStatsFilterSummary
              colourFilter={colourFilter}
              resultFilters={resultFilters}
              timeControlFilter={timeControlFilter}
              dateBounds={dateBounds}
              groupBy={groupBy}
              sortBy={sortBy}
              minGames={minGames}
            />
          )}
          <Collapse in={filtersOpen}>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                Every section below uses these filters. Min games only affects the opening lists and
                table.
              </Text>
              <Group gap="xs" grow align="flex-end">
                <MultiSelect
                  label="Results"
                  value={resultFilters}
                  onChange={(values) =>
                    setResultFilters(values as OpeningReviewStatsResultFilter[])
                  }
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
                  label="Group by"
                  value={groupBy}
                  onChange={(value) => setGroupBy((value as OpeningReviewStatsGroupBy) ?? "family")}
                  data={[
                    { value: "family", label: "Opening family" },
                    { value: "line", label: "Exact line" },
                  ]}
                  allowDeselect={false}
                />
                <Select
                  label="Sort table by"
                  value={sortBy}
                  onChange={(value) => setSortBy((value as OpeningReviewStatsSort) ?? "relevance")}
                  data={[
                    { value: "relevance", label: "Most relevant to you" },
                    { value: "planGap", label: "Biggest gap vs reference" },
                    { value: "scoreAsc", label: "Worst score" },
                    { value: "scoreDesc", label: "Best score" },
                    { value: "reviewDesc", label: "Best recall" },
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
          </Collapse>
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        <OpeningReviewStatsMetric
          label="Openings"
          value={formatReviewNumber(sampleRows.length)}
          detail={`${formatReviewNumber(filteredRows.length)} of ${formatReviewNumber(
            positions.length,
          )} positions, by ${groupBy === "line" ? "exact line" : "family"}`}
          tooltip={`Opening groups with at least ${formatReviewNumber(minGames)} games (groups you already trained always count), built from the filtered positions.`}
        />
        <OpeningReviewStatsMetric
          label="Est. points lost"
          value={
            totalPointsLost >= 0.05 ? `≈${formatOpeningReviewStatsPoints(totalPointsLost)}` : "—"
          }
          detail={
            totalPointsLost >= 0.05
              ? "vs reference, across your games"
              : "no openings scoring below reference"
          }
          tooltip="For every opening where you score below the reference: gap × your games, summed. Roughly how many game points these weaknesses have cost you."
        />
        <OpeningReviewStatsMetric
          label="Game score"
          value={formatNullableReviewPercent(summary.score)}
          detail={summary.score === null ? "no game results yet" : formatReviewRecord(summary)}
          tooltip="How you actually scored in these openings: win = 1, draw = 0.5, loss = 0."
        />
        <OpeningReviewStatsMetric
          label="Recall"
          value={
            summary.reviewScore === null ? "—" : formatNullableReviewPercent(summary.reviewScore)
          }
          detail={
            summary.attempts === 0
              ? "not trained yet"
              : formatOpeningReviewStatsReviewDetail(summary.attempts, summary.lapses)
          }
          tooltip="How often you remembered the saved move while training these positions."
        />
      </SimpleGrid>

      <OpeningReviewStatsList
        title="Work on these first"
        description="Your openings ranked by how much they matter to you right now: results below the reference, how often and how recently you play them, and cards that still need training. Each row says why it is here."
        rows={priorityRows}
        empty="Nothing urgent — no opening combines bad results with frequent, recent play."
        mode="relevance"
        onTrainOpening={onReviewOpening}
      />

      <OpeningReviewGapTypeSummary
        moveGaps={gapTypeBreakdown.moveGap}
        planGaps={gapTypeBreakdown.planGap}
        onTrain={onReviewOpening}
      />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <OpeningReviewStatsList
          title="Your strongest openings"
          description="Openings with your highest game score under the current filters."
          rows={bestRows}
          empty="No game results yet."
          mode="score"
          onTrainOpening={onReviewOpening}
        />
        <OpeningReviewStatsList
          title="Your weakest openings"
          description="Openings with your lowest game score under the current filters — the fastest place to win points back."
          rows={worstRows}
          empty="No game results yet."
          mode="score"
          onTrainOpening={onReviewOpening}
        />
      </SimpleGrid>

      <Paper p="xs" withBorder>
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <OpeningReviewStatsSectionHeader
              title="All openings"
              detail="Every opening group that matches the filters, most relevant to you first (change it with the Sort control). This is the full table behind the summary lists above."
            />
            <Badge variant="light">{rankedRows.length} openings</Badge>
          </Group>
          <Box style={{ overflowX: "auto" }}>
            <Table miw={1120}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Position</Table.Th>
                  <Table.Th>Opening</Table.Th>
                  <Table.Th>
                    <OpeningReviewStatsColumnHeader
                      label="Priority"
                      detail="How relevant this opening is to you right now: results cost vs the reference, how often and how recently you play it, and cards that still need training. The 'Most relevant' sort uses this score."
                    />
                  </Table.Th>
                  <Table.Th>
                    <OpeningReviewStatsColumnHeader
                      label="Your WDL"
                      detail="Your win/draw/loss after reaching this opening."
                    />
                  </Table.Th>
                  <Table.Th>
                    <OpeningReviewStatsColumnHeader
                      label="Reference"
                      detail="Reference win/draw/loss from saved strong-game data, or the filtered average when reference data is unavailable."
                    />
                  </Table.Th>
                  <Table.Th>
                    <OpeningReviewStatsColumnHeader
                      label="Recall"
                      detail="Remembered review attempts divided by total attempts."
                    />
                  </Table.Th>
                  <Table.Th>Signal</Table.Th>
                  <Table.Th>Train</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rankedRows.slice(0, 40).map((row) => (
                  <Table.Tr key={row.key}>
                    <Table.Td>
                      <OpeningReviewStatsBoard
                        position={row.previewPosition}
                        side={row.side}
                        size={OPENING_REVIEW_STATS_TABLE_BOARD_SIZE}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm" fw={700} lineClamp={2}>
                          {row.name}
                        </Text>
                        <Group gap={4}>
                          <Badge size="xs" variant="light">
                            {formatReviewNumber(row.games)} games
                          </Badge>
                          <Badge size="xs" variant="light">
                            {formatReviewRecord(row)}
                          </Badge>
                          <Badge size="xs" variant="light">
                            {formatReviewNumber(row.positions)} cards
                          </Badge>
                        </Group>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip
                        label={getOpeningReviewStatsRelevanceReason(row)}
                        withArrow
                        multiline
                        w={280}
                      >
                        <Badge color={openingReviewUrgencyColor(row.relevance)} variant="light">
                          {row.relevance}
                        </Badge>
                      </Tooltip>
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
                      <OpeningReviewStatsTrainButton row={row} onTrainOpening={onReviewOpening} />
                    </Table.Td>
                  </Table.Tr>
                ))}
                {rankedRows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={8}>
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

function OpeningReviewStatsSectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <Group gap={6} wrap="nowrap" miw={0}>
      <Text fw={700} truncate>
        {title}
      </Text>
      <Tooltip label={detail} withArrow multiline w={260}>
        <ThemeIcon size="xs" variant="subtle" color="gray" aria-label={`${title} details`}>
          <IconInfoCircle size={14} />
        </ThemeIcon>
      </Tooltip>
    </Group>
  );
}

function OpeningReviewStatsFilterSummary({
  colourFilter,
  resultFilters,
  timeControlFilter,
  dateBounds,
  groupBy,
  sortBy,
  minGames,
}: {
  colourFilter: OpeningReviewColourFilter;
  resultFilters: OpeningReviewStatsResultFilter[];
  timeControlFilter: string;
  dateBounds: ReturnType<typeof getOpeningHealthDateBounds>;
  groupBy: OpeningReviewStatsGroupBy;
  sortBy: OpeningReviewStatsSort;
  minGames: number;
}) {
  const chips = [
    {
      label: "Colour",
      value: formatOpeningReviewStatsColourFilter(colourFilter),
      active: colourFilter !== "any",
    },
    {
      label: "Results",
      value:
        resultFilters.length === 0
          ? "All"
          : resultFilters.map(formatOpeningReviewStatsResultFilter).join(", "),
      active: resultFilters.length > 0,
    },
    {
      label: "Time",
      value: timeControlFilter === "all" ? "All" : timeControlFilter,
      active: timeControlFilter !== "all",
    },
    {
      label: "Played",
      value: formatOpeningHealthDateFilter(dateBounds),
      active: openingHealthDateBoundsAreActive(dateBounds),
    },
    {
      label: "Group",
      value: formatOpeningReviewStatsGroupBy(groupBy),
      active: groupBy !== "family",
    },
    {
      label: "Min games",
      value: formatReviewNumber(minGames),
      active: minGames !== 3,
    },
    {
      label: "Sort",
      value: formatOpeningReviewStatsSort(sortBy),
      active: sortBy !== "relevance",
    },
  ].filter((chip) => chip.active);

  if (chips.length === 0) return null;

  return (
    <Group gap={6} className={classes.openingStatsFilterChips}>
      {chips.map((chip) => (
        <Badge key={chip.label} size="sm" variant="light" color="blue">
          {chip.label}: {chip.value}
        </Badge>
      ))}
    </Group>
  );
}

function OpeningReviewStatsMetric({
  label,
  value,
  detail,
  tooltip,
}: {
  label: string;
  value: string;
  detail: string;
  tooltip: string;
}) {
  return (
    <Paper p="xs" withBorder radius="sm">
      <Tooltip label={tooltip} withArrow multiline w={240}>
        <Text size="xs" c="dimmed" fw={600} className={classes.openingStatsHoverLabel}>
          {label}
        </Text>
      </Tooltip>
      <Text fw={800}>{value}</Text>
      <Text size="xs" c="dimmed">
        {detail}
      </Text>
    </Paper>
  );
}

function OpeningReviewGapTypeSummary({
  moveGaps,
  planGaps,
  onTrain,
}: {
  moveGaps: { indices: number[]; due: number };
  planGaps: { indices: number[]; due: number };
  onTrain: (indices: number[], label: string) => void;
}) {
  if (moveGaps.indices.length === 0 && planGaps.indices.length === 0) return null;

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
      <OpeningReviewGapTypeTile
        type="openingGap"
        icon={<IconTargetArrow size={16} />}
        headline="Different move, fix the choice"
        explainer="You played a move strong players rarely play. These cards drill the better move itself."
        count={moveGaps.indices.length}
        due={moveGaps.due}
        onTrain={() => onTrain(moveGaps.indices, "Move gaps")}
      />
      <OpeningReviewGapTypeTile
        type="planGap"
        icon={<IconRoute size={16} />}
        headline="Same move, learn the plan"
        explainer="Your move is fine, but your results after it trail the reference. These cards are about the follow-up plans."
        count={planGaps.indices.length}
        due={planGaps.due}
        onTrain={() => onTrain(planGaps.indices, "Plan gaps")}
      />
    </SimpleGrid>
  );
}

function OpeningReviewGapTypeTile({
  type,
  icon,
  headline,
  explainer,
  count,
  due,
  onTrain,
}: {
  type: OpeningReviewGapTrainingType;
  icon: ReactNode;
  headline: string;
  explainer: string;
  count: number;
  due: number;
  onTrain: () => void;
}) {
  const color = openingReviewGapTrainingTypeColor(type);
  const label = openingReviewGapTrainingTypeLabel(type);

  return (
    <Paper p="xs" withBorder>
      <Stack gap={6} h="100%" justify="space-between">
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <ThemeIcon size="md" radius="xl" color={color} variant="light">
            {icon}
          </ThemeIcon>
          <Stack gap={1} miw={0}>
            <Group gap={6} wrap="nowrap">
              <Text fw={700} size="sm">
                {label}
              </Text>
              <Text size="xs" c="dimmed" fw={600}>
                {headline}
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              {explainer}
            </Text>
          </Stack>
        </Group>
        <Group gap={6} wrap="nowrap" justify="space-between">
          <Group gap={4} wrap="nowrap">
            <Badge color={color} variant="light">
              {formatReviewNumber(count)} position{count === 1 ? "" : "s"}
            </Badge>
            {due > 0 && (
              <Badge color="orange" variant="light">
                {formatReviewNumber(due)} due
              </Badge>
            )}
          </Group>
          <Button
            size="compact-xs"
            color={color}
            variant="light"
            disabled={count === 0}
            onClick={onTrain}
          >
            Train {openingReviewGapTrainingTypePluralLabel(type)}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function OpeningReviewStatsColumnHeader({ label, detail }: { label: string; detail: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="sm" fw={700}>
        {label}
      </Text>
      <Tooltip label={detail} withArrow multiline w={240}>
        <ThemeIcon size="xs" variant="subtle" color="gray" aria-label={`${label} details`}>
          <IconInfoCircle size={13} />
        </ThemeIcon>
      </Tooltip>
    </Group>
  );
}

function OpeningReviewStatsBoard({
  position,
  side,
  size = OPENING_REVIEW_PREVIEW_BOARD_SIZE,
}: {
  position: Position;
  side: "white" | "black";
  size?: number;
}) {
  return (
    <Tooltip label="Representative review position" withArrow>
      <Box
        w={size}
        miw={size}
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
  description,
  rows,
  empty,
  mode,
  onTrainOpening,
}: {
  title: string;
  description: string;
  rows: OpeningReviewStatsGroup[];
  empty: string;
  mode: "score" | "gap" | "relevance";
  onTrainOpening: (indices: number[], label: string) => void;
}) {
  return (
    <Paper p="xs" withBorder>
      <Stack gap="xs">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <OpeningReviewStatsSectionHeader title={title} detail={description} />
          <Badge variant="light">{formatReviewNumber(rows.length)} shown</Badge>
        </Group>
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            {empty}
          </Text>
        ) : (
          <Stack gap={0} className={classes.openingStatsOpeningList}>
            {rows.map((row) => {
              const gapValue = row.winRateGap ?? row.scoreGap;
              const metric =
                mode === "relevance"
                  ? `Priority ${row.relevance}`
                  : mode === "gap"
                    ? gapValue === null
                      ? "Unknown"
                      : `${Math.abs(Math.round(gapValue * 100))}pp ${
                          gapValue >= 0 ? "behind" : "ahead of"
                        } ref`
                    : formatNullableReviewPercent(row.score);

              return (
                <Group
                  key={row.key}
                  gap="xs"
                  wrap="nowrap"
                  className={classes.openingStatsOpeningRow}
                >
                  <Group gap="xs" wrap="nowrap" className={classes.openingStatsOpeningMain}>
                    <OpeningReviewStatsBoard
                      position={row.previewPosition}
                      side={row.side}
                      size={OPENING_REVIEW_STATS_LIST_BOARD_SIZE}
                    />
                    <Stack gap={4} className={classes.openingStatsOpeningText}>
                      <Group gap={6} wrap="nowrap" miw={0} align="baseline">
                        <Tooltip label={row.name} withArrow openDelay={400}>
                          <Text
                            size="sm"
                            fw={700}
                            lineClamp={2}
                            className={classes.reviewDetailValue}
                          >
                            {row.name}
                          </Text>
                        </Tooltip>
                        <Badge
                          size="xs"
                          variant="light"
                          color={row.side === "white" ? "gray" : "dark"}
                          style={{ flexShrink: 0 }}
                        >
                          as {row.side === "white" ? "White" : "Black"}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {formatReviewNumber(row.games)} game{row.games === 1 ? "" : "s"} (
                        {formatReviewRecord(row)}) · {formatReviewNumber(row.positions)} position
                        {row.positions === 1 ? "" : "s"} to train
                        {row.due > 0 ? ` · ${formatReviewNumber(row.due)} due now` : ""}
                      </Text>
                      {mode === "relevance" && (
                        <Text size="xs" c="dimmed" fs="italic">
                          {getOpeningReviewStatsRelevanceReason(row)}
                        </Text>
                      )}
                      <Group gap={6} wrap="wrap">
                        <OpeningReviewStatsInlineStat
                          label={mode === "gap" ? "Your wins" : "Your score"}
                          value={formatNullableReviewPercent(
                            mode === "gap" ? row.winRate : row.score,
                          )}
                        />
                        <OpeningReviewStatsInlineStat
                          label={
                            mode === "gap"
                              ? "Reference wins"
                              : mode === "relevance"
                                ? "Reference"
                                : "Win rate"
                          }
                          value={formatNullableReviewPercent(
                            mode === "gap"
                              ? row.normalWinRate
                              : mode === "relevance"
                                ? row.normalScore
                                : row.winRate,
                          )}
                        />
                        <OpeningReviewStatsInlineStat
                          label="Recall"
                          value={
                            row.reviewScore === null
                              ? "not trained"
                              : formatNullableReviewPercent(row.reviewScore)
                          }
                          dimValue={row.reviewScore === null}
                        />
                        {row.moveGapCards > 0 && (
                          <Badge size="xs" variant="light" color="orange">
                            {formatReviewNumber(row.moveGapCards)} move gap
                            {row.moveGapCards === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {row.planGapCards > 0 && (
                          <Badge size="xs" variant="light" color="blue">
                            {formatReviewNumber(row.planGapCards)} plan gap
                            {row.planGapCards === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </Group>
                    </Stack>
                  </Group>
                  <Group gap={6} wrap="nowrap" className={classes.openingStatsOpeningActions}>
                    <Tooltip
                      label={<OpeningReviewStatsRowTooltip row={row} mode={mode} />}
                      withArrow
                      multiline
                      w={300}
                    >
                      <Badge
                        color={
                          mode === "relevance"
                            ? openingReviewUrgencyColor(row.relevance)
                            : mode === "gap"
                              ? "orange"
                              : openingReviewStatsScoreColor(row.score)
                        }
                      >
                        {metric}
                      </Badge>
                    </Tooltip>
                    <OpeningReviewStatsTrainButton row={row} onTrainOpening={onTrainOpening} />
                  </Group>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function OpeningReviewStatsInlineStat({
  label,
  value,
  dimValue = false,
}: {
  label: string;
  value: string;
  dimValue?: boolean;
}) {
  return (
    <Text size="xs" c="dimmed" span>
      {label}{" "}
      <Text size="xs" fw={700} span c={dimValue ? "dimmed" : undefined}>
        {value}
      </Text>
    </Text>
  );
}

function OpeningReviewStatsRowTooltip({
  row,
  mode,
}: {
  row: OpeningReviewStatsGroup;
  mode: "score" | "gap" | "relevance";
}) {
  const gap = row.winRateGap ?? row.scoreGap;
  const referenceRecord = formatReviewRecord({
    wins: row.referenceWins,
    draws: row.referenceDraws,
    losses: row.referenceLosses,
  });
  return (
    <Stack gap={2}>
      <Text size="xs" fw={700}>
        {row.name}
      </Text>
      <Text size="xs">
        Your games: {formatReviewRecord(row)}, score {formatNullableReviewPercent(row.score)}, win{" "}
        {formatNullableReviewPercent(row.winRate)}.
      </Text>
      <Text size="xs">
        Reference: {referenceRecord}, win {formatNullableReviewPercent(row.normalWinRate)}.
      </Text>
      <Text size="xs">
        Review: {formatOpeningReviewStatsReviewDetail(row.attempts, row.lapses)}{" "}
        {formatReviewNumber(row.due)} due.
      </Text>
      {mode === "gap" && gap !== null && (
        <Text size="xs">Gap: {formatSignedReviewPercent(gap)} below reference/normal.</Text>
      )}
      {mode === "relevance" && (
        <Text size="xs">
          Priority {row.relevance}/100: {getOpeningReviewStatsRelevanceReason(row)}
        </Text>
      )}
      {row.timeControls.length > 0 && (
        <Text size="xs">Time controls: {row.timeControls.join(", ")}.</Text>
      )}
    </Stack>
  );
}

function OpeningReviewStatsTrainButton({
  row,
  onTrainOpening,
}: {
  row: OpeningReviewStatsGroup;
  onTrainOpening: (indices: number[], label: string) => void;
}) {
  return (
    <Tooltip
      label={`Train ${formatReviewNumber(row.positions)} card${
        row.positions === 1 ? "" : "s"
      } from this opening${row.due > 0 ? `, ${formatReviewNumber(row.due)} due` : ""}.`}
      withArrow
    >
      <Button
        size="compact-xs"
        variant="light"
        leftSection={<IconTargetArrow size={13} />}
        onClick={() => onTrainOpening(row.indices, row.name)}
      >
        Train
      </Button>
    </Tooltip>
  );
}

function OpeningReviewScoreMeter({ value, detail }: { value: number | null; detail: string }) {
  if (value === null) {
    return (
      <Tooltip label={detail} withArrow>
        <Text size="sm" c="dimmed">
          No data
        </Text>
      </Tooltip>
    );
  }

  const percent = clamp(Math.round(value * 100), 0, 100);
  return (
    <Tooltip label={detail} withArrow>
      <Group gap="xs" wrap="nowrap">
        <Progress.Root w={70} size="sm">
          <Progress.Section value={percent} color={openingReviewStatsScoreColor(value)} />
        </Progress.Root>
        <Text size="sm" fw={600}>
          {percent}%
        </Text>
      </Group>
    </Tooltip>
  );
}

function OpeningReviewStatsSignal({ row }: { row: OpeningReviewStatsGroup }) {
  const gap = row.winRateGap ?? row.scoreGap;
  if (row.games === 0 || row.score === null) {
    return (
      <Tooltip label="This opening has review cards but no saved game results." withArrow>
        <Badge variant="light">No game data</Badge>
      </Tooltip>
    );
  }

  if ((row.reviewScore ?? 0) >= 0.7 && gap !== null && gap >= 0.06) {
    return (
      <Tooltip
        label={`Your win rate is ${formatOpeningReviewStatsGapBelow(
          gap,
        )} reference/normal while recall is ${formatNullableReviewPercent(row.reviewScore)}.`}
        withArrow
        multiline
        w={260}
      >
        <Badge color="orange" variant="light">
          Plan gap
        </Badge>
      </Tooltip>
    );
  }

  if (row.score >= 0.55) {
    return (
      <Tooltip label="Game score is above 55%." withArrow>
        <Badge color="green" variant="light">
          Strong
        </Badge>
      </Tooltip>
    );
  }

  if (row.score <= 0.45) {
    return (
      <Tooltip
        label={`Game score is 45% or lower from ${formatReviewNumber(row.games)} games.`}
        withArrow
      >
        <Badge color="red" variant="light">
          Needs work
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Tooltip label="Game score is near the middle." withArrow>
      <Badge variant="light">Neutral</Badge>
    </Tooltip>
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
    <Stack gap={4} miw={compact ? 0 : 180} w="100%">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="xs" fw={700} ta="right">
          {formatReviewRecord({ wins, draws, losses })} · {scoreText}
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
        moveGapCards: 0,
        planGapCards: 0,
        lastPlayed: null,
        lastPlayedTime: 0,
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
    if (row.lastPlayedTime > group.lastPlayedTime) {
      group.lastPlayedTime = row.lastPlayedTime;
      group.lastPlayed = row.position.openingHealth?.lastPlayed ?? null;
    }
    const gapType = getOpeningReviewGapTrainingType(row.position);
    if (gapType === "openingGap") group.moveGapCards += 1;
    else if (gapType === "planGap") group.planGapCards += 1;
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
    moveGapCards: group.moveGapCards,
    planGapCards: group.planGapCards,
    lastPlayed: group.lastPlayed,
    lastPlayedTime: group.lastPlayedTime,
    recency: openingReviewStatsRecencyScore(group.lastPlayedTime),
    gamesShare: 0,
    relevance: 0,
    estPointsLost: null,
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
    const pointsGap = scoreGap ?? winRateGap;
    const estPointsLost =
      pointsGap !== null && pointsGap > 0 && group.games > 0 ? pointsGap * group.games : null;
    const gamesShare = summary.games > 0 ? group.games / summary.games : 0;
    const withSignals = {
      ...group,
      normalScore,
      normalWinRate,
      winRateGap,
      scoreGap,
      gamesShare,
      estPointsLost,
    };

    return {
      ...withSignals,
      relevance: computeOpeningReviewStatsRelevance(withSignals),
    };
  });
}

/**
 * 0-100 "how much should this opening worry you right now" score: results cost
 * vs the reference carries the most weight, then how often the opening shows
 * up in the player's games, how recently it was played, and whether its cards
 * still need training (per-card urgency already folds in engine severity).
 */
function computeOpeningReviewStatsRelevance(row: OpeningReviewStatsGroup) {
  const gap = Math.max(row.winRateGap ?? row.scoreGap ?? 0, 0);
  const gapSignal = clamp(gap / 0.25, 0, 1);
  const poorScore = row.score === null ? 0 : clamp((0.55 - row.score) / 0.4, 0, 1);
  const sampleConfidence = clamp(Math.log1p(row.games) / Math.log1p(40), 0.35, 1);
  const cost = (gapSignal * 0.7 + poorScore * 0.3) * sampleConfidence;

  const volume = clamp(Math.log1p(row.games) / Math.log1p(200), 0, 1);
  const share = clamp(row.gamesShare / 0.15, 0, 1);
  const exposure = volume * 0.6 + share * 0.4;

  const dueShare = row.positions > 0 ? row.due / row.positions : 0;
  const trainingNeed = clamp(row.urgency / 100, 0, 1) * 0.6 + clamp(dueShare, 0, 1) * 0.4;

  return Math.round(
    clamp(cost * 0.45 + exposure * 0.22 + row.recency * 0.18 + trainingNeed * 0.15, 0, 1) * 100,
  );
}

/** Recency of the group's most recent game; unknown dates sit in the middle. */
function openingReviewStatsRecencyScore(lastPlayedTime: number) {
  if (!lastPlayedTime) return 0.35;
  const ageYears = Math.max(0, (Date.now() - lastPlayedTime) / 31_557_600_000);
  return clamp(Math.exp(-ageYears / 2), 0.08, 1);
}

/** One-line "why this ranks here" explanation for a relevance-ranked row. */
function getOpeningReviewStatsRelevanceReason(row: OpeningReviewStatsGroup) {
  const parts: string[] = [];
  if (row.estPointsLost !== null && row.estPointsLost >= 0.5) {
    parts.push(`≈${formatOpeningReviewStatsPoints(row.estPointsLost)} pts lost vs reference`);
  } else if (row.score !== null && row.games > 0 && row.score < 0.5) {
    parts.push(
      `scoring ${formatReviewPercent(row.score)} over ${formatReviewNumber(row.games)} games`,
    );
  }
  if (row.gamesShare >= 0.03) {
    parts.push(`${Math.round(row.gamesShare * 100)}% of your games`);
  }
  const lastPlayedText = formatOpeningReviewStatsLastPlayedShort(row.lastPlayedTime);
  if (lastPlayedText) parts.push(lastPlayedText);
  if (
    row.reviewScore !== null &&
    row.reviewScore >= 0.7 &&
    (row.winRateGap ?? row.scoreGap ?? 0) >= 0.06
  ) {
    parts.push("recall is fine — work on the plans");
  } else if (row.attempts > 0 && row.reviewScore !== null && row.reviewScore < 0.7) {
    parts.push(`recall ${formatReviewPercent(row.reviewScore)}`);
  }
  if (row.due > 0) parts.push(`${formatReviewNumber(row.due)} card${row.due === 1 ? "" : "s"} due`);
  return parts.length > 0 ? parts.join(" · ") : "No strong weakness signals under these filters.";
}

function formatOpeningReviewStatsPoints(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatOpeningReviewStatsLastPlayedShort(lastPlayedTime: number) {
  if (!lastPlayedTime) return null;
  const ageDays = Math.max(0, Math.round((Date.now() - lastPlayedTime) / 86_400_000));
  if (ageDays === 0) return "played today";
  if (ageDays === 1) return "played yesterday";
  if (ageDays < 45) return `played ${ageDays} days ago`;
  const ageMonths = Math.round(ageDays / 30.44);
  if (ageMonths < 18) return `played ${ageMonths} month${ageMonths === 1 ? "" : "s"} ago`;
  const ageYears = Math.round(ageMonths / 12);
  return `played ${ageYears} year${ageYears === 1 ? "" : "s"} ago`;
}

function sortOpeningReviewStatsRows(
  rows: OpeningReviewStatsGroup[],
  sortBy: OpeningReviewStatsSort,
) {
  return [...rows].sort((a, b) => {
    switch (sortBy) {
      case "relevance":
        return (
          b.relevance - a.relevance ||
          compareNullableNumber(b.winRateGap ?? b.scoreGap, a.winRateGap ?? a.scoreGap) ||
          b.games - a.games
        );
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

function formatOpeningReviewStatsColourFilter(value: OpeningReviewColourFilter) {
  switch (value) {
    case "white":
      return "White";
    case "black":
      return "Black";
    case "any":
      return "All";
  }
}

function formatOpeningReviewStatsResultFilter(value: OpeningReviewStatsResultFilter) {
  switch (value) {
    case "wins":
      return "Wins";
    case "draws":
      return "Draws";
    case "losses":
      return "Losses";
  }
}

function formatOpeningReviewStatsGroupBy(value: OpeningReviewStatsGroupBy) {
  switch (value) {
    case "family":
      return "Family";
    case "line":
      return "Exact line";
  }
}

function formatOpeningReviewStatsSort(value: OpeningReviewStatsSort) {
  switch (value) {
    case "relevance":
      return "Most relevant";
    case "planGap":
      return "Biggest gap vs reference";
    case "scoreAsc":
      return "Worst score";
    case "scoreDesc":
      return "Best score";
    case "reviewDesc":
      return "Best recall";
    case "gamesDesc":
      return "Most games";
  }
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

function MistakeReviewTimeManagementSettingsModal({
  opened,
  onClose,
  settings,
  thresholdText,
  matchCount,
  clockDataCount,
  onUpdate,
}: {
  opened: boolean;
  onClose: () => void;
  settings: MistakeReviewTimeManagementSettings;
  thresholdText: string;
  matchCount: number;
  clockDataCount: number;
  onUpdate: (partial: Partial<MistakeReviewTimeManagementSettings>) => void;
}) {
  const totalSeconds = Math.max(1, Math.min(3600, Math.round(settings.minMoveSeconds)));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const updateThreshold = (nextMinutes: number, nextSeconds: number) => {
    const normalizedMinutes = Math.max(0, Math.min(60, Math.round(nextMinutes || 0)));
    const normalizedSeconds = Math.max(0, Math.min(59, Math.round(nextSeconds || 0)));
    onUpdate({
      minMoveSeconds: Math.max(1, normalizedMinutes * 60 + normalizedSeconds),
    });
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Long-think settings" centered>
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">
            Train time-management cards from moves that reached this think time.
          </Text>
          <Badge variant="light" color="orange">
            {matchCount} of {clockDataCount}
          </Badge>
        </Group>
        <SimpleGrid cols={2} spacing="sm">
          <NumberInput
            label="Minutes"
            value={minutes}
            min={0}
            max={60}
            onChange={(value) => updateThreshold(Number(value) || 0, seconds)}
          />
          <NumberInput
            label="Seconds"
            value={seconds}
            min={0}
            max={59}
            onChange={(value) => updateThreshold(minutes, Number(value) || 0)}
          />
        </SimpleGrid>
        <Text size="xs" c="dimmed">
          Current threshold: {thresholdText}. Correspondence games stay out of this trainer.
        </Text>
      </Stack>
    </Modal>
  );
}

function MistakeReviewGameInfoPanel({
  position,
  revealAnswer,
}: {
  position: Position | null;
  revealAnswer: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const mistake = position?.mistakeReview;
  if (!mistake) {
    return (
      <Paper px="sm" py="xs" withBorder radius="sm" className={classes.reviewSection}>
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
  const storedNature = getStoredMistakeReviewNature(position);
  const nature = revealAnswer ? getMistakeReviewNature(position) : storedNature;
  const natureLabel = nature ? mistakeReviewNatureLabel(nature) : null;
  const natureConfidence = revealAnswer
    ? getMistakeReviewNatureConfidence(position)
    : getStoredMistakeReviewNatureConfidence(position);

  return (
    <Paper px="sm" py="xs" withBorder radius="sm" className={classes.reviewSection}>
      <Stack gap={expanded ? "xs" : 6}>
        <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
          <Stack gap={2} miw={0}>
            <Text size="xs" fw={700}>
              Game information
            </Text>
            <Text size="sm" c="dimmed" lineClamp={2} className={classes.reviewDetailValue}>
              {playerName} vs {opponentName}
            </Text>
          </Stack>
          <Group gap={4} wrap="wrap" justify="flex-end" className={classes.reviewBadgeGroup}>
            {nature && natureLabel && (
              <Tooltip label={`${natureLabel}, ${natureConfidence ?? "unknown"} confidence`}>
                <Badge size="xs" color={mistakeReviewNatureColor(nature)} variant="light">
                  {natureLabel}
                </Badge>
              </Tooltip>
            )}
            <Badge size="xs" variant="light">
              {mistakeReviewSeverityLabel(mistake.severity ?? "mistake")}
            </Badge>
            <Tooltip label={expanded ? "Hide game details" : "Show game details"}>
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={() => setExpanded((current) => !current)}
                aria-label={expanded ? "Hide game details" : "Show game details"}
                aria-expanded={expanded}
              >
                {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        {!expanded && (
          <SimpleGrid cols={3} spacing={6}>
            <ReviewDetail label="Played" value={formatMistakeReviewGameDate(mistake.date)} />
            <ReviewDetail label="Time control" value={formatMistakeReviewTimeControl(mistake)} />
            <ReviewDetail
              label="Best move"
              value={revealAnswer ? mistake.bestMoveSan || position.answer : "Hidden"}
            />
          </SimpleGrid>
        )}
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
              value={
                revealAnswer
                  ? `${mistake.moveNumber ? `${mistake.moveNumber}. ` : ""}${mistake.playedMoveSan ?? "-"}`
                  : "Hidden"
              }
            />
            <ReviewDetail label="Think time" value={formatMistakeReviewThinkTime(mistake)} />
            <ReviewDetail
              label="Mistake type"
              value={
                natureLabel
                  ? `${natureLabel} (${natureConfidence ?? "unknown"})`
                  : revealAnswer
                    ? "Unknown"
                    : "Hidden"
              }
            />
            <ReviewDetail label="Last seen" value={formatMistakeReviewLastSeen(position)} />
          </SimpleGrid>
        )}
      </Stack>
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
    <Paper p="xs" withBorder className={classes.reviewSection}>
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
  const hasRankingData = useMemo(
    () => positions.some((position) => position.priority !== undefined || position.openingHealth),
    [positions],
  );
  const ranked = useMemo(
    () => (expanded && hasRankingData ? rankOpeningReviewPositions(positions) : []),
    [expanded, hasRankingData, positions],
  );
  if (!hasRankingData || positions.length === 0) return null;

  return (
    <Paper px="sm" py="xs" withBorder radius="sm" className={classes.reviewSection}>
      <Stack gap="xs">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap={6} wrap="nowrap" miw={0}>
            <Text size="xs" fw={700} style={{ flexShrink: 0 }}>
              Urgency ranking
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {formatReviewCount(positions.length)} ranked
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
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
    const nature = getMistakeReviewNature(position);
    const natureLabel = mistakeReviewNatureLabel(nature);
    const natureConfidence = getMistakeReviewNatureConfidence(position);

    return (
      <Paper p="xs" withBorder className={classes.reviewSection}>
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
            <ReviewDetail label="Type" value={`${natureLabel} (${natureConfidence})`} />
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
  const gapType = getOpeningReviewGapTrainingType(position);

  return (
    <Paper p="xs" withBorder className={classes.reviewSection}>
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
          <Group gap={4} justify="flex-end">
            {gapType !== "other" && (
              <Badge color={openingReviewGapTrainingTypeColor(gapType)} variant="filled">
                {openingReviewGapTrainingTypeLabel(gapType)}
              </Badge>
            )}
            <Badge variant="light">{side === "white" ? "White to move" : "Black to move"}</Badge>
          </Group>
        </Group>

        {gapType !== "other" && (
          <Text size="xs" c="dimmed">
            {openingReviewGapTrainingTypeDescription(gapType, position)}
          </Text>
        )}

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
      <Text size="sm" fw={700} lh={1.25} className={classes.reviewDetailValue}>
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

function getStoredMistakeReviewNature(position: Position | null | undefined) {
  const metadata = position?.mistakeReview;
  const candidate = metadata?.nature ?? metadata?.mistakeNature ?? metadata?.summary?.nature;
  return candidate === "tactical" || candidate === "positional" ? candidate : null;
}

function getStoredMistakeReviewNatureConfidence(position: Position | null | undefined) {
  const metadata = position?.mistakeReview;
  const candidate = metadata?.natureConfidence ?? metadata?.summary?.natureConfidence;
  return candidate === "high" || candidate === "medium" || candidate === "low" ? candidate : null;
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

function formatMistakeReviewThinkTime(
  mistake: NonNullable<Position["mistakeReview"]>,
  activeLongThinkSeconds?: number,
) {
  const timeText = formatMistakeReviewMoveTime(mistake.moveTimeSeconds);
  if (!timeText) return "Unknown";

  const threshold =
    typeof activeLongThinkSeconds === "number" && Number.isFinite(activeLongThinkSeconds)
      ? activeLongThinkSeconds
      : mistake.longThinkThresholdSeconds;
  if (typeof threshold === "number" && Number.isFinite(threshold)) {
    const thresholdText = formatMistakeReviewMoveTime(threshold);
    const moveTime = mistake.moveTimeSeconds;
    return thresholdText &&
      typeof moveTime === "number" &&
      Number.isFinite(moveTime) &&
      moveTime >= threshold
      ? `${timeText} (${thresholdText}+ target)`
      : timeText;
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

function getNextDueOpeningReviewPositionIndex(
  positions: Position[],
  scopeIndices?: number[],
  excludePositionIndex?: number,
) {
  const now = new Date();
  if (!scopeIndices) {
    for (let index = 0; index < positions.length; index += 1) {
      if (index === excludePositionIndex) continue;
      const position = positions[index];
      if (position && new Date(position.card.due) <= now) return index;
    }
    return -1;
  }

  return (
    scopeIndices.find((index) => {
      if (index === excludePositionIndex) return false;
      const position = positions[index];
      return position ? new Date(position.card.due) <= now : false;
    }) ?? -1
  );
}

function getDueReviewPositionIndices(positions: Position[]) {
  const now = new Date();
  const indices: number[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    if (position && new Date(position.card.due) <= now) {
      indices.push(index);
    }
  }
  return indices;
}

function clampReviewQueueOffset(value: number | null | undefined, queueLength: number) {
  const offset = Math.max(0, Math.trunc(Number(value) || 0));
  return Math.min(offset, Math.max(0, queueLength));
}

function isReviewAllPositionQueue(sessionStats: Pick<PracticeSessionStats, "mode" | "queueKind">) {
  return sessionStats.mode === "full" && sessionStats.queueKind === "all";
}

function getReviewQueueLength(
  sessionStats: Pick<PracticeSessionStats, "mode" | "remainingPositions" | "queueKind">,
  positionsLength: number,
) {
  return isReviewAllPositionQueue(sessionStats)
    ? positionsLength
    : sessionStats.remainingPositions.length;
}

function getReviewQueueOffset(
  sessionStats: Pick<
    PracticeSessionStats,
    "mode" | "remainingPositions" | "queueOffset" | "queueKind"
  >,
  positionsLength: number,
) {
  return clampReviewQueueOffset(
    sessionStats.queueOffset,
    getReviewQueueLength(sessionStats, positionsLength),
  );
}

function getNextQueuedReviewPositionIndex(
  remainingPositions: number[],
  queueOffset: number,
  excludePositionIndex?: number,
) {
  for (let index = queueOffset; index < remainingPositions.length; index += 1) {
    const positionIndex = remainingPositions[index];
    if (positionIndex !== excludePositionIndex) return positionIndex ?? -1;
  }
  return -1;
}

function getNextAllReviewPositionIndex(
  positions: Position[],
  queueOffset: number,
  excludePositionIndex?: number,
) {
  for (let index = queueOffset; index < positions.length; index += 1) {
    if (index !== excludePositionIndex && positions[index]) return index;
  }
  return -1;
}

function getRemainingReviewQueueLength(
  sessionStats: {
    mode: "anki" | "full" | "srs-list";
    remainingPositions: number[];
    queueOffset?: number;
    queueKind?: "indices" | "all";
  },
  positionsLength: number,
) {
  const queueLength = getReviewQueueLength(sessionStats, positionsLength);
  return Math.max(0, queueLength - clampReviewQueueOffset(sessionStats.queueOffset, queueLength));
}

function getReviewPrewarmPositionIndices(
  positions: Position[],
  sessionStats: {
    mode: "anki" | "full" | "srs-list";
    remainingPositions: number[];
    queueOffset?: number;
    queueKind?: "indices" | "all";
  },
  currentPositionIndex: number,
) {
  if (positions.length === 0) return [];

  if (isReviewAllPositionQueue(sessionStats)) {
    const queueOffset = getReviewQueueOffset(sessionStats, positions.length);
    const indices: number[] = [];
    for (let index = queueOffset; index < positions.length; index += 1) {
      if (index === currentPositionIndex || !positions[index]) continue;
      indices.push(index);
      if (indices.length >= REVIEW_POSITION_PREWARM_LIMIT) break;
    }
    return indices;
  }

  if (sessionStats.remainingPositions.length > 0) {
    const queueOffset = clampReviewQueueOffset(
      sessionStats.queueOffset,
      sessionStats.remainingPositions.length,
    );
    const indices: number[] = [];
    for (
      let queueIndex = queueOffset;
      queueIndex < sessionStats.remainingPositions.length;
      queueIndex += 1
    ) {
      const index = sessionStats.remainingPositions[queueIndex];
      if (index === undefined) continue;
      if (index === currentPositionIndex || !positions[index]) continue;
      indices.push(index);
      if (indices.length >= REVIEW_POSITION_PREWARM_LIMIT) break;
    }
    return indices;
  }

  const now = new Date();
  const indices: number[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    if (index === currentPositionIndex) continue;
    const position = positions[index];
    if (!position || new Date(position.card.due) > now) continue;
    indices.push(index);
    if (indices.length >= REVIEW_POSITION_PREWARM_LIMIT) break;
  }
  return indices;
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

function getReviewPositionFilterSide(position: Position): "white" | "black" {
  return position.mistakeReview?.playerColor ?? getOpeningReviewMoveSide(position);
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

function isMistakeReviewLongThinkPosition(position: Position, minMoveSeconds?: number) {
  const metadata = position.mistakeReview;
  const threshold =
    typeof minMoveSeconds === "number" && Number.isFinite(minMoveSeconds)
      ? minMoveSeconds
      : (metadata?.longThinkThresholdSeconds ??
        metadata?.timeManagement?.minMoveSeconds ??
        DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds);
  return isMistakeReviewTimeManagementPosition(position, threshold);
}

function getMistakeReviewTimeControlLabel(
  metadata: NonNullable<Position["mistakeReview"]> | null | undefined,
) {
  return metadata ? formatMistakeReviewTimeControl(metadata) : "Unknown";
}

function getMistakeReviewOpponentLabel(position: Position) {
  return normalizeMistakeReviewName(position.mistakeReview?.opponent) || "Unknown";
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
      return getReviewPositionFilterSide(row.position) === "white" ? 0 : 1;
    case "opening":
      return row.opening.line;
    case "due":
      return new Date(row.position.card.due).getTime();
    case "move":
      return row.position.answer;
    case "severity":
      return -getMistakeReviewSeverityWeight(row.position.mistakeReview?.severity);
    case "moveTime":
      return sortNumberDescMissingLast(row.position.mistakeReview?.moveTimeSeconds);
    case "cpLoss":
      return sortNumberDescMissingLast(row.position.mistakeReview?.cpLoss);
    case "winProbabilityDrop":
      return sortNumberDescMissingLast(row.position.mistakeReview?.winProbabilityDrop);
    case "opponent":
      return getMistakeReviewOpponentLabel(row.position);
  }
}

function sortNumberDescMissingLast(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? -value : Number.POSITIVE_INFINITY;
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
  isMistakeReview,
  mistakeLongThinkMinSeconds,
  onTrainDue,
  onTrainAll,
  onLoadPosition,
}: {
  opened: boolean;
  onClose: () => void;
  deckPath: string;
  isMistakeReview: boolean;
  mistakeLongThinkMinSeconds?: number;
  onTrainDue: (indices?: number[], label?: string) => void;
  onTrainAll: (indices?: number[], label?: string) => void;
  onLoadPosition: (positionIndex: number) => void;
}) {
  const [deck, setDeck] = useAtom(deckAtomFamily({ file: deckPath, game: 0 }));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [moveInput, setMoveInput] = useState("");
  const [sortBy, setSortBy] = useState<OpeningReviewPositionSort>("urgency");
  const [gapFilter, setGapFilter] = useState<OpeningReviewGapFilter>("all");
  const [colourFilter, setColourFilter] = useState<OpeningReviewColourFilter>("any");
  const [openingFilters, setOpeningFilters] = useState<string[]>([]);
  const [mistakeSeverityFilters, setMistakeSeverityFilters] = useState<MistakeReviewAttemptLabel[]>(
    [],
  );
  const [mistakePhaseFilter, setMistakePhaseFilter] = useState<MistakeReviewPhaseFilter>("all");
  const [mistakeNatureFilter, setMistakeNatureFilter] = useState<MistakeReviewNatureFilter>("all");
  const [mistakeThinkTimeFilter, setMistakeThinkTimeFilter] =
    useState<MistakeReviewThinkTimeFilter>("all");
  const [mistakeTimeControlFilter, setMistakeTimeControlFilter] = useState("all");
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
  const mistakeLongThinkThresholdSeconds =
    typeof mistakeLongThinkMinSeconds === "number" && Number.isFinite(mistakeLongThinkMinSeconds)
      ? mistakeLongThinkMinSeconds
      : DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds;
  const mistakeLongThinkThresholdText =
    formatMistakeReviewMoveTime(mistakeLongThinkThresholdSeconds) ??
    `${mistakeLongThinkThresholdSeconds}s`;
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
          (colourFilter === "any" || getReviewPositionFilterSide(position) === colourFilter) &&
          openingHealthDateMatches(getReviewPositionLastPlayedDate(position), dateBounds),
      ),
    [colourFilter, dateBounds, rowsWithOpenings],
  );
  const gapTypeCounts = useMemo(
    () =>
      colourFilteredRows.reduce(
        (counts, row) => {
          const type = getOpeningReviewGapTrainingType(row.position);
          counts[type] += 1;
          return counts;
        },
        { openingGap: 0, planGap: 0, other: 0 } satisfies Record<
          OpeningReviewGapTrainingType,
          number
        >,
      ),
    [colourFilteredRows],
  );
  const showGapFilter =
    !isMistakeReview && (gapTypeCounts.openingGap > 0 || gapTypeCounts.planGap > 0);
  const gapFilterOptions = useMemo(
    () => [
      { value: "all", label: `All gaps (${colourFilteredRows.length})` },
      { value: "openingGap", label: `Bad move gaps (${gapTypeCounts.openingGap})` },
      { value: "planGap", label: `Plan gaps (${gapTypeCounts.planGap})` },
    ],
    [colourFilteredRows.length, gapTypeCounts.openingGap, gapTypeCounts.planGap],
  );
  const gapFilteredRows = useMemo(
    () =>
      !showGapFilter || gapFilter === "all"
        ? colourFilteredRows
        : colourFilteredRows.filter(
            (row) => getOpeningReviewGapTrainingType(row.position) === gapFilter,
          ),
    [colourFilteredRows, gapFilter, showGapFilter],
  );
  const mistakeSeverityOptions = useMemo(() => {
    const counts = new Map<MistakeReviewAttemptLabel, number>();
    for (const { position } of gapFilteredRows) {
      const severity = position.mistakeReview?.severity;
      if (!severity) continue;
      counts.set(severity, (counts.get(severity) ?? 0) + 1);
    }

    return MISTAKE_REVIEW_POSITION_SEVERITIES.filter((severity) => counts.has(severity)).map(
      (severity) => ({
        value: severity,
        label: `${mistakeReviewSeverityLabel(severity)} (${counts.get(severity) ?? 0})`,
      }),
    );
  }, [gapFilteredRows]);
  const mistakePhaseOptions = useMemo(() => {
    const counts = new Map<MistakeReviewPhase, number>();
    for (const { position } of gapFilteredRows) {
      if (!position.mistakeReview) continue;
      const phase = getMistakeReviewPhase(position);
      counts.set(phase, (counts.get(phase) ?? 0) + 1);
    }

    return [
      { value: "all", label: `All phases (${gapFilteredRows.length})` },
      ...MISTAKE_REVIEW_PHASES.map((phase) => ({
        value: phase.id,
        label: `${phase.label} (${counts.get(phase.id) ?? 0})`,
      })),
    ];
  }, [gapFilteredRows]);
  const mistakeNatureOptions = useMemo(() => {
    const counts = new Map<MistakeReviewNature, number>();
    for (const { position } of gapFilteredRows) {
      if (!position.mistakeReview) continue;
      const nature = getMistakeReviewNature(position);
      counts.set(nature, (counts.get(nature) ?? 0) + 1);
    }

    return [
      { value: "all", label: `All types (${gapFilteredRows.length})` },
      ...MISTAKE_REVIEW_NATURES.map((nature) => ({
        value: nature.id,
        label: `${nature.label} (${counts.get(nature.id) ?? 0})`,
      })),
    ];
  }, [gapFilteredRows]);
  const mistakeTimeControlOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { position } of gapFilteredRows) {
      if (!position.mistakeReview) continue;
      const label = getMistakeReviewTimeControlLabel(position.mistakeReview);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    const options = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ value: label, label: `${label} (${count})` }));
    return [{ value: "all", label: `All controls (${gapFilteredRows.length})` }, ...options];
  }, [gapFilteredRows]);
  const mistakeFilteredRows = useMemo(
    () =>
      !isMistakeReview
        ? gapFilteredRows
        : gapFilteredRows.filter(({ position }) => {
            const metadata = position.mistakeReview;
            if (!metadata) return false;
            if (
              mistakeSeverityFilters.length > 0 &&
              (!metadata.severity || !mistakeSeverityFilters.includes(metadata.severity))
            ) {
              return false;
            }
            if (
              mistakePhaseFilter !== "all" &&
              getMistakeReviewPhase(position) !== mistakePhaseFilter
            ) {
              return false;
            }
            if (
              mistakeNatureFilter !== "all" &&
              getMistakeReviewNature(position) !== mistakeNatureFilter
            ) {
              return false;
            }
            if (
              mistakeTimeControlFilter !== "all" &&
              getMistakeReviewTimeControlLabel(metadata) !== mistakeTimeControlFilter
            ) {
              return false;
            }

            const hasThinkTime =
              typeof metadata.moveTimeSeconds === "number" &&
              Number.isFinite(metadata.moveTimeSeconds);
            if (mistakeThinkTimeFilter === "known" && !hasThinkTime) return false;
            if (mistakeThinkTimeFilter === "missing" && hasThinkTime) return false;
            if (
              mistakeThinkTimeFilter === "long" &&
              !isMistakeReviewLongThinkPosition(position, mistakeLongThinkThresholdSeconds)
            ) {
              return false;
            }
            return true;
          }),
    [
      gapFilteredRows,
      isMistakeReview,
      mistakeNatureFilter,
      mistakePhaseFilter,
      mistakeLongThinkThresholdSeconds,
      mistakeSeverityFilters,
      mistakeThinkTimeFilter,
      mistakeTimeControlFilter,
    ],
  );
  const openingOptions = useMemo(() => {
    const familyCounts = new Map<string, number>();
    const lineCounts = new Map<string, number>();

    for (const row of mistakeFilteredRows) {
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
  }, [mistakeFilteredRows]);
  const visibleRows = useMemo(
    () =>
      mistakeFilteredRows
        .filter(
          (row) =>
            openingFilters.length === 0 ||
            openingFilters.some((filter) => openingReviewFilterMatchesOpening(filter, row.opening)),
        )
        .sort((a, b) => compareOpeningReviewPositionRows(a, b, sortBy)),
    [mistakeFilteredRows, openingFilters, sortBy],
  );
  const visibleIndices = useMemo(() => visibleRows.map((row) => row.index), [visibleRows]);
  const visibleDueCount = useMemo(() => {
    const now = new Date();
    return visibleRows.filter(({ position }) => new Date(position.card.due) <= now).length;
  }, [visibleRows]);
  const dateFilterActive = openingHealthDateBoundsAreActive(dateBounds);
  const activeGapFilterLabel =
    showGapFilter && gapFilter !== "all"
      ? openingReviewGapTrainingTypePluralLabel(gapFilter)
      : null;
  const activeMistakeSeverityLabel =
    isMistakeReview && mistakeSeverityFilters.length > 0
      ? mistakeSeverityFilters.length === 1
        ? mistakeReviewSeverityLabel(mistakeSeverityFilters[0]!)
        : `${mistakeSeverityFilters.length} qualities`
      : null;
  const activeMistakePhaseLabel =
    isMistakeReview && mistakePhaseFilter !== "all"
      ? MISTAKE_REVIEW_PHASES.find((phase) => phase.id === mistakePhaseFilter)?.label
      : null;
  const activeMistakeNatureLabel =
    isMistakeReview && mistakeNatureFilter !== "all"
      ? MISTAKE_REVIEW_NATURES.find((nature) => nature.id === mistakeNatureFilter)?.label
      : null;
  const activeMistakeThinkTimeLabel =
    isMistakeReview && mistakeThinkTimeFilter !== "all"
      ? mistakeThinkTimeFilter === "known"
        ? "Clock data"
        : mistakeThinkTimeFilter === "long"
          ? `Long think (${mistakeLongThinkThresholdText}+)`
          : "Missing clock"
      : null;
  const activeMistakeTimeControlLabel =
    isMistakeReview && mistakeTimeControlFilter !== "all" ? mistakeTimeControlFilter : null;
  const hasActivePositionFilter =
    openingFilters.length > 0 ||
    colourFilter !== "any" ||
    dateFilterActive ||
    Boolean(activeGapFilterLabel) ||
    Boolean(activeMistakeSeverityLabel) ||
    Boolean(activeMistakePhaseLabel) ||
    Boolean(activeMistakeNatureLabel) ||
    Boolean(activeMistakeThinkTimeLabel) ||
    Boolean(activeMistakeTimeControlLabel);
  const openingReviewScopeLabel =
    openingFilters.length === 0
      ? colourFilter === "any"
        ? "all openings"
        : `${colourFilter} openings`
      : `${openingReviewFiltersDisplayName(openingFilters)}${
          colourFilter === "any" ? "" : `, ${colourFilter}`
        }`;
  const mistakeOpeningScopeLabel =
    isMistakeReview && openingFilters.length > 0
      ? openingReviewFiltersDisplayName(openingFilters)
      : null;
  const mistakeColourScopeLabel =
    isMistakeReview && colourFilter !== "any"
      ? `${colourFilter === "white" ? "White" : "Black"} side`
      : null;
  const baseTrainingScopeLabel = isMistakeReview
    ? [
        activeMistakeSeverityLabel,
        activeMistakeNatureLabel,
        activeMistakePhaseLabel,
        activeMistakeThinkTimeLabel,
        activeMistakeTimeControlLabel,
        mistakeOpeningScopeLabel,
        mistakeColourScopeLabel,
      ]
        .filter(Boolean)
        .join(", ") || "all mistakes"
    : [activeGapFilterLabel, openingReviewScopeLabel].filter(Boolean).join(", ");
  const trainingScopeLabel = dateFilterActive
    ? `${baseTrainingScopeLabel}, ${
        isMistakeReview ? "played" : "last played"
      } ${formatOpeningHealthDateFilter(dateBounds)}`
    : baseTrainingScopeLabel;
  const reviewDueButtonLabel = activeGapFilterLabel
    ? `Review due ${activeGapFilterLabel}`
    : hasActivePositionFilter
      ? "Review due matches"
      : "Review due";
  const reviewAllButtonLabel = activeGapFilterLabel
    ? `Review ${activeGapFilterLabel}`
    : hasActivePositionFilter
      ? "Review matches"
      : "Review";
  const positionSortOptions = useMemo(
    () =>
      isMistakeReview
        ? [
            { value: "lastPlayed", label: "Game date newest" },
            { value: "moveTime", label: "Think time longest" },
            { value: "severity", label: "Move quality" },
            { value: "cpLoss", label: "Centipawn loss" },
            { value: "winProbabilityDrop", label: "Win-prob drop" },
            { value: "opponent", label: "Opponent" },
            { value: "opening", label: "Opening" },
            { value: "due", label: "Due date" },
            { value: "imported", label: "Imported newest" },
            { value: "move", label: "Best move" },
          ]
        : [
            { value: "urgency", label: "Urgency" },
            { value: "imported", label: "Imported newest" },
            { value: "lastPlayed", label: "Last played newest" },
            { value: "colour", label: "Colour" },
            { value: "opening", label: "Opening" },
            { value: "due", label: "Due date" },
            { value: "move", label: "Correct move" },
          ],
    [isMistakeReview],
  );
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
    if (positionSortOptions.some((option) => option.value === sortBy)) return;
    setSortBy(isMistakeReview ? "lastPlayed" : "urgency");
  }, [isMistakeReview, positionSortOptions, sortBy]);

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
    if (!isMistakeReview) return;
    const validValues = new Set(mistakeSeverityOptions.map((option) => option.value));
    setMistakeSeverityFilters((current) => {
      const next = current.filter((filter) => validValues.has(filter));
      return next.length === current.length ? current : next;
    });
  }, [isMistakeReview, mistakeSeverityOptions]);

  useEffect(() => {
    if (!isMistakeReview || mistakeTimeControlFilter === "all") return;
    const validValues = new Set(mistakeTimeControlOptions.map((option) => option.value));
    if (!validValues.has(mistakeTimeControlFilter)) {
      setMistakeTimeControlFilter("all");
    }
  }, [isMistakeReview, mistakeTimeControlFilter, mistakeTimeControlOptions]);

  useEffect(() => {
    if (!showGapFilter && gapFilter !== "all") {
      setGapFilter("all");
      return;
    }
    if (gapFilter === "openingGap" && gapTypeCounts.openingGap === 0) setGapFilter("all");
    if (gapFilter === "planGap" && gapTypeCounts.planGap === 0) setGapFilter("all");
  }, [gapFilter, gapTypeCounts.openingGap, gapTypeCounts.planGap, showGapFilter]);

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
            onChange={(value) =>
              setSortBy(
                (value as OpeningReviewPositionSort) ??
                  (isMistakeReview ? "lastPlayed" : "urgency"),
              )
            }
            data={positionSortOptions}
            w={isMistakeReview ? 190 : 170}
            allowDeselect={false}
          />
          <MultiSelect
            label={isMistakeReview ? "Opening" : "Openings"}
            value={openingFilters}
            onChange={setOpeningFilters}
            data={openingOptions}
            searchable
            clearable
            placeholder={isMistakeReview ? "Any opening" : "All openings"}
            w={isMistakeReview ? 260 : 300}
            maxDropdownHeight={320}
          />
          {isMistakeReview && (
            <>
              <MultiSelect
                label="Quality"
                value={mistakeSeverityFilters}
                onChange={(value) =>
                  setMistakeSeverityFilters(value as MistakeReviewAttemptLabel[])
                }
                data={mistakeSeverityOptions}
                clearable
                placeholder="All"
                w={220}
                maxDropdownHeight={260}
              />
              <Select
                label="Type"
                value={mistakeNatureFilter}
                onChange={(value) =>
                  setMistakeNatureFilter((value as MistakeReviewNatureFilter) ?? "all")
                }
                data={mistakeNatureOptions}
                allowDeselect={false}
                w={150}
              />
              <Select
                label="Phase"
                value={mistakePhaseFilter}
                onChange={(value) =>
                  setMistakePhaseFilter((value as MistakeReviewPhaseFilter) ?? "all")
                }
                data={mistakePhaseOptions}
                allowDeselect={false}
                w={155}
              />
              <Select
                label="Think time"
                value={mistakeThinkTimeFilter}
                onChange={(value) =>
                  setMistakeThinkTimeFilter((value as MistakeReviewThinkTimeFilter) ?? "all")
                }
                data={[
                  { value: "all", label: "All" },
                  { value: "known", label: "Has clock" },
                  { value: "long", label: `Long think (${mistakeLongThinkThresholdText}+)` },
                  { value: "missing", label: "Missing clock" },
                ]}
                allowDeselect={false}
                w={145}
              />
              <Select
                label="Time control"
                value={mistakeTimeControlFilter}
                onChange={(value) => setMistakeTimeControlFilter(value ?? "all")}
                data={mistakeTimeControlOptions}
                allowDeselect={false}
                searchable
                w={180}
                maxDropdownHeight={260}
              />
            </>
          )}
          {showGapFilter && (
            <Select
              label="Gap type"
              value={gapFilter}
              onChange={(value) => setGapFilter((value as OpeningReviewGapFilter) ?? "all")}
              data={gapFilterOptions}
              allowDeselect={false}
              w={190}
            />
          )}
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
            label={isMistakeReview ? "Game date" : "Last played"}
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
            {reviewDueButtonLabel}
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
            {reviewAllButtonLabel}
            <Badge variant="light" ml={6}>
              {visibleIndices.length}
            </Badge>
          </Button>
        </Group>
        <Group gap="xs">
          <Badge variant="light">{visibleRows.length} shown</Badge>
          {showGapFilter && gapFilter !== "all" && activeGapFilterLabel && (
            <Badge variant="light" color={openingReviewGapTrainingTypeColor(gapFilter)}>
              {activeGapFilterLabel}
            </Badge>
          )}
          {openingFilters.length > 0 && (
            <Badge variant="light">
              Openings: {openingReviewFiltersDisplayName(openingFilters)}
            </Badge>
          )}
          {activeMistakeSeverityLabel && (
            <Badge variant="light">Quality: {activeMistakeSeverityLabel}</Badge>
          )}
          {activeMistakePhaseLabel && (
            <Badge variant="light" color="teal">
              Phase: {activeMistakePhaseLabel}
            </Badge>
          )}
          {activeMistakeNatureLabel && (
            <Badge
              variant="light"
              color={mistakeReviewNatureColor(mistakeNatureFilter as MistakeReviewNature)}
            >
              Type: {activeMistakeNatureLabel}
            </Badge>
          )}
          {activeMistakeThinkTimeLabel && (
            <Badge variant="light" color="orange">
              {activeMistakeThinkTimeLabel}
            </Badge>
          )}
          {activeMistakeTimeControlLabel && (
            <Badge variant="light">Time control: {activeMistakeTimeControlLabel}</Badge>
          )}
          {colourFilter !== "any" && (
            <Badge variant="light">{colourFilter === "white" ? "White" : "Black"} side</Badge>
          )}
          {dateFilterActive && (
            <Badge variant="light">
              {isMistakeReview ? "Game date" : "Last played"}:{" "}
              {formatOpeningHealthDateFilter(dateBounds)}
            </Badge>
          )}
        </Group>
      </Stack>
      <Box ref={setPositionsScrollElement} mah={640} style={{ overflow: "auto" }}>
        <Table miw={1320}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Position</Table.Th>
              <Table.Th>{isMistakeReview ? "Quality" : "Urgency"}</Table.Th>
              <Table.Th>Opening</Table.Th>
              <Table.Th>{isMistakeReview ? "Moves" : "Correct move"}</Table.Th>
              <Table.Th>{isMistakeReview ? "Game date" : "Last played"}</Table.Th>
              <Table.Th>{isMistakeReview ? "Think time" : "Imported"}</Table.Th>
              <Table.Th>{isMistakeReview ? "Evidence" : "Why"}</Table.Th>
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
              const colour = getReviewPositionFilterSide(position);
              const gapType = showGapFilter ? getOpeningReviewGapTrainingType(position) : "other";
              const moveSequence = getOpeningReviewMoveSequenceLabel(position);
              const openingDetail =
                opening.variation ?? (opening.rawName !== opening.family ? opening.rawName : null);
              const mistake = position.mistakeReview;
              const mistakeSeverity = mistake?.severity ?? "mistake";
              const mistakePhase = mistake ? getMistakeReviewPhase(position) : null;
              const mistakePhaseLabel = mistakePhase
                ? MISTAKE_REVIEW_PHASES.find((phase) => phase.id === mistakePhase)?.label
                : null;
              const mistakeNature = mistake ? getMistakeReviewNature(position) : null;
              const mistakeNatureLabel = mistakeNature
                ? mistakeReviewNatureLabel(mistakeNature)
                : null;
              const mistakeNatureConfidence = mistake
                ? getMistakeReviewNatureConfidence(position)
                : null;
              const mistakeThinkTime = mistake
                ? formatMistakeReviewThinkTime(mistake, mistakeLongThinkThresholdSeconds)
                : "Unknown";
              const mistakeTimeControl = getMistakeReviewTimeControlLabel(mistake);
              const mistakeLossText =
                mistake?.cpLoss === undefined ? null : `${Math.round(mistake.cpLoss)} cp`;
              const mistakeDropText =
                mistake?.winProbabilityDrop === undefined
                  ? null
                  : `${mistake.winProbabilityDrop.toFixed(1)}% win-prob`;
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
                      {isMistakeReview ? (
                        <>
                          <Badge
                            color={mistakeReviewAttemptColor(mistakeSeverity, "incorrect")}
                            variant="light"
                          >
                            {mistakeReviewSeverityLabel(mistakeSeverity)}
                          </Badge>
                          {mistakePhaseLabel && (
                            <Text size="xs" c="dimmed">
                              {mistakePhaseLabel}
                            </Text>
                          )}
                          {mistakeNature && mistakeNatureLabel && (
                            <Tooltip
                              label={`${mistakeNatureLabel}, ${mistakeNatureConfidence} confidence`}
                            >
                              <Badge
                                size="xs"
                                variant="light"
                                color={mistakeReviewNatureColor(mistakeNature)}
                              >
                                {mistakeNatureLabel}
                              </Badge>
                            </Tooltip>
                          )}
                          {isMistakeReviewLongThinkPosition(
                            position,
                            mistakeLongThinkThresholdSeconds,
                          ) && (
                            <Badge size="xs" variant="light" color="orange">
                              Long think
                            </Badge>
                          )}
                        </>
                      ) : (
                        <>
                          <Badge color={openingReviewUrgencyColor(urgency)} variant="light">
                            #{rank}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {urgency}/100
                          </Text>
                          {gapType !== "other" && (
                            <Badge
                              size="xs"
                              variant="light"
                              color={openingReviewGapTrainingTypeColor(gapType)}
                            >
                              {openingReviewGapTrainingTypeLabel(gapType)}
                            </Badge>
                          )}
                        </>
                      )}
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
                      {isMistakeReview ? (
                        <>
                          <Text fw={700}>{mistake?.playedMoveSan ?? "-"}</Text>
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            Best: {mistake?.bestMoveSan ?? position.answer}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text fw={700}>{position.answer}</Text>
                          {moveSequence && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {moveSequence}
                            </Text>
                          )}
                        </>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {formatReviewPositionLastPlayed(position)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {isMistakeReview ? (
                      <Stack gap={0}>
                        <Text size="sm" fw={700} lineClamp={1}>
                          {mistakeThinkTime}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          Clock after {formatMistakeReviewClock(mistake?.clockAfterSeconds)}
                        </Text>
                      </Stack>
                    ) : (
                      <Text size="sm" lineClamp={2}>
                        {formatImportedAt(position.importedAt)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {isMistakeReview ? (
                      <Stack gap={1}>
                        <Text size="sm" lineClamp={1}>
                          {getMistakeReviewOpponentLabel(position)}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {mistakeTimeControl}
                        </Text>
                        {(mistakeLossText || mistakeDropText) && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {[mistakeLossText, mistakeDropText].filter(Boolean).join(", ")}
                          </Text>
                        )}
                      </Stack>
                    ) : (
                      <>
                        <Text size="sm" lineClamp={2}>
                          {openingReviewPositionExplanation(position)}
                        </Text>
                        {position.evidence && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {position.evidence}
                          </Text>
                        )}
                      </>
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
