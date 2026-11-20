import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const baseline = "2ac3391ca16281852ef0caa7f82b9fa93d4d1e62";
const revision = process.env.TWO_REVISION;
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const baseFiles = [
  "causalTactics",
  "decisionAssessment",
  "tacticalMistakeEpisode",
  "decisionQuietMateThreat",
];
const paths = [worker, ...baseFiles.map((name) => `src/utils/tacticalMotifs/${name}.ts`)];
if (revision) paths.push("src/utils/tacticalMotifs/decisionQuietMateInTwo.ts");
const pinned = new Map(
  paths.map((path) => {
    const changed = /decision(Assessment|QuietMate)/.test(path);
    const target = changed && revision ? revision : baseline;
    let source = execFileSync(
      "git",
      ["show", target === "index" ? `:${path}` : `${target}:${path}`],
      { encoding: "utf8" },
    );
    if (path === worker) {
      const handler = source.indexOf("\nself.onmessage =");
      if (handler < 0) throw new Error("Missing worker entry");
      source = source.slice(0, handler) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), source];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "pin-mate-two-sources",
      enforce: "pre",
      load(id) {
        return pinned.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
