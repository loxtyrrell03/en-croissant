import { Paper, Progress, Text } from "@mantine/core";
import { useContext } from "react";
import { match } from "ts-pattern";
import { useStore } from "zustand";
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
  const progress = match(color)
    .with("white", () => white.progress)
    .with("black", () => black.progress)
    .otherwise(() => 0);

  return (
    <Paper
      className={`${classes.clock} ${color === "black" ? classes.blackClock : classes.whiteClock}`}
      styles={{
        root: {
          opacity: turn !== color ? 0.5 : 1,
          visibility: clock !== undefined ? "visible" : "hidden",
          transition: "opacity 0.15s",
        },
      }}
    >
      <Text className={classes.clockText} fz="sm" fw={800} px="xs">
        {clock !== undefined ? formatClockTime(clock) : "0:00"}
      </Text>
      <Progress
        size="xs"
        w="100%"
        value={progress * 100}
        animated={turn === color}
        styles={{
          section: {
            animationDirection: "reverse",
          },
        }}
      />
    </Paper>
  );
}

export default Clock;
