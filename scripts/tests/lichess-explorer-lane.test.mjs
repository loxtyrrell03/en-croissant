import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLichessExplorerLane,
  LICHESS_EXPLORER_MIN_BACKOFF_MS,
  LICHESS_EXPLORER_MIN_SPACING_MS,
} from "../lichess-explorer-lane.mjs";

test("serializes upstream Explorer work and spaces request starts", async () => {
  let time = 1_000;
  const waits = [];
  const starts = [];
  const lane = createLichessExplorerLane({
    now: () => time,
    delay: async (waitMs) => {
      waits.push(waitMs);
      time += waitMs;
    },
  });

  await Promise.all([
    lane.run(async () => starts.push(time)),
    lane.run(async () => starts.push(time)),
  ]);

  assert.deepEqual(starts, [1_000, 1_000 + LICHESS_EXPLORER_MIN_SPACING_MS]);
  assert.deepEqual(waits, [LICHESS_EXPLORER_MIN_SPACING_MS]);
});

test("fails queued work fast throughout the provider Retry-After cooldown", async () => {
  let time = Date.parse("2026-08-31T12:00:00Z");
  const lane = createLichessExplorerLane({ now: () => time });

  assert.equal(lane.noteRateLimit("2"), LICHESS_EXPLORER_MIN_BACKOFF_MS);
  await assert.rejects(
    lane.run(async () => "unexpected"),
    {
      statusCode: 429,
      retryAfterMs: LICHESS_EXPLORER_MIN_BACKOFF_MS,
    },
  );

  time += LICHESS_EXPLORER_MIN_BACKOFF_MS;
  assert.equal(await lane.run(async () => "ready"), "ready");
});

test("honors an HTTP-date Retry-After longer than the one-minute floor", async () => {
  const time = Date.parse("2026-08-31T12:00:00Z");
  const lane = createLichessExplorerLane({ now: () => time });
  assert.equal(
    lane.noteRateLimit("Mon, 31 Aug 2026 12:02:00 GMT"),
    2 * LICHESS_EXPLORER_MIN_BACKOFF_MS,
  );
});
