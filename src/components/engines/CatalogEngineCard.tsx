import { Button, Group, Paper, Progress, Stack, Text } from "@mantine/core";
import { useAtomValue, useStore } from "jotai";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useProgress } from "@/hooks/useProgress";
import { enginesAtom } from "@/state/atoms";
import { catalogInstall } from "@/utils/catalogInstall";
import { catalogProfile } from "@/utils/catalogInstallState";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import { EngineLogo } from "./EngineLogo";

function FileProgress({ id }: { id: string }) {
  const { progress, finished } = useProgress(id);
  const value = Math.max(0, Math.min(99, Math.round(progress)));
  return (
    <Stack gap={4} role="status">
      <Text size="xs">
        {finished
          ? "Finishing engine files…"
          : value
            ? `Current download: ${value}%`
            : "Preparing engine files…"}
      </Text>
      <Progress value={value} animated aria-label="Current engine download" />
    </Stack>
  );
}

export function CatalogEngineCard({ engine }: { engine: LocalEngine }) {
  const { t } = useTranslation();
  const atoms = useStore();
  const profiles = useAtomValue(enginesAtom);
  const operation = catalogInstall(atoms, engine);
  const status = useSyncExternalStore(operation.subscribe, operation.getSnapshot);
  const preferences = useSyncExternalStore(
    enginePreferences.subscribe,
    enginePreferences.getSnapshot,
  );
  useEffect(() => {
    const confirm = () =>
      void operation.confirmSaved({
        read: () => atoms.get(enginesAtom),
        write: (value) => atoms.set(enginesAtom, value),
      });
    const unsubscribe = enginePreferences.subscribe(confirm);
    confirm();
    return unsubscribe;
  }, [atoms, operation]);
  const context = {
    read: () => atoms.get(enginesAtom),
    write: (value: NonNullable<typeof profiles>) => atoms.set(enginesAtom, value),
  };
  const busy = ["checking", "installing", "validating", "saving"].includes(status.phase);
  const complete =
    (status.phase === "idle" || status.phase === "complete") &&
    !!catalogProfile(profiles, engine, status.path) &&
    !preferences.saving &&
    !preferences.pending &&
    !preferences.error &&
    enginePreferences.isSavedValue(profiles);
  const blocked =
    preferences.phase === "loading" ||
    preferences.phase === "error" ||
    preferences.saving ||
    preferences.pending ||
    !!preferences.error;
  return (
    <Paper
      component="section"
      aria-label={`${engine.name} installation`}
      withBorder
      radius="md"
      p="sm"
    >
      <Stack gap="xs">
        <Text tt="uppercase" c="dimmed" fw={700} size="xs">
          ENGINE
        </Text>
        <Group gap="xs">
          <EngineLogo engine={engine} />
          <Text fw="bold" size="sm">
            {engine.name} {engine.version}
          </Text>
        </Group>
        {Number.isFinite(engine.elo) && <Text size="xs">{engine.elo} Elo</Text>}
        <Text size="xs">
          {engine.downloadSize == null || !Number.isFinite(engine.downloadSize)
            ? "Download size unavailable"
            : `Download: ${Math.round(engine.downloadSize / (1024 * 1024))} MiB`}
        </Text>
        {status.phase === "installing" && status.id && (
          <FileProgress key={status.id} id={status.id} />
        )}
        {busy && (
          <Text size="xs" role="status">
            {status.phase === "saving"
              ? "Saving engine settings. Keep this app open."
              : status.phase === "validating"
                ? "Checking the engine. You can close this dialog."
                : "Keep this app open; you can close this dialog."}
          </Text>
        )}
        {status.error && (
          <Text size="xs" c="red" role="alert">
            {status.error}
            {status.pendingSave ? " Keep this app open to retry saving." : ""}
          </Text>
        )}
        <Button
          size="xs"
          fullWidth
          disabled={busy || complete || (status.pendingSave ? preferences.saving : blocked)}
          onClick={() =>
            void (status.pendingSave ? operation.retrySave(context) : operation.install(context))
          }
        >
          {complete
            ? t("Common.Installed")
            : status.phase === "saving"
              ? "Saving settings…"
              : status.phase === "validating"
                ? "Checking engine…"
                : busy
                  ? "Installing…"
                  : status.pendingSave
                    ? "Retry save"
                    : status.error
                      ? "Retry install"
                      : t("Common.Install")}
        </Button>
      </Stack>
    </Paper>
  );
}
