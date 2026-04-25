import { Box, Paper, Stack } from "@mantine/core";
import { useElementSize, useLocalStorage } from "@mantine/hooks";
import { memo, type PointerEvent as ReactPointerEvent } from "react";
import AnalysisPanel from "../analysis/AnalysisPanel";
import DatabaseComparePanel from "../database/DatabaseComparePanel";

const MIN_ENGINE_HEIGHT = 120;
const MIN_DATABASE_HEIGHT = 220;
const COMPACT_MIN_ENGINE_HEIGHT = 96;
const COMPACT_MIN_DATABASE_HEIGHT = 160;
const COMPACT_COMPARE_WIDTH = 700;
const COMPARE_PANEL_CHROME_HEIGHT = 42;

function ComparePanel() {
  const [engineHeight, setEngineHeight] = useLocalStorage({
    key: "compareEngineHeight",
    defaultValue: 240,
  });
  const { ref: compareRef, width: compareWidth, height: compareHeight } = useElementSize();
  const compact = compareWidth > 0 && compareWidth < COMPACT_COMPARE_WIDTH;
  const minEngineHeight = compact ? COMPACT_MIN_ENGINE_HEIGHT : MIN_ENGINE_HEIGHT;
  const minDatabaseHeight = compact ? COMPACT_MIN_DATABASE_HEIGHT : MIN_DATABASE_HEIGHT;
  const maxEngineHeight =
    compareHeight > 0
      ? Math.max(minEngineHeight, compareHeight - minDatabaseHeight - COMPARE_PANEL_CHROME_HEIGHT)
      : Number.POSITIVE_INFINITY;
  const visibleEngineHeight = Math.min(Math.max(engineHeight, minEngineHeight), maxEngineHeight);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startY = event.clientY;
    const startHeight = visibleEngineHeight;
    document.body.style.cursor = "row-resize";

    const onPointerMove = (moveEvent: PointerEvent) => {
      setEngineHeight(
        Math.min(
          maxEngineHeight,
          Math.max(minEngineHeight, startHeight + moveEvent.clientY - startY),
        ),
      );
    };

    const stop = () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return (
    <Stack
      ref={compareRef}
      h="100%"
      gap={compact ? 4 : 6}
      p={compact ? 4 : "xs"}
      style={{ minHeight: 0, overflowX: "hidden", overflowY: "auto" }}
    >
      <Paper withBorder h={visibleEngineHeight} style={{ overflow: "hidden", flexShrink: 0 }}>
        <AnalysisPanel />
      </Paper>
      <Box
        h={8}
        style={{ position: "relative", cursor: "row-resize", flexShrink: 0 }}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize compare panels"
        onPointerDown={startResize}
      >
        <Box
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            height: 1,
            background: "var(--mantine-color-dark-4)",
            transform: "translateY(-50%)",
          }}
        />
      </Box>
      <Paper
        withBorder
        p={compact ? 6 : "xs"}
        flex={1}
        mih={minDatabaseHeight}
        style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
      >
        <DatabaseComparePanel />
      </Paper>
    </Stack>
  );
}

export default memo(ComparePanel);
