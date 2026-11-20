import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = process.env.INTERCEPTION_REV ?? "HEAD";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const assessment = "src/utils/tacticalMotifs/decisionAssessment.ts";
const module = "src/utils/tacticalMotifs/decisionPawnInterception.ts";
const pinned = [
  worker,
  assessment,
  "src/utils/tacticalMotifs/causalTactics.ts",
  "src/utils/tacticalMotifs/tacticalMistakeEpisode.ts",
  ...(revision.startsWith("07b48ba8") ? [] : [module]),
];
const resolved = new Map(
  pinned.map((path) => {
    let source = execFileSync("git", ["show", revision + ":" + path], { encoding: "utf8" });
    if (path === worker) {
      const cut = source.indexOf("\nself.onmessage =");
      if (cut === -1) throw new Error("Expected a worker message handler");
      source = source.slice(0, cut) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), source];
  }),
);
export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "pawn-interception-replay",
      enforce: "pre",
      load(id) {
        return resolved.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("worker.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
