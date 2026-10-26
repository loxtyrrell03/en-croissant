import { Button, Group, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import {
  CPU_RESOURCE_PRESETS,
  engineResourcePlan,
  memoryStops,
  type EngineDevice,
  type EngineResourceValues,
} from "@/utils/engineResources";
import classes from "./CpuResourceControls.module.css";
import { EngineSettingSlider } from "@/components/common/EngineSettingSlider";

export type ResourceBounds = { min: number; max: number };
export type ResourceEdit = {
  save: () => Promise<void>;
  restore: () => Promise<void>;
  owns?: () => boolean;
  isApplied?: () => boolean;
};

export function CpuResourceControls({
  values,
  device,
  checking,
  deviceError,
  retryDevice,
  bounds,
  includedEngines = 1,
  scope,
  successLabel = "Resources saved.",
  prepare,
  disabled = false,
  applyUnchanged = false,
}: {
  values: EngineResourceValues;
  device: EngineDevice | null;
  checking: boolean;
  deviceError: string | null;
  retryDevice: () => void;
  bounds: { threads: ResourceBounds; hashMb: ResourceBounds };
  includedEngines?: number;
  scope: string;
  successLabel?: string;
  prepare: (values: EngineResourceValues) => ResourceEdit;
  disabled?: boolean;
  applyUnchanged?: boolean;
}) {
  const plan = engineResourcePlan(device, includedEngines);
  const [state, setState] = useState<{
    busy: boolean;
    error: string | null;
    notice: string | null;
  }>({ busy: false, error: null, notice: null });
  const edit = useRef<ResourceEdit | null>(null);
  const [fieldVersion, setFieldVersion] = useState(0);
  // The shared preference notice can also retry the same guarded edit after
  // navigation. Reflect its verified receipt instead of retaining a stale error.
  useEffect(() => {
    if (state.error && !state.busy && edit.current?.isApplied?.()) {
      edit.current = null;
      setFieldVersion((value) => value + 1);
      setState({ busy: false, error: null, notice: successLabel });
    }
  }, [values.threads, values.hashMb, state.error, state.busy, successLabel]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const clamp = (v: number, b: ResourceBounds) => Math.min(b.max, Math.max(b.min, v));
  const presets = CPU_RESOURCE_PRESETS.map((preset) => ({
    ...preset,
    values: {
      threads: clamp(plan.presets[preset.id].threads, bounds.threads),
      hashMb: clamp(plan.presets[preset.id].hashMb, bounds.hashMb),
    },
  }));
  const selected = ["balanced", "quiet", "faster"].find((id) =>
    presets.some(
      (p) =>
        p.id === id && p.values.threads === values.threads && p.values.hashMb === values.hashMb,
    ),
  );
  const canRecommend =
    plan.canRecommend &&
    bounds.threads.min <= plan.maxThreads &&
    bounds.hashMb.min <= plan.maxHashMb;
  const locked = disabled || state.busy || Boolean(state.error);
  async function run(restore = false) {
    if (!edit.current) return;
    setState({ busy: true, error: null, notice: null });
    try {
      if (restore) await edit.current.restore();
      else await edit.current.save();
      edit.current = null;
      if (mounted.current) setFieldVersion((value) => value + 1);
      if (mounted.current)
        setState({
          busy: false,
          error: null,
          notice: restore ? "Previous settings restored." : successLabel,
        });
    } catch (error) {
      if (edit.current?.owns?.() === false) edit.current = null;
      if (mounted.current)
        setState({
          busy: false,
          notice: null,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }
  const editBounds = {
    threads: {
      min: bounds.threads.min,
      max: Math.min(bounds.threads.max, Math.max(bounds.threads.min, plan.maxThreads)),
    },
    hashMb: {
      min: bounds.hashMb.min,
      max: Math.min(bounds.hashMb.max, Math.max(bounds.hashMb.min, plan.maxHashMb)),
    },
  };
  function apply(next: EngineResourceValues) {
    if (
      edit.current ||
      locked ||
      (!applyUnchanged && next.threads === values.threads && next.hashMb === values.hashMb)
    )
      return;
    try {
      edit.current = prepare(next);
      void run();
    } catch (error) {
      setState({
        busy: false,
        notice: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return (
    <Stack gap="xs" className={classes.root}>
      <Group gap={4}>
        <Text size="sm" fw="bold">
          CPU resources
        </Text>
        <PerformanceHelp label="About CPU resources">
          Presets share the computer's CPU and a memory estimate between the included CPU engines.
          They change threads and hash memory; search limits and lines stay as selected.
        </PerformanceHelp>
      </Group>
      <Group gap="xs" wrap="wrap" aria-label="CPU resource presets">
        {presets.map((p) => (
          <Button
            key={p.id}
            size="xs"
            variant={selected === p.id ? "filled" : "default"}
            aria-pressed={selected === p.id}
            title={`${p.values.threads} threads, ${p.values.hashMb} MiB hash`}
            disabled={locked || checking || !canRecommend}
            onClick={() => apply(p.values)}
          >
            {p.label}
          </Button>
        ))}
        {!selected && (
          <Text size="xs" c="dimmed">
            Custom
          </Text>
        )}
      </Group>
      {checking ? (
        <Text size="xs" role="status">
          Checking computer resources…
        </Text>
      ) : deviceError ? (
        <Group gap="xs">
          <Text size="xs">{deviceError} Conservative presets are available.</Text>
          <Button size="compact-xs" variant="subtle" onClick={retryDevice}>
            Retry resource check
          </Button>
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          {device?.logicalThreads ?? 1} logical threads ·{" "}
          {device?.totalMemoryMb != null
            ? `${device.totalMemoryMb} MiB installed memory`
            : "Memory unavailable"}{" "}
          · {plan.engines} included CPU {plan.engines === 1 ? "engine" : "engines"}
        </Text>
      )}
      {!canRecommend && (
        <Text size="xs" role="status">
          A resource recommendation is unavailable for this many engines. Current settings are kept.
        </Text>
      )}
      {(values.threads < bounds.threads.min ||
        values.threads > bounds.threads.max ||
        values.hashMb < bounds.hashMb.min ||
        values.hashMb > bounds.hashMb.max) && (
        <Text size="xs">
          Saved resources exceed the engine's reported limits. They are kept until you choose new
          values.
        </Text>
      )}
      <EngineSettingSlider
        key={`threads-${fieldVersion}`}
        label="Threads"
        value={values.threads}
        bounds={editBounds.threads}
        disabled={locked}
        unit="threads"
        onCommit={(threads) => apply({ ...values, threads })}
      />
      <EngineSettingSlider
        key={`hash-${fieldVersion}`}
        label="Hash memory (MiB)"
        value={values.hashMb}
        bounds={editBounds.hashMb}
        disabled={locked}
        unit="MiB"
        stops={memoryStops(editBounds.hashMb.min, editBounds.hashMb.max, values.hashMb)}
        onCommit={(hashMb) => apply({ ...values, hashMb })}
      />
      <Text size="xs" c="dimmed">
        {scope}
      </Text>
      {state.busy && (
        <Text size="xs" role="status">
          Saving resources…
        </Text>
      )}
      {state.notice && (
        <Text size="xs" role="status">
          {state.notice}
        </Text>
      )}
      {state.error && (
        <Stack gap="xs">
          <Text size="sm" c="red" role="alert">
            {state.error}
          </Text>
          <Text size="xs">
            Current resources: {values.threads} threads, {values.hashMb} MiB hash. This edit has not
            been applied.
          </Text>
          <Group gap="xs">
            <Button size="xs" disabled={state.busy || !edit.current} onClick={() => void run()}>
              Retry save
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={state.busy || !edit.current}
              onClick={() => void run(true)}
            >
              Restore previous
            </Button>
            {!edit.current && (
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setState({ busy: false, error: null, notice: null });
                  setFieldVersion((value) => value + 1);
                }}
              >
                Dismiss
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
