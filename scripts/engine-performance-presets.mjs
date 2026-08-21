const PRESET_DEFINITIONS = {
  max: {
    label: "Max performance",
    stockfish: { threads: 20, hashMb: 4096 },
    lc0: { threads: 1, minibatchSize: 64, nnCacheSize: 2_000_000 },
  },
  good: {
    label: "Good performance",
    stockfish: { threads: 16, hashMb: 2048 },
    lc0: { threads: 1, minibatchSize: 32, nnCacheSize: 1_000_000 },
  },
  balanced: {
    label: "Balanced",
    stockfish: { threads: 10, hashMb: 1024 },
    lc0: { threads: 1, minibatchSize: 16, nnCacheSize: 500_000 },
  },
  eco: {
    label: "Low impact",
    stockfish: { threads: 4, hashMb: 512 },
    lc0: { threads: 1, minibatchSize: 8, nnCacheSize: 250_000 },
  },
};

export const ENGINE_PERFORMANCE_PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(PRESET_DEFINITIONS).map(([name, definition]) => [
      name,
      Object.freeze({
        ...definition,
        stockfish: Object.freeze({ ...definition.stockfish }),
        lc0: Object.freeze({ ...definition.lc0 }),
      }),
    ]),
  ),
);

export const ENGINE_PERFORMANCE_PRESET_OPTIONS = Object.freeze(
  Object.entries(ENGINE_PERFORMANCE_PRESETS).map(([value, definition]) =>
    Object.freeze({ value, label: definition.label }),
  ),
);

export function normalizeEnginePerformancePreset(value, fallback = null) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return Object.hasOwn(ENGINE_PERFORMANCE_PRESETS, normalized) ? normalized : fallback;
}

export function enginePerformanceSettings(engineKind, preset) {
  const normalizedKind = engineKind === "lc0" ? "lc0" : "stockfish";
  const normalizedPreset = normalizeEnginePerformancePreset(preset);
  if (!normalizedPreset) return null;
  return { ...ENGINE_PERFORMANCE_PRESETS[normalizedPreset][normalizedKind] };
}
