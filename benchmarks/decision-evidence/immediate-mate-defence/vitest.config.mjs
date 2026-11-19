import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = process.env.MATE_DEFENCE_REVISION ?? "HEAD";
const sources = new Map(
  ["decisionAssessment.ts", "causalTactics.ts", "tacticalMistakeEpisode.ts"].map((name) => {
    const file = "src/utils/tacticalMotifs/" + name;
    return [
      resolve(file).replaceAll("\\", "/"),
      execFileSync("git", ["show", revision + ":" + file], { encoding: "utf8" }),
    ];
  }),
);
const root = fileURLToPath(new URL(".", import.meta.url));
const testPath = fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/");
export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "mate-defence-replay",
      enforce: "pre",
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: { environment: "node", include: [testPath], dir: root },
};
