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
