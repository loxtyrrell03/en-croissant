import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const protocol = JSON.parse(readFileSync(resolve(directory, "protocol.json"), "utf8"));
const modules = ["causalTactics.ts", "decisionAssessment.ts", "tacticalMistakeEpisode.ts"];
const frozen = new Map(
  modules.map((name) => {
    const file = "src/utils/tacticalMotifs/" + name;
    return [
      resolve(file).replaceAll("\\", "/"),
      execFileSync("git", ["show", protocol.baseline + ":" + file], { encoding: "utf8" }),
    ];
  }),
);
const source = "src/utils/tacticalMotifs/decisionStrategicContinuation.ts";
const version = process.env.DECISION_STRATEGY_VERSION ?? "v2";
if (!["v1", "v2"].includes(version)) throw new Error("Select v1 or v2");
frozen.set(
  resolve(source).replaceAll("\\", "/"),
  readFileSync(resolve(directory, "candidate-" + version + ".ts.txt"), "utf8"),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "read-frozen-classifiers",
      enforce: "pre",
      resolveId(id) {
        if (id === "strategic-continuation-candidate") {
          return resolve(source).replaceAll("\\", "/");
        }
      },
      load(id) {
        return frozen.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [resolve(directory, "replay.bench.ts").replaceAll("\\", "/")],
  },
};
