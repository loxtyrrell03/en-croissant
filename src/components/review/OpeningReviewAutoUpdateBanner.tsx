import { Badge, Box, Group, Loader, Paper, Progress, Stack, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { databaseConversionStateAtom, openingReviewAutoUpdateStateAtom } from "@/state/atoms";

export function OpeningReviewAutoUpdateBanner({
  fixed = false,
  deckPath,
}: {
  fixed?: boolean;
  deckPath?: string;
}) {
  const state = useAtomValue(openingReviewAutoUpdateStateAtom);
  const conversionState = useAtomValue(databaseConversionStateAtom);
  const showingReviewUpdate = state.running;
  const showingDatabaseUpdate = fixed && !showingReviewUpdate && conversionState.inProgress;

  if (!showingReviewUpdate && !showingDatabaseUpdate) return null;
  if (showingReviewUpdate && deckPath && state.deckPath && state.deckPath !== deckPath) {
    return null;
  }

  const progress = showingReviewUpdate
    ? state.progress === null
      ? undefined
      : Math.max(0, Math.min(100, state.progress))
    : conversionState.progress === null
      ? undefined
      : Math.max(0, Math.min(100, conversionState.progress));
  const title = showingReviewUpdate ? "Updating Opening Review" : "Updating online games";
  const phase = showingReviewUpdate
    ? state.phase
    : conversionState.phase === "downloading"
      ? "Downloading"
      : "Converting";
  const detail = showingReviewUpdate
    ? `${state.deckName ?? ""}${state.databaseTitle ? ` from ${state.databaseTitle}` : ""}`
    : (conversionState.sourceFileName ?? conversionState.targetDatabaseTitle);

  const content = (
    <Paper withBorder shadow={fixed ? "md" : undefined} px="sm" py={6}>
      <Stack gap={4}>
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" miw={0}>
            <Loader size="xs" />
            <Text size="sm" fw={700} truncate>
              {title}
            </Text>
            {phase && (
              <Badge size="sm" variant="light">
                {phase}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {detail}
          </Text>
        </Group>
        {progress !== undefined && <Progress value={progress} size="xs" animated />}
      </Stack>
    </Paper>
  );

  if (!fixed) return content;

  return (
    <Box
      style={{
        position: "fixed",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(48rem, calc(100vw - 2rem))",
        zIndex: 450,
        pointerEvents: "none",
      }}
    >
      <Box style={{ pointerEvents: "auto" }}>{content}</Box>
    </Box>
  );
}
