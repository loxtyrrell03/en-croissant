import { Box, Paper, Stack, type MantineSpacing } from "@mantine/core";
import { useAtomValue } from "jotai";
import { lazy, Suspense, type ReactNode } from "react";
import { showEngineDockAtom } from "@/state/atoms";

const EnginePanelContent = lazy(() => import("@/components/panels/analysis/EnginePanelContent"));

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
      <Paper withBorder style={{ overflow: "hidden", flexShrink: 0 }}>
        <Suspense fallback={null}>
          <EnginePanelContent compact />
        </Suspense>
      </Paper>
    </Stack>
  );
}
