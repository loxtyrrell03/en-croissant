import { Button, Stack, Text } from "@mantine/core";
import { atom, useAtomValue } from "jotai";
import { useRef, useState, type ReactNode } from "react";
import { type EngineConfig } from "@/bindings";
import { useNativeEngineConfig } from "@/hooks/useNativeEngineConfig";
import { useNativeTabSettings } from "@/hooks/useNativeTabSettings";
import { useEngineDeviceSnapshot } from "@/hooks/useEngineDeviceSnapshot";
import {
  activeTabAtom,
  enginesAtom,
  tabEngineSettingsFamily,
  tabsAtom,
  engineSearchErrorFamily,
} from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import { withCpuResources } from "@/utils/nativeEngineResources";
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
  const { data: config, error, mutate } = useNativeEngineConfig(engine.path);
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
  const { settings, scope, prepare } = useNativeTabSettings(engine, tab);
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
    return prepare(
      (before) => ({ ...before, settings: withCpuResources(before.settings, values) }),
      (before) => {
        previous.current = {
          threads: Number(before.settings.find((setting) => setting.name === "Threads")?.value),
          hashMb: Number(before.settings.find((setting) => setting.name === "Hash")?.value),
        };
      },
    );
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
