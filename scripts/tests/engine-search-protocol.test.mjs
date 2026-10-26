import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ENGINE_SEARCH_PROTOCOL_VERSION,
  captureEngineSearchLimit,
  engineSearchCapability,
  engineSearchCommand,
  engineSearchTimeout,
  parseEngineSearchRequest,
} from "../engine-search-protocol.mjs";

test("search capabilities distinguish millisecond time, depth and node bounds", () => {
  assert.equal(ENGINE_SEARCH_PROTOCOL_VERSION, 1);
  assert.deepEqual(engineSearchCapability(40), {
    depth: { min: 1, max: 40 },
    timeMs: { min: 50, max: 3600000 },
    nodes: { min: 1, max: 4294967295 },
    infinite: true,
  });
  assert.equal(engineSearchCapability(999).depth.max, 70);
  assert.ok(Object.isFrozen(engineSearchCapability().timeMs));
});
test("legacy depth, infinite and report requests remain outside the opt-in protocol", () => {
  for (const body of [
    {},
    { depth: 17 },
    { infinite: true },
    { reportLimits: { depth: 8, timeMs: 50 } },
  ])
    assert.equal(parseEngineSearchRequest(body), null);
});
test("captures each explicit UCI limit once without retaining a mutable source", () => {
  for (const [mode, value, command] of [
    ["depth", 14, "go depth 14"],
    ["time", 51, "go movetime 51"],
    ["nodes", 333, "go nodes 333"],
  ]) {
    const source = { version: 1, mode, value };
    const selected = parseEngineSearchRequest({ searchLimit: source });
    source.value++;
    assert.deepEqual(selected, { version: 1, mode, value });
    assert.ok(Object.isFrozen(selected));
    assert.equal(engineSearchCommand(selected), command);
  }
  assert.deepEqual(captureEngineSearchLimit({ version: 1, mode: "infinite" }), {
    version: 1,
    mode: "infinite",
  });
  assert.equal(engineSearchCommand({ version: 1, mode: "infinite" }), "go infinite");
});
test("rejects malformed, unsupported or ambiguous limits rather than ignoring them", () => {
  for (const searchLimit of [
    null,
    [],
    "time",
    {},
    { version: 2, mode: "infinite" },
    { version: 1, mode: "unknown" },
    { version: 1, mode: "depth", value: 0 },
    { version: 1, mode: "depth", value: 71 },
    { version: 1, mode: "depth", value: 1.1 },
    { version: 1, mode: "time", value: 49 },
    { version: 1, mode: "time", value: 3600001 },
    { version: 1, mode: "time", value: "50" },
    { version: 1, mode: "nodes", value: 0 },
    { version: 1, mode: "nodes", value: 4294967296 },
    { version: 1, mode: "nodes", value: NaN },
    { version: 1, mode: "nodes", value: Infinity },
    { version: 1, mode: "infinite", value: null },
    { version: 1, mode: "infinite", extra: true },
  ])
    assert.throws(() => parseEngineSearchRequest({ searchLimit }), /limit|number|stopped/);
  for (const key of ["depth", "infinite", "reportLimits"])
    assert.throws(
      () =>
        parseEngineSearchRequest({
          searchLimit: { version: 1, mode: "time", value: 100 },
          [key]: null,
        }),
      /not both/,
    );
});
test("preserves exact boundary values and honors a lower configured service depth", () => {
  for (const [mode, values] of [
    ["depth", [1, 60, 70]],
    ["time", [50, 3600000]],
    ["nodes", [1, 4294967295]],
  ])
    for (const value of values)
      assert.equal(captureEngineSearchLimit({ version: 1, mode, value }).value, value);
  assert.throws(
    () => parseEngineSearchRequest({ searchLimit: { version: 1, mode: "depth", value: 41 } }, 40),
    /1 to 40/,
  );
});
test("explicit long time and until-stopped limits are not cut short by the legacy deadline", () => {
  assert.equal(engineSearchTimeout({ version: 1, mode: "time", value: 3600000 }), 3610000);
  for (const limit of [
    { version: 1, mode: "infinite" },
    { version: 1, mode: "depth", value: 70 },
    { version: 1, mode: "nodes", value: 4294967295 },
  ])
    assert.equal(engineSearchTimeout(limit), null);
});
test("installer stages the new search dependency before publishing the gateway", async () => {
  const script = await readFile(
    new URL("../install-stockfish-remote-server.ps1", import.meta.url),
    "utf8",
  );
  const dependency = script.indexOf(
    'Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\\engine-search-protocol.mjs")',
  );
  const gateway = script.indexOf(
    'Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\\stockfish-remote-server.mjs")',
  );
  assert.ok(dependency >= 0 && dependency < gateway);
});
