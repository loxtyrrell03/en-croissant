import { Button, Stack, Text } from "@mantine/core";
import { atom, useAtomValue, useStore } from "jotai";
import { useMemo, useRef, useState, type ReactNode } from "react";
import useSWRImmutable from "swr/immutable";
import { commands, type EngineConfig } from "@/bindings";
import { useEngineDeviceSnapshot } from "@/hooks/useEngineDeviceSnapshot";
import {
  activeTabAtom,
  enginesAtom,
  tabEngineSettingsFamily,
  tabsAtom,
  engineSearchErrorFamily,
} from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import { analysisResourceScope, withCpuResources } from "@/utils/nativeEngineResources";
import type { EngineResourceValues } from "@/utils/engineResources";
import { CpuResourceControls, type ResourceEdit } from "./CpuResourceControls";
import { nativeProfileResourceFields } from "./NativeProfileResources";

// Visible engines reserve room even when stopped. Other enabled tab instances
// also count, including focus-paused sessions. These are not configured remotely.
const includedCpuEnginesAtom = atom((get) => {
  const engines = (get(enginesAtom) ?? []).filter(
    (engine) =>
      engine.type === "local" &&
      engine.loaded &&
      ["Threads", "Hash"].every((name) =>
        engine.settings?.some((setting) => setting.name === name),
      ),
  );
  const included = new Set<string>();
  const active = get(activeTabAtom);
  for (const engine of engines) included.add(JSON.stringify([active, engine.id]));
  for (const tab of get(tabsAtom))
    for (const engine of engines) {
      if (
        get(
          tabEngineSettingsFamily({
            tab: tab.value,
            engineId: engine.id,
            defaultSettings: engine.settings ?? undefined,
            defaultGo: engine.go ?? undefined,
          }),
        ).enabled
      )
        included.add(JSON.stringify([tab.value, engine.id]));
    }
  return Math.max(1, included.size);
});

/** Mounted only when the live form is open. Existing UCI inspection is cached
 * by path, bounded by its native timeout, and never requests an analysis search. */
export function NativeTabResources({
  engine,
  tab,
  fallback,
}: {
  engine: LocalEngine;
  tab: string;
  fallback: ReactNode;
}) {
  const {
    data: config,
    error,
    mutate,
  } = useSWRImmutable(
    ["engine-config", engine.path],
    async ([, path]) => {
      const result = await commands.getEngineConfig(path);
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
    { shouldRetryOnError: false },
  );
  if (!config)
    return (
      <Stack gap="xs">
        <Text size="xs" role={error ? "alert" : "status"}>
          {error ? "Could not read this engine's resource options." : "Reading engine options…"}
        </Text>
        {error && (
          <Button size="compact-xs" variant="subtle" onClick={() => void mutate().catch(() => {})}>
            Retry engine options
          </Button>
        )}
      </Stack>
    );
  return <NativeTabResourceEditor engine={engine} tab={tab} config={config} fallback={fallback} />;
}

function NativeTabResourceEditor({
  engine,
  tab,
  config,
  fallback,
}: {
  engine: LocalEngine;
  tab: string;
  config: EngineConfig;
  fallback: ReactNode;
}) {
  const atoms = useStore();
  const tabSettings = useMemo(
    () =>
      tabEngineSettingsFamily({
        tab,
        engineId: engine.id,
        defaultSettings: engine.settings ?? undefined,
        defaultGo: engine.go ?? undefined,
      }),
    [tab, engine.id, engine.settings, engine.go],
  );
  const settings = useAtomValue(tabSettings);
  const scope = analysisResourceScope(useAtomValue(tabsAtom).find((item) => item.value === tab));
  const previous = useRef<EngineResourceValues | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const searchError = useAtomValue(engineSearchErrorFamily({ engine: engine.id, tab }));
  const count = useAtomValue(includedCpuEnginesAtom);
  const device = useEngineDeviceSnapshot();
  const fields = nativeProfileResourceFields({ settings: settings.settings }, config);
  if (!fields)
    return (
      <>
        {fallback}
        <Text size="xs" c="dimmed">
          This engine keeps its supported resource options.
        </Text>
      </>
    );
  function prepareResource(values: EngineResourceValues): ResourceEdit {
    const profiles = atoms.get(enginesAtom);
    const before = atoms.get(tabSettings);
    const profile = profiles?.find((item) => item.id === engine.id);
    const ownsProfile = () => atoms.get(enginesAtom) === profiles;
    const ownsScope = () => {
      const current = atoms.get(tabSettings);
      return (
        scope !== null &&
        analysisResourceScope(atoms.get(tabsAtom).find((item) => item.value === tab)) === scope &&
        current.settings === before.settings &&
        current.go === before.go &&
        current.synced === before.synced
      );
    };
    if (
      atoms.get(activeTabAtom) !== tab ||
      !ownsScope() ||
      profile?.type !== "local" ||
      profile.path !== engine.path
    )
      throw new Error("This tab or engine changed. Open its current settings again.");
    const previousValues = {
      threads: Number(before.settings.find((setting) => setting.name === "Threads")?.value),
      hashMb: Number(before.settings.find((setting) => setting.name === "Hash")?.value),
    };
    const nextSettings = withCpuResources(before.settings, values);
    if (!before.synced)
      return {
        owns: ownsScope,
        async save() {
          if (!ownsScope() || atoms.get(activeTabAtom) !== tab)
            throw new Error("This tab changed. Its settings were preserved.");
          previous.current = previousValues;
          atoms.set(tabSettings, (current) => ({ ...current, settings: nextSettings }));
        },
        async restore() {},
      };
    if (!profiles || !enginePreferences.isSavedValue(profiles))
      throw new Error("Finish saving engine defaults before changing resources.");
    const target = profiles.map((item) =>
      item === profile
        ? { ...item, settings: withCpuResources(item.settings ?? [], values) }
        : item,
    );
    const edit = enginePreferences.prepareVerifiedUpdate(
      target,
      () => ownsProfile() && ownsScope(),
    );
    return {
      owns: () => ownsProfile() && ownsScope(),
      isApplied: () =>
        enginePreferences.isSavedValue(atoms.get(enginesAtom)) &&
        JSON.stringify(atoms.get(enginesAtom)) === JSON.stringify(edit.value),
      async save() {
        try {
          await edit.save();
        } catch (error) {
          if (!ownsScope()) {
            const settled = await edit.settleCanceled();
            if (settled && ownsProfile() && enginePreferences.isSavedValue(settled))
              atoms.set(enginesAtom, settled);
          }
          throw error;
        }
        if (!ownsProfile() || !enginePreferences.isSavedValue(edit.value))
          throw new Error(
            "A newer engine edit replaced this resource change. Current settings were preserved.",
          );
        const tabStillOwned = ownsScope();
        atoms.set(enginesAtom, edit.value);
        if (tabStillOwned) {
          previous.current = previousValues;
          atoms.set(tabSettings, (current) => ({ ...current, settings: nextSettings }));
        }
      },
      restore: edit.restore,
    };
  }
  return (
    <Stack gap="xs">
      <CpuResourceControls
        key={`${scope}:${settings.synced}`}
        {...fields}
        {...device}
        deviceError={device.error}
        includedEngines={count}
        disabled={restoring}
        scope={
          settings.synced
            ? "Saved defaults for this engine and synced tabs."
            : "Applies to this tab. Saved defaults stay as selected."
        }
        successLabel={settings.synced ? "Resources saved." : "Tab resources updated."}
        prepare={prepareResource}
      />
      {searchError && previous.current && (
        <Button
          size="xs"
          variant="default"
          loading={restoring}
          onClick={() => {
            const values = previous.current;
            if (!values) return;
            setRestoring(true);
            setRestoreError(null);
            void Promise.resolve()
              .then(() => prepareResource(values).save())
              .catch((error) => {
                setRestoreError(error instanceof Error ? error.message : String(error));
              })
              .finally(() => setRestoring(false));
          }}
        >
          Restore previous resources
        </Button>
      )}
      {restoreError && (
        <Text size="sm" c="red" role="alert">
          {restoreError}
        </Text>
      )}
    </Stack>
  );
}
