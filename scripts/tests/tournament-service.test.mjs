import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { TournamentService } from "../tournament-service.mjs";

function fixture(timeoutMs = 1000) {
  const children = [];
  const service = new TournamentService({
    binaryPath: "fixture",
    root: "records",
    cacheRoot: "cache",
    timeoutMs,
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.requests = [];
      child.stdin.on("data", (bytes) => child.requests.push(JSON.parse(String(bytes))));
      child.kill = () => child.emit("exit", 1);
      children.push(child);
      return child;
    },
  });
  return { service, children };
}
test("correlates concurrent replies and prevents caller-controlled request IDs", async () => {
  const { service, children } = fixture();
  const first = service.request({ id: 999, method: "settingsGet", params: { key: "a" } });
  const second = service.request({ method: "collectionList" });
  const child = children[0];
  assert.deepEqual(
    child.requests.map((r) => r.id),
    [1, 2],
  );
  child.stdout.write(JSON.stringify({ id: 2, result: ["b"] }) + "\n");
  child.stdout.write(JSON.stringify({ id: 1, result: "a" }) + "\n");
  assert.deepEqual(await Promise.all([first, second]), ["a", ["b"]]);
  service.close();
});
test("rejects uncertain operations after death without replaying a mutation", async () => {
  const { service, children } = fixture();
  const pending = service.request({ method: "startDataPack", params: { token: "reviewed" } });
  children[0].emit("exit", 1);
  await assert.rejects(pending, /stopped/);
  assert.equal(children.length, 1);
  const read = service.request({ method: "dataPackStatus" });
  assert.equal(children.length, 2);
  assert.deepEqual(
    children[1].requests.map((r) => r.method),
    ["dataPackStatus"],
  );
  children[1].stdout.write(JSON.stringify({ id: 2, result: { jobs: [] } }) + "\n");
  await read;
  service.close();
});
test("rejects an unknown method before starting a worker", async () => {
  const { service, children } = fixture();
  await assert.rejects(service.request({ method: "deleteFile" }), /Unknown/);
  assert.equal(children.length, 0);
  service.close();
});
test("timeouts do not replay requests or consume a later reply as another operation", async () => {
  const { service, children } = fixture(5);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(service.request({ method: "collectionCreate" }), /not confirmed/);
    children[0].stdout.write(JSON.stringify({ id: 1, result: 99 }) + "\n");
    const next = service.request({ method: "collectionList" });
    children[0].stdout.write(JSON.stringify({ id: 2, result: [] }) + "\n");
    assert.deepEqual(await next, []);
    assert.equal(children[0].requests.length, 2);
  } finally {
    clearTimeout(keepAlive);
    service.close();
  }
});
