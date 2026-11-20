import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";

const base = "b6eb8757833297b2d7d3c4c637ef7239707179be";
const revision = process.env.ALTERNATE_CAPTURE_REVISION || base;
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const changed = ["causalTactics", "decisionAssessment", "mistakeReviewAdapter"];
const modules = [...changed, "tacticalMistakeEpisode"];
const paths = [worker, ...modules.map((name) => `src/utils/tacticalMotifs/${name}.ts`)];
const pinned = new Map(
  paths.map((path) => {
    const ref = changed.some((name) => path.endsWith(`/${name}.ts`)) ? revision : base;
    let code = execFileSync("git", ["show", ref === "index" ? `:${path}` : `${ref}:${path}`], {
      encoding: "utf8",
    });
    if (path.endsWith("/causalTactics.ts") && process.env.ALTERNATE_CAPTURE_ARM) {
      const call = "corroborateCompensatedCapture(reachedFen, nominations.get(uci)!, gain)";
      if (code.split(call).length !== 2) throw new Error("Unmatched capture confirmation");
      if (process.env.ALTERNATE_CAPTURE_ARM === "direct-only") code = code.replace(call, "null");
      else if (process.env.ALTERNATE_CAPTURE_ARM === "all-material")
        code = code.replace("reply.balance - unrelatedGain < gain", "reply.balance < gain");
      else throw new Error("Unknown alternate-capture comparison");
    }
    if (path === worker) {
      const boundary = code.indexOf("\nself.onmessage =");
      if (boundary < 0) throw new Error("Missing worker entry");
      code = code.slice(0, boundary) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), code];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    react(),
    {
      name: "alternate-capture-payoff",
      enforce: "pre",
      load(id) {
        return pinned.get(id.split("?")[0]) ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: process.env.ALTERNATE_CAPTURE_TEST_CONTROLS
      ? ["src/utils/tests/alternativeCaptureCause.test.ts"]
      : [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
