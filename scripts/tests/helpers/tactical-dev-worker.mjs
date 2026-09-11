import { parentPort, workerData } from "node:worker_threads";
import { createContext, SourceTextModule } from "node:vm";

// Evaluate the actual HTTP-served development ESM graph, without tree shaking,
// jsdom, Tauri or window shims. Node's VM is not a WebView/CSP test.
const context = createContext({
  console,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  AbortController,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  performance,
  fetch,
  Headers,
  Request,
  Response,
  structuredClone,
  location: new URL(workerData.origin),
  postMessage: (data) => parentPort.postMessage(data),
});
context.self = context;
const modules = new Map();
const loading = new Map();
const completed = [];
const progress = () =>
  parentPort.postMessage({
    loadProgress: {
      pending: [...loading].map(([url, start]) => ({ url, elapsedMs: performance.now() - start })),
      completed,
    },
  });
const progressTimer = setInterval(progress, 1000);
const input = new Promise((resolve) => parentPort.once("message", resolve));
async function load(url) {
  if (!modules.has(url)) {
    modules.set(
      url,
      (async () => {
        const start = performance.now();
        loading.set(url, start);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
        const source = await response.text();
        completed.push({
          url,
          elapsedMs: performance.now() - start,
          serverTiming: response.headers.get("server-timing"),
        });
        loading.delete(url);
        return new SourceTextModule(source, {
          context,
          identifier: url,
          initializeImportMeta: (meta) => {
            meta.url = url;
          },
        });
      })(),
    );
  }
  return modules.get(url);
}
try {
  const root = await load(
    new URL(
      "/src/utils/tacticalMotifs/liveTactics.worker.ts?worker_file&type=module",
      workerData.origin,
    ).href,
  );
  await root.link((specifier, importer) => load(new URL(specifier, importer.identifier).href));
  await root.evaluate();
  clearInterval(progressTimer);
  progress();
  parentPort.postMessage({ modules: [...modules.keys()] });
  context.onmessage({ data: structuredClone(await input) });
} catch (error) {
  clearInterval(progressTimer);
  progress();
  parentPort.postMessage({ failure: error.stack ?? String(error) });
}
