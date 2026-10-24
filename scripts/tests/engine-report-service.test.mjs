import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
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
  "isolated real engine service enforces report bounds and releases cancelled search ownership",
  {
    skip: !process.env.EN_CROISSANT_REPORT_TEST_ENGINE,
    timeout: 30_000,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "en-report-service-"));
    const httpPort = await port(),
      uciPort = await port();
    const config = join(root, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        enginePath: process.env.EN_CROISSANT_REPORT_TEST_ENGINE,
        threads: 1,
        hashMb: 16,
        backendIdleMs: 0,
      }),
    );
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
          STOCKFISH_REMOTE_HTTP_PORT: String(httpPort),
          STOCKFISH_REMOTE_UCI_PORT: String(uciPort),
          STOCKFISH_REMOTE_LOCAL_EVAL_PATH: join(root, "no-evals"),
          STOCKFISH_REMOTE_BACKEND_IDLE_MS: "0",
        },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const base = `http://127.0.0.1:${httpPort}`;
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const request = (body, signal) =>
      fetch(`${base}/v1/analyze`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fen, ...body }),
      });
    const controller = new AbortController();
    const queuedController = new AbortController();
    try {
      let health;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          health = await (await fetch(`${base}/v1/health`)).json();
          break;
        } catch {
          await delay(30);
        }
      }
      assert.equal(health?.reportProtocolVersion, 1, output);
      assert.equal((await request({ reportLimits: { depth: 31, timeMs: 50 } })).status, 400);
      assert.equal(
        (await request({ reportLimits: { depth: 8, timeMs: 50 }, infinite: true })).status,
        400,
      );
      const cancelled = await request({ multipv: 1, infinite: true }, controller.signal);
      const reader = cancelled.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        assert.equal(done, false, output);
        if (new TextDecoder().decode(value).includes('"type":"uci"')) break;
      }
      // Cancel a queued report while the original interactive search keeps its
      // slot. A successor must not start until that original owner stops.
      const queued = await request(
        { multipv: 1, reportLimits: { depth: 8, timeMs: 50 } },
        queuedController.signal,
      );
      assert.equal((await (await fetch(`${base}/v1/health`)).json()).queuedAnalyses, 2);
      queuedController.abort();
      await queued.body.cancel().catch(() => {});
      for (let i = 0; i < 50; i++) {
        if ((await (await fetch(`${base}/v1/health`)).json()).queuedAnalyses === 1) break;
        await delay(10);
      }
      assert.equal((await (await fetch(`${base}/v1/health`)).json()).queuedAnalyses, 1);
      const successor = await request({ multipv: 2, reportLimits: { depth: 8, timeMs: 50 } });
      assert.equal((await (await fetch(`${base}/v1/health`)).json()).queuedAnalyses, 2);
      controller.abort();
      await reader.cancel().catch(() => {});
      const response = successor;
      const messages = (await response.text())
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      assert.equal(
        messages.some((m) => m.type === "error"),
        false,
        JSON.stringify(messages),
      );
      assert.deepEqual(messages.find((m) => m.type === "meta").reportLimits, {
        depth: 8,
        timeMs: 50,
      });
      const selected = messages.find((m) => m.type === "done")?.bestmove;
      assert.match(selected, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
      const lines = messages.filter((m) => m.type === "uci").map((m) => m.line);
      const exact = lines.filter(
        (line) =>
          line.includes(` pv ${selected}`) &&
          /\bscore (cp|mate) -?\d+/.test(line) &&
          !/\b(lowerbound|upperbound)\b/.test(line),
      );
      assert.ok(exact.length > 0, JSON.stringify(messages));
      assert.ok(
        lines.every(
          (line) => !/\bdepth (\d+)/.test(line) || Number(line.match(/\bdepth (\d+)/)[1]) <= 8,
        ),
      );
      await fetch(`${base}/v1/engine/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"engineKind":"stockfish"}',
      });
      assert.equal((await (await fetch(`${base}/v1/health`)).json()).queuedAnalyses, 0);
    } finally {
      controller.abort();
      queuedController.abort();
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
      // Exact generated files only. No recursive delete or production data paths.
      await rm(config, { force: true });
      await rm(join(root, "stockfish-remote-server.log"), { force: true });
      await rmdir(root);
    }
  },
);
