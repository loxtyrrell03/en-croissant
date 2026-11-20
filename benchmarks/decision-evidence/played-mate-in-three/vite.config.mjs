import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const head = "c9e35249";
const method = process.env.MATE_THREE_ARM;
const mode = process.env.MATE_THREE_DEFENCE || "all";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const assessment = "src/utils/tacticalMotifs/decisionAssessment.ts";
const search = "src/components/panels/tactics/decisionSearch.ts";
const files = [
  worker,
  assessment,
  search,
  ...["causalTactics", "tacticalMistakeEpisode"].map(
    (name) => `src/utils/tacticalMotifs/${name}.ts`,
  ),
];
const pinned = new Map(
  files.map((path) => {
    const isProduct = method === "product" && (path === assessment || path === search);
    const ref = isProduct ? process.env.MATE_THREE_REVISION || "index" : head;
    let code = execFileSync("git", ["show", ref === "index" ? `:${path}` : `${ref}:${path}`], {
      encoding: "utf8",
    });
    if (path === worker) {
      const at = code.indexOf("\nself.onmessage =");
      if (at < 0) throw new Error("Missing worker boundary");
      code = code.slice(0, at) + "\nexport { classify };";
    }
    if (path === assessment && method && method !== "product") {
      const at = "    if (mateConsequence) {";
      if (code.split(at).length !== 2) throw new Error("Missing proof fallback");
      code =
        `import { proveAllowedMateInThree } from "@/../benchmarks/decision-evidence/played-mate-in-three/mateInThree";\n` +
        code.replace(
          at,
          `
    if (!mateConsequence)
        mateConsequence = proveAllowedMateInThree(input.fen, first, input.playedMoveUci,
            comparison, input.replyProbes?.find(probe => probe.moveUci === input.playedMoveUci)?.lines ?? [],
            input.history, ${JSON.stringify(method)}, ${JSON.stringify(mode)}, ${process.env.MATE_THREE_LEADING_ONLY === "1"});
${at}`,
        );
    }
    return [resolve(path).replaceAll("\\", "/"), code];
  }),
);

export default {
  resolve: { alias: { "@": resolve("src") } },
  plugins: [
    {
      name: "played-mate-three",
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
          process.env.MATE_THREE_ENGINE ? "./engine.bench.ts" : "./replay.bench.ts",
          import.meta.url,
        ),
      ).replaceAll("\\", "/"),
    ],
  },
};
