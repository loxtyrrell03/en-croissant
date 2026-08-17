import { Progress } from "@mantine/core";
import type { DatabaseResultPerspective } from "@/utils/db";
import classes from "./OpeningsTable.module.css";

export function DatabaseWdlBar({
  white,
  draw,
  black,
  perspective = null,
  compact = false,
  dense = false,
}: {
  white: number;
  draw: number;
  black: number;
  perspective?: DatabaseResultPerspective | null;
  compact?: boolean;
  dense?: boolean;
}) {
  const total = white + draw + black;
  const first = perspective === "black" ? black : white;
  const third = perspective === "black" ? white : black;
  const firstPercent = total > 0 ? (first / total) * 100 : 0;
  const drawPercent = total > 0 ? (draw / total) * 100 : 0;
  const thirdPercent = total > 0 ? (third / total) * 100 : 0;
  const showLabelThreshold = dense ? 18 : 10;
  const className = [classes.result, dense ? classes.denseResult : null]
    .filter(Boolean)
    .join(" ");

  return (
    <Progress.Root size={compact ? "lg" : "xl"} className={className}>
      <Progress.Section value={firstPercent} className={classes.whiteResultsSection}>
        <Progress.Label c="black">
          {firstPercent > showLabelThreshold ? `${firstPercent.toFixed(1)}%` : ""}
        </Progress.Label>
      </Progress.Section>
      <Progress.Section value={drawPercent} color="gray">
        <Progress.Label>
          {drawPercent > showLabelThreshold ? `${drawPercent.toFixed(1)}%` : ""}
        </Progress.Label>
      </Progress.Section>
      <Progress.Section value={thirdPercent} color="black">
        <Progress.Label>
          {thirdPercent > showLabelThreshold ? `${thirdPercent.toFixed(1)}%` : ""}
        </Progress.Label>
      </Progress.Section>
    </Progress.Root>
  );
}
