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
  "isolated real UCI service honors explicit search modes, cancellation ownership and legacy requests",
  {
    skip: !process.env.EN_CROISSANT_SEARCH_TEST_ENGINE,
    timeout: 40000,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "en-search-service-"));
    const config = join(root, "config.json"),
      httpPort = await port(),
      uciPort = await port();
    const original = JSON.stringify({
      enginePath: process.env.EN_CROISSANT_SEARCH_TEST_ENGINE,
      threads: 1,
      hashMb: 16,
      backendIdleMs: 0,
      maxDepth: 70,
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
          STOCKFISH_REMOTE_ENGINE: process.env.EN_CROISSANT_SEARCH_TEST_ENGINE,
          STOCKFISH_REMOTE_THREADS: "1",
          STOCKFISH_REMOTE_HASH_MB: "16",
          STOCKFISH_REMOTE_HTTP_PORT: String(httpPort),
          STOCKFISH_REMOTE_UCI_PORT: String(uciPort),
          STOCKFISH_REMOTE_LOCAL_EVAL_PATH: join(root, "no-evaluations"),
          STOCKFISH_REMOTE_BACKEND_IDLE_MS: "0",
        },
      },
    );
    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    const base = `http://127.0.0.1:${httpPort}`,
      fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const health = async () => {
      const r = await fetch(base + "/v1/health");
      assert.equal(r.status, 200);
      return r.json();
    };
    const request = (body, signal) =>
      fetch(base + "/v1/analyze", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fen, multipv: 1, ...body }),
      });
    const messages = async (response) => {
      assert.equal(response.status, 200);
      return (await response.text()).trim().split(/\r?\n/).map(JSON.parse);
    };
    const legal = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"]
        .flatMap((f) => [f + "2" + f + "3", f + "2" + f + "4"])
        .concat(["b1a3", "b1c3", "g1f3", "g1h3"]),
    );
    const finished = (rows) => {
      assert.equal(
        rows.some((row) => row.type === "error"),
        false,
        JSON.stringify(rows),
      );
      assert.ok(legal.has(rows.find((row) => row.type === "done")?.bestmove), JSON.stringify(rows));
    };
    const active = new AbortController(),
      cancelled = new AbortController(),
      cancelLongTime = new AbortController();
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
      assert.equal(initial.searchProtocolVersion, 1);
      assert.equal(initial.engineReady, false);
      assert.equal(initial.queuedAnalyses, 0);
      assert.deepEqual(initial.searchLimits.timeMs, { min: 50, max: 3600000 });
      assert.equal(initial.localEvals.available, false);
      for (const body of [
        { searchLimit: null },
        { searchLimit: { version: 2, mode: "infinite" } },
        { searchLimit: { version: 1, mode: "time", value: 49 } },
        { searchLimit: { version: 1, mode: "time", value: 50 }, depth: 6 },
        { searchLimit: { version: 1, mode: "nodes", value: 10 }, infinite: false },
        {
          searchLimit: { version: 1, mode: "depth", value: 6 },
          reportLimits: { depth: 6, timeMs: 50 },
        },
      ])
        assert.equal((await request(body)).status, 400);
      assert.equal((await health()).engineReady, false);
      assert.equal(await readFile(config, "utf8"), original);
      for (const [mode, value, command] of [
        ["depth", 6, "go depth 6"],
        ["time", 75, "go movetime 75"],
        ["nodes", 800, "go nodes 800"],
      ]) {
        const selected = { version: 1, mode, value };
        const rows = await messages(await request({ searchLimit: selected }));
        finished(rows);
        const meta = rows.find((row) => row.type === "meta");
        assert.equal(meta.searchProtocolVersion, 1);
        assert.deepEqual(meta.searchLimit, selected);
        assert.equal(meta.searchCommand, command);
        assert.ok(
          rows.some((row) => row.type === "uci" && row.line.includes(" score ")),
          JSON.stringify(rows),
        );
        if (mode === "depth")
          assert.ok(rows.some((row) => row.type === "uci" && /\bdepth 6\b/.test(row.line)));
        if (mode === "nodes") {
          const counts = rows
            .filter((row) => row.type === "uci")
            .map((row) => Number(/\bnodes (\d+)/.exec(row.line)?.[1] ?? 0));
          assert.ok(
            Math.max(...counts) >= 800 && Math.max(...counts) < 10000,
            JSON.stringify(counts),
          );
        }
      }
      const combined = await messages(
        await request({
          searchLimit: { version: 1, mode: "time", value: 50 },
          cpuResources: { version: 1, threads: 1, hashMb: 17 },
        }),
      );
      finished(combined);
      assert.equal(combined[0].hashMb, 17);
      assert.equal(combined[0].resourceProtocolVersion, 1);
      assert.equal(combined[0].searchProtocolVersion, 1);
      const streaming = await request(
        { searchLimit: { version: 1, mode: "infinite" } },
        active.signal,
      );
      const reader = streaming.body.getReader();
      let text = "";
      while (!text.includes('"type":"uci"')) {
        const item = await reader.read();
        assert.equal(item.done, false);
        text += new TextDecoder().decode(item.value);
      }
      const meta = JSON.parse(text.split(/\r?\n/)[0]);
      assert.deepEqual(meta.searchLimit, { version: 1, mode: "infinite" });
      assert.equal(meta.searchCommand, "go infinite");
      const queued = await request(
        { searchLimit: { version: 1, mode: "time", value: 1000 } },
        cancelled.signal,
      );
      assert.equal((await health()).queuedAnalyses, 2);
      cancelled.abort();
      await queued.body.cancel().catch(() => {});
      for (let i = 0; i < 50 && (await health()).queuedAnalyses !== 1; i++) await delay(10);
      assert.equal((await health()).queuedAnalyses, 1);
      assert.equal(active.signal.aborted, false);
      const next = await request({ searchLimit: { version: 1, mode: "depth", value: 5 } });
      assert.equal((await health()).queuedAnalyses, 2);
      active.abort();
      await reader.cancel().catch(() => {});
      const successor = await messages(next);
      finished(successor);
      assert.deepEqual(successor[0].searchLimit, { version: 1, mode: "depth", value: 5 });
      // A long time value is sent exactly, rather than silently clamped to the
      // old three-minute deadline. Only this fixture's owned request is aborted.
      const long = await request(
        { searchLimit: { version: 1, mode: "time", value: 3600000 } },
        cancelLongTime.signal,
      );
      const longReader = long.body.getReader();
      let longText = "";
      while (!longText.includes("\n")) {
        const item = await longReader.read();
        assert.equal(item.done, false);
        longText += new TextDecoder().decode(item.value);
      }
      assert.equal(JSON.parse(longText.split(/\r?\n/)[0]).searchCommand, "go movetime 3600000");
      cancelLongTime.abort();
      await longReader.cancel().catch(() => {});
      for (let i = 0; i < 100 && (await health()).queuedAnalyses !== 0; i++) await delay(10);
      const legacy = await messages(await request({ depth: 4 }));
      finished(legacy);
      assert.equal(legacy[0].searchLimit, undefined);
      assert.equal(legacy[0].searchProtocolVersion, undefined);
      assert.equal(legacy[0].hashMb, 16);
      assert.equal(legacy[0].threads, 1);
      assert.ok(legacy.some((row) => row.type === "uci" && /\bdepth 4\b/.test(row.line)));
      assert.equal(await readFile(config, "utf8"), original);
      const release = await fetch(base + "/v1/engine/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"engineKind":"stockfish"}',
      });
      assert.equal(release.status, 200);
      for (let i = 0; i < 100 && (await health()).engineReady; i++) await delay(10);
      assert.equal((await health()).engineReady, false);
      assert.equal((await health()).queuedAnalyses, 0);
    } finally {
      active.abort();
      cancelled.abort();
      cancelLongTime.abort();
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
      await rm(config, { force: true });
      await rm(join(root, "stockfish-remote-server.log"), { force: true });
      await rmdir(root);
    }
  },
);
