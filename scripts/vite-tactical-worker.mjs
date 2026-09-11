import { isAbsolute, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { build, normalizePath } from "vite";

/** The verifier is already bundled in production. Serve the same isolated
 * module shape in development, without serial HTTP dependency discovery on
 * every short-lived worker. No prebuilt file can silently go stale.
 * @returns {import("vite").Plugin}
 */
export function tacticalWorkerDevelopmentPlugin() {
  let server;
  let entry;
  let generation = 0;
  let cached;
  let pending;
  let dependencies = new Set();
  let disposeWatcher;

  async function fingerprint() {
    return JSON.stringify(
      await Promise.all(
        [...dependencies].sort().map(async (path) => {
          try {
            const file = await stat(path, { bigint: true });
            return [path, String(file.size), String(file.mtimeNs), String(file.ctimeNs)];
          } catch {
            return [path, "missing"];
          }
        }),
      ),
    );
  }

  async function compile() {
    const files = new Set([normalizePath(entry)]);
    const result = await build({
      configFile: false,
      envFile: false,
      root: server.config.root,
      logLevel: "silent",
      resolve: { alias: server.config.resolve.alias },
      plugins: [
        {
          name: "tactical-worker-dependency-receipt",
          generateBundle() {
            for (const id of this.getModuleIds()) {
              const path = id.split("?")[0];
              if (isAbsolute(path)) files.add(normalizePath(path));
            }
          },
        },
      ],
      build: {
        write: false,
        minify: "esbuild",
        target: "es2022",
        lib: { entry, formats: ["es"], fileName: "tactical-verifier" },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(
      (item) => item.output ?? [],
    );
    if (
      outputs.length !== 1 ||
      outputs[0].type !== "chunk" ||
      outputs[0].imports.length ||
      outputs[0].dynamicImports.length
    )
      throw new Error("The development tactical verifier must be a self-contained module");
    dependencies = files;
    server.watcher.add([...files]);
    return outputs[0].code;
  }

  async function currentBundle() {
    const snapshot = cached;
    if (snapshot?.generation === generation) {
      // Watchers may coalesce rapid edits (or an unlink/recreate). A request
      // also checks the exact dependency receipt before reusing the bundle.
      const receipt = await fingerprint();
      if (snapshot !== cached || snapshot.generation !== generation) return currentBundle();
      if (snapshot.fingerprint === receipt) return snapshot.code;
      generation++;
      cached = undefined;
    }
    if (pending?.generation === generation) return pending.promise;
    const version = generation;
    const promise = compile()
      .then(async (code) => {
        const receipt = await fingerprint();
        if (generation !== version) return currentBundle();
        cached = { generation: version, code, fingerprint: receipt };
        return code;
      })
      .finally(() => {
        if (pending?.generation === version) pending = undefined;
      });
    pending = { generation: version, promise };
    return promise;
  }

  return {
    name: "tactical-verifier-development-bundle",
    apply: "serve",
    async configureServer(instance) {
      server = instance;
      entry = resolve(server.config.root, "src/utils/tacticalMotifs/liveTactics.worker.ts");
      dependencies.add(normalizePath(entry));
      const changed = (event, file) => {
        if (!["add", "change", "unlink"].includes(event)) return;
        // Completed bundles are validated against disk on every request.
        // Initial watcher discovery also emits `add` for unchanged files;
        // treating that as an edit needlessly discards the startup prebuild.
        if (cached) return;
        const path = normalizePath(file);
        if (
          dependencies.has(path) ||
          (!cached && path.startsWith(`${normalizePath(resolve(server.config.root, "src"))}/`))
        ) {
          generation++;
          cached = undefined;
        }
      };
      server.watcher.on("all", changed);
      disposeWatcher = () => server.watcher.off("all", changed);
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (
          request.method !== "GET" ||
          url.pathname !== "/src/utils/tacticalMotifs/liveTactics.worker.ts" ||
          !url.searchParams.has("worker_file") ||
          url.searchParams.get("type") !== "module"
        )
          return next();
        const start = performance.now();
        void currentBundle().then(
          (code) => {
            if (response.destroyed) return;
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/javascript");
            response.setHeader("Cache-Control", "no-store");
            response.setHeader(
              "Server-Timing",
              `tactical-worker;dur=${(performance.now() - start).toFixed(1)}`,
            );
            response.end(code);
          },
          (error) => {
            if (response.destroyed) return;
            response.statusCode = 500;
            response.setHeader("Content-Type", "text/plain");
            response.setHeader("Cache-Control", "no-store");
            response.end(
              `Tactical verifier build failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          },
        );
      });
      // Pay compilation once while the development server starts, not after
      // the user's move. A broken source still permits the server to start;
      // requests report the build error and a subsequent edit can recover.
      await currentBundle().catch(() => {});
    },
    closeBundle() {
      disposeWatcher?.();
      cached = undefined;
    },
  };
}
