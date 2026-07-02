import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconBook,
  IconCheck,
  IconPlayerPlay,
  IconPlus,
  IconPuzzle,
  IconSettings,
  IconTarget,
  IconTargetArrow,
  IconTrash,
} from "@tabler/icons-react";
import clsx from "clsx";
import dayjs, { type Dayjs } from "dayjs";
import { useAtom, useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  dailyGoalAutoStartRequestAtom,
  dailyGoalCompletionPromptAtom,
  dailyGoalDeckRevisionAtom,
  dailyGoalHistoryAtom,
  dailyGoalsAtom,
  type DailyGoal,
  type DailyGoalHistory,
  type DailyGoalKind,
  type RecentFile,
} from "@/state/atoms";
import {
  getMistakeReviewDailyBatch,
  getMistakeReviewDailyProgress,
  readMistakeReviewDeck,
  type MistakeReviewDeck,
  type MistakeReviewDeckSummary,
} from "@/utils/mistakeReview";
import {
  getOpeningReviewDailyBatch,
  getOpeningReviewDailyProgress,
  readOpeningReviewDeck,
  type OpeningReviewDeck,
  type OpeningReviewDeckSummary,
} from "@/utils/openingReview";
import classes from "./DailyGoalsPanel.module.css";

type InitialPractice = {
  mode: "due" | "all";
  indices: number[];
  label?: string;
  source?: "daily-goals";
  goalId?: string;
  goalTitle?: string;
};

type DailyGoalState = {
  goal: DailyGoal;
  target: number;
  progress: number;
  completed: boolean;
  loading: boolean;
  color: string;
  detail: string;
  startLabel: string;
  startDisabled: boolean;
  manual: boolean;
  icon: ReactNode;
  onStart: () => void;
};

type DailyGoalsPanelProps = {
  openingDecks: OpeningReviewDeckSummary[];
  mistakeDecks: MistakeReviewDeckSummary[];
  openingDecksLoading: boolean;
  mistakeDecksLoading: boolean;
  recentFiles: RecentFile[];
  onOpenOpeningDeck: (
    deck: OpeningReviewDeckSummary,
    options?: { initialPractice?: InitialPractice },
  ) => void | Promise<void>;
  onOpenMistakeDeck: (
    deck: MistakeReviewDeckSummary,
    options?: { initialPractice?: InitialPractice },
  ) => void | Promise<void>;
  onOpenOpeningReview: () => void;
  onOpenMistakeReview: () => void;
  onOpenPuzzles: () => void;
  onOpenPrepFile: (file: RecentFile) => void | Promise<void>;
};

const STREAK_FIRE_SRC = "/daily-goals/streak-fire.png";
const DAILY_GOAL_WINDOW_DAYS = 7;

export default function DailyGoalsPanel({
  openingDecks,
  mistakeDecks,
  openingDecksLoading,
  mistakeDecksLoading,
  recentFiles,
  onOpenOpeningDeck,
  onOpenMistakeDeck,
  onOpenOpeningReview,
  onOpenMistakeReview,
  onOpenPuzzles,
  onOpenPrepFile,
}: DailyGoalsPanelProps) {
  const [goals, setGoals] = useAtom(dailyGoalsAtom);
  const [history, setHistory] = useAtom(dailyGoalHistoryAtom);
  const [autoStartRequest, setAutoStartRequest] = useAtom(dailyGoalAutoStartRequestAtom);
  const [, setDailyGoalCompletionPrompt] = useAtom(dailyGoalCompletionPromptAtom);
  const dailyGoalDeckRevision = useAtomValue(dailyGoalDeckRevisionAtom);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handledAutoStartRequestRef = useRef<number | null>(null);
  const [openingDeckDetails, setOpeningDeckDetails] = useState<
    Record<string, OpeningReviewDeck | null>
  >({});
  const [mistakeDeckDetails, setMistakeDeckDetails] = useState<
    Record<string, MistakeReviewDeck | null>
  >({});
  const today = useMemo(() => dayjs(), []);
  const todayKey = getLocalDateKey(today);

  const resolvedOpeningPaths = useMemo(
    () =>
      uniqueStrings(
        goals
          .filter((goal) => goal.enabled && goal.kind === "opening-review")
          .flatMap((goal) => resolveOpeningGoalDecks(goal, openingDecks).map((deck) => deck.path)),
      ),
    [goals, openingDecks],
  );

  const resolvedMistakePaths = useMemo(
    () =>
      uniqueStrings(
        goals
          .filter((goal) => goal.enabled && goal.kind === "mistake-review")
          .flatMap((goal) => resolveMistakeGoalDecks(goal, mistakeDecks).map((deck) => deck.path)),
      ),
    [goals, mistakeDecks],
  );

  useEffect(() => {
    if (resolvedOpeningPaths.length === 0) return;

    let disposed = false;
    async function loadDecks() {
      const entries = await Promise.all(
        resolvedOpeningPaths.map(async (path) => {
          const deck = await readOpeningReviewDeck(path).catch(() => null);
          return [path, deck] as const;
        }),
      );
      if (!disposed) {
        setOpeningDeckDetails((current) => ({ ...current, ...Object.fromEntries(entries) }));
      }
    }

    void loadDecks();
    return () => {
      disposed = true;
    };
  }, [dailyGoalDeckRevision, resolvedOpeningPaths]);

  useEffect(() => {
    if (resolvedMistakePaths.length === 0) return;

    let disposed = false;
    async function loadDecks() {
      const entries = await Promise.all(
        resolvedMistakePaths.map(async (path) => {
          const deck = await readMistakeReviewDeck(path).catch(() => null);
          return [path, deck] as const;
        }),
      );
      if (!disposed) {
        setMistakeDeckDetails((current) => ({ ...current, ...Object.fromEntries(entries) }));
      }
    }

    void loadDecks();
    return () => {
      disposed = true;
    };
  }, [dailyGoalDeckRevision, resolvedMistakePaths]);

  const goalStates = useMemo(
    () =>
      goals
        .filter((goal) => goal.enabled)
        .map((goal) =>
          resolveGoalState({
            goal,
            history,
            todayKey,
            openingDecks,
            mistakeDecks,
            openingDeckDetails,
            mistakeDeckDetails,
            openingDecksLoading,
            mistakeDecksLoading,
            recentFiles,
            onOpenOpeningDeck,
            onOpenMistakeDeck,
            onOpenOpeningReview,
            onOpenMistakeReview,
            onOpenPuzzles,
            onOpenPrepFile,
            onOpenSettings: () => setSettingsOpen(true),
          }),
        ),
    [
      goals,
      history,
      todayKey,
      openingDecks,
      mistakeDecks,
      openingDeckDetails,
      mistakeDeckDetails,
      openingDecksLoading,
      mistakeDecksLoading,
      recentFiles,
      onOpenOpeningDeck,
      onOpenMistakeDeck,
      onOpenOpeningReview,
      onOpenMistakeReview,
      onOpenPuzzles,
      onOpenPrepFile,
    ],
  );
  const allGoalsComplete =
    goalStates.length > 0 && goalStates.every((goalState) => goalState.completed);
  const streak = calculateStreak(today, history, todayKey, allGoalsComplete);
  const calendarDays = useMemo(
    () =>
      Array.from({ length: DAILY_GOAL_WINDOW_DAYS }, (_, index) =>
        today.subtract(DAILY_GOAL_WINDOW_DAYS - 1 - index, "day"),
      ),
    [today],
  );

  useEffect(() => {
    if (!allGoalsComplete) return;

    setHistory((current) => {
      const entry = current[todayKey] ?? { counts: {} };
      if (entry.completedAt) return current;
      return {
        ...current,
        [todayKey]: {
          ...entry,
          completedAt: Date.now(),
        },
      };
    });
  }, [allGoalsComplete, setHistory, todayKey]);

  function incrementManualGoal(goal: DailyGoal) {
    const target = normalizeTarget(goal.target);
    let completedNow = false;
    setHistory((current) => {
      const entry = current[todayKey] ?? { counts: {} };
      const currentCount = entry.counts[goal.id] ?? 0;
      const nextCount = Math.min(target, currentCount + 1);
      completedNow = currentCount < target && nextCount >= target;
      return {
        ...current,
        [todayKey]: {
          ...entry,
          counts: {
            ...entry.counts,
            [goal.id]: nextCount,
          },
        },
      };
    });
    if (completedNow) {
      setDailyGoalCompletionPrompt({
        completedGoalTitle: goal.title,
        completedGoalKind: goal.kind,
        completedAt: Date.now(),
      });
    }
  }

  function updateGoal(goalId: string, patch: Partial<DailyGoal>) {
    setGoals((current) =>
      current.map((goal) => (goal.id === goalId ? { ...goal, ...patch } : goal)),
    );
  }

  function removeGoal(goalId: string) {
    setGoals((current) => current.filter((goal) => goal.id !== goalId));
  }

  function addGoal(kind: DailyGoalKind) {
    const file = kind === "prep" ? recentFiles[0] : null;

    setGoals((current) => [
      ...current,
      {
        id: `${kind}-${Date.now()}`,
        kind,
        title: getDefaultGoalTitle(kind),
        enabled: true,
        target: getDefaultGoalTarget(kind),
        deckPaths: [],
        deckPath: null,
        filePath: file?.path ?? null,
        fileName: file?.name ?? null,
        fileType: file?.type,
      },
    ]);
  }

  const nextGoal = goalStates.find((goalState) => !goalState.completed && !goalState.loading);

  useEffect(() => {
    if (!autoStartRequest) return;
    if (handledAutoStartRequestRef.current === autoStartRequest.createdAt) return;

    const nextStartableGoal = goalStates.find(
      (goalState) => !goalState.completed && !goalState.loading && !goalState.startDisabled,
    );
    if (!nextStartableGoal) {
      if (goalStates.length > 0 && goalStates.every((goalState) => !goalState.loading)) {
        setAutoStartRequest(null);
      }
      return;
    }

    handledAutoStartRequestRef.current = autoStartRequest.createdAt;
    setAutoStartRequest(null);
    nextStartableGoal.onStart();
  }, [autoStartRequest, goalStates, setAutoStartRequest]);

  return (
    <>
      <Paper withBorder p="md" className={classes.panel}>
        <Group justify="space-between" align="flex-start" gap="md">
          <Stack gap={2}>
            <Text fw={800} size="xl">
              Daily goals
            </Text>
            <Text size="sm" c="dimmed">
              {today.format("dddd, MMMM D, YYYY")}
            </Text>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            <Paper withBorder className={classes.streakCard}>
              <Group gap={8} wrap="nowrap">
                <Text fw={800} className={classes.streakNumber}>
                  {streak}
                </Text>
                <img src={STREAK_FIRE_SRC} alt="" className={classes.streakFire} />
              </Group>
              <Text size="xs" fw={700} c="dimmed">
                Streak
              </Text>
            </Paper>
            <Tooltip label="Customize daily goals">
              <ActionIcon
                aria-label="Customize daily goals"
                variant="default"
                size={38}
                onClick={() => setSettingsOpen(true)}
              >
                <IconSettings size="1.1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Group justify="center" gap="sm" className={classes.dayRail}>
          {calendarDays.map((date) => {
            const dateKey = getLocalDateKey(date);
            const completed = isDateComplete(dateKey, history, todayKey, allGoalsComplete);
            const isToday = dateKey === todayKey;
            return (
              <Box key={dateKey} className={classes.dayItem}>
                <Box
                  className={clsx(classes.dayBubble, {
                    [classes.dayBubbleComplete]: completed,
                    [classes.dayBubbleToday]: isToday,
                  })}
                >
                  {date.format("D")}
                </Box>
                <Text size="xs" c="dimmed">
                  {date.format("ddd")}
                </Text>
              </Box>
            );
          })}
        </Group>

        <Group justify="center">
          <Button
            leftSection={<IconPlayerPlay size={18} />}
            onClick={nextGoal?.onStart}
            disabled={!nextGoal}
            size="md"
          >
            {nextGoal ? `Start ${nextGoal.goal.title}` : "Daily goals complete"}
          </Button>
        </Group>

        <Stack gap={0} className={classes.goalList}>
          {goalStates.length === 0 ? (
            <Box className={classes.emptyGoals}>
              <Text fw={700}>No daily goals enabled</Text>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => setSettingsOpen(true)}
              >
                Add goal
              </Button>
            </Box>
          ) : (
            goalStates.map((goalState) => (
              <Box key={goalState.goal.id} className={classes.goalRow}>
                <Box className={classes.goalIcon}>{goalState.icon}</Box>
                <Stack gap={3} className={classes.goalMain}>
                  <Group gap="xs" wrap="nowrap">
                    <Text fw={700} truncate>
                      {goalState.goal.title}
                    </Text>
                    {goalState.completed && (
                      <Badge color="blue" variant="light" size="sm">
                        Done
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" truncate>
                    {goalState.detail}
                  </Text>
                  <Progress
                    value={
                      goalState.target
                        ? (Math.min(goalState.progress, goalState.target) / goalState.target) *
                          100
                        : 0
                    }
                    color={goalState.completed ? "blue" : goalState.color}
                    size="xs"
                    radius="xl"
                  />
                </Stack>
                <Group gap="xs" wrap="nowrap" className={classes.goalActions}>
                  <Badge variant="light" color={goalState.completed ? "blue" : goalState.color}>
                    {Math.min(goalState.progress, goalState.target)} / {goalState.target}
                  </Badge>
                  {goalState.manual && (
                    <Tooltip label="Mark one complete">
                      <ActionIcon
                        aria-label={`Mark ${goalState.goal.title} complete`}
                        variant="light"
                        color="blue"
                        disabled={goalState.completed}
                        onClick={() => incrementManualGoal(goalState.goal)}
                      >
                        <IconCheck size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <Button
                    size="xs"
                    variant={goalState.completed ? "default" : "light"}
                    disabled={goalState.startDisabled}
                    loading={goalState.loading}
                    onClick={goalState.onStart}
                  >
                    {goalState.startLabel}
                  </Button>
                </Group>
              </Box>
            ))
          )}
        </Stack>
      </Paper>

      <DailyGoalsSettingsModal
        opened={settingsOpen}
        goals={goals}
        openingDecks={openingDecks}
        mistakeDecks={mistakeDecks}
        recentFiles={recentFiles}
        onClose={() => setSettingsOpen(false)}
        onUpdateGoal={updateGoal}
        onRemoveGoal={removeGoal}
        onAddGoal={addGoal}
      />
    </>
  );
}

function DailyGoalsSettingsModal({
  opened,
  goals,
  openingDecks,
  mistakeDecks,
  recentFiles,
  onClose,
  onUpdateGoal,
  onRemoveGoal,
  onAddGoal,
}: {
  opened: boolean;
  goals: DailyGoal[];
  openingDecks: OpeningReviewDeckSummary[];
  mistakeDecks: MistakeReviewDeckSummary[];
  recentFiles: RecentFile[];
  onClose: () => void;
  onUpdateGoal: (goalId: string, patch: Partial<DailyGoal>) => void;
  onRemoveGoal: (goalId: string) => void;
  onAddGoal: (kind: DailyGoalKind) => void;
}) {
  const openingOptions = openingDecks.map((deck) => ({ value: deck.path, label: deck.name }));
  const mistakeOptions = mistakeDecks.map((deck) => ({ value: deck.path, label: deck.name }));
  const fileOptions = recentFiles.map((file) => ({
    value: file.path,
    label: file.name.replace(/\.pgn$/i, ""),
  }));

  return (
    <Modal opened={opened} onClose={onClose} title={<b>Daily goals</b>} size="lg">
      <Stack gap="sm">
        <ScrollArea.Autosize mah={480}>
          <Stack gap="sm">
            {goals.map((goal) => (
              <Paper key={goal.id} withBorder p="sm">
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <Group gap="xs">
                      <Switch
                        checked={goal.enabled}
                        onChange={(event) =>
                          onUpdateGoal(goal.id, { enabled: event.currentTarget.checked })
                        }
                        aria-label={`Enable ${goal.title}`}
                      />
                      <Badge variant="light">{getGoalKindLabel(goal.kind)}</Badge>
                    </Group>
                    <Tooltip label="Remove goal">
                      <ActionIcon
                        aria-label={`Remove ${goal.title}`}
                        variant="subtle"
                        color="red"
                        onClick={() => onRemoveGoal(goal.id)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <TextInput
                      label="Name"
                      value={goal.title}
                      onChange={(event) => onUpdateGoal(goal.id, { title: event.target.value })}
                    />
                    <NumberInput
                      label="Daily target"
                      value={goal.target}
                      min={1}
                      max={500}
                      onChange={(value) =>
                        onUpdateGoal(goal.id, { target: normalizeTarget(Number(value)) })
                      }
                    />
                    {goal.kind === "opening-review" && (
                      <MultiSelect
                        label="Opening sets"
                        placeholder="All opening sets"
                        data={openingOptions}
                        value={getConfiguredDeckPaths(goal)}
                        onChange={(values) =>
                          onUpdateGoal(goal.id, {
                            deckPaths: values,
                            deckPath: values[0] ?? null,
                          })
                        }
                        clearable
                        searchable
                      />
                    )}
                    {goal.kind === "mistake-review" && (
                      <MultiSelect
                        label="Mistake sets"
                        placeholder="All mistake sets"
                        data={mistakeOptions}
                        value={getConfiguredDeckPaths(goal)}
                        onChange={(values) =>
                          onUpdateGoal(goal.id, {
                            deckPaths: values,
                            deckPath: values[0] ?? null,
                          })
                        }
                        clearable
                        searchable
                      />
                    )}
                    {goal.kind === "prep" && (
                      <Select
                        label="Saved file"
                        placeholder="Choose recent file"
                        data={fileOptions}
                        value={goal.filePath ?? null}
                        onChange={(value) => {
                          const file = recentFiles.find((item) => item.path === value);
                          onUpdateGoal(goal.id, {
                            filePath: value,
                            fileName: file?.name ?? null,
                            fileType: file?.type,
                          });
                        }}
                        clearable
                        searchable
                      />
                    )}
                  </SimpleGrid>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </ScrollArea.Autosize>
        <Divider />
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconTarget size={14} />}
            onClick={() => onAddGoal("mistake-review")}
          >
            Mistakes
          </Button>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconTargetArrow size={14} />}
            onClick={() => onAddGoal("opening-review")}
          >
            Openings
          </Button>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconBook size={14} />}
            onClick={() => onAddGoal("prep")}
          >
            Prep
          </Button>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPuzzle size={14} />}
            onClick={() => onAddGoal("puzzles")}
          >
            Puzzles
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function resolveGoalState({
  goal,
  history,
  todayKey,
  openingDecks,
  mistakeDecks,
  openingDeckDetails,
  mistakeDeckDetails,
  openingDecksLoading,
  mistakeDecksLoading,
  recentFiles,
  onOpenOpeningDeck,
  onOpenMistakeDeck,
  onOpenOpeningReview,
  onOpenMistakeReview,
  onOpenPuzzles,
  onOpenPrepFile,
  onOpenSettings,
}: {
  goal: DailyGoal;
  history: DailyGoalHistory;
  todayKey: string;
  openingDecks: OpeningReviewDeckSummary[];
  mistakeDecks: MistakeReviewDeckSummary[];
  openingDeckDetails: Record<string, OpeningReviewDeck | null>;
  mistakeDeckDetails: Record<string, MistakeReviewDeck | null>;
  openingDecksLoading: boolean;
  mistakeDecksLoading: boolean;
  recentFiles: RecentFile[];
  onOpenOpeningDeck: DailyGoalsPanelProps["onOpenOpeningDeck"];
  onOpenMistakeDeck: DailyGoalsPanelProps["onOpenMistakeDeck"];
  onOpenOpeningReview: () => void;
  onOpenMistakeReview: () => void;
  onOpenPuzzles: () => void;
  onOpenPrepFile: (file: RecentFile) => void | Promise<void>;
  onOpenSettings: () => void;
}): DailyGoalState {
  const target = normalizeTarget(goal.target);
  const icon = getGoalIcon(goal.kind);

  if (goal.kind === "opening-review") {
    const decks = resolveOpeningGoalDecks(goal, openingDecks);
    if (decks.length === 0) {
      return {
        goal,
        target,
        progress: 0,
        completed: false,
        loading: openingDecksLoading,
        color: "teal",
        detail: openingDecksLoading ? "Loading opening sets" : "No opening review set linked",
        startLabel: openingDecksLoading ? "Loading" : "Set up",
        startDisabled: openingDecksLoading,
        manual: false,
        icon,
        onStart: onOpenOpeningReview,
      };
    }

    if (decks.some((deck) => openingDeckDetails[deck.path] === undefined)) {
      return {
        goal,
        target,
        progress: 0,
        completed: false,
        loading: true,
        color: "teal",
        detail: getDeckSelectionLabel(decks),
        startLabel: "Loading",
        startDisabled: true,
        manual: false,
        icon,
        onStart: () => undefined,
      };
    }

    const loadedDecks = decks
      .map((deck) => ({ summary: deck, detail: openingDeckDetails[deck.path] }))
      .filter(
        (item): item is { summary: OpeningReviewDeckSummary; detail: OpeningReviewDeck } =>
          item.detail !== null && item.detail !== undefined,
      );

    if (loadedDecks.length === 0) {
      return {
        goal,
        target,
        progress: 0,
        completed: false,
        loading: false,
        color: "teal",
        detail: "Could not read linked opening sets",
        startLabel: "Open",
        startDisabled: false,
        manual: false,
        icon,
        onStart: () => void onOpenOpeningDeck(decks[0]),
      };
    }

    const deckStates = loadedDecks.map(({ summary, detail }) => {
      const settings = { ...detail.daily, reviewsPerDay: target };
      const progress = getOpeningReviewDailyProgress(detail.positions, settings);
      const batch = getOpeningReviewDailyBatch(detail.positions, settings);
      const indices = getPositionIndices(detail.positions, batch);
      return { summary, progress: progress.completed, indices };
    });
    const progress = sumNumbers(deckStates.map((deckState) => deckState.progress));
    const ready = sumNumbers(deckStates.map((deckState) => deckState.indices.length));
    const displayTarget = getReviewDisplayTarget(target, progress, ready);
    const completed = progress >= displayTarget;
    const startDeckState = deckStates.find((deckState) => deckState.indices.length > 0);

    return {
      goal,
      target: displayTarget,
      progress,
      completed,
      loading: false,
      color: "teal",
      detail: `${getDeckSelectionLabel(decks)} - ${ready} ready`,
      startLabel: completed ? "Done" : ready > 0 ? "Start" : "Open",
      startDisabled: completed,
      manual: false,
      icon,
      onStart: () => {
        if (!startDeckState) {
          void onOpenOpeningDeck(loadedDecks[0].summary);
          return;
        }
        void onOpenOpeningDeck(startDeckState.summary, {
          initialPractice: {
            mode: "due",
            indices: startDeckState.indices,
            label: "Daily goals",
            source: "daily-goals",
            goalId: goal.id,
            goalTitle: goal.title,
          },
        });
      },
    };
  }

  if (goal.kind === "mistake-review") {
    const decks = resolveMistakeGoalDecks(goal, mistakeDecks);
    if (decks.length === 0) {
      return {
        goal,
        target,
        progress: 0,
        completed: false,
        loading: mistakeDecksLoading,
        color: "orange",
        detail: mistakeDecksLoading ? "Loading mistake sets" : "No mistake review set linked",
        startLabel: mistakeDecksLoading ? "Loading" : "Set up",
        startDisabled: mistakeDecksLoading,
        manual: false,
        icon,
        onStart: onOpenMistakeReview,
      };
    }

    if (decks.some((deck) => mistakeDeckDetails[deck.path] === undefined)) {
      return {
        goal,
        target,
        progress: 0,
        completed: false,
        loading: true,
        color: "orange",
        detail: getDeckSelectionLabel(decks),
        startLabel: "Loading",
        startDisabled: true,
        manual: false,
        icon,
        onStart: () => undefined,
      };
    }

    const loadedDecks = decks
      .map((deck) => ({ summary: deck, detail: mistakeDeckDetails[deck.path] }))
      .filter(
        (item): item is { summary: MistakeReviewDeckSummary; detail: MistakeReviewDeck } =>
          item.detail !== null && item.detail !== undefined,
      );

    if (loadedDecks.length === 0) {
      return {
        goal,
        target,
        progress: 0,
        completed: false,
        loading: false,
        color: "orange",
        detail: "Could not read linked mistake sets",
        startLabel: "Open",
        startDisabled: false,
        manual: false,
        icon,
        onStart: () => void onOpenMistakeDeck(decks[0]),
      };
    }

    const deckStates = loadedDecks.map(({ summary, detail }) => {
      const settings = { ...detail.daily, reviewsPerDay: target };
      const progress = getMistakeReviewDailyProgress(detail.positions, settings);
      const batch = getMistakeReviewDailyBatch(detail.positions, settings);
      const indices = getPositionIndices(detail.positions, batch);
      return { summary, progress: progress.completed, indices };
    });
    const progress = sumNumbers(deckStates.map((deckState) => deckState.progress));
    const ready = sumNumbers(deckStates.map((deckState) => deckState.indices.length));
    const displayTarget = getReviewDisplayTarget(target, progress, ready);
    const completed = progress >= displayTarget;
    const startDeckState = deckStates.find((deckState) => deckState.indices.length > 0);

    return {
      goal,
      target: displayTarget,
      progress,
      completed,
      loading: false,
      color: "orange",
      detail: `${getDeckSelectionLabel(decks)} - ${ready} ready`,
      startLabel: completed ? "Done" : ready > 0 ? "Start" : "Open",
      startDisabled: completed,
      manual: false,
      icon,
      onStart: () => {
        if (!startDeckState) {
          void onOpenMistakeDeck(loadedDecks[0].summary);
          return;
        }
        void onOpenMistakeDeck(startDeckState.summary, {
          initialPractice: {
            mode: "due",
            indices: startDeckState.indices,
            label: "Daily goals",
            source: "daily-goals",
            goalId: goal.id,
            goalTitle: goal.title,
          },
        });
      },
    };
  }

  if (goal.kind === "prep") {
    const file = resolvePrepFile(goal, recentFiles);
    const progress = history[todayKey]?.counts[goal.id] ?? 0;
    return {
      goal,
      target,
      progress,
      completed: progress >= target,
      loading: false,
      color: "grape",
      detail: file ? file.name.replace(/\.pgn$/i, "") : "No saved file linked",
      startLabel: progress >= target ? "Done" : file ? "Start" : "Link file",
      startDisabled: progress >= target,
      manual: true,
      icon,
      onStart: () => {
        if (!file) {
          onOpenSettings();
          return;
        }
        void onOpenPrepFile(file);
      },
    };
  }

  const progress = history[todayKey]?.counts[goal.id] ?? 0;
  return {
    goal,
    target,
    progress,
    completed: progress >= target,
    loading: false,
    color: "blue",
    detail: "Puzzle training",
    startLabel: progress >= target ? "Done" : "Start",
    startDisabled: progress >= target,
    manual: true,
    icon,
    onStart: onOpenPuzzles,
  };
}

function resolveOpeningGoalDecks(goal: DailyGoal, decks: OpeningReviewDeckSummary[]) {
  return resolveSelectedDecks(goal, decks);
}

function resolveMistakeGoalDecks(goal: DailyGoal, decks: MistakeReviewDeckSummary[]) {
  return resolveSelectedDecks(goal, decks);
}

function resolveSelectedDecks<T extends { path: string; due: number; unseen: number; updatedAt: number }>(
  goal: DailyGoal,
  decks: T[],
) {
  const configuredPaths = getConfiguredDeckPaths(goal);
  if (configuredPaths.length > 0) {
    const deckByPath = new Map(decks.map((deck) => [deck.path, deck]));
    return configuredPaths.map((path) => deckByPath.get(path)).filter((deck): deck is T => !!deck);
  }

  return [...decks].sort((a, b) => {
    const aReady = a.due + a.unseen;
    const bReady = b.due + b.unseen;
    if (aReady !== bReady) return bReady - aReady;
    return b.updatedAt - a.updatedAt;
  });
}

function getConfiguredDeckPaths(goal: DailyGoal) {
  if (goal.deckPaths && goal.deckPaths.length > 0) {
    return uniqueStrings(goal.deckPaths);
  }
  return goal.deckPath ? [goal.deckPath] : [];
}

function getDeckSelectionLabel(decks: { name: string }[]) {
  if (decks.length === 1) return decks[0].name;
  return `${decks.length} sets`;
}

function getReviewDisplayTarget(target: number, completed: number, ready: number) {
  const availableToday = completed + ready;
  if (availableToday > 0) return Math.min(target, availableToday);
  return target;
}

function sumNumbers(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function resolvePrepFile(goal: DailyGoal, recentFiles: RecentFile[]): RecentFile | null {
  if (!goal.filePath) return null;
  return (
    recentFiles.find((file) => file.path === goal.filePath) ?? {
      path: goal.filePath,
      name: goal.fileName ?? goal.filePath,
      type: goal.fileType ?? "other",
      lastOpened: Date.now(),
    }
  );
}

function getPositionIndices<T>(positions: T[], batch: T[]) {
  return batch.map((position) => positions.indexOf(position)).filter((index) => index >= 0);
}

function normalizeTarget(value: number) {
  return Math.max(1, Math.min(500, Math.trunc(Number(value) || 1)));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function getLocalDateKey(date: Dayjs) {
  return date.format("YYYY-MM-DD");
}

function isDateComplete(
  dateKey: string,
  history: DailyGoalHistory,
  todayKey: string,
  todayComplete: boolean,
) {
  if (dateKey === todayKey && todayComplete) return true;
  return Boolean(history[dateKey]?.completedAt);
}

function calculateStreak(
  today: Dayjs,
  history: DailyGoalHistory,
  todayKey: string,
  todayComplete: boolean,
) {
  let cursor = todayComplete ? today : today.subtract(1, "day");
  let count = 0;

  while (isDateComplete(getLocalDateKey(cursor), history, todayKey, todayComplete)) {
    count += 1;
    cursor = cursor.subtract(1, "day");
  }

  return count;
}

function getGoalIcon(kind: DailyGoalKind) {
  switch (kind) {
    case "mistake-review":
      return <IconTarget size={20} />;
    case "opening-review":
      return <IconTargetArrow size={20} />;
    case "prep":
      return <IconBook size={20} />;
    case "puzzles":
      return <IconPuzzle size={20} />;
  }
}

function getGoalKindLabel(kind: DailyGoalKind) {
  switch (kind) {
    case "mistake-review":
      return "Mistakes";
    case "opening-review":
      return "Openings";
    case "prep":
      return "Prep";
    case "puzzles":
      return "Puzzles";
  }
}

function getDefaultGoalTitle(kind: DailyGoalKind) {
  switch (kind) {
    case "mistake-review":
      return "Mistake review";
    case "opening-review":
      return "Opening gaps";
    case "prep":
      return "Prep";
    case "puzzles":
      return "Puzzles";
  }
}

function getDefaultGoalTarget(kind: DailyGoalKind) {
  switch (kind) {
    case "mistake-review":
    case "opening-review":
      return 15;
    case "puzzles":
      return 5;
    case "prep":
      return 1;
  }
}
