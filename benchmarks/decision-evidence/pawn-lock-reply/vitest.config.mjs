import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseRevision = "2c02bb309c255600fc70170eeead6e7c13428aca";
const alias = "reply-consequences-candidate";
const directory = fileURLToPath(new URL(".", import.meta.url));
const snapshot = ["causalTactics.ts", "tacticalMistakeEpisode.ts", "decisionAssessment.ts"];
const candidateRevision = process.env.REPLY_CLASSIFIER_REVISION;
const model = process.env.REPLY_EXPERIMENT_VERSION ?? "v2";
if (!["v1", "v2"].includes(model)) throw new Error("Choose v1 or v2");
const normalize = (path) => path.replaceAll("\\", "/");
const virtual = normalize(resolve("src/utils/tacticalMotifs/decisionReplyConsequences.ts"));
const frozen = new Map(
  snapshot.map((name) => {
    const file = "src/utils/tacticalMotifs/" + name;
    const revision =
      name === "decisionAssessment.ts" ? candidateRevision || baseRevision : baseRevision;
    return [
      normalize(resolve(file)),
      execFileSync("git", ["show", revision + ":" + file], { encoding: "utf8" }),
    ];
  }),
);
frozen.set(virtual, readFileSync(resolve(directory, "candidate-" + model + ".ts.txt"), "utf8"));

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "reply-consequences-experiment",
      enforce: "pre",
      resolveId(id) {
        if (id === alias) return virtual;
      },
      load(id) {
        return frozen.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: { environment: "node", include: [normalize(resolve(directory, "replay.bench.ts"))] },
};
