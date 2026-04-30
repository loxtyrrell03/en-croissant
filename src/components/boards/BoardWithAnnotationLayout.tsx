import { Box, Paper, Stack } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import type { ReactNode } from "react";

const SIDE_BY_SIDE_MIN_WIDTH = 760;
const SIDE_BY_SIDE_MIN_HEIGHT = 520;
const ANNOTATION_SIDE_WIDTH = "17rem";
const ANNOTATION_BOTTOM_HEIGHT = "15rem";

export function BoardWithAnnotationLayout({
  board,
  annotation,
  controls,
}: {
  board: ReactNode;
  annotation: ReactNode;
  controls?: ReactNode;
}) {
  const { ref, width, height } = useElementSize();
  const sideBySide = width >= SIDE_BY_SIDE_MIN_WIDTH && height >= SIDE_BY_SIDE_MIN_HEIGHT;

  return (
    <Box
      ref={ref}
      h="100%"
      style={{
        display: "flex",
        flexDirection: sideBySide ? "row" : "column",
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
      <Paper
        withBorder
        h={sideBySide ? "100%" : ANNOTATION_BOTTOM_HEIGHT}
        w={sideBySide ? ANNOTATION_SIDE_WIDTH : undefined}
        mah={sideBySide ? undefined : "35%"}
        style={{
          flex: "0 0 auto",
          minWidth: sideBySide ? "14rem" : 0,
          minHeight: sideBySide ? 0 : "10rem",
          overflow: "hidden",
        }}
      >
        {annotation}
      </Paper>
    </Box>
  );
}
