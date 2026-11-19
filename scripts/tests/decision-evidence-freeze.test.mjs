import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import {
  assertFrozenFiles,
  selectFrozenValidation,
  sha256,
} from "../benchmarks/decision-evidence-freeze.mjs";

test("a frozen source cannot be silently changed", () => {
  const root = mkdtempSync(join(tmpdir(), "decision-freeze-"));
  try {
    writeFileSync(join(root, "candidate.ts"), "first");
    const manifest = { sourceHashes: { "candidate.ts": sha256("first") } };
    assertFrozenFiles(root, manifest);
    writeFileSync(join(root, "candidate.ts"), "changed");
    assert.throws(() => assertFrozenFiles(root, manifest), /source changed/);
    assert.throws(
      () => assertFrozenFiles(root, { sourceHashes: { "../outside.ts": "bad" } }),
      /escapes/,
    );
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("decision-freeze-"));
    rmSync(root, { recursive: true });
  }
});

test("only frozen held-out identities survive the predetermined exclusion mask", () => {
  const bytes = JSON.stringify({
    cases: [
      { id: "dev", split: "development" },
      { id: "keep", split: "validation" },
      { id: "overlap", split: "validation" },
    ],
  });
  const manifest = {
    datasets: { course: { sampleSha256: sha256(bytes), ids: ["keep"], excludedIds: ["overlap"] } },
  };
  assert.deepEqual(
    selectFrozenValidation(bytes, "course", manifest).map((row) => row.id),
    ["keep"],
  );
  assert.throws(
    () => selectFrozenValidation(bytes + " ", "course", manifest),
    /not the frozen input/,
  );
  manifest.datasets.course.ids = ["overlap"];
  assert.throws(() => selectFrozenValidation(bytes, "course", manifest), /identities changed/);
});
