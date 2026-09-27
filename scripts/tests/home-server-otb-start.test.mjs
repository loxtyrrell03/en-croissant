import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { normalizeOtbImportPayload } from "../otb-import-service.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const serverScript =
  process.env.OTB_START_HOME_SERVER || join(repoRoot, "scripts", "home-server.mjs");
const request = { playerName: "Player, Example", fideId: "12345678", fromYear: 2024 };
const newId = () => `otb-${randomUUID()}`;

test(
  "the actual home server accepts recoverable PUTs and preserves legacy job routes",
  { timeout: 20_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "en-otb-start-http-"));
    const serverRoot = join(root, "server");
    const jobRoot = join(serverRoot, "otb-import", "jobs");
    const artifactRoot = join(serverRoot, "otb-import", "artifacts");
    const siteRoot = join(serverRoot, "site");
    let child;
    let childClosed;
    const upstreamRequests = [];
    const upstream = createServer((incoming, response) => {
      upstreamRequests.push(incoming.url);
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    try {
      await Promise.all(
        [jobRoot, artifactRoot, siteRoot].map((path) => mkdir(path, { recursive: true })),
      );
      const id = newId();
      const timestamp = "2026-09-12T00:00:00.000Z";
      const saved = {
        id,
        status: "completed",
        request: normalizeOtbImportPayload(request),
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: timestamp,
        gameCount: 0,
        artifactAvailable: true,
        error: null,
      };
      const artifact = JSON.stringify({ jobId: id, games: [], prepDatabase: null });
      await writeFile(join(jobRoot, `${id}.json`), JSON.stringify(saved));
      await writeFile(join(artifactRoot, `${id}.json`), artifact);
      const upstreamPort = await listen(upstream);
      const reservation = createServer();
      const port = await listen(reservation);
      await new Promise((done) => reservation.close(done));
      const baseUrl = `http://127.0.0.1:${port}`;
      child = spawn(process.execPath, [serverScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          EN_CROISSANT_HOME_SERVER_PORT: String(port),
          EN_CROISSANT_HOME_SERVER_ROOT: serverRoot,
          EN_CROISSANT_HOME_SERVER_SITE: siteRoot,
          EN_CROISSANT_HOME_FILES_DIR: join(root, "documents"),
          EN_CROISSANT_OTB_IMPORT_CACHE_DIR: join(root, "otb-cache"),
          EN_CROISSANT_STOCKFISH_BACKEND_URL: `http://127.0.0.1:${upstreamPort}`,
          EN_CROISSANT_LOCAL_EVAL_PATH: join(root, "evals"),
          EN_CROISSANT_CHESS_BOOK_LIBRARY: join(root, "books"),
          EN_CROISSANT_CHESS_BOOK_CORPUS: join(root, "books", "corpus.sqlite"),
          EN_CROISSANT_COACH_COMMAND: join(root, "unavailable-coach"),
          STOCKFISH_REMOTE_CONFIG: join(root, "unavailable-engine-config.json"),
          OUTPOST_HOME_DATABASE: join(root, "unavailable-library.sqlite"),
          EN_CROISSANT_REPO_ROOT: repoRoot,
          LOCALAPPDATA: join(root, "local"),
          APPDATA: join(root, "roaming"),
          USERPROFILE: join(root, "profile"),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      childClosed = once(child, "close");
      let output = "";
      child.stdout.on("data", (chunk) => {
        output = `${output}${chunk}`.slice(-6000);
      });
      child.stderr.on("data", (chunk) => {
        output = `${output}${chunk}`.slice(-6000);
      });
      await waitForServer(baseUrl, child, () => output);
      const path = `/api/otb-import/jobs/${id}`;
      const send = (target, method, body) =>
        fetch(`${baseUrl}${target}`, {
          method,
          signal: AbortSignal.timeout(5000),
          ...(body === undefined
            ? {}
            : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        });

      // Discard the first accepted reply, as when a response is lost on the phone.
      const first = await send(path, "PUT", request);
      assert.equal(first.status, 202);
      await first.body.cancel();
      const replies = await Promise.all(
        Array.from({ length: 4 }, () => send(path, "PUT", request)),
      );
      for (const reply of replies) {
        assert.equal(reply.status, 202);
        assert.equal(reply.headers.get("cache-control"), "no-store");
        const recovered = await reply.json();
        assert.equal(recovered.id, id);
        assert.equal(recovered.status, "completed");
        assert.equal(recovered.completedAt, timestamp);
      }
      const conflict = await send(path, "PUT", { ...request, sources: { twic: false } });
      assert.equal(conflict.status, 409);
      assert.match((await conflict.json()).error, /different search/);
      const invalid = await send("/api/otb-import/jobs/otb-legacy", "PUT", request);
      assert.equal(invalid.status, 400);
      assert.match((await invalid.json()).error, /valid new OTB search ID/);
      for (const [target, method] of [
        [`/api/otb-import/jobs/${newId()}`, "PUT"],
        ["/api/otb-import/jobs", "POST"],
      ]) {
        const unavailable = await send(target, method, request);
        assert.equal(unavailable.status, 503);
        assert.match((await unavailable.json()).error, /not installed/);
      }
      for (const method of ["GET", "DELETE"]) {
        const response = await send(path, method);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).status, "completed");
      }
      const artifactReply = await send(`${path}/artifact`, "GET");
      assert.equal(artifactReply.status, 200);
      assert.equal(await artifactReply.text(), artifact);
      assert.equal(await readFile(join(artifactRoot, `${id}.json`), "utf8"), artifact);
      const unsupported = await send(path, "PATCH", request);
      assert.equal(unsupported.status, 405);
      await unsupported.body.cancel();
      assert.deepEqual(upstreamRequests, []);
    } finally {
      if (child && child.exitCode === null) child.kill();
      if (childClosed) await childClosed;
      upstream.closeAllConnections();
      await new Promise((done) => upstream.close(done));
      assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`));
      assert.ok(resolve(root).split(sep).at(-1).startsWith("en-otb-start-http-"));
      await rm(root, { recursive: true, force: true });
    }
  },
);

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function waitForServer(baseUrl, child, readOutput) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Fixture home server exited: ${readOutput()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        await response.body.cancel();
        return;
      }
      await response.body.cancel();
    } catch {
      /* Wait only for this fixture's loopback listener. */
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Fixture home server did not start: ${readOutput()}`);
}
