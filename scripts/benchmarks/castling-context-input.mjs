import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { privateReportPath } from "./private-pgn-sample.mjs";

const source = "benchmarks/tactical-relevance/castling-context-development.json";
const judgement = "benchmarks/tactical-relevance/castling-initial-judgement.md";
const context = JSON.parse(readFileSync(source, "utf8"));
assert.equal(context.cases.length, 18);
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
writeFileSync(
  privateReportPath(process.argv[2]),
  JSON.stringify(
    {
      sourceSha256: context.sourceSha256,
      contextSha256: hash(source),
      judgementSha256: hash(judgement),
      selection: context.scope,
      eligiblePositions: context.eligible,
      cases: context.cases.map((row) => ({
        ...row,
        sourceUci: [row.rookUci],
        sourceSan: [row.san],
      })),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log("Prepared eighteen preselected castling contexts with frozen initial judgements.");
