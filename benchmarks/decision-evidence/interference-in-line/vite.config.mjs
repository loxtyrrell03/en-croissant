import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "48a81d927755cd4ffbe58ee3579f7bbf40327a6c";
const candidate = process.env.INTERFERENCE_REVISION;
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const shared = ["causalTactics", "tacticalMistakeEpisode"];
const changed = [
  "decisionAssessment",
  "tacticalSequenceEvidence",
  "lineRouteEvidence",
  "mistakeReviewAdapter",
  "liveTactics",
  ...(candidate ? ["interferenceInLine"] : []),
];
const paths = [
  worker,
  ...[...shared, ...changed].map((name) => `src/utils/tacticalMotifs/${name}.ts`),
];
const pinned = new Map(
  paths.map((file) => {
    const version =
      candidate && changed.some((name) => file.endsWith(`/${name}.ts`)) ? candidate : base;
    let code = execFileSync(
      "git",
      ["show", version === "index" ? `:${file}` : `${version}:${file}`],
      { encoding: "utf8" },
    );
    if (worker === file) {
      const at = code.indexOf("\nself.onmessage =");
      if (at === -1) throw new Error("Missing worker entry");
      code = code.slice(0, at) + "\nexport { classify };";
    }
    return [resolve(file).replaceAll("\\", "/"), code];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "interference-routes",
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
