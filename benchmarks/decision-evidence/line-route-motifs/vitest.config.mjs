import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = process.env.LINE_ROUTE_REVISION ?? "HEAD";
const paths = [
  "causalTactics.ts",
  "decisionAssessment.ts",
  "tacticalMistakeEpisode.ts",
  "mistakeReviewAdapter.ts",
  "types.ts",
  "liveTactics.ts",
  "lineRouteEvidence.ts",
].map((file) => "src/utils/tacticalMotifs/" + file);
const filesAtRevision = execFileSync("git", ["ls-tree", "--name-only", revision, "--", ...paths], {
  encoding: "utf8",
}).trim().split("\n");
const sources = new Map(
  filesAtRevision.map((path) => [
    resolve(path).replaceAll("\\", "/"),
    execFileSync("git", ["show", revision + ":" + path], { encoding: "utf8" }),
  ]),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [{
    name: "line-route-replay",
    enforce: "pre",
    load(id) {
      return sources.get(id.split("?")[0]) ?? null;
    },
  }],
  test: {
    environment: "node",
    include: [fileURLToPath(new URL("./replay.bench.mjs", import.meta.url)).replaceAll("\\", "/")],
  },
};
