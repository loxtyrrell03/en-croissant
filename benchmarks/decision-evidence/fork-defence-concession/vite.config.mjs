import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "6481d4e9";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const module = "src/utils/tacticalMotifs/decisionAssessment.ts";
const arm = process.env.FORK_ARM ?? "baseline";
const makeCandidate = (source) => {
  if (arm === "baseline") return source;
  if (arm === "release") return source.replace("DECISION_ASSESSMENT_VERSION = 38", "DECISION_ASSESSMENT_VERSION = 39");
  const from = 'import { findConditionalFork, type ConditionalForkEvidence } from "./conditionalForkEvidence";';
  const original = "const conditionalFork = corroborated";
  if (!source.includes(from) || !source.includes(original)) throw new Error("Fork hook changed");
  const variant = arm.startsWith("retained") ? "candidate-v2" : "candidate";
  const path = `@/../benchmarks/decision-evidence/fork-defence-concession/${variant}`;
  return source.replace(from, from + `\nimport { findForkWithPaidDefence } from "${path}";`)
    .replace(original, "const originalFork = corroborated")
    .replace("    if (conditionalFork) result.conditionalFork = conditionalFork;",
      `    const conditionalFork = corroborated && !originalFork?.defenceConsequence
        ? findForkWithPaidDefence(input.fen, line, probe!.lines, ${arm.endsWith("immediate") ? 3 : 7}) ?? originalFork
        : originalFork;
    if (conditionalFork) result.conditionalFork = conditionalFork;`);
};
const paths = [worker, module, "src/utils/tacticalMotifs/causalTactics.ts",
  ...arm === "release" ? [] : ["src/utils/tacticalMotifs/conditionalForkEvidence.ts"],
  "src/utils/tacticalMotifs/tacticalMistakeEpisode.ts"];
const sources = new Map(paths.map((path) => {
  let contents = execFileSync("git", ["show", revision + ":" + path], { encoding: "utf8" });
  if (path === worker) {
    const offset = contents.indexOf("\nself.onmessage =");
    if (offset < 0) throw new Error("Decision worker entry point changed");
    contents = contents.slice(0, offset) + "\nexport { classify };";
  }
  if (path === module) contents = makeCandidate(contents);
  return [resolve(path).replaceAll("\\", "/"), contents];
}));

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [{ name: "fork-concession-replay", enforce: "pre", load(id) {
    return sources.get(id.split("?")[0]) ?? null;
  }}],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
