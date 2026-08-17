import assert from "node:assert/strict";
import test from "node:test";
import { compareStatsEntryQuality } from "../stats-entry-quality.mjs";

function entry({ ts, depth, targetDepth, nodeLimit }) {
  return {
    ts,
    stats: { analysisDepth: depth, scoredCount: 20 },
    advanced: {},
    opponentQuality: { advanced: {} },
    ...(targetDepth == null
      ? {}
      : {
          batchAnalysis: {
            targetDepth,
            nodeLimit,
            policy: "lichess-local-until-first-miss-then-pc",
          },
        }),
  };
}

test("saved PC analysis outranks a newer shallow manual result", () => {
  const pc = entry({ ts: 100, depth: 11, targetDepth: 25, nodeLimit: 1_000_000 });
  const phone = entry({ ts: 200, depth: 12 });

  assert.ok(compareStatsEntryQuality(pc, phone) > 0);
});

test("timestamp breaks ties between equally strong analyses", () => {
  const older = entry({ ts: 100, depth: 11, targetDepth: 25, nodeLimit: 1_000_000 });
  const newer = entry({ ts: 200, depth: 11, targetDepth: 25, nodeLimit: 1_000_000 });

  assert.ok(compareStatsEntryQuality(newer, older) > 0);
});
