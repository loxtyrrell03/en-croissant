import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofOnly = !process.env.PROMOTION_TEMPO_ENGINE && !process.env.PROMOTION_TEMPO_INPUT;
const pinned = new Map(
  [
    "src/components/panels/tactics/decisionReport.worker.ts",
    ...["decisionAssessment", "causalTactics", "tacticalMistakeEpisode"].map(
      (file) => "src/utils/tacticalMotifs/" + file + ".ts",
    ),
  ].map((path) => {
    const revision = path.endsWith("decisionAssessment.ts")
      ? process.env.PROMOTION_TEMPO_ASSESSMENT || (proofOnly ? "HEAD" : undefined)
      : undefined;
    let code = execFileSync(
      "git",
      ["show", `${revision === "index" ? "" : revision || "e624c951"}:${path}`],
      { encoding: "utf8" },
    );
    if (path.endsWith("decisionReport.worker.ts")) {
      const end = code.indexOf("\nself.onmessage =");
      if (end < 0) throw new Error("Missing decision report worker boundary");
      code = code.slice(0, end) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), code];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "pinned-assessment",
      enforce: "pre",
      load(id) {
        return pinned.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: [
      fileURLToPath(
        new URL(
          process.env.PROMOTION_TEMPO_ENGINE
            ? "./live.bench.ts"
            : process.env.PROMOTION_TEMPO_INPUT
              ? "./compare.bench.ts"
              : "./proof.test.ts",
          import.meta.url,
        ),
      ).replaceAll("\\", "/"),
    ],
  },
};
