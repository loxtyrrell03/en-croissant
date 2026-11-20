import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = process.env.OPENED_REVISION ?? "HEAD";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const paths = [
  worker,
  "src/utils/tacticalMotifs/decisionAssessment.ts",
  "src/utils/tacticalMotifs/causalTactics.ts",
  "src/utils/tacticalMotifs/tacticalMistakeEpisode.ts",
];
const sources = new Map(
  paths.map((path) => {
    let contents = execFileSync("git", ["show", revision + ":" + path], { encoding: "utf8" });
    if (path === worker) {
      const handler = contents.indexOf("\nself.onmessage =");
      if (handler === -1) throw new Error("Decision worker message handler was not found.");
      contents = contents.slice(0, handler) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), contents];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "opened-checking-fork-replay",
      enforce: "pre",
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
