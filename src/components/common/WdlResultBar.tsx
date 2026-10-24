import { Progress } from "@mantine/core";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import type { DatabaseResultPerspective } from "@/utils/db";
import classes from "./WdlResultBar.module.css";

type Props = ComponentPropsWithoutRef<"div"> & {
  white: number;
  draw: number;
  black: number;
  perspective?: DatabaseResultPerspective | null;
  precision?: 0 | 1;
  compact?: boolean;
  dense?: boolean;
  tone?: "database" | "prep";
};

/** Result labels own their space; a small or empty segment never hides one. */
export const WdlResultBar = forwardRef<HTMLDivElement, Props>(function WdlResultBar(
  {
    white,
    draw,
    black,
    perspective = null,
    precision = 1,
    compact = false,
    dense = false,
    tone = "database",
    className,
    ...rest
  },
  ref,
) {
  const counts = [white, draw, black];
  const valid =
    counts.every((count) => Number.isFinite(count) && count >= 0) &&
    Number.isFinite(white + draw + black);
  const total = valid ? white + draw + black : 0;
  const available = Number.isFinite(total) && total > 0;
  const firstIsBlack = perspective === "black";
  const outcomes = [
    {
      name: firstIsBlack ? "Black wins" : "White wins",
      count: firstIsBlack ? black : white,
      color: classes.white,
    },
    { name: "Draws", count: draw, color: classes.draw },
    {
      name: firstIsBlack ? "White wins" : "Black wins",
      count: firstIsBlack ? white : black,
      color: classes.black,
    },
  ].map((outcome) => ({ ...outcome, percent: available ? (outcome.count / total) * 100 : 0 }));
  const label = available
    ? outcomes.map(({ name, percent }) => `${name} ${percent.toFixed(precision)}%`).join(" · ")
    : valid
      ? "No completed game results"
      : "Game results unavailable";
  return (
    <div
      {...rest}
      ref={ref}
      className={[classes.results, className].filter(Boolean).join(" ")}
      role="img"
      aria-label={label}
      data-compact={compact || undefined}
      data-dense={dense || undefined}
      data-tone={tone}
    >
      <div className={classes.labels} aria-hidden="true">
        {outcomes.map(({ name, percent, color }) => (
          <span key={name} className={classes.label} title={name}>
            <span className={`${classes.swatch} ${color}`} />
            {available ? `${percent.toFixed(precision)}%` : "—"}
          </span>
        ))}
      </div>
      <Progress.Root size={5} className={classes.bar} aria-hidden="true">
        {outcomes.map(({ name, percent, color }) => (
          <Progress.Section key={name} value={percent} className={color} />
        ))}
      </Progress.Root>
    </div>
  );
});
