import assert from "node:assert/strict";
import test from "node:test";
import { preparePrivatePgnSample, privateReportPath } from "../benchmarks/private-pgn-sample.mjs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const fen = "7k/8/8/8/8/8/6P1/6K1 w - - 0 1";
const game = (number, moves = "1. g3 *") =>
  `[Event "Synthetic"]\n[Black "Example ${number}"]\n[FEN "${fen}"]\n\n${moves}\n\n`;

test("the fixed stride includes both endpoints without looking at annotations", () => {
  const source = Array.from({ length: 10 }, (_, i) => game(i + 1)).join("");
  const sample = preparePrivatePgnSample(source, 4);
  assert.equal(sample.eligiblePositions, 10);
  assert.deepEqual(
    sample.cases.map((row) => row.eligibleIndex),
    [1, 4, 7, 10],
  );
  assert.deepEqual(sample.cases[0].sourceUci, ["g2g3"]);
  assert.match(sample.sourceSha256, /^[a-f0-9]{64}$/);
});

test("mainline extraction ignores instructional comments and alternate moves", () => {
  const sample = preparePrivatePgnSample(game(1, "1. g3 { Pretend this is a fork. } (1. g4) *"));
  assert.deepEqual(sample.cases[0].sourceUci, ["g2g3"]);
  assert.equal(JSON.stringify(sample).includes("Pretend"), false);
});

test("an illegal continuation is rejected rather than silently truncated into a solution", () => {
  const sample = preparePrivatePgnSample(game(1, "1. g3 Kh7 2. Qh5 *") + game(2));
  assert.equal(sample.eligiblePositions, 1);
  assert.equal(sample.rejected.length, 1);
  assert.match(sample.rejected[0].error, /Illegal mainline/);
  assert.equal(sample.cases[0].exercise, "Example 2");
});

test("non-exercise introductions are excluded and one-position samples are well-defined", () => {
  const sample = preparePrivatePgnSample('[Event "Introduction"]\n\n*\n\n' + game(1), 1);
  assert.equal(sample.parsedGames, 2);
  assert.equal(sample.cases.length, 1);
  assert.equal(sample.cases[0].sourceGame, 2);
});

test("invalid sizes fail instead of silently changing selection", () => {
  for (const count of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => preparePrivatePgnSample(game(1), count));
});

test("private reports cannot be written inside the checkout", () => {
  assert.throws(
    () => privateReportPath("benchmarks/private/new/report.json"),
    /outside the checkout/,
  );
  assert.equal(
    privateReportPath(resolve(tmpdir(), "private-tactics-report.json")),
    resolve(tmpdir(), "private-tactics-report.json"),
  );
});

const uniqueGames = Array.from({ length: 8 }, (_, i) =>
  game(i + 1).replace(fen, fen.replace("7k/8/", `7k/${i || ""}p${7 - i || ""}/`)),
).join("");

test("a disjoint sample preserves original source indices and excludes prior positions", () => {
  const prior = preparePrivatePgnSample(uniqueGames, 3);
  assert.deepEqual(
    prior.cases.map((r) => r.eligibleIndex),
    [1, 4, 8],
  );
  const next = preparePrivatePgnSample(uniqueGames, 3, prior);
  assert.equal(next.excludedPositions, 3);
  assert.equal(next.remainingPositions, 5);
  assert.deepEqual(
    next.cases.map((r) => r.eligibleIndex),
    [2, 5, 7],
  );
  assert.deepEqual(next, preparePrivatePgnSample(uniqueGames, 3, prior));
});

test("the same position at another PGN index is excluded as well", () => {
  const first = uniqueGames.slice(0, uniqueGames.indexOf("[Event", 1));
  const source = uniqueGames + first;
  const prior = preparePrivatePgnSample(source, 1);
  const next = preparePrivatePgnSample(source, 20, prior);
  assert.equal(next.excludedPositions, 2);
  assert.equal(next.cases.length, 7);
  assert.equal(
    next.cases.some((r) => r.fen === prior.cases[0].fen),
    false,
  );
});

test("source mismatch, malformed exclusions and an exhausted pool fail explicitly", () => {
  const prior = preparePrivatePgnSample(uniqueGames, 2);
  assert.throws(() => preparePrivatePgnSample(uniqueGames + "\n", 2, prior), /exact PGN/);
  for (const cases of [
    [{ ...prior.cases[0], eligibleIndex: 0 }],
    [{ ...prior.cases[0], fen: "wrong" }],
    null,
  ])
    assert.throws(() => preparePrivatePgnSample(uniqueGames, 2, { ...prior, cases }));
  assert.throws(
    () => preparePrivatePgnSample(uniqueGames, 1, preparePrivatePgnSample(uniqueGames, 8)),
    /No unseen/,
  );
});
