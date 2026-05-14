import { ActionIcon, Button, Group, Progress, Stack, Tooltip } from "@mantine/core";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useStore } from "zustand";
import { keyMapAtom } from "@/state/keybinds";
import { formatMoveThinkTime } from "@/utils/clock";
import { getLiveReplayStep } from "@/utils/liveReplay";
import { TreeStateContext } from "./TreeStateContext";

function MoveControls({ readOnly }: { readOnly?: boolean }) {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const position = useStore(store, (s) => s.position);
  const practicePath = useStore(store, (s) => s.practicePath);
  const next = useStore(store, (s) => s.goToNext);
  const previous = useStore(store, (s) => s.goToPrevious);
  const start = useStore(store, (s) => s.goToStart);
  const end = useStore(store, (s) => s.goToEnd);
  const deleteMove = useStore(store, (s) => s.deleteMove);
  const startBranch = useStore(store, (s) => s.goToBranchStart);
  const endBranch = useStore(store, (s) => s.goToBranchEnd);
  const nextBranch = useStore(store, (s) => s.nextBranch);
  const previousBranch = useStore(store, (s) => s.previousBranch);
  const nextBranching = useStore(store, (s) => s.nextBranching);
  const previousBranching = useStore(store, (s) => s.previousBranching);
  const [liveReplay, setLiveReplay] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  const clearLiveTimers = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const stopLiveReplay = useCallback(() => {
    clearLiveTimers();
    setLiveReplay(false);
  }, [clearLiveTimers]);

  const liveStep = useMemo(
    () => getLiveReplayStep({ headers, root, position, practicePath }),
    [headers, position, practicePath, root],
  );
  const liveProgress =
    liveReplay && liveStep && remainingMs !== null && liveStep.delayMs > 0
      ? Math.min(100, Math.max(0, ((liveStep.delayMs - remainingMs) / liveStep.delayMs) * 100))
      : 0;
  const liveTooltip = liveReplay
    ? `Pause live replay${remainingMs !== null ? ` - next move in ${formatMoveThinkTime(remainingMs / 1000)}` : ""}`
    : liveStep
      ? `Watch at game pace - next move in ${formatMoveThinkTime(liveStep.moveTimeSeconds)}`
      : "Live replay needs timed moves";
  const liveLabel = liveReplay ? "Pause" : "Live replay";

  const wrapManualNavigation = useCallback(
    (action: () => void) => {
      return () => {
        stopLiveReplay();
        action();
      };
    },
    [stopLiveReplay],
  );

  const handleStart = useMemo(() => wrapManualNavigation(start), [start, wrapManualNavigation]);
  const handlePrevious = useMemo(
    () => wrapManualNavigation(previous),
    [previous, wrapManualNavigation],
  );
  const handleNext = useMemo(() => wrapManualNavigation(next), [next, wrapManualNavigation]);
  const handleEnd = useMemo(() => wrapManualNavigation(end), [end, wrapManualNavigation]);
  const handleDeleteMove = useMemo(
    () => (readOnly ? () => {} : wrapManualNavigation(() => deleteMove())),
    [deleteMove, readOnly, wrapManualNavigation],
  );
  const handleStartBranch = useMemo(
    () => wrapManualNavigation(startBranch),
    [startBranch, wrapManualNavigation],
  );
  const handleEndBranch = useMemo(
    () => wrapManualNavigation(endBranch),
    [endBranch, wrapManualNavigation],
  );
  const handleNextBranch = useMemo(
    () => wrapManualNavigation(nextBranch),
    [nextBranch, wrapManualNavigation],
  );
  const handlePreviousBranch = useMemo(
    () => wrapManualNavigation(previousBranch),
    [previousBranch, wrapManualNavigation],
  );
  const handleNextBranching = useMemo(
    () => wrapManualNavigation(nextBranching),
    [nextBranching, wrapManualNavigation],
  );
  const handlePreviousBranching = useMemo(
    () => wrapManualNavigation(previousBranching),
    [previousBranching, wrapManualNavigation],
  );

  useEffect(() => {
    if (!liveReplay) {
      clearLiveTimers();
      setRemainingMs(null);
      return;
    }

    if (!liveStep) {
      setLiveReplay(false);
      return;
    }

    clearLiveTimers();
    const startedAt = window.performance.now();
    const deadline = startedAt + liveStep.delayMs;
    setRemainingMs(liveStep.delayMs);
    tickRef.current = window.setInterval(() => {
      setRemainingMs(Math.max(0, deadline - window.performance.now()));
    }, 200);
    timeoutRef.current = window.setTimeout(() => {
      clearLiveTimers();
      setRemainingMs(null);
      next();
    }, liveStep.delayMs);

    return clearLiveTimers;
  }, [clearLiveTimers, liveReplay, liveStep, next]);

  useEffect(() => {
    return clearLiveTimers;
  }, [clearLiveTimers]);

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys(keyMap.PREVIOUS_MOVE.keys, handlePrevious);
  useHotkeys(keyMap.NEXT_MOVE.keys, handleNext);
  useHotkeys(keyMap.GO_TO_START.keys, handleStart);
  useHotkeys(keyMap.GO_TO_END.keys, handleEnd);
  useHotkeys(keyMap.DELETE_MOVE.keys, handleDeleteMove);
  useHotkeys(keyMap.GO_TO_BRANCH_START.keys, handleStartBranch);
  useHotkeys(keyMap.GO_TO_BRANCH_END.keys, handleEndBranch);
  useHotkeys(keyMap.NEXT_BRANCH.keys, handleNextBranch);
  useHotkeys(keyMap.PREVIOUS_BRANCH.keys, handlePreviousBranch);
  useHotkeys(keyMap.NEXT_BRANCHING.keys, handleNextBranching);
  useHotkeys(keyMap.PREVIOUS_BRANCHING.keys, handlePreviousBranching);

  return (
    <Stack gap={4}>
      <Group grow gap="xs" wrap="nowrap">
        <Tooltip label="Start" openDelay={350}>
          <ActionIcon variant="default" size="lg" onClick={handleStart} aria-label="Start">
            <IconChevronsLeft />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Previous move" openDelay={350}>
          <ActionIcon
            variant="default"
            size="lg"
            onClick={handlePrevious}
            aria-label="Previous move"
          >
            <IconChevronLeft />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={liveTooltip} openDelay={350}>
          <Button
            variant={liveReplay ? "filled" : "default"}
            color={liveReplay ? "blue" : undefined}
            size="lg"
            px="xs"
            onClick={() => {
              if (!liveStep && !liveReplay) return;
              setLiveReplay((playing) => !playing);
            }}
            aria-label={liveReplay ? "Pause live replay" : "Watch at game pace"}
            disabled={!liveReplay && !liveStep}
            leftSection={
              liveReplay ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />
            }
            styles={{
              root: {
                minWidth: 0,
              },
              label: {
                whiteSpace: "normal",
                lineHeight: 1.05,
              },
              section: {
                marginInlineEnd: 6,
              },
            }}
          >
            {liveLabel}
          </Button>
        </Tooltip>
        <Tooltip label="Next move" openDelay={350}>
          <ActionIcon variant="default" size="lg" onClick={handleNext} aria-label="Next move">
            <IconChevronRight />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="End" openDelay={350}>
          <ActionIcon variant="default" size="lg" onClick={handleEnd} aria-label="End">
            <IconChevronsRight />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Progress
        value={liveProgress}
        size={3}
        radius="xs"
        aria-label="Live replay progress"
        style={{
          opacity: liveReplay ? 1 : 0,
          transition: "opacity 120ms ease",
        }}
      />
    </Stack>
  );
}

export default memo(MoveControls);
