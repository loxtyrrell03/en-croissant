import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const base = "d7634bb9";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const routes = "src/utils/tacticalMotifs/decisionAllowedRoutes.ts";
const paths = [
  worker,
  routes,
  ...["causalTactics", "decisionAssessment", "mistakeReviewAdapter", "tacticalMistakeEpisode"].map(
    (name) => `src/utils/tacticalMotifs/${name}.ts`,
  ),
];
const arm = process.env.CAPTURE_RETENTION_ARM;
const sameSquare = `
function recoversClaimedCapture(steps: TacticalReplayStep[], index: number) {
    const take = steps[index];
    const square = take.move.to;
    const side = take.before.turn;
    for (const later of steps.slice(index + 1, 13)) {
        if (later.move.from === square) return false;
        if (later.before.turn === side || !later.capture || later.move.to !== square) continue;
        return tacticalExchangeGain(later.before, later.move) >= take.capture - 10;
    }
    return false;
}
`;
const pinned = new Map(
  paths.map((path) => {
    const inProduct =
      arm === "product" && (path === routes || path.endsWith("/decisionAssessment.ts"));
    const revision = inProduct ? process.env.CAPTURE_RETENTION_REVISION || "index" : base;
    const blob = revision === "index" ? `:${path}` : `${revision}:${path}`;
    let code = execFileSync("git", ["show", blob], { encoding: "utf8" });
    if (path === worker) {
      const at = code.indexOf("\nself.onmessage =");
      code = code.slice(0, at) + "\nexport { classify };";
    }
    if (path === routes && arm === "tracked") {
      code = code
        .replace(
          "import { replayTacticalLine,",
          "import { replayTacticalLine, tacticalExchangeGain,",
        )
        .replace("function consequenceAt(", sameSquare + "\nfunction consequenceAt(")
        .replace(
          "            const closures = worse.map(",
          "            if (worse.some(line => recoversClaimedCapture(line, index))) continue;\n            const closures = worse.map(",
        );
    }
    if (path === routes && arm === "late") {
      const start = code.indexOf('    if (method === "capture" || method === "verified") {');
      code =
        code.slice(0, start) +
        code
          .slice(start)
          .replace(
            "comparablePayoff(steps, Math.max(...closures.map((time) => time!)))",
            "comparablePayoff(steps, Math.max(6, ...closures.map((time) => time!)))",
          );
    }
    return [resolve(path).replaceAll("\\", "/"), code];
  }),
);
export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "capture-retention",
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
          process.env.CAPTURE_RETENTION_ROUTE_ONLY
            ? "./route-replay.bench.ts"
            : "./retention.bench.ts",
          import.meta.url,
        ),
      ).replaceAll("\\", "/"),
    ],
  },
};
