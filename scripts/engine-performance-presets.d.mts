export type FixedPerformancePreset = "max" | "good" | "balanced" | "eco";
export type FixedCpuSettings = { threads: number; hashMb: number };
export type FixedGpuSettings = { threads: number; minibatchSize: number; nnCacheSize: number };
export const ENGINE_PERFORMANCE_PRESETS: Readonly<
  Record<
    FixedPerformancePreset,
    Readonly<{
      label: string;
      stockfish: Readonly<FixedCpuSettings>;
      lc0: Readonly<FixedGpuSettings>;
    }>
  >
>;
export const ENGINE_PERFORMANCE_PRESET_OPTIONS: readonly Readonly<{
  value: FixedPerformancePreset;
  label: string;
}>[];
export function normalizeEnginePerformancePreset(
  value: unknown,
  fallback?: FixedPerformancePreset | null,
): FixedPerformancePreset | null;
export function enginePerformanceSettings(
  engineKind: "stockfish",
  preset: FixedPerformancePreset,
): FixedCpuSettings | null;
export function enginePerformanceSettings(
  engineKind: "lc0",
  preset: FixedPerformancePreset,
): FixedGpuSettings | null;
