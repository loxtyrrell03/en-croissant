import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import baseline from "../current-classifier-audit/replay.config.mjs";

const path = "src/utils/tacticalMotifs/decisionAssessment.ts";
const normalized = resolve(path).replaceAll("\\", "/");
const stage = {
  name: "staged-capture-structure",
  enforce: "pre",
  load(id) {
    if (process.env.CAPTURE_ROUTE_INDEX === "1" && id.split("?")[0].replaceAll("\\", "/") === normalized)
      return execFileSync("git", ["show", ":" + path], { encoding: "utf8" });
    return null;
  },
};
export default {
  ...baseline,
  plugins: [stage, ...baseline.plugins],
  test: {
    ...baseline.test,
    include: [fileURLToPath(new URL("./application.bench.ts", import.meta.url)).replaceAll("\\", "/")],
  },
};
