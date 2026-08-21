import type { PcEngineKind } from "./lc0Networks";

export const ENGINE_PERFORMANCE_PRESETS = [
    {
        value: "max",
        label: "Max performance",
        stockfishDescription: "20 threads, 4096 MiB hash",
        lc0Description: "1 search thread, batch 64, 2M NN cache",
    },
    {
        value: "good",
        label: "Good performance",
        stockfishDescription: "16 threads, 2048 MiB hash",
        lc0Description: "1 search thread, batch 32, 1M NN cache",
    },
    {
        value: "balanced",
        label: "Balanced",
        stockfishDescription: "10 threads, 1024 MiB hash",
        lc0Description: "1 search thread, batch 16, 500k NN cache",
    },
    {
        value: "eco",
        label: "Low impact",
        stockfishDescription: "4 threads, 512 MiB hash",
        lc0Description: "1 search thread, batch 8, 250k NN cache",
    },
] as const;

export type EnginePerformancePreset = (typeof ENGINE_PERFORMANCE_PRESETS)[number]["value"];

const ENGINE_PERFORMANCE_PRESET_VALUES = new Set<string>(
    ENGINE_PERFORMANCE_PRESETS.map(({ value }) => value),
);

export function normalizeEnginePerformancePreset(value: unknown): EnginePerformancePreset {
    const normalized = String(value ?? "good")
        .trim()
        .toLowerCase();
    return ENGINE_PERFORMANCE_PRESET_VALUES.has(normalized)
        ? (normalized as EnginePerformancePreset)
        : "good";
}

export function getEnginePerformancePreset(value: unknown) {
    const normalized = normalizeEnginePerformancePreset(value);
    return (
        ENGINE_PERFORMANCE_PRESETS.find((preset) => preset.value === normalized) ??
        ENGINE_PERFORMANCE_PRESETS[1]
    );
}

export function getEnginePerformanceDescription(engineKind: PcEngineKind, value: unknown) {
    const preset = getEnginePerformancePreset(value);
    return engineKind === "lc0" ? preset.lc0Description : preset.stockfishDescription;
}
