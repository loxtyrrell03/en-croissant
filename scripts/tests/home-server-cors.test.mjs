import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const homeServerScript = join(repoRoot, "scripts", "home-server.mjs");
const allowedOrigin = "https://lox-pc.tail89d19b.ts.net";
const rejectedOrigin = "https://evil.example";

test("private Stockfish and OTB APIs restrict CORS to private origins", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "en-croissant-home-cors-"));
  const serverRoot = join(temporaryRoot, "server");
  const siteRoot = join(serverRoot, "site");
  const upstreamOrigins = [];
  let child;

  await mkdir(siteRoot, { recursive: true });
  const upstream = createServer((request, response) => {
    upstreamOrigins.push(request.headers.origin ?? null);
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    });
    response.end('{"ok":true}\n');
  });

  try {
    const upstreamPort = await listenOnRandomPort(upstream);
    const homePort = await reservePort();
    child = spawn(process.execPath, [homeServerScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        EN_CROISSANT_HOME_SERVER_PORT: String(homePort),
        EN_CROISSANT_HOME_SERVER_ROOT: serverRoot,
        EN_CROISSANT_HOME_SERVER_SITE: siteRoot,
        EN_CROISSANT_STOCKFISH_BACKEND_URL: `http://127.0.0.1:${upstreamPort}`,
        EN_CROISSANT_PRIVATE_ORIGINS: allowedOrigin,
        EN_CROISSANT_REPO_ROOT: repoRoot,
        LOCALAPPDATA: join(temporaryRoot, "local"),
        APPDATA: join(temporaryRoot, "roaming"),
        USERPROFILE: join(temporaryRoot, "profile"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let childOutput = "";
    child.stdout.on("data", (chunk) => (childOutput += chunk));
    child.stderr.on("data", (chunk) => (childOutput += chunk));
    const baseUrl = `http://127.0.0.1:${homePort}`;
    await waitForServer(baseUrl, child, () => childOutput);

    const allowedActual = await fetch(`${baseUrl}/v1/health`, {
      headers: { Origin: allowedOrigin },
    });
    assert.equal(allowedActual.status, 200);
    assert.equal(allowedActual.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.equal(await allowedActual.text(), '{"ok":true}\n');

    const rejectedActual = await fetch(`${baseUrl}/v1/health`, {
      headers: { Origin: rejectedOrigin },
    });
    assert.equal(rejectedActual.status, 200);
    assert.equal(rejectedActual.headers.get("access-control-allow-origin"), null);
    await rejectedActual.body.cancel();

    const allowedPreflight = await fetch(`${baseUrl}/v1/analyze`, {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(allowedPreflight.status, 204);
    assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), allowedOrigin);

    const rejectedPreflight = await fetch(`${baseUrl}/v1/analyze`, {
      method: "OPTIONS",
      headers: {
        Origin: rejectedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(rejectedPreflight.status, 204);
    assert.equal(rejectedPreflight.headers.get("access-control-allow-origin"), null);

    const allowedFideLookup = await fetch(`${baseUrl}/api/otb-import/players?q=ab`, {
      headers: { Origin: allowedOrigin },
    });
    assert.equal(allowedFideLookup.status, 400);
    assert.equal(allowedFideLookup.headers.get("access-control-allow-origin"), allowedOrigin);

    const rejectedFideLookup = await fetch(`${baseUrl}/api/otb-import/players?q=ab`, {
      headers: { Origin: rejectedOrigin },
    });
    assert.equal(rejectedFideLookup.status, 400);
    assert.equal(rejectedFideLookup.headers.get("access-control-allow-origin"), null);

    assert.equal(upstreamOrigins.length, 3);
    assert.ok(upstreamOrigins.every((origin) => origin === null));
  } finally {
    child?.kill();
    upstream.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

async function listenOnRandomPort(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  return server.address().port;
}

async function reservePort() {
  const server = createServer();
  const port = await listenOnRandomPort(server);
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitForServer(baseUrl, child, readOutput) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Home server exited with ${child.exitCode}: ${readOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/health`);
      await response.body.cancel();
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  throw new Error(`Timed out waiting for HomeServer: ${readOutput()}`);
}
