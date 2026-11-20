import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const checkout = "46c31482";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const files = ["causalTactics.ts", "decisionAssessment.ts", "tacticalMistakeEpisode.ts"].map(
  (file) => "src/utils/tacticalMotifs/" + file,
);
const sources = new Map(
  [...files, worker].map((file) => {
    let script = execFileSync("git", ["show", checkout + ":" + file], { encoding: "utf8" });
    if (file === worker) {
      const handler = script.indexOf("\nself.onmessage =");
      if (handler < 0) throw new Error("The decision worker message handler was not found.");
      script = script.slice(0, handler) + "\nexport { classify };";
    }
    return [resolve(file).replaceAll("\\", "/"), script];
  }),
);
export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "exchange-defence-baseline",
      enforce: "pre",
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("exchange.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
