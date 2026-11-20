import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "3d696066d6d4a5807b4ab517897c077a933b1fa1";
const arm = process.env.ASSET_AXIS_ARM ?? "baseline";
if (!["baseline", "candidate", "proofs"].includes(arm)) {
  throw new Error("Set ASSET_AXIS_ARM to baseline, candidate or proofs.");
}

const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const assessment = "src/utils/tacticalMotifs/decisionAssessment.ts";
const paths = [
  worker,
  assessment,
  "src/utils/tacticalMotifs/causalTactics.ts",
  "src/utils/tacticalMotifs/tacticalMistakeEpisode.ts",
];
const testFile = arm === "proofs" ? "arms.bench.ts" : "replay.bench.ts";
const experiment = fileURLToPath(new URL("./experiment.ts", import.meta.url));
const overlays = JSON.parse(
  readFileSync(new URL("./assessment-overlay.json", import.meta.url), "utf8"),
);

function applyCandidate(source) {
  const lines = source.split("\n");
  for (const { offset, before, after } of overlays.toReversed()) {
    if (lines.slice(offset, offset + before.length).join("\n") !== before.join("\n")) {
      throw new Error("The experimental assessment overlay did not match the frozen baseline.");
    }
    lines.splice(offset, before.length, ...after);
  }
  return lines.join("\n");
}

const sources = new Map(
  paths.map((path) => {
    let source = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    if (path === assessment && arm === "candidate") source = applyCandidate(source);
    if (path === worker) {
      const handler = source.indexOf("\nself.onmessage =");
      if (handler === -1) throw new Error("The frozen worker handler was not found.");
      source = source.slice(0, handler) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), source];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src"), "strategic-asset-experiment": experiment } },
  plugins: [
    {
      name: "strategic-asset-replay",
      enforce: "pre",
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL(testFile, import.meta.url)).replaceAll("\\", "/")],
  },
};
