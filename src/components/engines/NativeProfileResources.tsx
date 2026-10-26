import { useStore } from "jotai";
import type { EngineConfig } from "@/bindings";
import { useEngineDeviceSnapshot } from "@/hooks/useEngineDeviceSnapshot";
import { enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import { CpuResourceControls, type ResourceBounds } from "./CpuResourceControls";

function spin(config: EngineConfig, name: string): ResourceBounds | null {
  const option = config.options.find(
    (option) => option.type === "spin" && option.value.name === name,
  );
  if (option?.type !== "spin" || option.value.min == null || option.value.max == null) return null;
  const min = Number(option.value.min),
    max = Number(option.value.max);
  return Number.isSafeInteger(min) && min > 0 && Number.isSafeInteger(max) && max >= min
    ? { min, max }
    : null;
}

export function nativeProfileResourceFields(engine: LocalEngine, config: EngineConfig) {
  const threads = spin(config, "Threads"),
    hashMb = spin(config, "Hash");
  const values = {
    threads: Number(engine.settings?.find((s) => s.name === "Threads")?.value),
    hashMb: Number(engine.settings?.find((s) => s.name === "Hash")?.value),
  };
  if (
    !threads ||
    !hashMb ||
    !Number.isSafeInteger(values.threads) ||
    values.threads <= 0 ||
    !Number.isSafeInteger(values.hashMb) ||
    values.hashMb <= 0
  )
    return null;
  return { values, bounds: { threads, hashMb } };
}

/** Verified profile edits publish only after readback. No enabled/search fields are written. */
export function NativeProfileResources({
  engine,
  config,
}: {
  engine: LocalEngine;
  config: EngineConfig;
}) {
  const atoms = useStore();
  const device = useEngineDeviceSnapshot();
  const fields = nativeProfileResourceFields(engine, config);
  if (!fields) return null;
  return (
    <CpuResourceControls
      {...device}
      deviceError={device.error}
      {...fields}
      scope="Saved defaults for this engine. Synced tabs use these resources."
      prepare={(next) => {
        const before = atoms.get(enginesAtom);
        if (
          !before ||
          before.find((item) => item.id === engine.id) !== engine ||
          !enginePreferences.isSavedValue(before)
        )
          throw new Error(
            "Engine settings changed or are still saving. Open this engine again after saving finishes.",
          );
        const owns = () => atoms.get(enginesAtom) === before;
        const target = before.map((item) =>
          item === engine
            ? {
                ...item,
                settings: item.settings?.map((setting) =>
                  setting.name === "Threads"
                    ? { ...setting, value: next.threads }
                    : setting.name === "Hash"
                      ? { ...setting, value: next.hashMb }
                      : setting,
                ),
              }
            : item,
        );
        const edit = enginePreferences.prepareVerifiedUpdate(target, owns);
        return {
          owns,
          isApplied: () =>
            enginePreferences.isSavedValue(atoms.get(enginesAtom)) &&
            JSON.stringify(atoms.get(enginesAtom)) === JSON.stringify(edit.value),
          async save() {
            await edit.save();
            if (!owns() || !enginePreferences.isSavedValue(edit.value))
              throw new Error(
                "Another edit replaced this resource change. Current engine settings were preserved.",
              );
            atoms.set(enginesAtom, edit.value);
          },
          restore: edit.restore,
        };
      }}
    />
  );
}
