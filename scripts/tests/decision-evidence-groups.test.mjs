import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotatedGameGroup,
  headerGameGroup,
  auditGroups,
} from "../benchmarks/decision-evidence-groups.mjs";

test("annotation grouping normalizes numbering, reversed players and accents", () => {
  assert.equal(
    annotatedGameGroup("123. José Example – Alex Player, London 1999"),
    annotatedGameGroup("7) Alex Player - Jose Example, Paris 1999"),
  );
  assert.equal(
    annotatedGameGroup("Jose Example - Alex Player, London 1998"),
    headerGameGroup("Exercise 72 - Player- Alex vs. Example- Jose"),
  );
  assert.equal(annotatedGameGroup("The bishop improves its diagonal."), null);
});
test("source-game overlap and transposed roots exclude validation without changing development", () => {
  const rows = [
    { id: "a", sourceGroup: "one", fen: "board w - - 0 1", split: "development" },
    { id: "b", sourceGroup: "one", fen: "different b - - 0 9", split: "validation" },
    { id: "c", sourceGroup: "two", fen: "board w - - 12 10", split: "validation" },
    { id: "d", sourceGroup: "three", fen: "other w - - 0 1", split: "validation" },
    {
      id: "e",
      sourceGroup: "chapter-only",
      identityResolution: "chapter-only",
      fen: "fifth w - - 0 1",
      split: "validation",
    },
  ];
  assert.deepEqual(auditGroups(rows).excludedValidationIds, ["b", "c", "e"]);
  assert.equal(rows[0].split, "development");
});
