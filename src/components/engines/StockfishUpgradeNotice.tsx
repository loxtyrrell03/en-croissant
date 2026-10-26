import { Alert, Button, Group, Text } from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useSyncExternalStore } from "react";
import { desktopEngineSessionsBusyAtom, enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import { stockfishUpgradeState } from "@/utils/stockfishUpgrade";

export function StockfishUpgradeNotice() {
  const status = useSyncExternalStore(
    stockfishUpgradeState.subscribe,
    stockfishUpgradeState.getSnapshot,
  );
  const preferences = useSyncExternalStore(
    enginePreferences.subscribe,
    enginePreferences.getSnapshot,
  );
  const busy = useAtomValue(desktopEngineSessionsBusyAtom);
  const setEngines = useSetAtom(enginesAtom);
  if (status.checkingResources && !status.error)
    return (
      <Text size="sm" role="status">
        Checking resources for new engine defaults…
      </Text>
    );
  if (!status.error) return null;
  return (
    <Alert color="red" title="Stockfish default couldn't finish updating" role="alert">
      <Group justify="space-between" wrap="wrap">
        <Text size="sm">{status.error}</Text>
        <Text size="sm">Keep this app open to retry. Your engine choices are retained.</Text>
        <Button
          size="xs"
          disabled={busy || preferences.pending || !!preferences.error}
          onClick={() => {
            void enginePreferences
              .reload()
              .then((profiles) => {
                setEngines(profiles);
                stockfishUpgradeState.retry();
              })
              .catch(() => {});
          }}
        >
          Retry upgrade
        </Button>
      </Group>
    </Alert>
  );
}
