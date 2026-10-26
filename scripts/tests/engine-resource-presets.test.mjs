import { test } from "node:test";
import assert from "node:assert/strict";
import {
  engineResourcePlan,
  matchingCpuResourcePreset,
  memoryStops,
  parseEngineDevice,
} from "../engine-resource-presets.mjs";

const device = Object.freeze({
  logicalThreads: 20,
  totalMemoryMb: 32768,
  availableMemoryMb: 20480,
});
test("one CPU engine receives the source device-balanced resource tiers", () => {
  const plan = engineResourcePlan(device);
  assert.equal(plan.canRecommend, true);
  assert.deepEqual(plan.presets, {
    quiet: { threads: 5, hashMb: 256 },
    balanced: { threads: 10, hashMb: 1024 },
    faster: { threads: 15, hashMb: 2048 },
  });
  assert.equal(plan.maxThreads, 20);
  assert.equal(plan.maxHashMb, 8192);
});
test("included engines share the same device snapshot without overspending its regular budget", () => {
  const plan = engineResourcePlan(device, 2);
  assert.deepEqual(plan.presets, {
    quiet: { threads: 2, hashMb: 128 },
    balanced: { threads: 5, hashMb: 512 },
    faster: { threads: 7, hashMb: 1024 },
  });
  assert.equal(plan.maxThreads, 10);
  assert.equal(plan.maxHashMb, 4096);
});
test("a low-power computer gets smaller recommendations than the fixed legacy PC presets", () => {
  const plan = engineResourcePlan({
    logicalThreads: 2,
    totalMemoryMb: 4096,
    availableMemoryMb: 2048,
  });
  assert.deepEqual(plan.presets, {
    quiet: { threads: 1, hashMb: 32 },
    balanced: { threads: 1, hashMb: 128 },
    faster: { threads: 1, hashMb: 256 },
  });
});
test("current available memory limits recommendations while unknown availability uses installed memory conservatively", () => {
  const constrained = engineResourcePlan({ ...device, availableMemoryMb: 512 });
  assert.equal(constrained.maxHashMb, 256);
  assert.equal(constrained.presets.faster.hashMb, 256);
  assert.equal(engineResourcePlan({ ...device, availableMemoryMb: null }).maxHashMb, 8192);
});
test("unknown hardware uses conservative values instead of pretending to be the PC", () => {
  const plan = engineResourcePlan(null);
  assert.equal(plan.known, false);
  assert.deepEqual(plan.presets, {
    quiet: { threads: 1, hashMb: 64 },
    balanced: { threads: 1, hashMb: 128 },
    faster: { threads: 1, hashMb: 128 },
  });
});
test("known memory pressure or too many included engines cannot be presented as a feasible recommendation", () => {
  assert.equal(engineResourcePlan({ ...device, availableMemoryMb: 0 }).canRecommend, false);
  assert.equal(engineResourcePlan({ ...device, availableMemoryMb: 16 }).canRecommend, false);
  assert.equal(engineResourcePlan(device, 21).canRecommend, false);
  assert.equal(engineResourcePlan({ ...device, availableMemoryMb: 32 }, 1).canRecommend, true);
});
test("hardware metadata is bounded and unknown memory stays distinct from a known zero", () => {
  for (const value of [
    null,
    [],
    {},
    { logicalThreads: 0 },
    { logicalThreads: 1.5 },
    { logicalThreads: Infinity },
  ])
    assert.equal(parseEngineDevice(value), null);
  assert.deepEqual(
    parseEngineDevice({ logicalThreads: 4, totalMemoryMb: 1024, availableMemoryMb: 0 }),
    { logicalThreads: 4, totalMemoryMb: 1024, availableMemoryMb: 0 },
  );
  assert.deepEqual(
    parseEngineDevice({ logicalThreads: 4, totalMemoryMb: "1024", availableMemoryMb: 9 }),
    { logicalThreads: 4, totalMemoryMb: null, availableMemoryMb: null },
  );
  assert.equal(
    parseEngineDevice({ logicalThreads: 4, totalMemoryMb: 1024, availableMemoryMb: 9000 })
      .availableMemoryMb,
    1024,
  );
});
test("invalid engine counts are safe and high-end hardware remains within the supported policy limits", () => {
  for (const count of [0, -1, NaN, Infinity])
    assert.equal(engineResourcePlan(device, count).engines, 1);
  assert.equal(engineResourcePlan(device, 2.9).engines, 2);
  const plan = engineResourcePlan({
    logicalThreads: 256,
    totalMemoryMb: 1048576,
    availableMemoryMb: 524288,
  });
  assert.equal(plan.maxThreads, 64);
  assert.equal(plan.maxHashMb, 8192);
  assert.equal(plan.presets.faster.threads, 64);
  assert.equal(plan.presets.faster.hashMb, 4096);
});
test("non-power-of-two explicit values remain custom and never mutate the supplied settings", () => {
  const saved = Object.freeze({
    threads: 12,
    hashMb: 1536,
    multipv: 3,
    go: "unlimited",
    enabled: false,
  });
  assert.equal(matchingCpuResourcePreset(saved, engineResourcePlan(device)), "custom");
  assert.deepEqual(saved, {
    threads: 12,
    hashMb: 1536,
    multipv: 3,
    go: "unlimited",
    enabled: false,
  });
});
test("coincident small-device tiers prefer Balanced and exact saved memory values remain slider stops", () => {
  const plan = engineResourcePlan({ logicalThreads: 1, totalMemoryMb: 512, availableMemoryMb: 64 });
  assert.equal(matchingCpuResourcePreset({ threads: 1, hashMb: 16 }, plan), "balanced");
  assert.deepEqual(
    memoryStops(16, 8192, 1536),
    [16, 32, 64, 128, 256, 512, 1024, 1536, 2048, 4096, 8192],
  );
  assert.deepEqual(memoryStops(32, 70), [32, 64, 70]);
  for (const [min, max] of [
    [0, 100],
    [16, 8],
    [16, Infinity],
    [16, NaN],
  ])
    assert.throws(() => memoryStops(min, max), /valid memory bounds/);
});
