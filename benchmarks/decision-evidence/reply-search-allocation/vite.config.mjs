import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pinned = new Map(
  [
    "components/panels/tactics/decisionReport.worker.ts",
    "utils/tacticalMotifs/causalTactics.ts",
    "utils/tacticalMotifs/decisionAssessment.ts",
    "utils/tacticalMotifs/tacticalMistakeEpisode.ts",
    "utils/tacticalMotifs/decisionPositionContrast.ts",
  ].map((file) => {
    const path = "src/" + file;
    let source = execFileSync("git", ["show", "e389632b:" + path], { encoding: "utf8" });
    if (process.env.REPLY_CAPTURE_ARM === "candidate" && file.endsWith("/tacticalMistakeEpisode.ts"))
      source = execFileSync("git", ["show", (process.env.REPLY_CAPTURE_REVISION ?? "HEAD") + ":" + path], { encoding: "utf8" });
    if (file.includes(".worker.")) source = source.slice(0, source.indexOf("\nself.onmessage =")) + "\nexport { classify };";
    return [resolve(path).replaceAll("\\", "/"), source];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [{
    name: "reply-budget-frozen-source",
    enforce: "pre",
    load(id) { return pinned.get(id.split("?")[0]) ?? null; },
  }],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL(process.env.REPLY_CAPTURE_ARM ? "capture.bench.ts" : process.env.REPLY_BUDGET_SEARCH ? "evaluate.bench.ts" : "budget.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
