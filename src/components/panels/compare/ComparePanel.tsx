import { Box, Paper, Stack, Text } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { memo, type PointerEvent as ReactPointerEvent } from "react";
import AnalysisPanel from "../analysis/AnalysisPanel";
import DatabaseComparePanel from "../database/DatabaseComparePanel";

const MIN_ENGINE_HEIGHT = 120;
const MIN_DATABASE_HEIGHT = 220;

function ComparePanel() {
  const [engineHeight, setEngineHeight] = useLocalStorage({
    key: "compareEngineHeight",
    defaultValue: 240,
  });

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startY = event.clientY;
    const startHeight = engineHeight;
    document.body.style.cursor = "row-resize";

    const onPointerMove = (moveEvent: PointerEvent) => {
      setEngineHeight(Math.max(MIN_ENGINE_HEIGHT, startHeight + moveEvent.clientY - startY));
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
    <Stack h="100%" gap={6} p="xs" style={{ minHeight: 0, overflowX: "hidden", overflowY: "auto" }}>
      <Paper withBorder h={engineHeight} style={{ overflow: "hidden", flexShrink: 0 }}>
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
        p="xs"
        flex={1}
        mih={MIN_DATABASE_HEIGHT}
        style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
      >
        <Text fw={700} fz="sm" mb={6}>
          Database comparison
        </Text>
        <DatabaseComparePanel />
      </Paper>
    </Stack>
  );
}

export default memo(ComparePanel);
