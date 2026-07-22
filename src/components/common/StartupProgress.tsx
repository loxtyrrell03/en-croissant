import { Box, Center, Group, Paper, Progress, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import classes from "./StartupProgress.module.css";

type StartupProgressProps = {
  label?: string;
  detail?: string;
  compact?: boolean;
};

const STARTUP_STEPS = [
  { label: "Preparing workspace", progress: 18 },
  { label: "Loading saved state", progress: 38 },
  { label: "Building board view", progress: 64 },
  { label: "Starting panels", progress: 82 },
  { label: "Ready", progress: 96 },
];

export function useStartupProgress() {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (stepIndex >= STARTUP_STEPS.length - 1) return;

    const delay = stepIndex === 0 ? 120 : stepIndex === 1 ? 180 : 260;
    const timer = window.setTimeout(() => setStepIndex((current) => current + 1), delay);
    return () => window.clearTimeout(timer);
  }, [stepIndex]);

  return STARTUP_STEPS[stepIndex];
}

export function StartupProgress({
  label = "Opening workspace",
  detail,
  compact = false,
}: StartupProgressProps) {
  const step = useStartupProgress();
  const detailText = detail ? `${detail} - ${step.label}` : step.label;

  return (
    <Stack gap={compact ? 6 : "xs"} className={compact ? classes.compactProgress : undefined}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Box style={{ minWidth: 0 }}>
          <Text size={compact ? "xs" : "sm"} fw={700} truncate>
            {label}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {detailText}
          </Text>
        </Box>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {step.progress}%
        </Text>
      </Group>
      <Progress value={step.progress} size={compact ? "xs" : "sm"} radius="xl" animated />
    </Stack>
  );
}

export function RouteStartupFallback() {
  return (
    <Center h="100%" w="100%" p="md">
      <Paper withBorder p="md" className={classes.routeFallback}>
        <StartupProgress />
      </Paper>
    </Center>
  );
}

export function BoardStartupFallback({
  label = "Opening board",
  detail,
}: {
  label?: string;
  detail?: string;
}) {
  const files = useMemo(() => Array.from({ length: 64 }, (_, index) => index), []);

  return (
    <Box className={classes.boardFallbackShell} aria-live="polite">
      <Box className={classes.boardFallbackLeft}>
        <Box className={classes.boardSkeleton}>
          {files.map((file) => (
            <Box
              key={file}
              className={classes.boardSquare}
              data-light={(file + Math.floor(file / 8)) % 2 === 0}
            />
          ))}
        </Box>
        <Paper withBorder className={classes.underBoardSkeleton}>
          <StartupProgress label={label} detail={detail} compact />
        </Paper>
      </Box>
      <Box className={classes.boardFallbackRight}>
        <Paper withBorder className={classes.panelSkeleton}>
          <StartupProgress label="Starting panels" detail="Loading analysis tools" compact />
          <Stack gap={8} mt="md">
            <Box className={classes.skeletonLineWide} />
            <Box className={classes.skeletonLine} />
            <Box className={classes.skeletonLineShort} />
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
