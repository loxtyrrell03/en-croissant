import { Box, Stack } from "@mantine/core";
import type { ReactNode } from "react";

const UNDER_BOARD_HEIGHT = "clamp(17rem, 35%, 24rem)";

export function BoardWithAnnotationLayout({
  board,
  underBoard,
  controls,
}: {
  board: ReactNode;
  underBoard?: ReactNode;
  controls?: ReactNode;
}) {
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
            flex: `0 0 ${UNDER_BOARD_HEIGHT}`,
            minWidth: 0,
            minHeight: "17rem",
            overflow: "hidden",
          }}
        >
          {underBoard}
        </Box>
      )}
    </Box>
  );
}
