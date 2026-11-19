import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "334634e22fb25684396dd028cfc27c1c4de232db";
const revision = process.env.REPLY_COVERAGE_REVISION ?? baseline;
const matingOnly = process.env.REPLY_COVERAGE_MATING_ONLY === "1";
const core = "src/utils/tacticalMotifs/";
const normalize = (path) => path.replaceAll("\\", "/");
const archived = normalize(resolve(core + "decisionOpponentEvidence.ts"));
const sources = new Map(
  ["decisionAssessment.ts", "causalTactics.ts", "tacticalMistakeEpisode.ts"].map((name) => {
    const file = core + name;
    const source = name === "decisionAssessment.ts" ? revision : baseline;
    return [
      normalize(resolve(file)),
      execFileSync("git", ["show", source + ":" + file], { encoding: "utf8" }),
    ];
  }),
);
sources.set(
  archived,
  readFileSync(new URL("./opponent-candidate.ts.txt", import.meta.url), "utf8"),
);

const runner = matingOnly ? "mates.bench.ts" : "replay.bench.ts";
const testPath = normalize(fileURLToPath(new URL(runner, import.meta.url)));

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "coverage-audit",
      enforce: "pre",
      resolveId(id) {
        if (id === "opponent-evidence-candidate") return archived;
      },
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: { environment: "node", include: [testPath] },
};
