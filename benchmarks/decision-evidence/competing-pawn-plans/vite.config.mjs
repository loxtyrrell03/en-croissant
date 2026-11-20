import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "561e1bdcf9df959864be951a4f6e5bf9d1827958";
const paths = ["decisionAssessment", "causalTactics", "tacticalMistakeEpisode"].map(
  (name) => `src/utils/tacticalMotifs/${name}.ts`,
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
      name: "pawn-plan-replay",
      enforce: "pre",
      load(id) {
        return pinned.get(id.split("?")[0]);
      },
    },
  ],
  test: {
    environment: "node",
    include: ["replay.bench.ts", "compareBreakPlans.test.ts"].map((file) =>
      fileURLToPath(new URL(file, import.meta.url)).replaceAll("\\", "/"),
    ),
  },
};
