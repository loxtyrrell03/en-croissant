import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Paper,
  Portal,
  Progress,
  RangeSlider,
  RingProgress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { useSessionStorage } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconBrain,
  IconChartLine,
  IconDownload,
  IconFlame,
  IconListCheck,
  IconPlayerPlay,
  IconRefresh,
  IconRobot,
  IconSettings,
  IconTrash,
  IconX,
  IconZoomCheck,
} from "@tabler/icons-react";
import { save } from "@tauri-apps/plugin-dialog";
import { isNormal, makeSquare, makeUci, parseUci } from "chessops";
import { parseFen } from "chessops/fen";
import { useAtom, useSetAtom } from "jotai";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "zustand";
import {
  commands,
  type PuzzleAttemptResult,
  type PuzzleDashboard,
  type PuzzleDatabaseInfo,
  type PuzzleProgressSummary,
  type PuzzleThemeStatsRow,
  type PuzzleTrainingMode,
} from "@/bindings";
import { usePracticeAgainstBot } from "@/hooks/usePracticeAgainstBot";
import {
  activeTabAtom,
  currentPuzzleAtom,
  currentPuzzleTimerAtom,
  dailyGoalCompletionPromptAtom,
  dailyGoalHistoryAtom,
  dailyGoalsAtom,
  hidePuzzleRatingAtom,
  puzzleSelectionModeAtom,
  puzzleRatingRangeAtom,
  puzzleThemeAtom,
  selectedPuzzleDbAtom,
  tabsAtom,
  trackPuzzleTimeAtom,
} from "@/state/atoms";
import { positionFromFen } from "@/utils/chessops";
import { formatThemeLabel, formatTime } from "@/utils/format";
import { type Completion, getPuzzleDatabases, type Puzzle } from "@/utils/puzzles";
import {
  buildPuzzleTrendRows,
  formatPuzzleEloChange,
  getActivePuzzleGoals,
  puzzleNumber,
  PUZZLE_SELECTION_MODE_GUIDE,
  rankPuzzleThemes,
  type PuzzleSelectionMode,
  type PuzzleThemeSort,
} from "@/utils/puzzleTraining";
import { createTab } from "@/utils/tabs";
import { defaultTree } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";
import ChallengeHistory from "../common/ChallengeHistory";
import ConfirmModal from "../common/ConfirmModal";
import GameNotation from "../common/GameNotation";
import MoveControls from "../common/MoveControls";
import { TreeStateContext } from "../common/TreeStateContext";
import AddPuzzle from "./AddPuzzle";
import PuzzleBoard from "./PuzzleBoard";

const SMART_PUZZLE_RATING_RANGE: [number, number] = [600, 3000];

function backendModeForPuzzleSelection(
  mode: PuzzleSelectionMode,
  theme: string | null,
): PuzzleTrainingMode {
  if (mode === "smart") return "coach";
  return theme ? "themeFocus" : "random";
}

function Puzzles({ id }: { id: string }) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const setFen = useStore(store, (s) => s.setFen);
  const goToStart = useStore(store, (s) => s.goToStart);
  const reset = useStore(store, (s) => s.reset);
  const makeMove = useStore(store, (s) => s.makeMove);
  const setShapes = useStore(store, (s) => s.setShapes);
  const currentMove = useStore(store, (s) => s.currentNode().move);
  const practiceAgainstBot = usePracticeAgainstBot();
  const [puzzles, setPuzzles] = useSessionStorage<Puzzle[]>({
    key: `${id}-puzzles`,
    defaultValue: [],
  });
  const [currentPuzzle, setCurrentPuzzle] = useAtom(currentPuzzleAtom);

  const [puzzleDbs, setPuzzleDbs] = useState<PuzzleDatabaseInfo[]>([]);
  const [selectedDb, setSelectedDb] = useAtom(selectedPuzzleDbAtom);
  const previousSelectedDbRef = useRef<string | null | undefined>(undefined);

  const [settingsOpened, setSettingsOpened] = useState(false);
  const [panelView, setPanelView] = useState<string | null>("train");
  const [dashboard, setDashboard] = useState<PuzzleDashboard | null>(null);
  const [progressSummary, setProgressSummary] = useState<PuzzleProgressSummary | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [puzzleLoading, setPuzzleLoading] = useState(false);
  const [lastAttempt, setLastAttempt] = useState<PuzzleAttemptResult | null>(null);
  const [resetProgressModalOpened, setResetProgressModalOpened] = useState(false);
  const [addOpened, setAddOpened] = useState(false);
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const [isPlayingSolution, setIsPlayingSolution] = useState(false);
  const progressRequestIdRef = useRef(0);

  useEffect(() => {
    getPuzzleDatabases().then((databases) => {
      setPuzzleDbs(databases);
    });
  }, []);

  useEffect(() => {
    if (puzzleDbs.length === 0) return;
    if (selectedDb && puzzleDbs.some((database) => database.path === selectedDb)) return;
    setSelectedDb(puzzleDbs[0].path);
  }, [puzzleDbs, selectedDb, setSelectedDb]);

  const [ratingRange, setRatingRange] = useAtom(puzzleRatingRangeAtom);
  const [puzzleMode, setPuzzleMode] = useAtom(puzzleSelectionModeAtom);
  const [dailyGoals] = useAtom(dailyGoalsAtom);
  const [, setDailyGoalHistory] = useAtom(dailyGoalHistoryAtom);
  const [, setDailyGoalCompletionPrompt] = useAtom(dailyGoalCompletionPromptAtom);

  const [selectedTheme, setSelectedTheme] = useAtom(puzzleThemeAtom);
  const [availableThemes, setAvailableThemes] = useState<string[]>([]);
  const [themesTableMissing, setThemesTableMissing] = useState(false);
  const effectiveSelectedTheme =
    selectedTheme && availableThemes.includes(selectedTheme) ? selectedTheme : null;

  useEffect(() => {
    setThemesTableMissing(false);

    if (!selectedDb) {
      setAvailableThemes([]);
      return;
    }

    commands.getPuzzleThemes(selectedDb).then((res) => {
      if (res.status === "ok") {
        setAvailableThemes(res.data);
        return;
      }

      setAvailableThemes([]);

      if (typeof res.error === "string" && res.error.includes("no such table")) {
        setThemesTableMissing(true);
      }
    });
  }, [selectedDb]);

  const applyProgressSummary = useCallback((summary: PuzzleProgressSummary, force = false) => {
    setProgressSummary((previous) =>
      force || isNewerPuzzleSummary(summary, previous) ? summary : previous,
    );
    setDashboard((previous) => {
      if (!previous || previous.summary.dbKey !== summary.dbKey) return previous;
      if (!force && !isNewerPuzzleSummary(summary, previous.summary)) return previous;
      return { ...previous, summary };
    });
  }, []);

  const refreshPuzzleProgress = useCallback(
    async (db = selectedDb) => {
      if (!db) {
        setDashboard(null);
        setProgressSummary(null);
        setProgressError(null);
        return;
      }

      const requestId = ++progressRequestIdRef.current;
      setProgressLoading(true);
      setProgressError(null);
      try {
        const [summary, dashboard] = await Promise.all([
          commands.getPuzzleProgress(db),
          commands.getPuzzleDashboard(db, 90),
        ]);
        if (requestId !== progressRequestIdRef.current) return;
        if (summary.status === "ok") {
          applyProgressSummary(summary.data);
        } else {
          setProgressError(String(summary.error));
        }
        if (dashboard.status === "ok") {
          setDashboard((previous) =>
            isNewerPuzzleSummary(dashboard.data.summary, previous?.summary)
              ? dashboard.data
              : previous,
          );
          applyProgressSummary(dashboard.data.summary);
        } else {
          setProgressError(String(dashboard.error));
        }
      } finally {
        if (requestId === progressRequestIdRef.current) {
          setProgressLoading(false);
        }
      }
    },
    [applyProgressSummary, selectedDb],
  );

  useEffect(() => {
    void refreshPuzzleProgress();
  }, [refreshPuzzleProgress]);

  const [hideRating, setHideRating] = useAtom(hidePuzzleRatingAtom);
  const [trackTime, setTrackTime] = useAtom(trackPuzzleTimeAtom);

  const [timerStart, setTimerStart] = useAtom(currentPuzzleTimerAtom);
  const [, setTick] = useState(0);
  const isPuzzleIncomplete = puzzles[currentPuzzle]?.completion === "incomplete";
  const elapsedTime =
    timerStart && isPuzzleIncomplete && trackTime
      ? Date.now() - timerStart
      : puzzles[currentPuzzle]?.timeSpent || 0;

  const wonPuzzles = puzzles.filter((p) => p.completion === "correct");
  const lostPuzzles = puzzles.filter((p) => p.completion === "incorrect");

  const totalCompleted = wonPuzzles.length + lostPuzzles.length;
  const accuracy =
    totalCompleted > 0 ? Math.round((wonPuzzles.length / totalCompleted) * 100) : null;

  let currentStreak = 0;
  for (let i = puzzles.length - 1; i >= 0; i--) {
    if (puzzles[i].completion === "correct") currentStreak++;
    else if (puzzles[i].completion === "incorrect") break;
  }

  const avgTimeSeconds =
    wonPuzzles.length > 0
      ? wonPuzzles.reduce((acc, p) => acc + (p.timeSpent || 0), 0) / wonPuzzles.length / 1000
      : 0;

  const durableSummary = progressSummary ?? dashboard?.summary ?? null;
  const durableAttempts = toNumber(durableSummary?.totalAttempts);
  const durableCorrect = toNumber(durableSummary?.correctAttempts);
  const durableAccuracy =
    durableAttempts > 0 ? Math.round((durableCorrect / durableAttempts) * 100) : null;

  const incrementPuzzleDailyGoals = useCallback(() => {
    const puzzleGoals = getActivePuzzleGoals(dailyGoals);
    if (puzzleGoals.length === 0) return;

    const now = Date.now();
    const todayKey = getLocalDateKey();
    for (const goal of puzzleGoals) {
      let completed = false;
      setDailyGoalHistory((history) => {
        const entry = history[todayKey] ?? { counts: {} };
        const currentCount = entry.counts[goal.id] ?? 0;
        const nextCount = currentCount + 1;
        completed = currentCount < goal.target && nextCount >= goal.target;
        return {
          ...history,
          [todayKey]: {
            counts: {
              ...entry.counts,
              [goal.id]: nextCount,
            },
            completedAt: entry.completedAt ?? (completed ? now : undefined),
          },
        };
      });

      if (completed) {
        setDailyGoalCompletionPrompt({
          completedGoalTitle: goal.title,
          completedGoalKind: goal.kind,
          completedAt: now,
        });
      }
    }
  }, [dailyGoals, setDailyGoalCompletionPrompt, setDailyGoalHistory]);

  const setPuzzle = useCallback(
    (puzzle: { fen: string; moves: string[] }) => {
      setFen(puzzle.fen);
      makeMove({ payload: parseUci(puzzle.moves[0])! });
    },
    [makeMove, setFen],
  );

  const solutionAbortRef = useRef<AbortController | null>(null);
  const puzzleGenerationRef = useRef(false);
  const autoStartKeyRef = useRef<string | null>(null);

  const generatePuzzle = useCallback(
    async (db: string, force: boolean = false) => {
      if (puzzleGenerationRef.current) return;

      puzzleGenerationRef.current = true;
      setPuzzleLoading(true);
      try {
        let nextIndex = puzzles.findIndex(
          (p, i) => i > currentPuzzle && p.completion === "incomplete",
        );
        if (nextIndex === -1) {
          nextIndex = puzzles.findIndex(
            (p, i) => i < currentPuzzle && p.completion === "incomplete",
          );
        }

        if (nextIndex !== -1 && !force) {
          solutionAbortRef.current?.abort();
          setIsPlayingSolution(false);
          setCurrentPuzzle(nextIndex);
          setPuzzle(puzzles[nextIndex]);
          if (trackTime) {
            setTimerStart(Date.now() - (puzzles[nextIndex].timeSpent || 0));
          }
          setProgressError(null);
          return;
        }

        solutionAbortRef.current?.abort();
        setIsPlayingSolution(false);

        const mode = backendModeForPuzzleSelection(puzzleMode, effectiveSelectedTheme);
        const range = puzzleMode === "smart" ? SMART_PUZZLE_RATING_RANGE : ratingRange;
        const theme = puzzleMode === "manual" ? effectiveSelectedTheme : null;
        const res = await commands.getTrainingPuzzle(db, mode, range[0], range[1], theme);
        const candidate = unwrap(res);
        const puzzle = candidate.puzzle;
        const nextPuzzleIndex = puzzles.length;
        const newPuzzle: Puzzle = {
          ...puzzle,
          moves: puzzle.moves.split(" "),
          completion: "incomplete",
          themes: candidate.themes,
          trainingMode: candidate.mode,
          selectionReason: candidate.reason,
          progress: candidate.progress,
        };
        setPuzzles((puzzles) => [...puzzles, newPuzzle]);
        setCurrentPuzzle(nextPuzzleIndex);
        setPuzzle(newPuzzle);
        setProgressError(null);
        if (trackTime) {
          setTimerStart(Date.now());
        }
      } catch (error) {
        setProgressError(error instanceof Error ? error.message : String(error));
      } finally {
        puzzleGenerationRef.current = false;
        setPuzzleLoading(false);
      }
    },
    [
      currentPuzzle,
      effectiveSelectedTheme,
      puzzleMode,
      puzzles,
      ratingRange,
      setCurrentPuzzle,
      setPuzzles,
      setPuzzle,
      setTimerStart,
      trackTime,
    ],
  );

  useEffect(() => {
    if (!selectedDb || puzzles.length > 0 || puzzleLoading) return;

    const autoStartKey = [
      selectedDb,
      puzzleMode,
      puzzleMode === "manual" ? ratingRange[0] : SMART_PUZZLE_RATING_RANGE[0],
      puzzleMode === "manual" ? ratingRange[1] : SMART_PUZZLE_RATING_RANGE[1],
      puzzleMode === "manual" ? (effectiveSelectedTheme ?? "all") : "smart",
    ].join(":");
    if (autoStartKeyRef.current === autoStartKey) return;

    autoStartKeyRef.current = autoStartKey;
    void generatePuzzle(selectedDb, true);
  }, [
    effectiveSelectedTheme,
    generatePuzzle,
    puzzleMode,
    puzzleLoading,
    puzzles.length,
    ratingRange,
    selectedDb,
  ]);

  async function changeCompletion(
    completion: Completion,
    options: { usedHint?: boolean; viewedSolution?: boolean } = {},
  ) {
    const puzzleIndex = currentPuzzle;
    const timeSpent = timerStart !== null ? Date.now() - timerStart : 0;
    const puzzle = puzzles[puzzleIndex];
    if (!puzzle || puzzle.completion !== "incomplete") return;

    let attemptResult: PuzzleAttemptResult | null = null;
    const usedHint = Boolean(options.usedHint || puzzle.usedHint);
    const viewedSolution = Boolean(options.viewedSolution || puzzle.viewedSolution);

    setTimerStart(null);
    setPuzzles((puzzles) => {
      const next = [...puzzles];
      if (next[puzzleIndex]) {
        next[puzzleIndex] = {
          ...next[puzzleIndex],
          completion,
          timeSpent,
          usedHint,
          viewedSolution,
          attemptRecorded: false,
        };
      }
      return next;
    });

    incrementPuzzleDailyGoals();

    if (selectedDb && Number.isFinite(puzzle.id)) {
      const res = await commands.recordPuzzleAttempt(selectedDb, {
        puzzleId: puzzle.id,
        mode:
          puzzle.trainingMode ?? backendModeForPuzzleSelection(puzzleMode, effectiveSelectedTheme),
        outcome: completion === "correct" ? "correct" : "incorrect",
        timeSpentMs: BigInt(Math.max(0, Math.round(timeSpent))),
        usedHint,
        viewedSolution,
      });

      if (res.status === "ok") {
        attemptResult = res.data;
        setLastAttempt(res.data);
        applyProgressSummary(res.data.summary, true);
        setDashboard((dashboard) =>
          mergePuzzleAttemptIntoDashboard(dashboard, res.data, {
            success: completion === "correct" && !usedHint && !viewedSolution,
            timeSpentMs: timeSpent,
          }),
        );
        setProgressError(null);
      } else {
        setProgressError(String(res.error));
      }
    } else if (!selectedDb) {
      setProgressError("Select a puzzle database before recording puzzle progress.");
    } else {
      setProgressError(`Puzzle ${puzzle.id} could not be recorded.`);
    }

    setPuzzles((puzzles) => {
      const next = [...puzzles];
      if (next[puzzleIndex]) {
        next[puzzleIndex] = {
          ...next[puzzleIndex],
          attemptRecorded: attemptResult ? true : undefined,
          ...(attemptResult
            ? {
                themes: attemptResult.themes,
                progress: attemptResult.card,
                eloAfter: attemptResult.eloAfter,
                eloDelta: attemptResult.eloDelta,
              }
            : {}),
        };
      }
      return next;
    });

    if (selectedDb) {
      void refreshPuzzleProgress(selectedDb);
    }
  }

  useEffect(() => {
    if (previousSelectedDbRef.current === undefined) {
      previousSelectedDbRef.current = selectedDb;
      return;
    }
    if (previousSelectedDbRef.current === selectedDb) return;

    previousSelectedDbRef.current = selectedDb;
    autoStartKeyRef.current = null;
    solutionAbortRef.current?.abort();
    setPuzzles([]);
    setCurrentPuzzle(0);
    reset();
    setTimerStart(null);
    setLastAttempt(null);
    setIsPlayingSolution(false);
  }, [reset, selectedDb, setCurrentPuzzle, setPuzzles, setTimerStart]);

  useEffect(() => {
    if (trackTime && isPuzzleIncomplete && timerStart === null) {
      setTimerStart(Date.now());
    }
  }, [trackTime, isPuzzleIncomplete, timerStart, setTimerStart]);

  useEffect(() => {
    if (!trackTime || !isPuzzleIncomplete || timerStart === null) return;

    const displayInterval = setInterval(() => {
      setTick((t) => t + 1);
    }, 100);

    return () => clearInterval(displayInterval);
  }, [trackTime, isPuzzleIncomplete, timerStart]);

  useEffect(() => {
    return () => {
      if (trackTime && timerStart !== null && isPuzzleIncomplete) {
        const finalElapsed = Date.now() - timerStart;
        setPuzzles((prev) => {
          const newPuzzles = [...prev];
          if (newPuzzles[currentPuzzle]) {
            newPuzzles[currentPuzzle].timeSpent = finalElapsed;
          }
          return newPuzzles;
        });
      }
    };
  }, [trackTime, timerStart, currentPuzzle, isPuzzleIncomplete, setPuzzles]);

  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

  const turnToMove =
    puzzles[currentPuzzle] !== undefined
      ? positionFromFen(puzzles[currentPuzzle]?.fen)[0]?.turn
      : null;

  const currentlyOnLastMoveOrNoLastMove = (): boolean => {
    if (!currentMove) return true;

    const moves = puzzles[currentPuzzle]?.moves;
    if (!moves) return true;

    const lastMoveIndex = moves.indexOf(makeUci(currentMove));
    return lastMoveIndex + 1 === moves.length;
  };

  const nextMoveUci = () => {
    const curPuzzle = puzzles[currentPuzzle];
    if (!curPuzzle || !currentMove) return;

    const indexOfNextMoveToPlay = curPuzzle.moves.indexOf(makeUci(currentMove)) + 1;
    const nextMoveUci = curPuzzle.moves[indexOfNextMoveToPlay];
    if (!nextMoveUci) return;

    const nextMove = parseUci(nextMoveUci);
    if (!nextMove || !isNormal(nextMove)) return;

    return nextMove;
  };

  const currentSessionPuzzle = puzzles[currentPuzzle];
  const activePanelView = panelView === "themes" ? "stats" : panelView;

  function clearSession() {
    autoStartKeyRef.current = null;
    setPuzzles([]);
    reset();
    setTimerStart(null);
    setIsPlayingSolution(false);
    setLastAttempt(null);
  }

  function analyzeCurrentPuzzle() {
    if (!currentSessionPuzzle) return;
    createTab({
      tab: {
        name: "Puzzle Analysis",
        type: "analysis",
      },
      setTabs,
      setActiveTab,
      pgn: currentSessionPuzzle.moves.join(" "),
      headers: {
        ...defaultTree().headers,
        fen: currentSessionPuzzle.fen,
        orientation:
          parseFen(currentSessionPuzzle.fen).unwrap().turn === "white" ? "black" : "white",
      },
    });
  }

  async function showHint() {
    solutionAbortRef.current?.abort();
    setIsPlayingSolution(false);
    const abortController = new AbortController();
    solutionAbortRef.current = abortController;
    const curPuzzle = currentSessionPuzzle;
    if (!curPuzzle) return;

    if (curPuzzle.completion === "incomplete") {
      await changeCompletion("incorrect", { usedHint: true });
    }

    if (currentlyOnLastMoveOrNoLastMove()) return;

    const nextMove = nextMoveUci();
    if (!nextMove) return;

    const from = makeSquare(nextMove.from);
    const to = makeSquare(nextMove.to);
    const currentShapes = store.getState().currentNode().shapes;

    const hasCircle = currentShapes.some((s) => s.orig === from && !s.dest);
    const hasArrow = currentShapes.some((s) => s.orig === from && s.dest === to);

    if (hasArrow) {
      setShapes(currentShapes.filter((s) => !(s.orig === from && (!s.dest || s.dest === to))));
    } else if (hasCircle) {
      setShapes([
        ...currentShapes.filter((s) => !(s.orig === from && !s.dest)),
        { orig: from, dest: to, brush: "green" },
      ]);
    } else {
      setShapes([...currentShapes, { orig: from, dest: undefined, brush: "green" }]);
    }
  }

  async function viewSolution() {
    solutionAbortRef.current?.abort();
    const abortController = new AbortController();
    solutionAbortRef.current = abortController;

    const curPuzzle = currentSessionPuzzle;
    if (!curPuzzle) return;
    if (curPuzzle.completion === "incomplete") {
      await changeCompletion("incorrect", { viewedSolution: true });
    }
    setIsPlayingSolution(true);
    goToStart();
    for (let i = 0; i < curPuzzle.moves.length; i++) {
      if (abortController.signal.aborted) break;
      makeMove({
        payload: parseUci(curPuzzle.moves[i])!,
        mainline: true,
      });
      await new Promise((r) => setTimeout(r, 500));
    }
    setIsPlayingSolution(false);
  }

  async function resetPuzzleProgress() {
    if (!selectedDb) return;
    const res = await commands.resetPuzzleProgress(selectedDb);
    if (res.status === "ok") {
      setProgressSummary(res.data);
      setDashboard(null);
      setLastAttempt(null);
      autoStartKeyRef.current = null;
      setPuzzles([]);
      reset();
      setTimerStart(null);
      await refreshPuzzleProgress(selectedDb);
    } else {
      setProgressError(String(res.error));
    }
  }

  async function exportPuzzleProgress() {
    if (!selectedDb) return;
    const target = await save({
      defaultPath: "puzzle-progress.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!target) return;
    const res = await commands.exportPuzzleProgress(selectedDb, target);
    if (res.status === "error") {
      setProgressError(String(res.error));
    }
  }

  return (
    <>
      <Portal target="#left" style={{ height: "100%" }}>
        <PuzzleBoard
          key={currentPuzzle}
          puzzles={puzzles}
          currentPuzzle={currentPuzzle}
          changeCompletion={changeCompletion}
        />
      </Portal>
      <Portal target="#topRight" style={{ height: "100%" }}>
        <Paper
          h="100%"
          withBorder
          p="md"
          style={{
            overflow: "hidden",
          }}
        >
          <AddPuzzle
            puzzleDbs={puzzleDbs}
            opened={addOpened}
            setOpened={setAddOpened}
            setPuzzleDbs={setPuzzleDbs}
          />
          <ConfirmModal
            title="Delete Puzzle Database"
            description="Are you sure you want to delete this puzzle database?"
            opened={deleteModalOpened}
            onClose={() => setDeleteModalOpened(false)}
            onConfirm={async () => {
              if (selectedDb) {
                await commands.deletePuzzleDatabase(selectedDb);
                setPuzzleDbs((dbs) => dbs.filter((db) => db.path !== selectedDb));
                setSelectedDb(null);
                autoStartKeyRef.current = null;
                setPuzzles([]);
                reset();
                setTimerStart(null);
                setIsPlayingSolution(false);
              }
              setDeleteModalOpened(false);
            }}
          />
          <Group justify="space-between" pb="sm">
            <Select
              style={{ flex: 1 }}
              data={puzzleDbs
                .map((p) => ({
                  label: p.title.split(".db3")[0],
                  value: p.path,
                }))
                .concat({ label: `+ ${t("Common.AddNew")}`, value: "add" })}
              value={selectedDb}
              clearable={false}
              placeholder={t("Puzzle.SelectDatabase")}
              onChange={(v) => {
                if (v === "add") {
                  setAddOpened(true);
                } else {
                  setSelectedDb(v);
                }
              }}
            />
            <Group gap="xs">
              <Tooltip label="Delete database">
                <ActionIcon
                  color="red"
                  disabled={!selectedDb}
                  onClick={() => setDeleteModalOpened(true)}
                >
                  <IconTrash size={20} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("SideBar.Settings")}>
                <ActionIcon onClick={() => setSettingsOpened((o) => !o)}>
                  <IconSettings size={20} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <Accordion
            value={settingsOpened ? "settings" : null}
            onChange={(v) => setSettingsOpened(v === "settings")}
            mb="sm"
          >
            <Accordion.Item value="settings">
              <Accordion.Panel>
                <Stack gap="md">
                  {themesTableMissing && (
                    <Alert
                      icon={<IconAlertTriangle />}
                      title="Puzzle database outdated"
                      color="yellow"
                    >
                      This database does not support themes. Update to the latest puzzle DB.
                    </Alert>
                  )}
                  <SimpleGrid cols={2} spacing="sm">
                    <Switch
                      label={t("Puzzle.HideRating")}
                      description={t("Puzzle.HideRating.Desc")}
                      checked={hideRating}
                      onChange={(event) => setHideRating(event.currentTarget.checked)}
                    />
                    <Switch
                      label={t("Puzzle.TrackPuzzleTime")}
                      description={t("Puzzle.TrackPuzzleTime.Desc")}
                      checked={trackTime}
                      onChange={(event) => {
                        if (!event.currentTarget.checked) {
                          setTimerStart(null);
                          setTrackTime(false);
                        } else {
                          setTrackTime(true);
                        }
                      }}
                    />
                  </SimpleGrid>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
          {progressError && (
            <Alert icon={<IconAlertTriangle />} color="red" mb="sm">
              {progressError}
            </Alert>
          )}
          <Tabs
            value={activePanelView}
            onChange={(value) => setPanelView(value ?? "train")}
            h={settingsOpened ? "calc(100% - 11rem)" : "calc(100% - 5.5rem)"}
            style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
          >
            <Tabs.List grow>
              <Tabs.Tab value="train" leftSection={<IconBrain size={16} />}>
                Train
              </Tabs.Tab>
              <Tabs.Tab value="stats" leftSection={<IconChartLine size={16} />}>
                Stats
              </Tabs.Tab>
              <Tabs.Tab value="srs" leftSection={<IconListCheck size={16} />}>
                SRS
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="train" h="100%" pt="sm" style={{ minHeight: 0 }}>
              <ScrollArea h="100%" offsetScrollbars>
                <PuzzleTrainPanel
                  selectedDb={selectedDb}
                  currentPuzzle={currentSessionPuzzle}
                  durableSummary={durableSummary}
                  durableAccuracy={durableAccuracy}
                  sessionAccuracy={accuracy}
                  currentStreak={currentStreak}
                  avgTimeSeconds={avgTimeSeconds}
                  progressLoading={progressLoading}
                  puzzleLoading={puzzleLoading}
                  hideRating={hideRating}
                  trackTime={trackTime}
                  elapsedTime={elapsedTime}
                  turnToMove={turnToMove ?? null}
                  puzzleMode={puzzleMode}
                  setPuzzleMode={setPuzzleMode}
                  ratingRange={ratingRange}
                  setRatingRange={setRatingRange}
                  selectedTheme={effectiveSelectedTheme}
                  setSelectedTheme={setSelectedTheme}
                  availableThemes={availableThemes}
                  lastAttempt={lastAttempt}
                  onNewPuzzle={() => selectedDb && generatePuzzle(selectedDb, true)}
                  onAnalyze={analyzeCurrentPuzzle}
                  onPracticeBot={practiceAgainstBot}
                  onClearSession={clearSession}
                  onHint={showHint}
                  onViewSolution={viewSolution}
                  hintDisabled={
                    puzzles.length === 0 || currentlyOnLastMoveOrNoLastMove() || isPlayingSolution
                  }
                  solutionDisabled={puzzles.length === 0}
                />
              </ScrollArea>
            </Tabs.Panel>
            <Tabs.Panel value="stats" h="100%" pt="sm" style={{ minHeight: 0 }}>
              <ScrollArea h="100%" offsetScrollbars>
                <PuzzleStatsPanel dashboard={dashboard} summary={durableSummary} />
              </ScrollArea>
            </Tabs.Panel>
            <Tabs.Panel value="srs" h="100%" pt="sm" style={{ minHeight: 0 }}>
              <ScrollArea h="100%" offsetScrollbars>
                <PuzzleSrsPanel
                  dashboard={dashboard}
                  selectedDb={selectedDb}
                  onRefresh={() => void refreshPuzzleProgress()}
                  onReset={() => setResetProgressModalOpened(true)}
                  onExport={exportPuzzleProgress}
                />
              </ScrollArea>
            </Tabs.Panel>
          </Tabs>
          <ConfirmModal
            title="Reset Puzzle Progress"
            description="Reset the Elo, SRS cards, theme stats, and attempt history for this puzzle database?"
            opened={resetProgressModalOpened}
            onClose={() => setResetProgressModalOpened(false)}
            onConfirm={async () => {
              await resetPuzzleProgress();
              setResetProgressModalOpened(false);
            }}
          />
        </Paper>
      </Portal>
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        <Stack h="100%" gap="xs">
          <Paper withBorder p="md" mih="5rem">
            <ScrollArea h="100%" offsetScrollbars>
              <ChallengeHistory
                challenges={puzzles.map((p) => ({
                  ...p,
                  label: p.rating?.toString() ?? "-",
                }))}
                current={currentPuzzle}
                select={(i) => {
                  if (i === currentPuzzle) return;
                  solutionAbortRef.current?.abort();
                  setIsPlayingSolution(false);
                  setCurrentPuzzle(i);
                  setPuzzle(puzzles[i]);
                  if (puzzles[i].completion === "incomplete") {
                    setTimerStart(Date.now() - (puzzles[i].timeSpent || 0));
                  } else {
                    setTimerStart(null);
                  }
                }}
              />
            </ScrollArea>
          </Paper>
          <Stack flex={1} gap="xs">
            <GameNotation />
            <MoveControls readOnly />
          </Stack>
        </Stack>
      </Portal>
    </>
  );
}

function PuzzleTrainPanel({
  selectedDb,
  currentPuzzle,
  durableSummary,
  durableAccuracy,
  sessionAccuracy,
  currentStreak,
  avgTimeSeconds,
  progressLoading,
  puzzleLoading,
  hideRating,
  trackTime,
  elapsedTime,
  turnToMove,
  puzzleMode,
  setPuzzleMode,
  ratingRange,
  setRatingRange,
  selectedTheme,
  setSelectedTheme,
  availableThemes,
  lastAttempt,
  onNewPuzzle,
  onAnalyze,
  onPracticeBot,
  onClearSession,
  onHint,
  onViewSolution,
  hintDisabled,
  solutionDisabled,
}: {
  selectedDb: string | null;
  currentPuzzle?: Puzzle;
  durableSummary: PuzzleProgressSummary | null;
  durableAccuracy: number | null;
  sessionAccuracy: number | null;
  currentStreak: number;
  avgTimeSeconds: number;
  progressLoading: boolean;
  puzzleLoading: boolean;
  hideRating: boolean;
  trackTime: boolean;
  elapsedTime: number;
  turnToMove: "white" | "black" | null;
  puzzleMode: PuzzleSelectionMode;
  setPuzzleMode: (mode: PuzzleSelectionMode) => void;
  ratingRange: [number, number];
  setRatingRange: (range: [number, number]) => void;
  selectedTheme: string | null;
  setSelectedTheme: (theme: string | null) => void;
  availableThemes: string[];
  lastAttempt: PuzzleAttemptResult | null;
  onNewPuzzle: () => void;
  onAnalyze: () => void;
  onPracticeBot: () => void;
  onClearSession: () => void;
  onHint: () => void | Promise<void>;
  onViewSolution: () => void | Promise<void>;
  hintDisabled: boolean;
  solutionDisabled: boolean;
}) {
  const puzzleRating =
    currentPuzzle && currentPuzzle.completion === "incomplete" && hideRating
      ? "?"
      : (currentPuzzle?.rating?.toString() ?? "-");
  const activeModeGuide = PUZZLE_SELECTION_MODE_GUIDE[puzzleMode];
  const currentThemes = currentPuzzle?.themes ?? [];
  const isCompleted = currentPuzzle !== undefined && currentPuzzle.completion !== "incomplete";
  const completedEloDelta = isCompleted
    ? (currentPuzzle.eloDelta ?? lastAttempt?.eloDelta)
    : undefined;
  const lastEloDelta = completedEloDelta ?? lastAttempt?.eloDelta;
  const newPuzzleLabel = !currentPuzzle
    ? "Start training"
    : currentPuzzle.completion === "incomplete"
      ? "New puzzle"
      : "Next puzzle";

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={puzzleMode}
        onChange={(value) => setPuzzleMode(value as PuzzleSelectionMode)}
        data={[
          { label: PUZZLE_SELECTION_MODE_GUIDE.smart.label, value: "smart" },
          { label: PUZZLE_SELECTION_MODE_GUIDE.manual.label, value: "manual" },
        ]}
      />
      <Paper withBorder p="xs">
        <Stack gap={6}>
          <Group justify="space-between" gap="xs">
            <Text size="sm" fw={700}>
              {activeModeGuide.label}
            </Text>
            {lastEloDelta !== undefined && (
              <Badge color={lastEloDelta >= 0 ? "teal" : "orange"} variant="light">
                Last Elo {formatPuzzleEloChange(lastEloDelta)}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {activeModeGuide.purpose}
          </Text>
        </Stack>
      </Paper>
      {puzzleMode === "manual" && (
        <Paper withBorder p="xs">
          <Stack gap="sm">
            <div>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={500}>
                  Rating range
                </Text>
                <Badge variant="light">
                  {ratingRange[0]}-{ratingRange[1]}
                </Badge>
              </Group>
              <RangeSlider
                min={600}
                max={2800}
                value={ratingRange}
                onChange={setRatingRange}
                marks={[
                  { value: 600, label: "600" },
                  { value: 1700, label: "1700" },
                  { value: 2800, label: "2800" },
                ]}
              />
            </div>
            <Select
              label="Theme"
              placeholder="All themes"
              data={availableThemes.map((theme) => ({
                label: formatThemeLabel(theme),
                value: theme,
              }))}
              value={selectedTheme}
              onChange={setSelectedTheme}
              clearable
              searchable
            />
          </Stack>
        </Paper>
      )}
      <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs">
        <PuzzleStatTile label="Puzzle Elo" value={formatRating(durableSummary?.puzzleElo)} />
        <PuzzleStatTile
          label="Last change"
          value={formatPuzzleEloChange(lastEloDelta)}
          color={lastEloDelta === undefined ? "dimmed" : lastEloDelta >= 0 ? "teal" : "orange"}
        />
        <PuzzleStatTile
          label="Database accuracy"
          value={durableAccuracy === null ? "-" : `${durableAccuracy}%`}
          color={durableAccuracy === null ? "dimmed" : durableAccuracy >= 60 ? "teal" : "orange"}
        />
        <PuzzleStatTile
          label="Due now"
          value={progressLoading ? "..." : toNumber(durableSummary?.due).toString()}
          color={toNumber(durableSummary?.due) > 0 ? "yellow" : "dimmed"}
        />
        <PuzzleStatTile
          label="Mastered"
          value={toNumber(durableSummary?.mastered).toString()}
          color="teal"
        />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        <PuzzleStatTile label="Puzzle rating" value={puzzleRating} />
        {trackTime && <PuzzleStatTile label="Time" value={formatTime(elapsedTime)} mono />}
        <PuzzleStatTile
          label="Session accuracy"
          value={sessionAccuracy !== null ? `${sessionAccuracy}%` : "-"}
        />
        <PuzzleStatTile
          label="Streak"
          value={
            <Group gap={3}>
              <Text fw={700}>{currentStreak}</Text>
              <IconFlame size={16} color="orange" />
            </Group>
          }
        />
      </SimpleGrid>
      {trackTime && avgTimeSeconds > 0 && (
        <Text size="xs" c="dimmed">
          Average correct solve time this session: {avgTimeSeconds.toFixed(1)}s
        </Text>
      )}
      {isCompleted && (
        <Alert
          color={currentPuzzle.completion === "correct" ? "teal" : "orange"}
          variant="light"
          p="xs"
        >
          <Stack gap={4}>
            <Group justify="space-between" gap="xs">
              <Text size="sm" fw={700}>
                {currentPuzzle.completion === "correct" ? "Solved" : "Review scheduled"}
              </Text>
              {currentPuzzle.progress && (
                <Badge variant="light">{formatSrsState(currentPuzzle.progress.state)}</Badge>
              )}
            </Group>
            <Group gap="xs">
              {trackTime && (
                <Badge variant="outline">Time {formatTime(currentPuzzle.timeSpent ?? 0)}</Badge>
              )}
              {currentPuzzle.attemptRecorded === false && selectedDb && (
                <Badge variant="outline">Saving result</Badge>
              )}
              {completedEloDelta !== undefined && (
                <Badge color={completedEloDelta >= 0 ? "teal" : "orange"} variant="outline">
                  Elo {formatPuzzleEloChange(completedEloDelta)}
                </Badge>
              )}
              {currentPuzzle.eloAfter !== undefined && (
                <Badge variant="outline">Now {formatRating(currentPuzzle.eloAfter)}</Badge>
              )}
            </Group>
          </Stack>
        </Alert>
      )}
      {currentPuzzle?.selectionReason && !isCompleted && (
        <Alert color="blue" variant="light" p="xs">
          <Group justify="space-between" gap="xs">
            <Text size="sm">{currentPuzzle.selectionReason}</Text>
            {currentPuzzle.progress && (
              <Badge variant="light">{formatSrsState(currentPuzzle.progress.state)}</Badge>
            )}
          </Group>
        </Alert>
      )}
      {currentThemes.length > 0 && (
        <Group gap="xs">
          {currentThemes.map((theme) => (
            <Badge key={theme} variant="light" size="sm">
              {formatThemeLabel(theme)}
            </Badge>
          ))}
        </Group>
      )}
      <Group justify="space-between">
        <Text fz="1.5rem" fw={500}>
          {!turnToMove ? "" : turnToMove === "white" ? "Black to move" : "White to move"}
        </Text>
        <Group gap="xs">
          <Button
            size="xs"
            leftSection={<IconPlayerPlay size={16} />}
            disabled={!selectedDb}
            loading={puzzleLoading}
            onClick={onNewPuzzle}
          >
            {newPuzzleLabel}
          </Button>
          <Tooltip label="Analyze position">
            <ActionIcon disabled={!currentPuzzle} onClick={onAnalyze}>
              <IconZoomCheck />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Practice against bot">
            <ActionIcon disabled={!currentPuzzle} onClick={onPracticeBot}>
              <IconRobot />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Clear session">
            <ActionIcon onClick={onClearSession}>
              <IconX />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Group grow>
        <Button variant="light" onClick={onHint} disabled={hintDisabled}>
          Get a Hint
        </Button>
        <Button variant="light" onClick={onViewSolution} disabled={solutionDisabled}>
          View Solution
        </Button>
      </Group>
    </Stack>
  );
}

function PuzzleStatsPanel({
  dashboard,
  summary,
}: {
  dashboard: PuzzleDashboard | null;
  summary: PuzzleProgressSummary | null;
}) {
  const trendData = useMemo(() => buildPuzzleTrendRows(dashboard?.trends ?? []), [dashboard]);

  if (!summary) {
    return (
      <Center h={200}>
        <Text c="dimmed">Select a puzzle database to see training stats.</Text>
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        <PuzzleStatTile label="Puzzle Elo" value={formatRating(summary.puzzleElo)} />
        <PuzzleStatTile label="Attempts" value={toNumber(summary.totalAttempts).toString()} />
        <PuzzleStatTile label="Correct" value={toNumber(summary.correctAttempts).toString()} />
        <PuzzleStatTile label="Themes" value={toNumber(summary.themesTracked).toString()} />
      </SimpleGrid>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600} mb="xs">
          Elo over time
        </Text>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis domain={["dataMin - 50", "dataMax + 50"]} tick={{ fontSize: 10 }} />
              <RechartsTooltip />
              <Area
                type="monotone"
                dataKey="elo"
                stroke="var(--mantine-color-blue-filled)"
                fill="var(--mantine-color-blue-light)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Text size="sm" c="dimmed">
            Complete a puzzle to start the Elo timeline.
          </Text>
        )}
      </Paper>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600} mb="xs">
          Attempts and accuracy
        </Text>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <RechartsTooltip />
              <Bar yAxisId="left" dataKey="attempts" fill="var(--mantine-color-blue-filled)" />
              <Bar yAxisId="right" dataKey="accuracy" fill="var(--mantine-color-teal-filled)" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Text size="sm" c="dimmed">
            Daily volume and accuracy will appear after your first attempt.
          </Text>
        )}
      </Paper>
      <PuzzleThemesPanel dashboard={dashboard} />
    </Stack>
  );
}

function PuzzleThemesPanel({ dashboard }: { dashboard: PuzzleDashboard | null }) {
  const [sort, setSort] = useState<string | null>("weakness");
  const rows = useMemo(() => {
    return rankPuzzleThemes(dashboard?.themes ?? [], sort as PuzzleThemeSort | null);
  }, [dashboard, sort]);

  if (!dashboard || rows.length === 0) {
    return (
      <Center h={200}>
        <Text c="dimmed">Theme strengths and weaknesses appear after completed puzzles.</Text>
      </Center>
    );
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>Theme performance</Text>
        <Select
          w={170}
          size="xs"
          value={sort}
          onChange={setSort}
          data={[
            { value: "weakness", label: "Weakest first" },
            { value: "accuracy", label: "Accuracy" },
            { value: "skill", label: "Skill" },
            { value: "attempts", label: "Attempts" },
            { value: "recent", label: "Recent form" },
          ]}
        />
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Theme</Table.Th>
            <Table.Th ta="right">Skill</Table.Th>
            <Table.Th ta="right">Acc</Table.Th>
            <Table.Th ta="right">Recent</Table.Th>
            <Table.Th ta="right">Due</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.slice(0, 40).map((row) => (
            <PuzzleThemeRow key={row.theme} row={row} />
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function PuzzleThemeRow({ row }: { row: PuzzleThemeStatsRow }) {
  const attempts = toNumber(row.attempts);
  const due = toNumber(row.due);
  return (
    <Table.Tr>
      <Table.Td>
        <Stack gap={2}>
          <Group gap="xs">
            <Text size="sm" fw={500}>
              {formatThemeLabel(row.theme)}
            </Text>
            {row.weaknessScore > 0 && (
              <Badge size="xs" color="orange">
                Weakness
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {attempts} attempts, avg {formatCompactTime(row.averageTimeMs)}
          </Text>
          <Progress value={Math.min(100, row.weaknessScore / 4)} color="orange" size="xs" />
        </Stack>
      </Table.Td>
      <Table.Td ta="right">{formatRating(row.skill)}</Table.Td>
      <Table.Td ta="right">{formatPercent(row.accuracy)}</Table.Td>
      <Table.Td ta="right">
        {toNumber(row.recentAttempts) > 0 ? formatPercent(row.recentAccuracy) : "-"}
      </Table.Td>
      <Table.Td ta="right">{due}</Table.Td>
    </Table.Tr>
  );
}

function PuzzleSrsPanel({
  dashboard,
  selectedDb,
  onRefresh,
  onReset,
  onExport,
}: {
  dashboard: PuzzleDashboard | null;
  selectedDb: string | null;
  onRefresh: () => void;
  onReset: () => void;
  onExport: () => void | Promise<void>;
}) {
  const counts = dashboard?.srsCounts;
  const dueCards = dashboard?.dueCards ?? [];
  const totalCards =
    toNumber(counts?.learning) +
    toNumber(counts?.relearning) +
    toNumber(counts?.review) +
    toNumber(counts?.mastered);
  const masteredPercent =
    totalCards > 0 ? Math.round((toNumber(counts?.mastered) / totalCards) * 100) : 0;

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={onRefresh}
          >
            Refresh
          </Button>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconDownload size={16} />}
            disabled={!selectedDb}
            onClick={onExport}
          >
            Export
          </Button>
        </Group>
        <Button size="xs" color="red" variant="light" disabled={!selectedDb} onClick={onReset}>
          Reset
        </Button>
      </Group>
      <Group align="center">
        <RingProgress
          size={110}
          thickness={10}
          sections={[{ value: masteredPercent, color: "teal" }]}
          label={
            <Text ta="center" size="xs" fw={700}>
              {masteredPercent}%
            </Text>
          }
        />
        <SimpleGrid cols={2} spacing="xs" style={{ flex: 1 }}>
          <PuzzleStatTile label="Due" value={toNumber(counts?.due).toString()} color="yellow" />
          <PuzzleStatTile label="Learning" value={toNumber(counts?.learning).toString()} />
          <PuzzleStatTile label="Relearning" value={toNumber(counts?.relearning).toString()} />
          <PuzzleStatTile label="Review" value={toNumber(counts?.review).toString()} />
        </SimpleGrid>
      </Group>
      <Divider />
      <Text fw={600}>Next reviews</Text>
      {dueCards.length === 0 ? (
        <Text size="sm" c="dimmed">
          No SRS cards yet. Failed and reviewed puzzles will appear here.
        </Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Puzzle</Table.Th>
              <Table.Th>State</Table.Th>
              <Table.Th ta="right">Due</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {dueCards.slice(0, 20).map((card) => (
              <Table.Tr key={card.puzzleId}>
                <Table.Td>
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      #{card.puzzleId} - {card.rating}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {card.themes.slice(0, 3).map(formatThemeLabel).join(", ") || "No themes"}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light">{formatSrsState(card.state)}</Badge>
                </Table.Td>
                <Table.Td ta="right">{formatDueTime(card.dueAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function PuzzleStatTile({
  label,
  value,
  color,
  mono,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  mono?: boolean;
}) {
  return (
    <Paper withBorder p="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="lg" c={color} ff={mono ? "monospace" : undefined}>
        {value}
      </Text>
    </Paper>
  );
}

function toNumber(value: bigint | number | null | undefined) {
  return puzzleNumber(value);
}

function formatRating(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(1);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatCompactTime(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function formatSrsState(state: string) {
  return state.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

function formatDueTime(value: bigint | number) {
  const due = toNumber(value);
  const diff = due - Date.now();
  if (diff <= 0) return "Now";
  if (diff < 60_000) return "< 1m";
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / (60 * 60_000))}h`;
  return `${Math.round(diff / (24 * 60 * 60_000))}d`;
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isNewerPuzzleSummary(
  next: PuzzleProgressSummary,
  previous: PuzzleProgressSummary | null | undefined,
) {
  if (!previous) return true;
  if (next.dbKey !== previous.dbKey) return true;

  const nextUpdatedAt = toNumber(next.updatedAt);
  const previousUpdatedAt = toNumber(previous.updatedAt);
  if (nextUpdatedAt !== previousUpdatedAt) return nextUpdatedAt > previousUpdatedAt;

  return toNumber(next.totalAttempts) >= toNumber(previous.totalAttempts);
}

function mergePuzzleAttemptIntoDashboard(
  dashboard: PuzzleDashboard | null,
  attempt: PuzzleAttemptResult,
  options: { success: boolean; timeSpentMs: number },
): PuzzleDashboard | null {
  if (!dashboard || dashboard.summary.dbKey !== attempt.summary.dbKey) return dashboard;

  const deltaByTheme = new Map(attempt.themeDeltas.map((delta) => [delta.theme, delta]));
  const attemptedThemes = new Set(attempt.themeDeltas.map((delta) => delta.theme));
  if (attemptedThemes.size === 0) {
    return { ...dashboard, summary: attempt.summary };
  }

  const seen = new Set<string>();
  const themes = dashboard.themes.map((row) => {
    if (!attemptedThemes.has(row.theme)) return row;

    seen.add(row.theme);
    const attempts = toNumber(row.attempts) + 1;
    const correct = toNumber(row.correct) + Number(options.success);
    const recentAttempts = toNumber(row.recentAttempts) + 1;
    const recentCorrect =
      Math.round(row.recentAccuracy * toNumber(row.recentAttempts)) + Number(options.success);
    const delta = deltaByTheme.get(row.theme);

    return {
      ...row,
      attempts: BigInt(attempts),
      correct: BigInt(correct),
      accuracy: attempts > 0 ? correct / attempts : 0,
      averageTimeMs:
        attempts > 0
          ? (row.averageTimeMs * (attempts - 1) + Math.max(0, options.timeSpentMs)) / attempts
          : 0,
      skill: delta?.skillAfter ?? row.skill,
      recentAttempts: BigInt(recentAttempts),
      recentAccuracy: recentAttempts > 0 ? recentCorrect / recentAttempts : 0,
      lastAttemptAt: attempt.card.lastAttemptAt,
    };
  });

  for (const theme of attemptedThemes) {
    if (seen.has(theme)) continue;

    const delta = deltaByTheme.get(theme);
    themes.push({
      theme,
      attempts: BigInt(1),
      correct: BigInt(Number(options.success)),
      accuracy: Number(options.success),
      averageTimeMs: Math.max(0, options.timeSpentMs),
      skill: delta?.skillAfter ?? attempt.eloAfter,
      weaknessScore: 0,
      recentAttempts: BigInt(1),
      recentAccuracy: Number(options.success),
      due: BigInt(0),
      mastered: BigInt(attempt.card.mastered ? 1 : 0),
      lastAttemptAt: attempt.card.lastAttemptAt,
    });
  }

  return { ...dashboard, summary: attempt.summary, themes };
}

export default Puzzles;
