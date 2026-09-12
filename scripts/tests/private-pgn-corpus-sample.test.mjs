import assert from "node:assert/strict";
import test from "node:test";
import { preparePrivatePgnCorpusSample } from "../benchmarks/private-pgn-corpus-sample.mjs";

const game = (index, extra = "", clock = "0 1") =>
  `[Event "Synthetic"]\n[FEN "7k/${index || ""}p${7 - index || ""}/8/8/8/8/6P1/6K1 w - - ${clock}"]\n\n1. g3 ${extra} *\n\n`;
const sources = [
  { label: "Chapter A", source: [0, 1, 2].map((i) => game(i)).join("") },
  { label: "Chapter B", source: [3, 4, 5].map((i) => game(i)).join("") },
];
test("each source receives its own fixed endpoints in deterministic order", () => {
  const sample = preparePrivatePgnCorpusSample(sources, 2);
  assert.deepEqual(
    sample.cases.map((row) => row.eligibleIndex),
    [1, 3, 4, 6],
  );
  assert.deepEqual(
    sample.cases.map((row) => row.sourceEligibleIndex),
    [1, 3, 1, 3],
  );
  assert.deepEqual(sample, preparePrivatePgnCorpusSample([...sources].reverse(), 2));
  assert.equal(new Set(sample.cases.map((row) => row.id)).size, 4);
});
test("duplicates within and across sources do not inflate coverage, including clocks", () => {
  const sample = preparePrivatePgnCorpusSample(
    [
      { label: "A", source: game(0) + game(0, "", "12 30") },
      { label: "B", source: game(0) + game(1) },
    ],
    2,
  );
  assert.equal(sample.eligiblePositions, 4);
  assert.equal(sample.distinctPositions, 2);
  assert.deepEqual(
    sample.sources.map((row) => row.sampledPositions),
    [1, 1],
  );
});
test("annotations and variations cannot choose cases or become tactical labels", () => {
  const sample = preparePrivatePgnCorpusSample(
    [{ label: "A", source: game(0, "{ label this a fork } (1. g4)") }],
    1,
  );
  assert.deepEqual(sample.cases[0].sourceUci, ["g2g3"]);
  assert.equal(JSON.stringify(sample).includes("label this a fork"), false);
});
test("source and corpus hashes preserve provenance", () => {
  const first = preparePrivatePgnCorpusSample(sources);
  const edited = preparePrivatePgnCorpusSample([
    { ...sources[0], source: sources[0].source + "\n" },
    sources[1],
  ]);
  assert.notEqual(first.sourceSha256, edited.sourceSha256);
  assert.notEqual(first.sources[0].sourceSha256, edited.sources[0].sourceSha256);
  assert.equal(first.sources[1].sourceSha256, edited.sources[1].sourceSha256);
});
test("rejected lines remain visible in their source receipt", () => {
  const sample = preparePrivatePgnCorpusSample([
    { label: "A", source: game(0, "Kh7 2. Qh5") + game(1) },
  ]);
  assert.equal(sample.sources[0].rejected.length, 1);
  assert.equal(sample.cases.length, 1);
});
test("invalid sizes, ambiguous labels and empty corpora fail", () => {
  for (const count of [0, -1, NaN, Infinity, 1.5])
    assert.throws(() => preparePrivatePgnCorpusSample(sources, count));
  assert.throws(() => preparePrivatePgnCorpusSample([]));
  assert.throws(() => preparePrivatePgnCorpusSample([null]));
  assert.throws(() => preparePrivatePgnCorpusSample([{ label: "A", source: 123 }]));
  assert.throws(() => preparePrivatePgnCorpusSample([sources[0], sources[0]]));
  assert.throws(() => preparePrivatePgnCorpusSample([{ label: "", source: game(0) }]));
  assert.throws(() =>
    preparePrivatePgnCorpusSample([{ label: "A", source: '[Event "Intro"]\n\n*' }]),
  );
});
