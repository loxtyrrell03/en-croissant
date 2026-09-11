import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as createPortProbe } from "node:net";
import { createContext, SourceTextModule } from "node:vm";
import test from "node:test";
import { createServer } from "vite";
import { tacticalWorkerDevelopmentPlugin } from "../vite-tactical-worker.mjs";

for (const brokenAtStartup of [false, true]) {
  test(
    `development verifier rebuilds transitive changes and recovers from errors (broken startup: ${brokenAtStartup})`,
    { timeout: 20000 },
    async () => {
      const base = resolve(tmpdir());
      const root = await mkdtemp(join(base, "tactical-worker-bundle-"));
      const directory = join(root, "src/utils/tacticalMotifs");
      const dependency = join(root, "src/dependency.ts");
      const probe = createPortProbe();
      await new Promise((ok) => probe.listen(0, "127.0.0.1", ok));
      const port = probe.address().port;
      await new Promise((ok) => probe.close(ok));
      let server;
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(
          dependency,
          brokenAtStartup
            ? "export const delta = ;"
            : 'export const delta: string = "VERSION_ONE";',
        );
        await writeFile(
          join(directory, "liveTactics.worker.ts"),
          'import { delta } from "../../dependency"; self.onmessage = () => self.postMessage({ version: delta });',
        );
        server = await createServer({
          configFile: false,
          root,
          logLevel: "silent",
          plugins: [tacticalWorkerDevelopmentPlugin()],
          server: { host: "127.0.0.1", port, strictPort: true, hmr: false, open: false },
        });
        await server.listen();
        const url = `http://127.0.0.1:${port}/src/utils/tacticalMotifs/liveTactics.worker.ts?worker_file&type=module`;
        const get = async () => {
          const response = await fetch(url);
          return {
            status: response.status,
            code: await response.text(),
            cache: response.headers.get("cache-control"),
          };
        };
        const execute = async (code) => {
          let result;
          const context = createContext({
            self: {
              postMessage: (message) => {
                result = message;
              },
            },
          });
          const module = new SourceTextModule(code, { context });
          await module.link(() => {
            throw new Error("Unexpected external import");
          });
          await module.evaluate();
          context.self.onmessage({ data: {} });
          return result.version;
        };
        if (brokenAtStartup) {
          const failed = await get();
          assert.equal(failed.status, 500);
          assert.equal(failed.cache, "no-store");
          await writeFile(dependency, 'export const delta: string = "VERSION_ONE";');
        }
        const initial = await Promise.all([get(), get(), get()]);
        assert.equal(initial[0].status, 200);
        assert.equal(initial[0].cache, "no-store");
        assert.equal(initial[0].code, initial[1].code);
        assert.equal(initial[1].code, initial[2].code);
        assert.equal(await execute(initial[0].code), "VERSION_ONE");
        const until = async (predicate) => {
          const deadline = performance.now() + 5000;
          do {
            const result = await get();
            if (predicate(result)) return result;
            await new Promise((ok) => setTimeout(ok, 25));
          } while (performance.now() < deadline);
          throw new Error("Verifier did not invalidate its dependency cache");
        };
        await writeFile(dependency, 'export const delta: string = "VERSION_TWO";');
        const concurrent = await Promise.all([get(), get(), get()]);
        for (const result of concurrent) {
          assert.equal(result.status, 200);
          assert.equal(await execute(result.code), "VERSION_TWO");
        }
        const updated = await until(
          (result) => result.status === 200 && result.code.includes("VERSION_TWO"),
        );
        assert.equal(await execute(updated.code), "VERSION_TWO");
        await writeFile(dependency, "export const delta = ;");
        const invalid = await until((result) => result.status === 500);
        assert.match(invalid.code, /Tactical verifier build failed/);
        assert.equal(invalid.cache, "no-store");
        await writeFile(dependency, 'export const delta = "VERSION_THREE";');
        const restored = await until(
          (result) => result.status === 200 && result.code.includes("VERSION_THREE"),
        );
        assert.equal(await execute(restored.code), "VERSION_THREE");
        await unlink(dependency);
        await until((result) => result.status === 500);
      } finally {
        await server?.close();
        assert.ok(resolve(root).startsWith(join(base, "tactical-worker-bundle-")));
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
