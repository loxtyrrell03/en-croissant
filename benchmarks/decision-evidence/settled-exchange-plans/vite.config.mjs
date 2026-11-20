import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "a779f152";
const mode = process.env.SETTLED_EXCHANGE_REVISION;
const pinned = new Map(
  [
    ["src/components/panels/tactics/decisionReport.worker.ts", baseline],
    ["src/utils/tacticalMotifs/decisionAssessment.ts", mode ?? (process.env.SETTLED_EXCHANGE_INPUT ? baseline : "HEAD")],
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
      name: "settled-exchange-pinned-worker",
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
          process.env.SETTLED_EXCHANGE_ENGINE
            ? "./live.bench.ts"
            : process.env.SETTLED_EXCHANGE_INPUT ? "./scan.bench.ts" : "./proof.test.ts",
          import.meta.url,
        ),
      ).replaceAll("\\", "/"),
    ],
  },
};
