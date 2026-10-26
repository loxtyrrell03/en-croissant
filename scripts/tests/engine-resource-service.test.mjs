import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function port() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}

test(
  "isolated real service captures explicit CPU choices through queued cancellation and preserves defaults",
  {
    skip: !process.env.EN_CROISSANT_RESOURCE_TEST_ENGINE,
    timeout: 30000,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "en-resource-service-"));
    const config = join(root, "config.json"),
      httpPort = await port(),
      uciPort = await port();
    const original = JSON.stringify({
      enginePath: process.env.EN_CROISSANT_RESOURCE_TEST_ENGINE,
      threads: 1,
      hashMb: 16,
      backendIdleMs: 0,
    });
    await writeFile(config, original);
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../stockfish-remote-server.mjs", import.meta.url))],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          STOCKFISH_REMOTE_ROOT: root,
          STOCKFISH_REMOTE_CONFIG: config,
          STOCKFISH_REMOTE_ENGINE: process.env.EN_CROISSANT_RESOURCE_TEST_ENGINE,
          STOCKFISH_REMOTE_THREADS: "1",
          STOCKFISH_REMOTE_HASH_MB: "16",
          STOCKFISH_REMOTE_HTTP_PORT: String(httpPort),
          STOCKFISH_REMOTE_UCI_PORT: String(uciPort),
          STOCKFISH_REMOTE_LOCAL_EVAL_PATH: join(root, "no-evals"),
          STOCKFISH_REMOTE_BACKEND_IDLE_MS: "0",
        },
      },
    );
    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    const base = `http://127.0.0.1:${httpPort}`,
      fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const health = async () => (await fetch(base + "/v1/health")).json();
    const request = (body, signal) =>
      fetch(base + "/v1/analyze", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fen, multipv: 1, depth: 8, ...body }),
      });
    const messages = async (response) =>
      (await response.text()).trim().split(/\r?\n/).map(JSON.parse);
    const active = new AbortController(),
      canceled = new AbortController();
    try {
      let initial;
      for (let i = 0; i < 100; i++) {
        try {
          initial = await health();
          break;
        } catch {
          await delay(30);
        }
      }
      assert.ok(initial?.ok, output);
      assert.equal(initial.resourceProtocolVersion, 1);
      assert.equal(initial.engineReady, false);
      assert.equal(initial.queuedAnalyses, 0);
      assert.deepEqual(initial.cpuResources.threads, { min: 1, max: 64 });
      for (const body of [
        { cpuResources: { version: 2, threads: 1, hashMb: 16 } },
        { cpuResources: { version: 1, threads: 0, hashMb: 16 } },
        { cpuResources: { version: 1, threads: 1, hashMb: 16 }, performancePreset: "balanced" },
        { cpuResources: { version: 1, threads: 1, hashMb: 16 }, engineKind: "lc0" },
      ])
        assert.equal((await request(body)).status, 400);
      assert.equal((await health()).engineReady, false);
      const first = await request(
        { infinite: true, cpuResources: { version: 1, threads: 1, hashMb: 33 } },
        active.signal,
      );
      const reader = first.body.getReader();
      let text = "";
      while (!text.includes('"type":"uci"')) {
        const { value, done } = await reader.read();
        assert.equal(done, false, output);
        text += new TextDecoder().decode(value);
      }
      const firstMeta = text
        .split(/\r?\n/)
        .slice(0, -1)
        .map(JSON.parse)
        .find((m) => m.type === "meta");
      assert.deepEqual(firstMeta.cpuResources, { version: 1, threads: 1, hashMb: 33 });
      assert.equal(firstMeta.performancePreset, null);
      assert.equal(firstMeta.resourceProtocolVersion, 1);
      assert.equal(firstMeta.hashMb, 33);
      const queued = await request(
        { cpuResources: { version: 1, threads: 2, hashMb: 48 } },
        canceled.signal,
      );
      assert.equal((await health()).queuedAnalyses, 2);
      canceled.abort();
      await queued.body.cancel().catch(() => {});
      for (let i = 0; i < 50 && (await health()).queuedAnalyses !== 1; i++) await delay(10);
      assert.equal((await health()).queuedAnalyses, 1);
      const next = await request({ cpuResources: { version: 1, threads: 1, hashMb: 65 } });
      assert.equal((await health()).queuedAnalyses, 2);
      active.abort();
      await reader.cancel().catch(() => {});
      const result = await messages(next),
        meta = result.find((m) => m.type === "meta");
      assert.deepEqual(meta.cpuResources, { version: 1, threads: 1, hashMb: 65 });
      assert.equal(meta.hashMb, 65);
      assert.equal(
        result.some((m) => m.type === "error"),
        false,
        JSON.stringify(result),
      );
      assert.match(
        result.find((m) => m.type === "done")?.bestmove,
        /^[a-h][1-8][a-h][1-8][qrbn]?$/,
      );
      const defaults = await messages(await request({}));
      assert.equal(defaults[0].threads, 1);
      assert.equal(defaults[0].hashMb, 16);
      assert.equal(defaults[0].performancePreset, "server");
      assert.equal(defaults[0].cpuResources, undefined);
      assert.equal(
        defaults.some((m) => m.type === "error"),
        false,
        JSON.stringify(defaults),
      );
      assert.equal(await readFile(config, "utf8"), original);
      await fetch(base + "/v1/engine/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"engineKind":"stockfish"}',
      });
      assert.equal((await health()).queuedAnalyses, 0);
      assert.equal((await health()).engineReady, false);
    } finally {
      active.abort();
      canceled.abort();
      if (child.exitCode === null) {
        const exited = new Promise((done) => child.once("exit", done));
        if (process.platform === "win32")
          await new Promise((done) =>
            execFile(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { windowsHide: true },
              done,
            ),
          );
        else child.kill();
        await exited;
      }
      // Exact synthetic files only; no recursive removal or owner data paths.
      await rm(config, { force: true });
      await rm(join(root, "stockfish-remote-server.log"), { force: true });
      await rmdir(root);
    }
  },
);
