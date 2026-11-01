import { Alert, Button, Stack, Text } from "@mantine/core";
import { otbCoverageWarning, type OtbCoverage } from "@/utils/otbCoverage";

export function OtbCoverageNotice({ coverage, onRetry, busy = false }: {
  coverage?: OtbCoverage;
  onRetry?: () => void;
  busy?: boolean;
}) {
  const warning = otbCoverageWarning(coverage);
  if (!warning) return null;
  return <Alert color="yellow" title={coverage?.status === "unknown" ? "Source coverage unknown" : "Incomplete source coverage"}>
    <Stack gap="xs">
      <Text size="sm">{warning}</Text>
      {!!coverage?.gaps.length && <details><summary>Source details</summary><Stack gap={4} mt="xs">
        {coverage.gaps.map((gap, index) => <Text key={index} size="sm" style={{ overflowWrap: "anywhere" }}>{gap}</Text>)}
      </Stack></details>}
      {onRetry && <Button variant="light" loading={busy} onClick={onRetry} style={{ alignSelf: "flex-start", maxWidth: "100%" }}>Retry same sources</Button>}
    </Stack>
  </Alert>;
}
