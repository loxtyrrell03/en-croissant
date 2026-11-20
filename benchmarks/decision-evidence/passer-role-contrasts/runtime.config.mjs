import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const worker = resolve("src/components/panels/tactics/decisionReport.worker.ts").replaceAll("\\", "/");

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [{
    name: "capture-order-worker-replay",
    enforce: "pre",
    load(id) {
      if (id.split("?")[0].replaceAll("\\", "/") !== worker) return null;
      const source = readFileSync(worker, "utf8");
      const start = source.indexOf("\nself.onmessage =");
      if (start < 0) throw new Error("Decision Analysis worker entry changed.");
      return source.slice(0, start) + "\nexport { classify };";
    },
  }],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("./runtime.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
