// Compare retained receipts only: no classifier, engine, source fetch or writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
const directory = "benchmarks/tactical-relevance";
const prefix = "rare-causal-cohort-v2";
const read = (suffix) => JSON.parse(readFileSync(`${directory}/${prefix}-${suffix}.json`, "utf8"));
const before = read("adapter171"),
  checkpoint = read("adapter172"),
  after = read("adapter172-final");
const inputs = read("inputs"),
  selection = read("selection"),
  engine = read("stockfish16");
assert.equal(before.productionRef, "455adfd38e23d352b1a4af512f67ca4795c7be5a");
assert.equal(before.version, "site-55.adapter-171");
assert.equal(after.version, "site-55.adapter-172");
assert.equal(inputs.puzzles.length, 8);
assert.equal(inputs.contexts.length, 6);
assert.equal(inputs.games.length, 2);
for (const report of [before, checkpoint, after]) assert.equal(report.observations.length, 56);
const normalize = (result) =>
  JSON.parse(
    JSON.stringify(result, (key, value) =>
      ["outcome", "motifClassifierVersion"].includes(key) ? undefined : value,
    ),
  );
const semanticChanges = [];
for (let index = 0; index < 56; index++) {
  const b = before.observations[index],
    c = checkpoint.observations[index],
    a = after.observations[index];
  assert.deepEqual([b.id, b.scope, b.reflected], [a.id, a.scope, a.reflected]);
  assert.equal(JSON.stringify(b.input), JSON.stringify(a.input));
  assert.deepEqual(c.input, a.input);
  assert.deepEqual(c.result, a.result);
  const expected = normalize(b.result);
  if (b.id === "lichess:YvGsE" && b.scope === "source-line") {
    const remove = (motif) => motif.id === "discoveredAttack" && motif.ply === 3;
    assert.equal(expected.motifs.filter(remove).length, 1);
    assert.equal(expected.timeline.filter(remove).length, 1);
    expected.motifs = expected.motifs.filter((motif) => !remove(motif));
    expected.timeline = expected.timeline.filter((motif) => !remove(motif));
    semanticChanges.push({
      id: b.id,
      scope: b.scope,
      reflected: b.reflected,
      removed: { id: "discoveredAttack", ply: 3, value: 900 },
      primaryRetained: { id: "mateIn3", ply: 1 },
      supportingMechanismsRetained: ["deflection", "xRayAttack", "promotion", "triangleMate"],
    });
  }
  assert.deepEqual(normalize(a.result), expected);
}
assert.equal(semanticChanges.length, 2);
assert.equal(engine.observations.length, 20);
assert.equal(engine.observations.filter((row) => row.error).length, 0);
const files = readdirSync(directory)
  .filter((name) => name.startsWith(prefix) && name !== `${prefix}-verification.json`)
  .sort()
  .map((name) => {
    const bytes = readFileSync(`${directory}/${name}`);
    return {
      path: `${directory}/${name}`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      scope:
        "Paired public development evidence, not source-label agreement or population accuracy",
      versions: {
        before: before.version,
        after: after.version,
        baselineCommit: before.productionRef,
      },
      sourceHashes: after.sourceHashes,
      selection: {
        seed: selection.seed,
        sourceSha256: selection.sourceSha256,
        puzzles: 8,
        ordinaryContexts: 6,
        independentSourceGames: 10,
        controlGames: 2,
        controlPlies: [12, 20, 28],
        retainedPublicGamePlies: 131,
        boundary:
          "Disjoint from recorded public review, not an unseen corpus; no holdout classification",
      },
      comparisons: {
        identicalSerializedInputs: 56,
        unchangedFromEarlier172Checkpoint: 56,
        rootPrimaryChanges: 0,
        motifIdentityChanges: 2,
        unchangedMotifVariants: 54,
        mateOutcomeMetadataIsNotAccuracyCredit: true,
        semanticChanges,
      },
      independentVerification: {
        testsPassed: 14,
        testsFailed: 0,
        optionalSourceUnavailable: { passed: 13, skipped: 1 },
        types: "pass",
        lint: "0 warnings, 0 errors",
        format: "pass",
        removalWitnesses:
          "YvGsE original / noBc8 / noQc1 / neither, both colours; every legal reply and same mate",
        positiveControls:
          "ySzc4 all seven replies and real ordinary missed queen; no blanket material suppression",
        negativeBoundary:
          "Only specific safe retreats / reply countercapture checked; ordinary empties are not certified negatives",
      },
      engine: {
        queries: 20,
        errors: 0,
        limits: engine.limits,
        inputsSha256: engine.inputsSha256,
        boundary: "Corroboration only, not all-reply proof",
      },
      unresolved: [
        "rqcm3 root mechanism",
        "wN37d quiet preparation all replies",
        "CY182 independent bound/root-only recall",
        "GFfWQ attraction declines/debt",
        "Ltbye intermezzo all replies",
        "Xg7Rd trap all replies",
      ],
      runtimeDeployment: "Not attempted; benchmark/source evidence only",
      retainedFiles: files,
      totalRetainedBytesExcludingThisReceipt: files.reduce((sum, file) => sum + file.bytes, 0),
    },
    null,
    2,
  ),
);
