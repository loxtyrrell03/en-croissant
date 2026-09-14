import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "vite";
import {
  directThreatFen,
  directThreatLine,
} from "../../src/utils/tests/fixtures/directThreatRelevance.ts";

// Load the retained revision in memory; never replace the user's working files.
const ref = "2c86dab59cd51421bf02bbc1484704f1759a8716";
const paths = ["causalTactics", "mistakeReviewAdapter", "liveTactics"].map(
  (name) => `src/utils/tacticalMotifs/${name}.ts`,
);
const sources = new Map(
  paths.map((path) => [
    resolve(path),
    execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" }),
  ]),
);
const entry = resolve("scripts/benchmarks/direct-threat-baseline.mjs");
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
      name: "retained-revision",
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
const receipt = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/checking-pawn-stockfish-18.json", "utf8"),
);
const cases = [
  { id: "direct-discovery", fen: directThreatFen, pvUci: directThreatLine },
  ...receipt.groups
    .find((g) => g.id === "sample")
    .searches.map((row) => ({
      id: row.id,
      fen: row.fen,
      pvUci: row.lines[0].pvUci,
      variations: row.lines,
    })),
].map((input) => ({
  ...input,
  result: api.classifyPositionTacticalMotifs(input),
  scan: api.buildLiveTacticalScan({ ...input, depth: 16, engineName: "Retained baseline" }),
}));
assert.ok(
  cases[0].result.timeline.some((m) => m.id === "attacking_undefended_piece" && m.ply === 1),
);
writeFileSync(
  process.argv[2],
  JSON.stringify(
    { scope: "Reproduced adapter-98 baseline, not correct answers.", revision: ref, cases },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  `Reproduced ${cases.length} baseline source/live inputs without editing the working tree.`,
);
