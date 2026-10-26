import { Button, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CpuResourceControls } from "@/components/engines/CpuResourceControls";
import { engineResourcePlan } from "@/utils/engineResources";
import { createVerifiedJsonPreference } from "./verifiedJsonPreference";
import type { PhoneCpuPreferences } from "./phoneCpuPreferences";
import { capturePcCpuResources, loadPcCpuCapability, type PcCpuCapability } from "./pcCpuResources";
import {
  ENGINE_PERFORMANCE_PRESETS,
  type EnginePerformancePreset,
} from "@/utils/enginePerformance";
import { enginePerformanceSettings } from "../../scripts/engine-performance-presets.mjs";

export type PhoneCpuStore = ReturnType<typeof createVerifiedJsonPreference<PhoneCpuPreferences>>;
export function usePhonePcCpuCapability(active: boolean) {
  const [state, setState] = useState({
    capability: null as PcCpuCapability | null,
    checking: false,
    error: null as string | null,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let owned = true;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, checking: true, error: null }));
    void loadPcCpuCapability(controller.signal).then(
      (capability) => {
        if (owned) setState({ capability, checking: false, error: null });
      },
      (error) => {
        if (owned)
          setState({
            capability: null,
            checking: false,
            error: error instanceof Error ? error.message : "PC resource check failed.",
          });
      },
    );
    return () => {
      owned = false;
      controller.abort();
    };
  }, [active, revision]);
  return { ...state, retry: () => setRevision((value) => value + 1) };
}

/** Both successful absence reads must still belong to this setup. Existing
 * fixed/default-looking choices, failed reads and any manual edit are excluded. */
export function useFirstUsePhoneCpu(
  store: PhoneCpuStore,
  capability: PcCpuCapability | null,
  allowed: boolean,
  legacy: { isFirstUse: () => boolean },
) {
  const attempted = useRef<PcCpuCapability | null>(null);
  useEffect(() => {
    if (
      !allowed ||
      !capability ||
      attempted.current === capability ||
      !legacy.isFirstUse() ||
      !store.getSnapshot().firstUseEligible
    )
      return;
    const plan = engineResourcePlan(capability.device, 1);
    if (
      !plan.canRecommend ||
      plan.presets.balanced.threads < capability.bounds.threads.min ||
      plan.presets.balanced.hashMb < capability.bounds.hashMb.min
    )
      return;
    attempted.current = capability;
    const values = {
      ...plan.presets.balanced,
      threads: Math.min(plan.presets.balanced.threads, capability.bounds.threads.max),
      hashMb: Math.min(plan.presets.balanced.hashMb, capability.bounds.hashMb.max),
    };
    try {
      store
        .prepare(
          () => ({ cpuResources: capturePcCpuResources({ version: 1, ...values }) }),
          legacy.isFirstUse,
          true,
        )
        .save();
    } catch {
      /* Store owns its visible failure and explicit retry. */
    }
  }, [store, capability, allowed, legacy]);
}

export function PhoneCpuResourceControls({
  store,
  state,
  fixedPreset,
  unavailable,
  starting = false,
  requestError,
}: {
  store: PhoneCpuStore;
  state: ReturnType<typeof usePhonePcCpuCapability>;
  fixedPreset: EnginePerformancePreset;
  unavailable: boolean;
  starting?: boolean;
  requestError?: string | null;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const selected = snapshot.value.cpuResources;
  // These values describe the legacy wire contract. They are never calculated
  // from this phone or silently changed into the new policy.
  const legacyValues = enginePerformanceSettings("stockfish", fixedPreset)!;
  const values = selected ?? legacyValues;
  const previous = useRef<PhoneCpuPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (snapshot.phase === "unreadable") return null;
  return (
    <Stack gap="xs">
      {state.capability ? (
        <CpuResourceControls
          values={values}
          device={state.capability.device}
          checking={state.checking}
          deviceError={null}
          retryDevice={state.retry}
          bounds={state.capability.bounds}
          disabled={unavailable || state.checking || Boolean(state.error)}
          applyUnchanged={!selected}
          scope="Live PC Stockfish for this phone profile. Other engines keep their settings."
          successLabel="PC resources saved."
          prepare={(next) => {
            const before = store.getSnapshot().value;
            const edit = store.prepare(() => ({
              cpuResources: capturePcCpuResources({ version: 1, ...next }),
            }));
            return {
              owns: edit.owns,
              isApplied: edit.isApplied,
              async save() {
                edit.save();
                previous.current = before;
              },
              async restore() {
                edit.restore();
              },
            };
          }}
        />
      ) : (
        <Text size="xs" role={state.error ? "alert" : "status"}>
          {unavailable
            ? starting
              ? "PC services are starting. Saved resources are kept."
              : "PC services are off. Saved resources are kept."
            : state.checking
              ? "Checking PC resource controls…"
              : (state.error ?? "PC resource controls are unavailable.")}
        </Text>
      )}
      {state.error && state.capability && (
        <Text size="xs" role="alert">
          {state.error}
        </Text>
      )}
      {!state.capability && (
        <Text size="xs">
          Current PC resources: {values.threads} threads · {values.hashMb} MiB hash
        </Text>
      )}
      {!unavailable && state.error && (
        <Button size="compact-xs" variant="subtle" onClick={state.retry}>
          Retry PC resource check
        </Button>
      )}
      {selected && (
        <Button
          size="xs"
          variant="default"
          onClick={() => {
            try {
              store.prepare(() => ({ cpuResources: null })).save();
              setError(null);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          Use fixed preset:{" "}
          {ENGINE_PERFORMANCE_PRESETS.find((preset) => preset.value === fixedPreset)?.label}
        </Button>
      )}
      {requestError && previous.current && selected && (
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => {
            try {
              const before = previous.current!;
              store.prepare(() => before).save();
              previous.current = null;
              setError(null);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          Restore previous PC resources
        </Button>
      )}
      {error && (
        <Text size="xs" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}
