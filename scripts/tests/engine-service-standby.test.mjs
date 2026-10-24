import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function reservePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
for (const idle of [0, 1000]) test(`engine service idle timeout ${idle} preserves lazy worker policy`, async () => {
  const root = await mkdtemp(join(tmpdir(), "en-engine-standby-"));
  await writeFile(join(root, "config.json"), JSON.stringify({ enginePath: process.execPath, backendIdleMs: idle }));
  const port = await reservePort(), uciPort = await reservePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../stockfish-remote-server.mjs", import.meta.url))], {
    windowsHide: true,
    env: { ...process.env, STOCKFISH_REMOTE_ROOT: root, STOCKFISH_REMOTE_CONFIG: join(root, "config.json"), STOCKFISH_REMOTE_LOCAL_EVAL_PATH: join(root, "no-evals"), STOCKFISH_REMOTE_HTTP_PORT: String(port), STOCKFISH_REMOTE_UCI_PORT: String(uciPort), STOCKFISH_REMOTE_BACKEND_IDLE_MS: String(idle) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk);
  child.stderr.on("data", (chunk) => output += chunk);
  try {
    let health;
    for (let i = 0; i < 50; i++) {
      try { health = await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json(); break; } catch { await delay(30); }
    }
    assert.ok(health?.ok, output);
    assert.equal(health.backendIdleMs, idle);
    assert.equal(health.engineReady, false);
    assert.equal(health.engines.lc0.ready, false);
    await delay(1800);
    if (idle === 0) {
      assert.equal(child.exitCode, null, output);
      assert.equal((await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json()).engineReady, false);
    } else assert.equal(child.exitCode, 0, output);
  } finally {
    if (child.exitCode === null) { const exited = new Promise((done) => child.once("exit", done)); child.kill(); await exited; }
    await rm(root, { recursive: true, force: true });
  }
});
