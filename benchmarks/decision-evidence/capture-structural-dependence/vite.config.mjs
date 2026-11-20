import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "ae4bf1fc";
const candidate = process.env.CAPTURE_EFFECT_ARM;
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const shared = ["causalTactics", "tacticalMistakeEpisode"];
const changed = [
  "decisionAssessment",
  "tacticalSequenceEvidence",
  "lineRouteEvidence",
  "mistakeReviewAdapter",
  "liveTactics",
  "interferenceInLine",
];
const paths = [
  worker,
  ...[...shared, ...changed].map((name) => `src/utils/tacticalMotifs/${name}.ts`),
];
const pinned = new Map(
  paths.map((file) => {
    const version =
      candidate === "product" && file.endsWith("/decisionAssessment.ts")
        ? (process.env.CAPTURE_EFFECT_PRODUCT_REV ?? "index")
        : base;
    let code = execFileSync(
      "git",
      ["show", version === "index" ? `:${file}` : `${version}:${file}`],
      { encoding: "utf8" },
    );
    if (candidate && candidate !== "product" && file.endsWith("/decisionAssessment.ts")) {
      const criteria = {
        geometry: "true",
        material: 'item.tacticalGain && result.tactical.support === "supported"',
        independent:
          'item.tacticalGain && result.tactical.support === "supported" && !item.separatelyUsed',
      }[candidate];
      if (!criteria) throw new Error("Unknown capture-effect comparison");
      const at = "    result.category = category(result.tactical, result.positional);";
      if (code.split(at).length !== 2) throw new Error("Assessment replacement changed");
      code =
        'import { findCaptureEffectDependencies } from "./decisionCaptureEffects";\n' +
        code.replace(
          at,
          `
        if (corroborated && result.positionalFactors.length) {
          const tied = findCaptureEffectDependencies(input.fen,line,branches[0],result.positionalFactors)
            .filter(item => ${criteria});
          if (tied.length) {
            const selected = new Set(tied.map(item=>item.factor));
            const factors = result.positionalFactors.filter(factor=>!selected.has(factor));
            const reasons = result.positional.reasons.filter((_,index)=>!selected.has(result.positionalFactors[index]));
            result.positionalFactors = factors;
            result.positional = factors.length ? { ...result.positional, reasons } : {
                support: "suggestive", basis: "insufficient", reasons: [
                    "The structural effect follows the same capture. Its separate strategic value is uncertain."
                ]
            };
            for (const item of tied) result.limitations.push(item.factor.description +
                " Separate strategic value alongside " + item.captureSan + " is uncertain.");
          }
        }
        ${at}
      `,
        );
    }
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
      name: "capture-effect-comparison",
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
