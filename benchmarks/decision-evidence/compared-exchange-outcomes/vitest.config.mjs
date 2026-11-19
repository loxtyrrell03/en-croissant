import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sources = new Map(
  ["decisionAssessment.ts", "causalTactics.ts", "tacticalMistakeEpisode.ts"].map((name) => {
    const file = "src/utils/tacticalMotifs/" + name;
    return [
      resolve(file).replaceAll("\\", "/"),
      execFileSync("git", ["show", "beb0a7e0:" + file], { encoding: "utf8" }),
    ];
  }),
);
const path = fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/");
export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "exchange-test",
      enforce: "pre",
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: { environment: "node", include: [path], dir: resolve(".") },
};
