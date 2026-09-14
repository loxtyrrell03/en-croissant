import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "vite";

// Freeze the predecessor's source in an in-memory bundle. Never replace the
// working tree, and never classify the old fixture's held-out puzzle games.
const revision = "e7a33a83a55fbb55839dde36ffdcc011f7d7ff90";
const paths = ["causalTactics", "mistakeReviewAdapter", "liveTactics"].map(
  (name) => `src/utils/tacticalMotifs/${name}.ts`,
);
const sources = new Map(
  paths.map((path) => [
    resolve(path),
    execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8" }),
  ]),
);
const entry = resolve("scripts/benchmarks/quiet-mate-baseline.mjs");
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
const sample = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/quiet-mate-development.json", "utf8"),
);
const cases = sample.cases.flatMap((row) =>
  [1, row.bestLine.length].map((length) => {
    const input = { fen: row.startFen, pvUci: row.bestLine.slice(0, length) };
    return {
      id: `${row.id}:${length === 1 ? "short" : "full"}`,
      input,
      result: api.classifyPositionTacticalMotifs(input),
      scan: api.buildLiveTacticalScan({ ...input, depth: 16, engineName: "Retained baseline" }),
    };
  }),
);
assert.equal(cases.length, 18);
for (const id of ["0IJ6I", "09Cf3", "0hHGN"]) {
  assert.notEqual(
    cases.find((row) => row.id === `lichess:${id}:short`).result.motifs[0]?.id,
    "mateIn3",
  );
  assert.equal(
    cases.find((row) => row.id === `lichess:${id}:full`).result.motifs[0]?.id,
    "mateIn3",
  );
}
writeFileSync(
  process.argv[2],
  JSON.stringify(
    {
      revision,
      scope:
        "Exact predecessor source/live outputs on 18 new public inputs. Reproduces PV-length-dependent primary themes; not a population accuracy result.",
      cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(`Reproduced ${cases.length} predecessor inputs.`);
