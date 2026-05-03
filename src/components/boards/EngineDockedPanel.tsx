import { Box, Paper, Stack, type MantineSpacing } from "@mantine/core";
import { useAtomValue } from "jotai";
import type { ReactNode } from "react";
import EnginePanelContent from "@/components/panels/analysis/EnginePanelContent";
import { showEngineDockAtom } from "@/state/atoms";

const dockedContentStyle = {
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
} as const;

export default function EngineDockedPanel({
  children,
  contentPadding,
}: {
  children: ReactNode;
  contentPadding?: MantineSpacing;
}) {
  const showEngineDock = useAtomValue(showEngineDockAtom);

  if (!showEngineDock) {
    return (
      <Box h="100%" p={contentPadding} style={dockedContentStyle}>
        {children}
      </Box>
    );
  }

  return (
    <Stack h="100%" gap={6} style={{ minHeight: 0, overflow: "hidden" }}>
      <Box flex={1} p={contentPadding} style={dockedContentStyle}>
        {children}
      </Box>
      <Paper
        withBorder
        h="13rem"
        mah="35%"
        style={{ minHeight: "8.75rem", overflow: "hidden", flexShrink: 0 }}
      >
        <EnginePanelContent compact />
      </Paper>
    </Stack>
  );
}
