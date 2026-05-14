import { Paper, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { useContext } from "react";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { liveReplayClockAtom } from "@/state/liveReplay";
import { positionFromFen } from "@/utils/chessops";
import { formatClockTime, getClockInfo } from "@/utils/clock";
import { TreeStateContext } from "../common/TreeStateContext";
import classes from "./Clock.module.css";

function Clock({
  color,
  turn,
  whiteTime,
  blackTime,
}: {
  color: "white" | "black";
  turn: "white" | "black";
  whiteTime?: number;
  blackTime?: number;
}) {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);
  const headers = useStore(store, (s) => s.headers);
  const currentNode = useStore(store, (s) => s.currentNode());
  const liveReplayClock = useAtomValue(liveReplayClockAtom);
  const [pos] = positionFromFen(currentNode.fen);

  const { white, black } = getClockInfo({
    headers,
    root,
    currentClock: currentNode.clock,
    position,
    pos,
    whiteTime,
    blackTime,
  });

  const clock = match(color)
    .with("white", () => white.value)
    .with("black", () => black.value)
    .otherwise(() => undefined);
  const visibleClock =
    liveReplayClock?.color === color
      ? getInterpolatedClock(liveReplayClock)
      : clock;
  return (
    <Paper
      className={`${classes.clock} ${color === "black" ? classes.blackClock : classes.whiteClock}`}
      styles={{
        root: {
          opacity: turn !== color ? 0.5 : 1,
          visibility: visibleClock !== undefined ? "visible" : "hidden",
          transition: "opacity 0.15s",
        },
      }}
    >
      <Text className={classes.clockText} fz="sm" fw={800} px="xs">
        {visibleClock !== undefined ? formatClockTime(visibleClock) : "0:00"}
      </Text>
    </Paper>
  );
}

function getInterpolatedClock({
  startSeconds,
  endSeconds,
  remainingMs,
  totalMs,
}: {
  startSeconds: number;
  endSeconds: number;
  remainingMs: number;
  totalMs: number;
}) {
  const progress = totalMs > 0 ? (totalMs - remainingMs) / totalMs : 1;
  return startSeconds - (startSeconds - endSeconds) * Math.min(1, Math.max(0, progress));
}

export default Clock;
