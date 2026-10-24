import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exactReportRoot,
  runBoundedUciReport,
  validReportSearchLimits,
} from "../uci-report-search.mjs";

const limits = { depth: 8, timeMs: 50 };
test("report bounds reject coercion, fractions, missing values and out-of-range caps", () => {
  for (const value of [
    null,
    {},
    { depth: "8", timeMs: 50 },
    { depth: 8.5, timeMs: 50 },
    { depth: 31, timeMs: 50 },
    { depth: 8, timeMs: 49 },
    { depth: 8, timeMs: Infinity },
  ])
    assert.equal(validReportSearchLimits(value), false);
  assert.equal(validReportSearchLimits(limits), true);
});
test("exact report roots reject bounds, over-cap depth, malformed PVs and scores", () => {
  for (const line of [
    "info depth 8 score cp 2 lowerbound pv e2e4",
    "info depth 9 score cp 2 pv e2e4",
    "info depth 8 score cp 2x pv e2e4",
    "info depth 8 score cp 2 pv e2e4 junk e7e5",
    "info depth 8 score cp 2 pv",
    "info depth 8 multipv 3 score cp 2 pv e2e4",
  ])
    assert.equal(exactReportRoot(line, limits, 2), null);
  assert.equal(
    exactReportRoot("info depth 7 multipv 2 score mate -3 pv e2e4 e7e5", limits, 2),
    "e2e4",
  );
});
test("an exact final choice completes in one bounded search", async () => {
  const commands = [];
  const selected = await runBoundedUciReport({
    limits,
    multipv: 2,
    now: () => 0,
    onInfo() {},
    runSearch: async (command, collect) => {
      commands.push(command);
      collect("info depth 8 multipv 1 score cp 200 pv d2d4");
      collect("info depth 6 multipv 2 score cp 17 pv e2e4");
      return "e2e4";
    },
  });
  assert.equal(selected, "e2e4");
  assert.deepEqual(commands, ["go depth 8 movetime 40"]);
});
test("recovery shares remaining time, caps depth at 12 and holds the same queue job", async () => {
  const commands = [],
    ranks = [];
  let elapsed = 0;
  await runBoundedUciReport({
    limits: { depth: 22, timeMs: 1000 },
    multipv: 2,
    now: () => elapsed,
    onInfo() {},
    setMultiPv: (value) => {
      ranks.push(value);
      elapsed += 7;
    },
    runSearch: async (command, collect) => {
      commands.push(command);
      if (commands.length === 1) {
        collect("info depth 22 score cp 42 pv d2d4");
        elapsed = 810;
      } else collect("info depth 12 score cp 17 pv e2e4");
      return "e2e4";
    },
  });
  assert.deepEqual(commands, [
    "go depth 22 movetime 800",
    "go depth 12 movetime 183 searchmoves e2e4",
  ]);
  assert.deepEqual(ranks, [1]);
});
test("an exhausted budget cannot start recovery", async () => {
  let elapsed = 0,
    calls = 0;
  await assert.rejects(
    runBoundedUciReport({
      limits,
      multipv: 1,
      now: () => elapsed,
      onInfo() {},
      runSearch: async () => {
        calls++;
        elapsed = 51;
        return "e2e4";
      },
    }),
    /budget ended/,
  );
  assert.equal(calls, 1);
});
for (const mode of ["bound", "foreign", "over-depth"])
  test(`recovery cannot manufacture evidence from ${mode} output`, async () => {
    let calls = 0;
    await assert.rejects(
      runBoundedUciReport({
        limits,
        multipv: 1,
        now: () => 0,
        onInfo() {},
        runSearch: async (_command, collect) => {
          if (++calls === 2)
            collect(
              mode === "bound"
                ? "info depth 7 score cp 2 upperbound pv e2e4"
                : mode === "foreign"
                  ? "info depth 7 score cp 2 pv d2d4"
                  : "info depth 9 score cp 2 pv e2e4",
            );
          return "e2e4";
        },
      }),
      /exact selected-move score/,
    );
    assert.equal(calls, 2);
  });
test("cancellation after the first search prevents recovery", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    runBoundedUciReport({
      limits,
      multipv: 1,
      signal: controller.signal,
      onInfo() {},
      runSearch: async () => {
        calls++;
        controller.abort();
        return "e2e4";
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});
