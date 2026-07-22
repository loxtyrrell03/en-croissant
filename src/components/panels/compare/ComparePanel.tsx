import { Paper, Stack } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { memo } from "react";
import EnginePanelContent from "../analysis/EnginePanelContent";
import DatabaseComparePanel from "../database/DatabaseComparePanel";

const ENGINE_DOCK_HEIGHT = "clamp(11rem, 18vh, 12.25rem)";
const COMPACT_ENGINE_DOCK_HEIGHT = "clamp(10.5rem, 18vh, 12rem)";
const COMPACT_COMPARE_WIDTH = 700;

function ComparePanel() {
  const { ref: compareRef, width: compareWidth } = useElementSize();
  const compact = compareWidth > 0 && compareWidth < COMPACT_COMPARE_WIDTH;
  const engineDockHeight = compact ? COMPACT_ENGINE_DOCK_HEIGHT : ENGINE_DOCK_HEIGHT;

  return (
    <Stack
      ref={compareRef}
      h="100%"
      gap={compact ? 4 : 6}
      p={compact ? 4 : "xs"}
      style={{ minHeight: 0, overflow: "hidden" }}
    >
      <Paper withBorder h={engineDockHeight} style={{ overflow: "hidden", flexShrink: 0 }}>
        <EnginePanelContent compact />
      </Paper>
      <Paper
        withBorder
        p={compact ? 6 : "xs"}
        flex={1}
        mih={0}
        style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
      >
        <DatabaseComparePanel />
      </Paper>
    </Stack>
  );
}

export default memo(ComparePanel);
