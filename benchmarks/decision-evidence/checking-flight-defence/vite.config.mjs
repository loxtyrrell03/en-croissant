import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "f851ecda";
const revision = process.env.PASSER_FLIGHT_REVISION ?? "HEAD";
const pinned = new Map(
  [
    ["src/components/panels/tactics/decisionReport.worker.ts", baseline],
    ["src/components/panels/tactics/decisionSearch.ts", revision],
    ["src/utils/tacticalMotifs/decisionAssessment.ts", revision],
    ["src/utils/tacticalMotifs/causalTactics.ts", baseline],
    ["src/utils/tacticalMotifs/tacticalMistakeEpisode.ts", baseline],
  ].map(([path, ref]) => {
    let code = execFileSync("git", ["show", `${ref === "index" ? "" : ref}:${path}`], {
      encoding: "utf8",
    });
    if (path.endsWith("decisionReport.worker.ts")) {
      const end = code.indexOf("\nself.onmessage =");
      if (end < 0) throw new Error("Missing worker entry");
      code = code.slice(0, end) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), code];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "fixed-decision-report",
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
          process.env.PASSER_FLIGHT_ENGINE
            ? "./live.bench.ts"
            : process.env.PASSER_FLIGHT_SCREEN
              ? "./screen.bench.ts"
              : "./proof.test.ts",
          import.meta.url,
        ),
      ).replaceAll("\\", "/"),
    ],
  },
};
