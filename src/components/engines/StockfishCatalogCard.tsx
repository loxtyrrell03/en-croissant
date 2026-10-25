import { Button, Group, Paper, Progress, Stack, Text } from "@mantine/core";
import { useAtomValue, useStore } from "jotai";
import { useSyncExternalStore } from "react";
import { useProgress } from "@/hooks/useProgress";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import { enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import { stockfishCatalog } from "@/utils/stockfishCatalog";
import { hasStockfishCatalogPath } from "@/utils/stockfishCatalogInstall";

function FileProgress({ id }: { id: string }) {
  const { progress } = useProgress(id);
  const value = Math.max(0, Math.min(95, Math.round(progress)));
  return (
    <Stack gap={4} role="status">
      <Text size="xs">{value ? `Engine files: ${value}%` : "Preparing engine files…"}</Text>
      <Progress value={value} animated aria-label="Engine file preparation" />
    </Stack>
  );
}

export function StockfishCatalogCard() {
  const atoms = useStore();
  const profiles = useAtomValue(enginesAtom);
  const status = useSyncExternalStore(stockfishCatalog.subscribe, stockfishCatalog.getSnapshot);
  const preferences = useSyncExternalStore(
    enginePreferences.subscribe,
    enginePreferences.getSnapshot,
  );
  const context = {
    read: () => atoms.get(enginesAtom),
    write: (next: NonNullable<typeof profiles>) => atoms.set(enginesAtom, next),
  };
  const busy = ["checking", "installing", "cancelling", "saving"].includes(status.phase);
  const added =
    status.phase === "complete" &&
    hasStockfishCatalogPath(profiles, status.path) &&
    enginePreferences.isSavedValue(profiles);
  const blocked =
    preferences.phase === "loading" ||
    preferences.phase === "error" ||
    preferences.saving ||
    preferences.pending ||
    !!preferences.error;
  const cancelVisible =
    status.phase === "checking" || status.phase === "installing" || status.phase === "cancelling";
  return (
    <Paper component="section" aria-label="Stockfish 19 setup" withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Text tt="uppercase" c="dimmed" fw={700} size="xs">
          ENGINE
        </Text>
        <Group gap="xs">
          <Text fw="bold" size="sm">
            Stockfish 19
          </Text>
          <PerformanceHelp label="About adding Stockfish 19">
            Uses the included engine when available, otherwise downloads it for this PC. Adding
            keeps your current default.
          </PerformanceHelp>
        </Group>
        {status.id && (status.phase === "installing" || status.phase === "cancelling") && (
          <FileProgress key={status.id} id={status.id} />
        )}
        {busy && (
          <Text size="xs" role="status">
            {status.phase === "saving"
              ? "Saving engine settings. Keep this app open."
              : status.phase === "cancelling"
                ? "Waiting for installation to stop…"
                : "Keep this app open; you can close this dialog."}
          </Text>
        )}
        {status.phase === "cancelled" && (
          <Text size="xs" role="status">
            Cancelled. Any completed download is kept for reuse.
          </Text>
        )}
        {status.error && (
          <Text size="xs" c="red" role="alert">
            {status.error}
            {status.pendingSave ? " Keep this app open to retry saving." : ""}
          </Text>
        )}
        <Group gap="xs" wrap="wrap">
          <Button
            size="xs"
            flex={1}
            disabled={busy || added || (status.pendingSave ? preferences.saving : blocked)}
            onClick={() => {
              void (status.pendingSave
                ? stockfishCatalog.retrySave(context)
                : stockfishCatalog.add(context));
            }}
          >
            {added
              ? "Added"
              : status.phase === "saving"
                ? "Saving settings…"
                : status.phase === "checking"
                  ? "Checking engine…"
                  : busy
                    ? "Installing…"
                    : status.pendingSave
                      ? "Retry save"
                      : status.error
                        ? "Retry adding Stockfish"
                        : "Add Stockfish 19"}
          </Button>
          {cancelVisible && (
            <Button
              size="xs"
              variant="default"
              disabled={status.phase === "cancelling" && !status.error}
              onClick={() => {
                void stockfishCatalog.cancel();
              }}
            >
              {status.phase === "cancelling" && status.error ? "Retry Cancel" : "Cancel"}
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
