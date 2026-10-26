import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CPU_RESOURCE_CAPABILITY,
  CPU_RESOURCE_PROTOCOL_VERSION,
  parseCpuResourceRequest,
  cpuResourceSpinOption,
  validateCpuResourceOptions,
} from "../engine-resource-protocol.mjs";
import { enginePerformanceSettings } from "../engine-performance-presets.mjs";

test("new CPU resources use a separate versioned field without reinterpreting fixed presets", () => {
  assert.equal(CPU_RESOURCE_PROTOCOL_VERSION, 1);
  assert.deepEqual(
    CPU_RESOURCE_CAPABILITY.presets.map((p) => p.id),
    ["quiet", "balanced", "faster"],
  );
  assert.equal(parseCpuResourceRequest({ performancePreset: "balanced" }, "stockfish"), null);
  assert.deepEqual(enginePerformanceSettings("stockfish", "balanced"), {
    threads: 10,
    hashMb: 1024,
  });
  assert.equal(parseCpuResourceRequest({}, "stockfish"), null);
  assert.equal(parseCpuResourceRequest({ performancePreset: "eco" }, "lc0"), null);
});
test("custom selection snapshots remain exact, immutable and independent from the parsed request", () => {
  const body = { cpuResources: { version: 1, threads: 3, hashMb: 333 } };
  const value = parseCpuResourceRequest(body, "stockfish");
  body.cpuResources.hashMb = 65;
  assert.deepEqual(value, { version: 1, threads: 3, hashMb: 333 });
  assert.ok(Object.isFrozen(value));
});
test("malformed versions, ambiguous fixed choices and GPU resource requests fail explicitly", () => {
  for (const value of [
    null,
    [],
    "balanced",
    {},
    { version: 2, threads: 1, hashMb: 16 },
    { version: 1, threads: 1, hashMb: 16, preset: "quiet" },
  ])
    assert.throws(() => parseCpuResourceRequest({ cpuResources: value }, "stockfish"));
  const cpuResources = { version: 1, threads: 1, hashMb: 16 };
  assert.throws(
    () => parseCpuResourceRequest({ cpuResources, performancePreset: "balanced" }, "stockfish"),
    /not both/,
  );
  assert.throws(() => parseCpuResourceRequest({ cpuResources }, "lc0"), /require Stockfish/);
});
test("only integral supported protocol bounds are accepted without coercion or automatic clamping", () => {
  for (const [field, values] of [
    ["threads", [0, 65, 1.2, "2", NaN, Infinity]],
    ["hashMb", [0, 15, 8193, 16.5, "16", NaN, Infinity]],
  ])
    for (const value of values)
      assert.throws(() =>
        parseCpuResourceRequest(
          { cpuResources: { version: 1, threads: 1, hashMb: 16, [field]: value } },
          "stockfish",
        ),
      );
  assert.deepEqual(
    parseCpuResourceRequest(
      { cpuResources: { version: 1, threads: 64, hashMb: 8192 } },
      "stockfish",
    ),
    { version: 1, threads: 64, hashMb: 8192 },
  );
});
test("actual UCI spin bounds are required before applying an explicit resource selection", () => {
  const values = { version: 1, threads: 3, hashMb: 333 };
  const options = new Map();
  assert.throws(() => validateCpuResourceOptions(values, options), /Threads/);
  for (const line of [
    "option name Threads type spin default 1 min 1 max 2",
    "option name Hash type spin default 16 min 1 max 1024",
  ]) {
    const option = cpuResourceSpinOption(line);
    options.set(option.name, option);
  }
  assert.throws(() => validateCpuResourceOptions(values, options), /Threads/);
  options.set("Threads", { min: 1, max: 64 });
  assert.doesNotThrow(() => validateCpuResourceOptions(values, options));
  options.set("Hash", { min: 1, max: 256 });
  assert.throws(() => validateCpuResourceOptions(values, options), /Hash/);
  assert.equal(cpuResourceSpinOption("option name Hash type string default 16"), null);
  assert.equal(cpuResourceSpinOption("option name Threads type spin default 1 max 8"), null);
});
test("installer stages transitive CPU policy/protocol modules before the gateway without executing it", async () => {
  const source = await readFile(
    new URL("../install-stockfish-remote-server.ps1", import.meta.url),
    "utf8",
  );
  const preset = source.indexOf(
    'Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\\engine-resource-presets.mjs")',
  );
  const protocol = source.indexOf(
    'Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\\engine-resource-protocol.mjs")',
  );
  const gateway = source.indexOf(
    'Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\\stockfish-remote-server.mjs")',
  );
  assert.ok(preset >= 0 && preset < protocol && protocol < gateway);
});
