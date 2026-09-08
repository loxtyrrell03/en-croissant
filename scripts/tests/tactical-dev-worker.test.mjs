import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import test from "node:test";

// Point only at a local Vite dev server. This does not automate or restart the app.
// node --experimental-vm-modules --test scripts/tests/tactical-dev-worker.test.mjs
const origin = process.env.TACTICAL_DEV_SERVER;
function runWorker(input) {
  const start = performance.now();
  const worker = new Worker(new URL("./helpers/tactical-dev-worker.mjs", import.meta.url), {
    workerData: { origin, input },
  });
  return new Promise((resolve, reject) => {
    let modules;
    const timer = setTimeout(
      () => finish(new Error("Development worker deadline exceeded")),
      15000,
    );
    function finish(error, result) {
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    }
    worker.on("error", (error) => finish(error));
    worker.on("message", (message) => {
      if (message.failure) finish(new Error(message.failure));
      if (message.modules) modules = message.modules;
      if (message.reply)
        finish(null, { ...message.reply, modules, elapsedMs: performance.now() - start });
    });
  });
}

test(
  "unbundled development worker loads and classifies without UI dependencies",
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
    for (const item of cases) {
      const result = await runWorker({ ...item, engineName: "Worker regression", depth: 16 });
      assert.equal(result.ok, true, result.error);
      assert.ok(result.elapsedMs < 3000, `application deadline exceeded: ${result.elapsedMs} ms`);
      assert.ok(result.modules.length > 2, "must evaluate transitive development imports");
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
        `${item.name}: ${result.modules.length} modules, ${Math.round(result.elapsedMs)} ms`,
      );
    }
  },
);
