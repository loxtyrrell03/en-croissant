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
  postMessage: (data) => parentPort.postMessage({ reply: data }),
});
context.self = context;
const modules = new Map();
async function load(url) {
  if (!modules.has(url)) {
    modules.set(
      url,
      (async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
        const source = await response.text();
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
  parentPort.postMessage({ modules: [...modules.keys()] });
  context.onmessage({ data: structuredClone(workerData.input) });
} catch (error) {
  parentPort.postMessage({ failure: error.stack ?? String(error) });
}
