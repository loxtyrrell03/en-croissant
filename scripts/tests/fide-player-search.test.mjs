import assert from "node:assert/strict";
import test from "node:test";
import {
  FidePlayerSearchService,
  parseFidePlayer,
  rankFidePlayers,
} from "../fide-player-search.mjs";

test("parses only valid public FIDE fields", () => {
  assert.deepEqual(parseFidePlayer({ id: 6003788, name: "TYRRELL, LACHLAN", federation: "ENG" }), {
    id: 6003788,
    name: "TYRRELL, LACHLAN",
    federation: "ENG",
  });
  assert.equal(parseFidePlayer({ name: "Missing ID" }), null);
});

test("ranks exact and one-letter surname matches", () => {
  const players = [
    { id: 1, name: "TAYLOR, LACHLAN", standard: 2300 },
    { id: 2, name: "TYRRELL, LACHLAN BALY HUGHES", standard: 2100 },
    { id: 3, name: "TYRELL, LACHLAN", standard: 2050 },
  ];
  assert.deepEqual(
    rankFidePlayers("Tyrrell Lachlan", players).map(({ id }) => id),
    [2, 3, 1],
  );
});

test("numeric lookup uses the ID endpoint and caches the result", async () => {
  const urls = [];
  const service = new FidePlayerSearchService({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ id: 6003788, name: "TYRRELL, LACHLAN" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal((await service.search("6003788"))[0].name, "TYRRELL, LACHLAN");
  assert.equal((await service.search("6003788"))[0].id, 6003788);
  assert.deepEqual(urls, ["https://lichess.org/api/fide/player/6003788"]);
});

test("concurrent name searches share one PC request", async () => {
  let calls = 0;
  const service = new FidePlayerSearchService({
    fetchImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify([{ id: 1, name: "CARLSEN, MAGNUS" }]));
    },
  });
  const [left, right] = await Promise.all([service.search("Carlsen"), service.search("carlsen")]);
  assert.equal(calls, 1);
  assert.deepEqual(left, right);
});

const example = { id: 12345, name: "Example, Alex" };
const reply = (body, status = 200, headers) =>
  new Response(JSON.stringify(body), { status, headers });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("only confirmed misses are cached; HTTP, JSON and invalid-identity errors retry", async () => {
  const replies = [
    reply({}, 503),
    new Response("not JSON"),
    reply([{ id: -1, name: "Invalid" }]),
    reply([example]),
  ];
  let calls = 0;
  const service = new FidePlayerSearchService({
    minSpacingMs: 0,
    fetchImpl: async () => {
      calls++;
      return replies.shift();
    },
  });
  for (let i = 0; i < 3; i++) await assert.rejects(service.search("Example"));
  assert.equal((await service.search("Example"))[0].id, 12345);
  assert.equal((await service.search("example"))[0].id, 12345);
  assert.equal(calls, 4);
});

test("numeric 404 is a miss, name 404 and wrong numeric identity are errors", async () => {
  const replies = [reply({}, 404), reply({}, 404), reply({ ...example, id: 54321 })];
  const service = new FidePlayerSearchService({
    minSpacingMs: 0,
    fetchImpl: async () => replies.shift(),
  });
  assert.deepEqual(await service.search("12345"), []);
  await assert.rejects(service.search("Example"), /404/);
  await assert.rejects(service.search("99999"), /different player/);
});

test("body and queued stalls time out even if the provider ignores cancellation", async () => {
  let calls = 0;
  const service = new FidePlayerSearchService({
    minSpacingMs: 0,
    timeoutMs: 25,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return { ok: true, status: 200, json: () => new Promise(() => {}) };
      return reply([example]);
    },
  });
  await assert.rejects(service.search("Example"), /too long/);
  assert.equal((await service.search("Example"))[0].id, 12345);
});

test("one reader can cancel without cancelling another, and the last reader abandons stale results", async () => {
  const pending = deferred();
  let signal;
  const service = new FidePlayerSearchService({
    minSpacingMs: 0,
    fetchImpl: (_url, options) => {
      signal = options.signal;
      return pending.promise;
    },
  });
  const left = new AbortController(),
    right = new AbortController();
  const cancelledLeft = assert.rejects(service.search("Example", left.signal), {
    name: "AbortError",
  });
  const cancelledRight = assert.rejects(service.search("Example", right.signal), {
    name: "AbortError",
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  left.abort();
  await cancelledLeft;
  assert.equal(signal.aborted, false);
  right.abort();
  await cancelledRight;
  assert.equal(signal.aborted, true);
  pending.resolve(reply([example]));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(service.cache.size, 0);
});

test("different queries are serialized and spaced; cancelled queued queries never fetch", async () => {
  const pending = deferred();
  const calls = [];
  const service = new FidePlayerSearchService({
    minSpacingMs: 15,
    fetchImpl: async (url) => {
      calls.push({ url, time: Date.now() });
      return calls.length === 1 ? pending.promise : reply([example]);
    },
  });
  const active = service.search("Example");
  const controller = new AbortController();
  const cancelled = assert.rejects(service.search("Abandoned", controller.signal), {
    name: "AbortError",
  });
  const next = service.search("Another");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.length, 1);
  controller.abort();
  await cancelled;
  pending.resolve(reply([example]));
  await active;
  await next;
  assert.equal(calls.length, 2);
  assert.ok(calls[1].time - calls[0].time >= 14);
});

test("429 keeps a minimum minute cooldown, with no failed cache entry", async () => {
  let calls = 0;
  const service = new FidePlayerSearchService({
    fetchImpl: async () => {
      calls++;
      return reply({}, 429, { "retry-after": "1" });
    },
  });
  const before = Date.now();
  await assert.rejects(service.search("Example"), /minute/);
  await assert.rejects(service.search("Another"), /minute/);
  assert.equal(calls, 1);
  assert.ok(service.backoffUntil >= before + 60_000);
  assert.equal(service.cache.size, 0);
});

test("cache entries stay bounded and optional malformed metadata never displays as a rating", async () => {
  const service = new FidePlayerSearchService({
    maxCacheEntries: 2,
    minSpacingMs: 0,
    fetchImpl: async () => reply([example]),
  });
  for (const query of ["One", "Two", "Three"]) await service.search(query);
  assert.equal(service.cache.size, 2);
  assert.equal(service.cache.has("one"), false);
  assert.equal(
    parseFidePlayer({ ...example, standard: -10, rapid: 0, blitz: 2.5, inactive: 1 }).inactive,
    true,
  );
  assert.equal(parseFidePlayer({ ...example, standard: -10 }).standard, undefined);
});
