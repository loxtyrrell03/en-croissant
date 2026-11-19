import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = process.env.RECOVERY_REVISION ?? "HEAD";
const motifs = "src/utils/tacticalMotifs/";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const sourcePaths = [
  worker,
  ...["decisionAssessment.ts", "causalTactics.ts", "tacticalMistakeEpisode.ts"].map(
    (file) => motifs + file,
  ),
];
const recovery = motifs + "decisionTacticalRecovery.ts";
if (
  execFileSync("git", ["ls-tree", "--name-only", revision, recovery], { encoding: "utf8" }).trim()
)
  sourcePaths.push(recovery);
const sources = new Map(
  sourcePaths.map((file) => {
    let source = execFileSync("git", ["show", revision + ":" + file], { encoding: "utf8" });
    if (file === worker) {
      const handler = source.indexOf("\nself.onmessage =");
      if (handler < 0) throw new Error("Decision worker message handler was not found.");
      source = source.slice(0, handler) + "\nexport { classify };";
    }
    return [resolve(file).replaceAll("\\", "/"), source];
  }),
);
const benchmark = fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll(
  "\\",
  "/",
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "recovery-worker-replay",
      enforce: "pre",
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: { environment: "node", include: [benchmark] },
};
