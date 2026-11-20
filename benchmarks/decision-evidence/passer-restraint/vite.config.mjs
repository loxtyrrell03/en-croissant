import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const baseline = "31f8e50c01cdd8345f3555f49d8c643deaf53536";
const files = [
  "causalTactics",
  "decisionPawnInterception",
  "decisionAssessment",
  "tacticalMistakeEpisode",
];
const modules = new Map(
  files.map((name) => {
    const path = `src/utils/tacticalMotifs/${name}.ts`;
    let source = execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" });
    if (name === "decisionPawnInterception") {
      const gate = source
        .split("): TacticalMistakeEpisode | null {")[1]
        .split("    const [root]")[0]
        .replace("if (", "return !(")
        .replace(")\n        return null;", ");");
      source += `
export { relativeRank as passerRank, passed as isPassedPawn, lineSteps as exactInterceptionLine,
         tradeCost as interceptionTradeCost, noDrawClaim as noInterceptionDrawClaim };
export function hasInterceptionScores(
  better: DecisionEngineLine, played: DecisionEngineLine,
  betterReply: DecisionEngineLine, playedReply: DecisionEngineLine,
) {${gate}}
`;
    }
    return [resolve(path).replaceAll("\\", "/"), source];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "pin-decision-worker",
      enforce: "pre",
      load(id) {
        return modules.get(id.split("?")[0]);
      },
    },
  ],
  test: {
    environment: "node",
    include: [
      fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/"),
      fileURLToPath(new URL("./restraint.test.ts", import.meta.url)).replaceAll("\\", "/"),
    ],
  },
};
