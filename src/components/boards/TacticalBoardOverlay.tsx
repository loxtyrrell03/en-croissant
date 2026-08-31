import { Box } from "@mantine/core";
import type { CSSProperties } from "react";
import type { LiveTacticalBoardLabel } from "@/utils/tacticalMotifs/liveTactics";

function squarePosition(square: string, orientation: "white" | "black") {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number.parseInt(square[1] ?? "", 10) - 1;
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;

  const displayFile = orientation === "white" ? file : 7 - file;
  const displayRankFromTop = orientation === "white" ? 7 - rank : rank;
  return {
    left: `${(displayFile + 0.5) * 12.5}%`,
    top: `${displayRankFromTop * 12.5 + 1.25}%`,
  };
}

export function TacticalBoardOverlay({
  labels,
  orientation,
}: {
  labels: LiveTacticalBoardLabel[];
  orientation: "white" | "black";
}) {
  const squareCounts = new Map<string, number>();

  return (
    <Box
      aria-hidden="true"
      pos="absolute"
      inset={0}
      style={{ pointerEvents: "none", zIndex: 35, overflow: "hidden" }}
    >
      {labels.map((label, index) => {
        const position = label.square ? squarePosition(label.square, orientation) : null;
        const squareKey = label.square ?? "fallback";
        const stackIndex = squareCounts.get(squareKey) ?? 0;
        squareCounts.set(squareKey, stackIndex + 1);
        const style: CSSProperties = position
          ? {
              left: position.left,
              top: position.top,
              transform: `translate(-50%, ${stackIndex * 19}px)`,
            }
          : {
              left: "50%",
              top: 8 + stackIndex * 21,
              transform: "translateX(-50%)",
            };

        return (
          <Box
            key={`${label.id}:${label.square ?? index}`}
            pos="absolute"
            px={7}
            py={2}
            style={{
              ...style,
              maxWidth: "42%",
              overflow: "hidden",
              color: "white",
              background: label.color,
              border: "1px solid rgba(255, 255, 255, 0.82)",
              borderRadius: 999,
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.48)",
              fontSize: "clamp(0.58rem, 1.6vw, 0.72rem)",
              fontWeight: 800,
              lineHeight: 1.25,
              letterSpacing: "0.01em",
              textOverflow: "ellipsis",
              textShadow: "0 1px 2px rgba(0, 0, 0, 0.55)",
              whiteSpace: "nowrap",
            }}
          >
            {label.text}
          </Box>
        );
      })}
    </Box>
  );
}
