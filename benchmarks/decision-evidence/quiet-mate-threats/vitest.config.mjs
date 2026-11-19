import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = process.env.THREAT_REVISION ?? "HEAD";
const motifs = "src/utils/tacticalMotifs/";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const paths = [
  worker,
  ...["decisionAssessment.ts", "causalTactics.ts", "tacticalMistakeEpisode.ts"].map(
    (name) => motifs + name,
  ),
];
const newProof = motifs + "decisionQuietMateThreat.ts";
if (
  execFileSync("git", ["ls-tree", "--name-only", revision, newProof], { encoding: "utf8" }).trim()
)
  paths.push(newProof);
const sources = new Map(
  paths.map((path) => {
    let source = execFileSync("git", ["show", revision + ":" + path], { encoding: "utf8" });
    if (path === worker) {
      const handler = source.indexOf("\nself.onmessage =");
      if (handler === -1) throw new Error("Decision worker message handler was not found.");
      source = source.slice(0, handler) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), source];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "quiet-mate-replay",
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
