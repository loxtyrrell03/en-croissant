import { Button, Group, Stack, Switch, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import { storedEvaluationSaveErrorAtom, useStoredEvaluationsAtom } from "@/state/atoms";

export function StoredEvaluationSwitch() {
  const [enabled, setEnabled] = useAtom(useStoredEvaluationsAtom);
  const [error, setError] = useAtom(storedEvaluationSaveErrorAtom);
  function save(value: boolean) {
    try {
      setEnabled(value);
      setError(null);
    } catch {
      setError("Could not save this setting. Your choice stays active until the app closes.");
    }
  }
  return (
    <Stack gap={4}>
      <Group gap={5} wrap="nowrap">
        <Switch
          size="xs"
          label="Stored evals"
          aria-label="Use stored evaluations for local engines"
          checked={enabled}
          onChange={(event) => save(event.currentTarget.checked)}
        />
        <PerformanceHelp label="About stored evaluations for local engines">
          Use downloaded evaluations in local-engine analysis; turn off to use only the local
          engine. Separate cloud engines keep their own On/Off switches.
        </PerformanceHelp>
      </Group>
      {error && (
        <Group gap="xs" align="start">
          <Text size="xs" c="red" role="alert" style={{ flex: 1 }}>
            {error}
          </Text>
          <Button size="compact-xs" variant="default" onClick={() => save(enabled)}>
            Retry saving
          </Button>
        </Group>
      )}
    </Stack>
  );
}
