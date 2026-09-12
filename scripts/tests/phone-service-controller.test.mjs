import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPhoneServiceController } from "../phone-service-controller.mjs";

async function fixture(t, initial = true, fail = false) {
  const root = await mkdtemp(join(tmpdir(), "en-phone-controller-"));
  await writeFile(join(root, "phone-services.json"), JSON.stringify({ enabled: initial }));
  await mkdir(join(root, "app-releases", "test-release"), { recursive: true });
  await writeFile(join(root, "active-app.json"), JSON.stringify({ releaseId: "test-release" }));
  await writeFile(
    join(root, "app-releases", "test-release", "index.html"),
    "<html>Phone services switch</html>",
  );
  let alive = false;
  const actions = [];
  const servers = ["en-croissant-home-server", "stockfish-18-remote"].map((service) =>
    createServer((req, res) => {
      res.writeHead(alive ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: alive, service }));
    }),
  );
  await Promise.all(servers.map((s) => new Promise((done) => s.listen(0, "127.0.0.1", done))));
  const options = {
    root,
    port: 0,
    homePort: servers[0].address().port,
    enginePort: servers[1].address().port,
    origins: ["https://phone.example"],
    intervalMs: 60_000,
    manage: async (action) => {
      actions.push(action);
      if (fail) throw new Error("Startup failed");
      alive = action === "Ensure";
    },
  };
  let controller = await createPhoneServiceController(options);
  await controller.reconcile();
  const base = () => `http://127.0.0.1:${controller.server.address().port}`;
  t.after(async () => {
    await controller.close();
    await Promise.all(
      servers.map(
        (s) =>
          new Promise((done) => {
            s.closeAllConnections();
            s.close(done);
          }),
      ),
    );
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    actions,
    options,
    base,
    get controller() {
      return controller;
    },
    die: () => {
      alive = false;
    },
    stopHome: () =>
      new Promise((done) => {
        servers[0].closeAllConnections();
        servers[0].close(done);
      }),
    restart: async () => {
      await controller.close();
      controller = await createPhoneServiceController(options);
      await controller.reconcile();
    },
    post: (enabled, headers = {}) =>
      fetch(base() + "/api/pc-services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-en-croissant-client": "phone-services",
          ...headers,
        },
        body: JSON.stringify({ enabled }),
      }),
  };
}

test("starts absent services, recovers a crash, and persists Off across controller restart", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.actions, ["Ensure"]);
  assert.equal(f.controller.snapshot().home, true);
  f.die();
  await f.controller.reconcile();
  assert.deepEqual(f.actions, ["Ensure", "Ensure"]);
  const response = await f.post(false);
  assert.equal(response.status, 200);
  assert.deepEqual(f.actions, ["Ensure", "Ensure", "Stop"]);
  assert.equal(JSON.parse(await readFile(join(f.root, "phone-services.json"))).enabled, false);
  await f.restart();
  assert.equal(f.controller.snapshot().enabled, false);
  assert.equal(f.actions.length, 3);
  assert.equal((await f.post(true)).status, 200);
  assert.equal(f.controller.snapshot().engine, true);
});

test("recovery is truthful when launching fails and can be retried", async (t) => {
  const f = await fixture(t, false, true);
  const response = await f.post(true);
  assert.equal(response.status, 503);
  const status = await response.json();
  assert.equal(status.home, false);
  assert.equal(status.engine, false);
  assert.equal(status.error, "Startup failed");
});

test("control refuses cross-site requests, forged hosts, form posts and nonboolean commands", async (t) => {
  const f = await fixture(t, false);
  assert.equal((await f.post(true, { origin: "https://evil.example" })).status, 403);
  const badHostStatus = await new Promise((done, reject) => {
    const req = request(
      f.base() + "/api/pc-services",
      { headers: { host: "evil.example" } },
      (res) => {
        res.resume();
        done(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await f.post(true, { "x-en-croissant-client": "" })).status, 403);
  assert.equal((await f.post(true, { "content-type": "text/plain" })).status, 403);
  assert.equal((await f.post("start anything")).status, 400);
  assert.deepEqual(f.actions, []);
});

test("GET status never turns deliberately stopped services on", async (t) => {
  const f = await fixture(t, false);
  const status = await (await fetch(f.base() + "/api/pc-services")).json();
  assert.equal(status.enabled, false);
  assert.deepEqual(f.actions, []);
});

test("the installed app stays loadable with home server down and cannot expose private state", async (t) => {
  const f = await fixture(t, false);
  await f.stopHome();
  assert.match(await (await fetch(f.base() + "/")).text(), /Phone services switch/);
  assert.equal((await fetch(f.base() + "/api/mistake-review")).status, 503);
  assert.equal((await fetch(f.base() + "/phone-services.json")).status, 404);
  assert.equal((await fetch(f.base() + "/..%2f..%2fphone-services.json")).status, 403);
  assert.equal((await fetch(f.base() + "/api/pc-services")).status, 200);
});

test("concurrent opposite requests settle in order and leave the latest choice persisted", async (t) => {
  const f = await fixture(t, false);
  const on = f.post(true);
  const off = f.post(false);
  const responses = await Promise.all([on, off]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.equal(f.controller.snapshot().enabled, false);
  assert.deepEqual(f.actions, ["Ensure", "Stop"]);
});
