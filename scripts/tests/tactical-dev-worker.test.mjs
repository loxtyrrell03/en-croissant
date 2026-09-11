import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import test from "node:test";
import {
  classifyLiveTacticsInWorker,
  TACTICAL_CLASSIFICATION_TIMEOUT_MS,
  TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
} from "../../src/utils/tacticalMotifs/liveTacticsWorker.ts";

// Point only at a local Vite dev server. This does not automate or restart the app.
// node --experimental-vm-modules --test scripts/tests/tactical-dev-worker.test.mjs
const origin = process.env.TACTICAL_DEV_SERVER;
async function runWorker(input) {
  const start = performance.now();
  let bridge;
  const original = globalThis.Worker;
  // Execute the application's actual ownership/deadline controller, replacing
  // only the browser transport with Node's thread and HTTP-module adapter.
  globalThis.Worker = class {
    constructor(url, options) {
      assert.ok(url.pathname.endsWith("/liveTactics.worker.ts"));
      assert.equal(options.type, "module");
      bridge = this;
      this.modules = [];
      this.loadProgress = null;
      this.startedAt = null;
      this.thread = new Worker(new URL("./helpers/tactical-dev-worker.mjs", import.meta.url), {
        workerData: { origin },
      });
      this.thread.on("error", (error) => this.onerror?.({ message: error.message }));
      this.thread.on("message", (message) => {
        if (message.failure) this.onerror?.({ message: message.failure });
        else if (message.loadProgress) this.loadProgress = message.loadProgress;
        else if (message.modules) this.modules = message.modules;
        else {
          if (message.type === "started") this.startedAt = performance.now();
          this.onmessage?.({ data: message });
        }
      });
    }
    postMessage(data) {
      this.thread.postMessage(data);
    }
    terminate() {
      this.terminated = true;
      void this.thread.terminate();
    }
  };
  try {
    const scan = await classifyLiveTacticsInWorker(input, new AbortController().signal);
    const finished = performance.now();
    assert.equal(bridge.terminated, true);
    assert.notEqual(bridge.startedAt, null);
    return {
      scan,
      modules: bridge.modules,
      startupMs: bridge.startedAt - start,
      classificationMs: finished - bridge.startedAt,
      loadProgress: bridge.loadProgress,
    };
  } catch (error) {
    if (process.env.TACTICAL_DEV_WORKER_REPORT)
      writeFileSync(
        process.env.TACTICAL_DEV_WORKER_REPORT,
        JSON.stringify(
          {
            error: error.message,
            elapsedMs: performance.now() - start,
            loadProgress: bridge?.loadProgress,
          },
          null,
          2,
        ),
      );
    throw error;
  } finally {
    globalThis.Worker = original;
  }
}

test(
  "bundled development worker loads and classifies without UI dependencies",
  { skip: !origin },
  async (t) => {
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
    const cases = [
      {
        name: "reported Reti position",
        fen: "rnbqkbnr/ppp1pppp/8/3p4/2P5/5N2/PP1PPPPP/RNBQKB1R b KQkq - 0 2",
        pvUci: ["d5d4", "e2e3", "c7c5"],
      },
      {
        name: "f7 fork and checking bishop alternative",
        fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
        pvUci: ["e5f7", "d8e8", "f7h8"],
        variations: [
          { multipv: 1, pvUci: ["e5f7", "d8e8", "f7h8"], cp: 460 },
          { multipv: 2, pvUci: ["c4f7", "e8f8", "f7b3"], cp: 350 },
        ],
      },
    ];
    const report = [];
    for (const item of cases) {
      const result = await runWorker({ ...item, engineName: "Worker regression", depth: 16 });
      assert.ok(result.startupMs < TACTICAL_WORKER_STARTUP_TIMEOUT_MS);
      assert.ok(result.classificationMs < TACTICAL_CLASSIFICATION_TIMEOUT_MS);
      assert.equal(result.modules.length, 1, "development must serve a self-contained verifier");
      assert.deepEqual(
        result.modules.filter((url) =>
          /engines\.ts|unwrap\.tsx|tauri|react|mantine|@vite\/client/.test(url),
        ),
        [],
      );
      if (item.variations) {
        assert.equal(result.scan.motifs[0].id, "fork");
        assert.ok(result.scan.arrows.some((arrow) => arrow.from === "f7" && arrow.to === "d8"));
        assert.ok(result.scan.arrows.some((arrow) => arrow.from === "f7" && arrow.to === "h8"));
        assert.ok(result.scan.variations[1].motifs.some((motif) => motif.id === "attackingF2F7"));
      }
      t.diagnostic(
        `${item.name}: ${result.modules.length} modules; startup ${Math.round(result.startupMs)} ms; classification/transfer ${Math.round(result.classificationMs)} ms`,
      );
      report.push({
        name: item.name,
        startupMs: result.startupMs,
        classificationMs: result.classificationMs,
        modules: result.modules.length,
        primary: result.scan.motifs.map((motif) => motif.id),
        loadProgress: result.loadProgress,
      });
    }
    if (process.env.TACTICAL_DEV_WORKER_REPORT)
      writeFileSync(
        process.env.TACTICAL_DEV_WORKER_REPORT,
        JSON.stringify(
          {
            scope:
              "Actual application worker controller with an isolated Vite HTTP graph and Node thread/VM transport. This is not a WebView/CSP or physical UI test.",
            startupDeadlineMs: TACTICAL_WORKER_STARTUP_TIMEOUT_MS,
            classificationDeadlineMs: TACTICAL_CLASSIFICATION_TIMEOUT_MS,
            serverStartupMs: Number(process.env.TACTICAL_DEV_SERVER_STARTUP_MS) || null,
            cases: report,
          },
          null,
          2,
        ),
      );
  },
);
