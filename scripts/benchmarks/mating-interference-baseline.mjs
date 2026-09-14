import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "vite";
import { privateReportPath } from "./private-pgn-sample.mjs";
import { matingInterferenceCases } from "../../src/utils/tests/fixtures/matingInterference.ts";

// The retained classifier is bundled in memory; no working files are replaced.
const revision = "016bc1e0";
const paths = ["causalTactics", "mistakeReviewAdapter", "liveTactics"].map(
  (name) => `src/utils/tacticalMotifs/${name}.ts`,
);
const sources = new Map(
  paths.map((path) => [
    resolve(path),
    execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8" }),
  ]),
);
const entry = resolve("scripts/benchmarks/mating-interference-baseline.mjs");
const output = await build({
  configFile: false,
  publicDir: false,
  logLevel: "error",
  ssr: { noExternal: true },
  resolve: { alias: [{ find: "@", replacement: resolve("src") }] },
  build: {
    target: "node22",
    ssr: true,
    write: false,
    minify: false,
    lib: { entry, formats: ["cjs"] },
    rollupOptions: { external: [/^node:/] },
  },
  plugins: [
    {
      name: "retained-classifier",
      enforce: "pre",
      load(id) {
        if (resolve(id) === entry)
          return paths
            .slice(1)
            .map((path) => `export * from ${JSON.stringify(resolve(path).replaceAll("\\", "/"))};`)
            .join("\n");
        return sources.get(resolve(id));
      },
    },
  ],
});
const module = { exports: {} };
const chunks = (Array.isArray(output) ? output : [output]).flatMap((result) => result.output);
new Function(
  "module",
  "exports",
  "require",
  chunks.find((chunk) => chunk.type === "chunk" && chunk.isEntry).code,
)(module, module.exports, createRequire(import.meta.url));
const api = module.exports;
const audit = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows = audit.results.flatMap((group) => group.cases);
const inputs = [
  ...matingInterferenceCases.map((row) => ({ id: row.id, fen: row.fen, pvUci: [row.move] })),
  ...rows
    .filter((row) => ["private-easy:190", "private-easy:10"].includes(row.id))
    .map((row) => ({
      id: row.id,
      fen: row.fen,
      pvUci: row.engineLines[0].pvUci,
      variations: row.engineLines,
    })),
];
const cases = inputs.map((input) => ({
  ...input,
  result: api.classifyPositionTacticalMotifs(input),
  scan: api.buildLiveTacticalScan({ ...input, depth: 16, engineName: "Retained baseline" }),
}));
assert.equal(cases[0].result.motifs[0].id, "forcingAttack");
assert.equal(
  cases.find((row) => row.id === "private-easy:190").scan.motifs[0].id,
  "tacticalPreparation",
);
assert(
  !cases
    .find((row) => row.id === "private-easy:10")
    .scan.variations[0].timeline.some((m) => m.id === "forcingAttack" && m.ply === 5),
);
writeFileSync(
  privateReportPath(process.argv[3]),
  JSON.stringify(
    {
      revision,
      scope:
        "Retained baseline reproduces the old generic main label and missing secondary threat. Includes private course data; not a correctness report.",
      cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`Reproduced ${cases.length} retained-baseline source/live inputs.`);
