import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import {
  IconArrowBack,
  IconArrowRight,
  IconBook,
  IconBulb,
  IconCheck,
  IconFlame,
  IconInfoCircle,
  IconTarget,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { formatDate } from "ts-fsrs";
import { useStore } from "zustand";
import ConfirmModal from "@/components/common/ConfirmModal";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  buildFromTree,
  formatReviewInterval,
  getCardForReview,
  getNextReviewTimes,
  getStats,
  syncDeck,
  updateCardPerformance,
} from "@/components/files/opening";
import {
  currentEvalOpenAtom,
  currentInvisibleAtom,
  currentPracticeTabAtom,
  currentShowCommentsAtom,
  currentTabAtom,
  deckAtomFamily,
  type PracticeData,
  type PracticeState,
  type PracticeSessionStats,
  practiceCardStartTimeAtom,
  practiceSessionStatsAtom,
  practiceStateAtom,
  practiceAutoDifficultyAtom,
} from "@/state/atoms";
import { getTabFile, getTabGameNumber, getTabPracticeKey } from "@/utils/tabs";
import { mistakeReviewSeverityLabel } from "@/utils/mistakeReview";
import { formatOpeningReviewMoveSource } from "@/utils/openingReviewPractice";
import { findFen, getNodeAtPath } from "@/utils/treeReducer";
import RepertoireInfo from "./RepertoireInfo";

type PracticeMoveQualityLabel = NonNullable<PracticeState["moveQualityLabel"]>;

function practiceMoveQualityColor(
  label: PracticeMoveQualityLabel | undefined,
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

function practiceMoveQualityIcon(
  label: PracticeMoveQualityLabel | undefined,
  phase: PracticeState["phase"],
) {
  if (phase === "incorrect" && label !== "okay" && label !== "inaccuracy") return "x";
  if (label === "good" || label === "okay" || label === "inaccuracy") return "bulb";
  return "check";
}

function practiceMoveQualityTitle(practiceState: PracticeState, fallback: string) {
  return practiceState.moveQualityLabel
    ? mistakeReviewSeverityLabel(practiceState.moveQualityLabel)
    : fallback;
}

function normalizePracticeMoveSan(move: string | null | undefined) {
  return (move ?? "")
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .replace(/[!?]+/g, "");
}

function practiceMovesSameSan(
  firstMove: string | null | undefined,
  secondMove: string | null | undefined,
) {
  const first = normalizePracticeMoveSan(firstMove);
  const second = normalizePracticeMoveSan(secondMove);
  return Boolean(first && second && first === second);
}

function practiceMoveQualityDetail(practiceState: PracticeState) {
  const source = practiceState.bestMoveSource
    ? formatOpeningReviewMoveSource(practiceState.bestMoveSource)
    : "Saved answer";
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
    bestMove && (source !== "Saved answer" || !practiceMovesSameSan(bestMove, repertoireMove));

  if (shouldShowObjectiveBest) {
    if (
      practiceState.moveQualityLabel === "best" &&
      practiceState.playedMove &&
      practiceMovesSameSan(bestMove, practiceState.playedMove)
    ) {
      parts.push(`${source} ranks ${practiceState.playedMove} best.`);
    } else {
      parts.push(`${source} has ${bestMove} as best.`);
    }
  }

  if (practiceState.moveLossCp !== undefined && practiceState.moveQualityLabel !== "best") {
    const rank = practiceState.chessDbRank ? `, rank ${practiceState.chessDbRank}` : "";
    parts.push(`${Math.round(practiceState.moveLossCp)} cp behind${rank}.`);
  }

  return parts.join(" ");
}

function PracticePanel() {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const goToMove = useStore(store, (s) => s.goToMove);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  const currentFen = useStore(store, (s) => s.currentNode().fen);

  const currentTab = useAtomValue(currentTabAtom);
  const tabFile = getTabFile(currentTab);
  const [resetModal, toggleResetModal] = useToggle();

  const [deck, setDeck] = useAtom(
    deckAtomFamily({
      file: getTabPracticeKey(currentTab),
      game: getTabGameNumber(currentTab),
    }),
  );

  const [syncMessage, setSyncMessage] = useState<{
    added: number;
    removed: number;
  } | null>(null);
  const deckPositionsRef = useRef(deck.positions);
  deckPositionsRef.current = deck.positions;
  const lastSyncedTreeRef = useRef<string | null>(null);

  useEffect(() => {
    const treeFingerprint = JSON.stringify(root);
    if (lastSyncedTreeRef.current === treeFingerprint) return;

    const orientation = headers.orientation || "white";
    const start = headers.start || [];

    if (deckPositionsRef.current.length === 0) {
      const newDeck = buildFromTree(root, orientation, start);
      if (newDeck.length > 0) {
        setDeck({ positions: newDeck, logs: [] });
      }
    } else {
      // Sync existing deck with tree changes
      const { positions, added, removed } = syncDeck(
        deckPositionsRef.current,
        root,
        orientation,
        start,
      );
      if (added > 0 || removed > 0) {
        setDeck((prev) => ({ ...prev, positions }));
        setSyncMessage({ added, removed });
        setTimeout(() => setSyncMessage(null), 5000);
      }
    }
    lastSyncedTreeRef.current = treeFingerprint;
  }, [root, headers, setDeck]);

  const stats = getStats(deck.positions);

  const setInvisible = useSetAtom(currentInvisibleAtom);
  const setShowComments = useSetAtom(currentShowCommentsAtom);
  const setEvalOpen = useSetAtom(currentEvalOpenAtom);
  const [practiceState, setPracticeState] = useAtom(practiceStateAtom);
  const [sessionStats, setSessionStats] = useAtom(practiceSessionStatsAtom);
  const setCardStartTime = useSetAtom(practiceCardStartTimeAtom);
  const practiceAutoDifficulty = useAtomValue(practiceAutoDifficultyAtom);

  const newPractice = useCallback(
    (stats?: Partial<PracticeSessionStats>) => {
      if (deck.positions.length === 0) return;

      const currentMode = stats?.mode ?? sessionStats.mode;
      const remaining = stats?.remainingPositions ?? sessionStats.remainingPositions;

      let c: (typeof deck.positions)[0] | null | undefined;

      if (currentMode === "full") {
        if (remaining.length > 0) {
          c = deck.positions[remaining[0]];
        } else {
          c = null;
        }
      } else {
        c = getCardForReview(deck.positions);
      }

      if (!c) {
        setPracticeState({ phase: "idle" });
        setPracticePath(null);
        setInvisible(false);
        setShowComments(true);
        setEvalOpen(true);
        return;
      }
      const path = findFen(c.fen, root);
      if (path.length === 0 && root.fen !== c.fen) {
        setHeaders({
          ...headers,
          fen: c.fen,
          orientation: c.sideToMove ?? headers.orientation ?? "white",
          result: "*",
        });
        setPracticePath([]);
      } else {
        goToMove(path);
        setPracticePath(path);
      }
      setInvisible(true);
      setShowComments(false);
      setEvalOpen(false);
      setCardStartTime(Date.now());
      setPracticeState({ phase: "waiting", currentFen: c.fen });
    },
    [
      deck.positions,
      sessionStats.mode,
      sessionStats.remainingPositions,
      headers,
      root,
      goToMove,
      setHeaders,
      setPracticePath,
      setInvisible,
      setShowComments,
      setEvalOpen,
      setCardStartTime,
      setPracticeState,
    ],
  );

  useEffect(() => {
    if (practiceState.phase === "correct") {
      if (sessionStats.mode === "full") {
        const timer = setTimeout(() => {
          const remainingPositions = sessionStats.remainingPositions.slice(1);
          setSessionStats((prev) => ({
            ...prev,
            remainingPositions,
            correct: prev.correct + 1,
            streak: prev.streak + 1,
            bestStreak: Math.max(prev.bestStreak, prev.streak + 1),
          }));
          newPractice({ remainingPositions, mode: "full" });
        }, 300);
        return () => clearTimeout(timer);
      } else if (practiceAutoDifficulty !== "none" && practiceState.positionIndex !== undefined) {
        const positionIndex = practiceState.positionIndex;
        const timer = setTimeout(() => {
          const card = deck.positions[positionIndex].card;
          const grade = Number(practiceAutoDifficulty) as 1 | 2 | 3 | 4;

          updateCardPerformance(setDeck, positionIndex, card, grade, { profile: "repertoire" });
          setSessionStats((prev) => ({
            ...prev,
            correct: prev.correct + 1,
            streak: prev.streak + 1,
            bestStreak: Math.max(prev.bestStreak, prev.streak + 1),
          }));
          newPractice();
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [
    practiceState.phase,
    practiceState.positionIndex,
    sessionStats.mode,
    sessionStats.remainingPositions,
    newPractice,
    setSessionStats,
    practiceAutoDifficulty,
    deck.positions,
    setDeck,
  ]);

  const canRateAttempt =
    sessionStats.mode !== "full" &&
    (practiceState.phase === "correct" ||
      (practiceState.phase === "incorrect" && Boolean(practiceState.moveQualityLabel)));
  const attemptFeedbackTitle = practiceMoveQualityTitle(
    practiceState,
    practiceState.phase === "correct" ? t("Board.Practice.Correct") : t("Common.Incorrect"),
  );
  const attemptFeedbackDetail = practiceMoveQualityDetail(practiceState);
  const attemptFeedbackColor = practiceMoveQualityColor(
    practiceState.moveQualityLabel,
    practiceState.phase,
  );
  const attemptFeedbackIcon = practiceMoveQualityIcon(
    practiceState.moveQualityLabel,
    practiceState.phase,
  );

  function handleQualityRating(grade: 1 | 2 | 3 | 4) {
    if (!canRateAttempt || practiceState.positionIndex === undefined) return;

    const { positionIndex } = practiceState;
    const card = deck.positions[positionIndex].card;
    const wasCorrect = practiceState.phase === "correct";

    updateCardPerformance(setDeck, positionIndex, card, grade, { profile: "repertoire" });
    setSessionStats((prev) => ({
      ...prev,
      correct: wasCorrect ? prev.correct + 1 : prev.correct,
      incorrect: wasCorrect ? prev.incorrect : prev.incorrect + 1,
      streak: wasCorrect ? prev.streak + 1 : 0,
      bestStreak: wasCorrect ? Math.max(prev.bestStreak, prev.streak + 1) : prev.bestStreak,
    }));
    newPractice();
  }

  function startPractice() {
    const stats: Partial<PracticeSessionStats> = {
      mode: "anki",
      remainingPositions: [],
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStats((prev) => ({ ...prev, ...stats }));
    newPractice(stats);
  }

  function startFullPractice() {
    const indices = deck.positions.map((_, i) => i);
    const stats: Partial<PracticeSessionStats> = {
      mode: "full",
      remainingPositions: indices,
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStats((prev) => ({ ...prev, ...stats }));
    newPractice(stats);
  }

  function skipCard() {
    const wasIncorrect = practiceState.phase === "incorrect";
    if (sessionStats.mode === "full" && sessionStats.remainingPositions.length > 0) {
      const remainingPositions = sessionStats.remainingPositions.slice(1);
      setSessionStats((prev) => ({
        ...prev,
        remainingPositions,
        incorrect: wasIncorrect ? prev.incorrect + 1 : prev.incorrect,
        streak: wasIncorrect ? 0 : prev.streak,
      }));
      newPractice({ remainingPositions });
    } else {
      if (wasIncorrect) {
        setSessionStats((prev) => ({
          ...prev,
          incorrect: prev.incorrect + 1,
          streak: 0,
        }));
      }
      newPractice();
    }
  }

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

  const [positionsOpen, setPositionsOpen] = useToggle();
  const [logsOpen, setLogsOpen] = useToggle();
  const [tab, setTab] = useAtom(currentPracticeTabAtom);

  return (
    <>
      <Tabs
        h="100%"
        orientation="vertical"
        placement="right"
        value={tab}
        onChange={(v) => setTab(v!)}
        style={{
          display: "flex",
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="train">{t("Board.Practice.Train")}</Tabs.Tab>
          <Tabs.Tab value="build">{t("Board.Practice.Build")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="train" style={{ overflow: "hidden" }}>
          <Stack p="sm" gap="md">
            {stats.total === 0 && (
              <Alert icon={<IconInfoCircle />}>
                <Stack gap="xs">
                  <Text fz="sm">{t("Board.Practice.NoPositionForTrain1")}</Text>
                  <Button variant="light" size="xs" onClick={() => setTab("build")}>
                    {t("Board.Practice.GoToBuild")}
                  </Button>
                </Stack>
              </Alert>
            )}
            {syncMessage && (
              <Alert
                title={t("Board.Practice.DeckSynced")}
                withCloseButton
                onClose={() => setSyncMessage(null)}
              >
                {syncMessage.added > 0 &&
                  t("Board.Practice.SyncAdded", {
                    count: syncMessage.added,
                  })}
                {syncMessage.added > 0 && syncMessage.removed > 0 && " · "}
                {syncMessage.removed > 0 &&
                  t("Board.Practice.SyncRemoved", {
                    count: syncMessage.removed,
                  })}
              </Alert>
            )}
            {stats.total > 0 && (
              <>
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text fz="xs" fw={500}>
                      {t("Board.Practice.Progress")}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {Math.round((stats.practiced / stats.total) * 100)}%
                    </Text>
                  </Group>
                  <Progress.Root size="sm">
                    <Tooltip label={`${t("Board.Practice.Practiced")}: ${stats.practiced}`}>
                      <Progress.Section
                        value={(stats.practiced / stats.total) * 100}
                        color="blue"
                      />
                    </Tooltip>
                    <Tooltip label={`${t("Board.Practice.Due")}: ${stats.due}`}>
                      <Progress.Section value={(stats.due / stats.total) * 100} color="yellow" />
                    </Tooltip>
                    <Tooltip label={`${t("Board.Practice.Unseen")}: ${stats.unseen}`}>
                      <Progress.Section value={(stats.unseen / stats.total) * 100} color="gray" />
                    </Tooltip>
                  </Progress.Root>
                </Stack>

                <SimpleGrid cols={3} spacing="xs">
                  <Paper p="xs" withBorder radius="sm">
                    <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                      {t("Board.Practice.Practiced")}
                    </Text>
                    <Text fz="lg" fw={700} c="blue">
                      {stats.practiced}
                    </Text>
                  </Paper>
                  <Paper p="xs" withBorder radius="sm">
                    <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                      {t("Board.Practice.Due")}
                    </Text>
                    <Text fz="lg" fw={700} c="yellow">
                      {stats.due}
                    </Text>
                  </Paper>
                  <Paper p="xs" withBorder radius="sm">
                    <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                      {t("Board.Practice.Unseen")}
                    </Text>
                    <Text fz="lg" fw={700} c="dimmed">
                      {stats.unseen}
                    </Text>
                  </Paper>
                </SimpleGrid>

                {(practiceState.phase !== "idle" ||
                  sessionStats.correct > 0 ||
                  sessionStats.incorrect > 0) && (
                  <SimpleGrid cols={3} spacing="xs">
                    <Paper p="xs" withBorder radius="sm">
                      <Group gap={4} wrap="nowrap">
                        <ThemeIcon size="xs" color="green" variant="transparent">
                          <IconCheck size={12} />
                        </ThemeIcon>
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.SessionCorrect")}
                        </Text>
                      </Group>
                      <Text fz="lg" fw={700} c="green">
                        {sessionStats.correct}
                      </Text>
                    </Paper>
                    <Paper p="xs" withBorder radius="sm">
                      <Group gap={4} wrap="nowrap">
                        <ThemeIcon size="xs" color="red" variant="transparent">
                          <IconX size={12} />
                        </ThemeIcon>
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.SessionIncorrect")}
                        </Text>
                      </Group>
                      <Text fz="lg" fw={700} c="red">
                        {sessionStats.incorrect}
                      </Text>
                    </Paper>
                    <Paper p="xs" withBorder radius="sm">
                      <Group gap={4} wrap="nowrap">
                        {sessionStats.correct + sessionStats.incorrect > 0 ? (
                          <ThemeIcon size="xs" color="teal" variant="transparent">
                            <IconTarget size={12} />
                          </ThemeIcon>
                        ) : (
                          <ThemeIcon size="xs" color="orange" variant="transparent">
                            <IconFlame size={12} />
                          </ThemeIcon>
                        )}
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {sessionStats.correct + sessionStats.incorrect > 0
                            ? t("Board.Practice.Accuracy")
                            : t("Board.Practice.Streak")}
                        </Text>
                      </Group>
                      <Text
                        fz="lg"
                        fw={700}
                        c={sessionStats.correct + sessionStats.incorrect > 0 ? "teal" : "orange"}
                      >
                        {sessionStats.correct + sessionStats.incorrect > 0
                          ? `${Math.round(
                              (sessionStats.correct /
                                (sessionStats.correct + sessionStats.incorrect)) *
                                100,
                            )}%`
                          : sessionStats.streak}
                      </Text>
                    </Paper>
                  </SimpleGrid>
                )}

                {practiceState.phase === "idle" && (
                  <Stack gap="sm">
                    {stats.due === 0 && stats.unseen === 0 ? (
                      <Paper p="sm" withBorder>
                        <Stack gap="xs" align="center">
                          <ThemeIcon size="xl" radius="xl" color="green" variant="light">
                            <IconCheck size={24} />
                          </ThemeIcon>
                          <Text ta="center" fw={500}>
                            {t("Board.Practice.PracticedAll1")}
                          </Text>
                          <Text ta="center" fz="sm" c="dimmed">
                            {t("Board.Practice.PracticedAll2")}{" "}
                            {dayjs(stats.nextDue).format("MMM D, HH:mm")}
                          </Text>
                        </Stack>
                      </Paper>
                    ) : (
                      <Button
                        size="md"
                        variant="light"
                        fullWidth
                        onClick={startPractice}
                        leftSection={<IconTarget size={20} />}
                        justify="space-between"
                        rightSection={
                          <Badge size="sm" variant="white" color="blue">
                            {stats.due + stats.unseen}
                          </Badge>
                        }
                      >
                        {t("Board.Practice.StartPractice")}
                      </Button>
                    )}
                    <Button
                      size="md"
                      variant="light"
                      color="gray"
                      fullWidth
                      onClick={startFullPractice}
                      leftSection={<IconBook size={20} />}
                      justify="space-between"
                      rightSection={
                        <Badge size="sm" variant="white" color="gray">
                          {deck.positions.length}
                        </Badge>
                      }
                    >
                      {t("Board.Practice.PracticeFullRepertoire")}
                    </Button>
                  </Stack>
                )}

                {practiceState.phase === "waiting" && (
                  <Paper p="sm" withBorder>
                    {practiceState.currentFen && currentFen !== practiceState.currentFen ? (
                      <Stack gap="xs" align="center">
                        <Text ta="center" fz="sm" c="dimmed">
                          {t("Board.Practice.NotOnPosition")}
                        </Text>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconArrowBack size={14} />}
                          onClick={() => {
                            goToMove(findFen(practiceState.currentFen!, root));
                            setInvisible(true);
                          }}
                        >
                          {t("Board.Practice.GoBackToPosition")}
                        </Button>
                      </Stack>
                    ) : (
                      <Group gap="xs" justify="center">
                        <Text ta="center" fz="sm" c="dimmed">
                          {t("Board.Practice.MakeYourMove")}
                        </Text>
                        <Button
                          variant="light"
                          size="compact-xs"
                          color="red"
                          onClick={() => {
                            setPracticeState({ phase: "idle" });
                            setPracticePath(null);
                            setInvisible(false);
                            setShowComments(true);
                            setEvalOpen(true);
                            setSessionStats({
                              mode: "anki",
                              remainingPositions: [],
                              correct: 0,
                              incorrect: 0,
                              streak: 0,
                              bestStreak: 0,
                            });
                          }}
                        >
                          {t("Common.Stop")}
                        </Button>
                      </Group>
                    )}
                  </Paper>
                )}

                {canRateAttempt && (
                  <QualityRatingPanel
                    onRate={handleQualityRating}
                    title={attemptFeedbackTitle}
                    detail={attemptFeedbackDetail}
                    color={attemptFeedbackColor}
                    icon={attemptFeedbackIcon}
                    card={
                      practiceState.positionIndex !== undefined
                        ? deck.positions[practiceState.positionIndex].card
                        : undefined
                    }
                    timeTaken={practiceState.timeTaken}
                  />
                )}

                {practiceState.phase === "incorrect" && !canRateAttempt && (
                  <Paper p="sm" withBorder>
                    <Stack gap="xs" align="center">
                      <Group gap="xs">
                        <ThemeIcon
                          size="md"
                          color={attemptFeedbackColor}
                          variant="light"
                          radius="xl"
                        >
                          {attemptFeedbackIcon === "bulb" ? (
                            <IconBulb size={16} />
                          ) : attemptFeedbackIcon === "x" ? (
                            <IconX size={16} />
                          ) : (
                            <IconCheck size={16} />
                          )}
                        </ThemeIcon>
                        <Text fw={500} c={attemptFeedbackColor}>
                          {attemptFeedbackTitle}
                        </Text>
                      </Group>
                      {attemptFeedbackDetail ? (
                        <Text fz="sm" c="dimmed" ta="center">
                          {attemptFeedbackDetail}
                        </Text>
                      ) : (
                        <Text fz="sm" c="dimmed">
                          {t("Board.Practice.CorrectMoveWas", {
                            move: practiceState.answer,
                          })}
                        </Text>
                      )}
                      {practiceState.playedMove && (
                        <Text fz="xs" c="dimmed">
                          You played: {practiceState.playedMove}
                        </Text>
                      )}
                      <Button variant="light" size="sm" onClick={skipCard}>
                        {t("Board.Practice.NextPosition")}
                      </Button>
                    </Stack>
                  </Paper>
                )}

                <Divider />

                <Group gap="xs">
                  <Button variant="subtle" size="xs" onClick={() => setPositionsOpen(true)}>
                    {t("Board.Practice.ShowAll")}
                  </Button>
                  <Button variant="subtle" size="xs" onClick={() => setLogsOpen(true)}>
                    {t("Board.Practice.ShowLogs")}
                  </Button>
                  <Button variant="subtle" size="xs" color="red" onClick={() => toggleResetModal()}>
                    {t("Common.Reset")}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="build" style={{ overflow: "hidden" }}>
          <RepertoireInfo />
        </Tabs.Panel>
      </Tabs>

      <ConfirmModal
        title={t("Board.Practice.Reset.Title")}
        description={t("Board.Practice.Reset.Description", {
          name: tabFile?.name,
        })}
        opened={resetModal}
        onClose={toggleResetModal}
        onConfirm={() => {
          const cards = buildFromTree(root, headers.orientation || "white", headers.start || []);
          setDeck({ positions: cards, logs: [] });
          setPracticeState({ phase: "idle" });
          setPracticePath(null);
          setInvisible(false);
          setShowComments(true);
          setEvalOpen(true);
          setSessionStats({
            mode: "anki",
            remainingPositions: [],
            correct: 0,
            incorrect: 0,
            streak: 0,
            bestStreak: 0,
          });
          toggleResetModal();
        }}
        confirmLabel={t("Common.Reset")}
      />
      {positionsOpen && (
        <PositionsModal open={positionsOpen} setOpen={setPositionsOpen} deck={deck} />
      )}
      <LogsModal open={logsOpen} setOpen={setLogsOpen} logs={deck.logs} />
    </>
  );
}

function QualityRatingPanel({
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
  const { t } = useTranslation();
  const reviewTimes = card ? getNextReviewTimes(card, { profile: "repertoire" }) : null;
  const feedbackColor = color ?? "green";

  return (
    <Paper p="sm" withBorder>
      <Stack gap="sm" align="center">
        <Group gap="xs">
          <ThemeIcon size="md" color={feedbackColor} variant="light" radius="xl">
            {icon === "bulb" ? (
              <IconBulb size={16} />
            ) : icon === "x" ? (
              <IconX size={16} />
            ) : (
              <IconCheck size={16} />
            )}
          </ThemeIcon>
          <Text fw={500} c={feedbackColor}>
            {title ?? t("Board.Practice.Correct")}
          </Text>
          {timeTaken !== undefined && (
            <Text fz="xs" c="dimmed">
              ({(timeTaken / 1000).toFixed(1)}s)
            </Text>
          )}
        </Group>
        {detail && (
          <Text fz="xs" c="dimmed" ta="center">
            {detail}
          </Text>
        )}
        <Text fz="sm" c="dimmed">
          {t("Board.Practice.HowDifficult")}
        </Text>
        <SimpleGrid cols={4} spacing="xs" style={{ width: "100%" }}>
          <Tooltip label={t("Board.Practice.AgainHint")}>
            <Button
              color="red"
              variant="light"
              size="compact-md"
              onClick={() => onRate(1)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text fz="xs" fw={600}>
                  {t("Board.Practice.Again")}
                </Text>
                <Text fz={10} c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[1]) : ""}
                </Text>
              </Stack>
            </Button>
          </Tooltip>
          <Tooltip label={t("Board.Practice.HardHint")}>
            <Button
              color="orange"
              variant="light"
              size="compact-md"
              onClick={() => onRate(2)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text fz="xs" fw={600}>
                  {t("Board.Practice.Hard")}
                </Text>
                <Text fz={10} c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[2]) : ""}
                </Text>
              </Stack>
            </Button>
          </Tooltip>
          <Tooltip label={t("Board.Practice.GoodHint")}>
            <Button
              color="blue"
              variant="light"
              size="compact-md"
              onClick={() => onRate(3)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text fz="xs" fw={600}>
                  {t("Board.Practice.Good")}
                </Text>
                <Text fz={10} c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[3]) : ""}
                </Text>
              </Stack>
            </Button>
          </Tooltip>
          <Tooltip label={t("Board.Practice.EasyHint")}>
            <Button
              color="green"
              variant="light"
              size="compact-md"
              onClick={() => onRate(4)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text fz="xs" fw={600}>
                  {t("Board.Practice.Easy")}
                </Text>
                <Text fz={10} c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[4]) : ""}
                </Text>
              </Stack>
            </Button>
          </Tooltip>
        </SimpleGrid>
        <Text fz={10} c="dimmed">
          {t("Board.Practice.KeyboardHint")}
        </Text>
      </Stack>
    </Paper>
  );
}

function PositionsModal({
  open,
  setOpen,
  deck,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  deck: PracticeData;
}) {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const goToMove = useStore(store, (s) => s.goToMove);
  return (
    <Modal
      opened={open}
      onClose={() => setOpen(false)}
      size="xl"
      title={<b>{t("Board.Practice.Positions")}</b>}
    >
      {deck.positions.length === 0 && <Text>{t("Board.Practice.NoPositionsYet")}</Text>}
      <SimpleGrid cols={2}>
        {deck.positions.map((c) => {
          const position = findFen(c.fen, root);
          const node = getNodeAtPath(root, position);
          return (
            <Card key={c.fen}>
              <Text>
                {Math.floor(node.halfMoves / 2) + 1}
                {node.halfMoves % 2 === 0 ? ". " : "... "}
                {c.answer}
              </Text>
              <Divider my="xs" />
              <Group justify="space-between">
                <Stack>
                  <Text tt="uppercase" fw="bold" fz="sm">
                    {t("Board.Practice.Status")}
                  </Text>
                  <Badge
                    color={c.card.reps === 0 ? "gray" : c.card.due < new Date() ? "yellow" : "blue"}
                  >
                    {c.card.reps === 0
                      ? t("Board.Practice.Unseen")
                      : c.card.due < new Date()
                        ? t("Board.Practice.Due")
                        : t("Board.Practice.Practiced")}
                  </Badge>
                </Stack>
                <Stack>
                  <Text tt="uppercase" fw="bold" fz="sm">
                    {t("Board.Practice.Due")}
                  </Text>
                  <Text>{formatDate(c.card.due)}</Text>
                </Stack>
                <ActionIcon
                  variant="subtle"
                  onClick={() => {
                    goToMove(position);
                    setOpen(false);
                  }}
                >
                  <IconArrowRight />
                </ActionIcon>
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>
    </Modal>
  );
}

function LogsModal({
  open,
  setOpen,
  logs,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  logs: PracticeData["logs"];
}) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const goToMove = useStore(store, (s) => s.goToMove);
  return (
    <Modal
      opened={open}
      onClose={() => setOpen(false)}
      size="xl"
      title={<b>{t("Board.Practice.Logs")}</b>}
    >
      <SimpleGrid cols={2}>
        {logs.length === 0 && <Text>{t("Board.Practice.NoLogsYet")}</Text>}
        {logs.map((log) => {
          const position = findFen(log.fen, root);
          const node = getNodeAtPath(root, position);

          return (
            <Card key={log.fen}>
              <Text>
                {Math.floor(node.halfMoves / 2) + 1}
                {node.halfMoves % 2 === 0 ? ". " : "... "}
                {node.san}
              </Text>

              <Divider my="xs" />
              <Group justify="space-between">
                <Stack>
                  <Text tt="uppercase" fw="bold" fz="sm">
                    {t("Board.Practice.Rating")}
                  </Text>
                  <Badge
                    color={
                      log.rating === 1
                        ? "red"
                        : log.rating === 2
                          ? "orange"
                          : log.rating === 3
                            ? "blue"
                            : "green"
                    }
                  >
                    {log.rating === 1
                      ? t("Board.Practice.Again")
                      : log.rating === 2
                        ? t("Board.Practice.Hard")
                        : log.rating === 3
                          ? t("Board.Practice.Good")
                          : t("Board.Practice.Easy")}
                  </Badge>
                </Stack>
                <Stack>
                  <Text tt="uppercase" fw="bold" fz="sm">
                    {t("Common.Date")}
                  </Text>
                  <Text>{formatDate(log.due)}</Text>
                </Stack>
                <ActionIcon
                  variant="subtle"
                  onClick={() => {
                    goToMove(position);
                    setOpen(false);
                  }}
                >
                  <IconArrowRight />
                </ActionIcon>
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>
    </Modal>
  );
}

export default PracticePanel;
