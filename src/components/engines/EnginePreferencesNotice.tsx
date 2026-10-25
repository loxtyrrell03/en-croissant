import { Alert, Button, Group, Text } from "@mantine/core";
import { useSetAtom } from "jotai";
import { useSyncExternalStore } from "react";
import { enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";

export function EnginePreferencesNotice() {
  const status = useSyncExternalStore(enginePreferences.subscribe, enginePreferences.getSnapshot);
  const setEngines = useSetAtom(enginesAtom);
  if (!status.error) return null;
  return (
    <Alert
      color="red"
      title={
        status.pending
          ? "Engine settings haven't saved"
          : status.phase === "error"
            ? "Engine settings couldn't load"
            : "Engine settings couldn't change"
      }
      role="alert"
    >
      <Group justify="space-between" wrap="wrap">
        <Text size="sm">{status.error}</Text>
        {status.pending && <Text size="sm">Keep this app open until the settings save.</Text>}
        <Button
          size="xs"
          loading={status.saving}
          onClick={() => {
            void enginePreferences
              .retry()
              .then(() => {
                const current = enginePreferences.getSnapshot();
                if (!current.pending && current.value) setEngines(current.value);
              })
              .catch(() => {});
          }}
        >
          {status.pending ? "Retry save" : "Retry load"}
        </Button>
      </Group>
    </Alert>
  );
}
