import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "e64555d2785828da81fae6c55ef4463ea222a41c";
const base = `src/utils/tacticalMotifs`;
const paths = ["decisionAssessment", "causalTactics", "tacticalMistakeEpisode"].map(
  (file) => `${base}/${file}.ts`,
);
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const pinned = new Map(
  [...paths, worker].map((path) => {
    let source = execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8" });
    if (path === worker)
      source = source.slice(0, source.indexOf("\nself.onmessage =")) + "\nexport { classify };";
    return [resolve(path).replaceAll("\\", "/"), source];
  }),
);
export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "draw-aware-search",
      enforce: "pre",
      load(id) {
        return pinned.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
