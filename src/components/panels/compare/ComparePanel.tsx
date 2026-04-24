import { Paper, Stack, Text } from "@mantine/core";
import { memo } from "react";
import AnalysisPanel from "../analysis/AnalysisPanel";
import DatabaseComparePanel from "../database/DatabaseComparePanel";

function ComparePanel() {
  return (
    <Stack h="100%" gap={6} p="xs" style={{ overflow: "hidden" }}>
      <Paper withBorder h={240} style={{ overflow: "hidden", flexShrink: 0 }}>
        <AnalysisPanel />
      </Paper>
      <Paper
        withBorder
        p="xs"
        flex={1}
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
