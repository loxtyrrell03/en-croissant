import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGINE_PERFORMANCE_PRESET_OPTIONS,
  enginePerformanceSettings,
  normalizeEnginePerformancePreset,
} from "../engine-performance-presets.mjs";

test("performance presets match the measured Chrome extension profiles for this PC", () => {
  assert.deepEqual(
    ENGINE_PERFORMANCE_PRESET_OPTIONS.map(({ value, label }) => [value, label]),
    [
      ["max", "Max performance"],
      ["good", "Good performance"],
      ["balanced", "Balanced"],
      ["eco", "Low impact"],
    ],
  );
  assert.deepEqual(enginePerformanceSettings("stockfish", "max"), {
    threads: 20,
    hashMb: 4096,
  });
  assert.deepEqual(enginePerformanceSettings("stockfish", "good"), {
    threads: 16,
    hashMb: 2048,
  });
  assert.deepEqual(enginePerformanceSettings("stockfish", "balanced"), {
    threads: 10,
    hashMb: 1024,
  });
  assert.deepEqual(enginePerformanceSettings("stockfish", "eco"), {
    threads: 4,
    hashMb: 512,
  });
  assert.deepEqual(enginePerformanceSettings("lc0", "max"), {
    threads: 1,
    minibatchSize: 64,
    nnCacheSize: 2_000_000,
  });
  assert.deepEqual(enginePerformanceSettings("lc0", "eco"), {
    threads: 1,
    minibatchSize: 8,
    nnCacheSize: 250_000,
  });
});

test("unknown presets do not silently select a different performance level", () => {
  assert.equal(normalizeEnginePerformancePreset("GOOD"), "good");
  assert.equal(normalizeEnginePerformancePreset("turbo"), null);
  assert.equal(enginePerformanceSettings("stockfish", "turbo"), null);
});
