import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { BackgroundEngine } from "../generated/shared-review-service.js";

function fixture(timeout = 1000) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let kills = 0;
  child.kill = () => { kills++; return true; };
  const engine = new BackgroundEngine("fake-engine", timeout, () => child);
  return { engine, child, kills: () => kills };
}

test("timeout followed by batch cleanup closes the review engine only once", async () => {
  const { engine, child, kills } = fixture(10);
  await assert.rejects(engine.analyze("unused"), /timed out/);
  engine.close();
  engine.close();
  assert.equal(kills(), 1);
  assert.equal(child.stdin.destroyed, true);
  await assert.rejects(engine.analyze("unused"), /timed out/);
});

test("pausing preparation immediately rejects a pending engine request", async () => {
  const { engine, kills } = fixture();
  const analysis = engine.analyze("unused");
  engine.close();
  await assert.rejects(analysis, /closed/);
  engine.close();
  assert.equal(kills(), 1);
});

test("a broken input pipe rejects analysis without an unhandled stream error", async () => {
  const { engine, child } = fixture();
  const analysis = engine.analyze("unused");
  child.stdin.emit("error", new Error("write EPIPE"));
  await assert.rejects(analysis, /EPIPE/);
  engine.close();
  assert.doesNotThrow(() => child.stdin.emit("error", new Error("late pipe error")));
});

test("an exited engine can be closed repeatedly during failure recovery", async () => {
  const { engine, child, kills } = fixture();
  const analysis = engine.analyze("unused");
  child.emit("exit", 1);
  await assert.rejects(analysis, /exited/);
  engine.close();
  engine.close();
  assert.equal(kills(), 1);
});
