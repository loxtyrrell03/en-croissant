import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = process.env.RECOVERY_REVISION ?? "HEAD";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const motifs = "src/utils/tacticalMotifs/";
const sources = new Map(
  [
    worker,
    ...[
      "decisionAssessment.ts",
      "causalTactics.ts",
      "tacticalMistakeEpisode.ts",
      "decisionTacticalRecovery.ts",
    ].map((name) => motifs + name),
  ].map((file) => {
    let source = execFileSync("git", ["show", revision + ":" + file], { encoding: "utf8" });
    if (file === worker) {
      const handler = source.indexOf("\nself.onmessage =");
      if (handler === -1) throw new Error("Decision worker message handler was not found.");
      source = source.slice(0, handler) + "\nexport { classify };";
    }
    return [resolve(file).replaceAll("\\", "/"), source];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "conditional-recovery-replay",
      enforce: "pre",
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
