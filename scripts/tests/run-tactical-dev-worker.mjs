import { spawn } from "node:child_process";
import { createServer as createPortProbe } from "node:net";
import { createServer } from "vite";

// Own an isolated HTTP-only Vite instance. Never launch/restart the desktop
// app or depend on its active development server for worker verification.
// Vite treats port 0 as its default, so select an OS-assigned port first.
// strictPort still refuses a collision between releasing it and starting Vite.
const probe = createPortProbe();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
const startedAt = performance.now();
const server = await createServer({
  cacheDir: "node_modules/.vite-tactical-worker-test",
  optimizeDeps: {
    entries: ["src/utils/tacticalMotifs/liveTactics.worker.ts"],
    force: process.env.TACTICAL_DEV_COLD === "1",
  },
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, open: false },
});
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-vm-modules", "--test", "scripts/tests/tactical-dev-worker.test.mjs"],
      {
        stdio: "inherit",
        windowsHide: true,
        env: {
          ...process.env,
          TACTICAL_DEV_SERVER: `http://127.0.0.1:${address.port}`,
          TACTICAL_DEV_SERVER_STARTUP_MS: String(performance.now() - startedAt),
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
  process.exitCode = code;
} finally {
  await server.close();
}
