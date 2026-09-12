import { createServer, request as httpRequest } from "node:http";
import { readFile, writeFile, rename, stat, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

export async function createPhoneServiceController({
  root,
  port = 8786,
  homePort = 8787,
  enginePort = 38419,
  origins = [],
  manage,
  intervalMs = 5000,
}) {
  root = resolve(root);
  const statePath = join(root, "phone-services.json");
  let enabled = true;
  try {
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    if (typeof saved.enabled !== "boolean") throw new Error("Invalid PC services setting.");
    enabled = saved.enabled;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const allowedOrigins = new Set(origins);
  const allowedHosts = new Set(origins.map((origin) => new URL(origin).host));
  for (const host of ["127.0.0.1", "localhost"]) allowedHosts.add(`${host}:${port}`);
  let busy = false,
    lastError = null,
    queue = Promise.resolve(),
    closed = false;
  let observed = { home: false, engine: false };
  const health = async (targetPort, path, service) => {
    try {
      const response = await fetch(`http://127.0.0.1:${targetPort}${path}`, {
        signal: AbortSignal.timeout(1200),
      });
      const result = await response.json();
      return response.ok && result.ok === true && result.service === service;
    } catch {
      return false;
    }
  };
  const refresh = async () => {
    const [home, engine] = await Promise.all([
      health(homePort, "/api/health", "en-croissant-home-server"),
      health(enginePort, "/v1/health", "stockfish-18-remote"),
    ]);
    observed = { home, engine };
  };
  const snapshot = () => ({
    ok: true,
    service: "en-croissant-service-controller",
    enabled,
    busy,
    ...observed,
    error: lastError,
  });
  const reconcile = async () => {
    if (closed) return;
    busy = true;
    try {
      await refresh();
      if (enabled ? !observed.home || !observed.engine : observed.home || observed.engine) {
        await manage(enabled ? "Ensure" : "Stop");
        await refresh();
      }
      if (enabled ? !observed.home || !observed.engine : observed.home || observed.engine)
        throw new Error(
          enabled
            ? "The PC services did not finish starting. Try again."
            : "The PC services did not finish stopping. Try again.",
        );
      lastError = null;
    } catch (error) {
      lastError = error.message;
    } finally {
      busy = false;
    }
  };
  const enqueue = (operation) => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const json = (response, status, value) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  };
  const fallbackApp = async (request, response, pathname) => {
    if (
      !["GET", "HEAD"].includes(request.method) ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/v1")
    )
      return json(response, 503, {
        error: enabled ? "PC services are starting." : "PC services are off.",
      });
    // Keep the installed phone shell and its assets available even when both
    // backends are deliberately off. Never expose state, credentials or runtime.
    const active = JSON.parse(await readFile(join(root, "active-app.json"), "utf8"));
    if (!/^[a-zA-Z0-9-]+$/.test(active.releaseId)) throw new Error("Invalid phone release.");
    const appRoot = join(root, "app-releases", active.releaseId);
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
    const path = resolve(appRoot, relative || "index.html");
    if (!path.startsWith(appRoot + sep)) return json(response, 403, { error: "Forbidden." });
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return json(response, 404, { error: "Not found." });
    response.writeHead(200, {
      "content-type": mime[extname(path)] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") return response.end();
    const stream = createReadStream(path);
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  };
  const proxy = (request, response, pathname) => {
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: homePort,
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (incoming) => {
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (response.headersSent) return response.destroy();
      void fallbackApp(request, response, pathname).catch(() =>
        json(response, 503, { error: "The phone app is unavailable. Check the PC installation." }),
      );
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => {
      if (!response.writableEnded) upstream.destroy();
    });
    request.pipe(upstream);
  };
  const server = createServer(
    (request, response) =>
      void (async () => {
        if (!allowedHosts.has(request.headers.host))
          return json(response, 403, { error: "Host is not allowed." });
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (pathname !== "/api/pc-services") return proxy(request, response, pathname);
        const origin = request.headers.origin;
        if (origin && !allowedOrigins.has(origin))
          return json(response, 403, { error: "Origin is not allowed." });
        if (origin) {
          response.setHeader("access-control-allow-origin", origin);
          response.setHeader("vary", "Origin");
        }
        if (request.method === "OPTIONS") {
          response.setHeader("access-control-allow-methods", "GET, POST");
          response.setHeader("access-control-allow-headers", "Content-Type, X-En-Croissant-Client");
          response.writeHead(204);
          return response.end();
        }
        if (request.method === "GET") return json(response, 200, snapshot());
        if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
        if (
          request.headers["x-en-croissant-client"] !== "phone-services" ||
          !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")
        )
          return json(response, 403, { error: "A phone service request is required." });
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 1024) return json(response, 413, { error: "Request is too large." });
        }
        let value;
        try {
          value = JSON.parse(body);
        } catch {
          return json(response, 400, { error: "Invalid request." });
        }
        if (
          typeof value.enabled !== "boolean" ||
          Object.keys(value).some((key) => key !== "enabled")
        )
          return json(response, 400, { error: "Enabled must be true or false." });
        // Persist and reconcile in one ordered lane so overlapping requests and the
        // recovery timer cannot undo a later off choice or falsely report success.
        const operation = enqueue(async () => {
          await writeFile(`${statePath}.next`, JSON.stringify({ enabled: value.enabled }));
          await rename(`${statePath}.next`, statePath);
          enabled = value.enabled;
          await reconcile();
        });
        await operation;
        return json(response, lastError ? 503 : 200, snapshot());
      })().catch((error) => {
        if (!response.headersSent) json(response, 500, { error: error.message });
        else response.destroy();
      }),
  );
  await mkdir(root, { recursive: true });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  if (port === 0) {
    for (const host of ["127.0.0.1", "localhost"])
      allowedHosts.add(`${host}:${server.address().port}`);
  }
  const timer = setInterval(() => {
    if (!busy) void enqueue(reconcile);
  }, intervalMs);
  void enqueue(reconcile);
  return {
    server,
    snapshot,
    reconcile: () => enqueue(reconcile),
    close: async () => {
      closed = true;
      clearInterval(timer);
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await queue;
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || join(process.env.LOCALAPPDATA, "EnCroissantHomeServer"));
  const config = JSON.parse(
    await readFile(join(root, "launcher", "controller-config.json"), "utf8"),
  );
  await createPhoneServiceController({
    root,
    ...config,
    manage: async (action) => {
      await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(dirname(fileURLToPath(import.meta.url)), "manage-phone-services.ps1"),
          "-Action",
          action,
          "-ServerRoot",
          root,
          "-HomePort",
          String(config.homePort),
        ],
        { windowsHide: true, timeout: 55_000, maxBuffer: 64 * 1024 },
      ).catch((error) => {
        console.error(error.message);
        throw new Error(action === "Ensure" ? "PC services could not start. Try again." : "PC services could not stop. Try again.");
      });
    },
  });
}
