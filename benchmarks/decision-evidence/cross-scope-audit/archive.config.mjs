import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const legacy = process.env.DECISION_SCORE_ARM === "original";
const root = "src/utils/tacticalMotifs/";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const originals = [
  "src/utils/mistakeReview.ts",
  root + "mistakeReviewAdapter.ts",
  root + "mistakeNature.ts",
  root + "liveTactics.ts",
  root + "siteClassifier/theme-detector.js",
];
if (legacy && !process.env.DECISION_BASELINE_CAUSAL)
  throw new Error("Set DECISION_BASELINE_CAUSAL to the reconstructed original source.");
const paths = [
  root + "causalTactics.ts",
  root + "decisionAssessment.ts",
  root + "tacticalMistakeEpisode.ts",
  worker,
  ...(legacy ? originals : []),
];
const sources = new Map(
  paths.map((file) => {
    const source =
      legacy && file === root + "causalTactics.ts"
        ? readFileSync(process.env.DECISION_BASELINE_CAUSAL, "utf8")
        : execFileSync(
            "git",
            ["show", (legacy && originals.includes(file) ? "a4428e35" : "8ff28909") + ":" + file],
            { encoding: "utf8" },
          );
    return [
      resolve(file).replaceAll("\\", "/"),
      file === worker ? source.split("\nself.onmessage =")[0] + "\nexport { classify };" : source,
    ];
  }),
);
const path = fileURLToPath(new URL("./archive.bench.ts", import.meta.url)).replaceAll("\\", "/");
export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "archive-score-source",
      enforce: "pre",
      load(id) {
        return sources.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [path, "src/utils/tests/decisionMotifTransferReplay.test.ts"],
    dir: resolve("."),
  },
};
