import { Box, Stack } from "@mantine/core";
import type { ReactNode } from "react";

const UNDER_BOARD_HEIGHT = "clamp(17rem, 35%, 24rem)";
const LARGE_UNDER_BOARD_HEIGHT = "clamp(18rem, 38%, 26rem)";

export function BoardWithAnnotationLayout({
  board,
  underBoard,
  underBoardSize = "default",
  controls,
}: {
  board: ReactNode;
  underBoard?: ReactNode;
  underBoardSize?: "default" | "large";
  controls?: ReactNode;
}) {
  const underBoardHeight =
    underBoardSize === "large" ? LARGE_UNDER_BOARD_HEIGHT : UNDER_BOARD_HEIGHT;
  const underBoardMinHeight = underBoardSize === "large" ? "18rem" : "17rem";

  return (
    <Box
      h="100%"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--mantine-spacing-xs)",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Stack flex={1} gap="xs" style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <Box style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflow: "hidden" }}>{board}</Box>
        {controls}
      </Stack>
      {underBoard && (
        <Box
          data-testid="under-board-panel"
          style={{
            flex: `0 0 ${underBoardHeight}`,
            minWidth: 0,
            minHeight: underBoardMinHeight,
            overflow: "hidden",
          }}
        >
          {underBoard}
        </Box>
      )}
    </Box>
  );
}
