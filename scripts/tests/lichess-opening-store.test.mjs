import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createLocalLichessOpeningStore } from "../lichess-opening-store.mjs";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const INITIAL_KEY = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

function withTempStore(run) {
  const directory = mkdtempSync(join(tmpdir(), "en-croissant-lichess-opening-"));
  const path = join(directory, "opening.sqlite3");
  try {
    return run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function createFixture(path, { masters = false, complete = true } = {}) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE move_stats(
      source TEXT, hash_hi INTEGER, hash_lo INTEGER, month INTEGER,
      speed INTEGER, rating_group INTEGER, uci TEXT, san TEXT,
      white INTEGER, draws INTEGER, black INTEGER
    );
    CREATE TABLE game_lines(
      month INTEGER, speed INTEGER, rating_group INTEGER,
      white_key TEXT, black_key TEXT, white_name TEXT, black_name TEXT,
      white_rating INTEGER, black_rating INTEGER, result INTEGER, moves BLOB
    );
  `);
  const metadata = {
    version: "1",
    complete: complete ? "1" : "0",
    game_count: "3",
    move_rows: "2",
    standard_months: "2026-07",
    masters_months: masters ? "2026-07" : "",
    max_plies: "40",
    built_at: "1234",
  };
  const insertMetadata = database.prepare("INSERT INTO metadata VALUES (?, ?)");
  for (const [key, value] of Object.entries(metadata)) insertMetadata.run(key, value);

  const [hashHi, hashLo] = hashPosition(INITIAL_KEY);
  database
    .prepare("INSERT INTO move_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("lichess-all", hashHi, hashLo, 202607, 3, 2000, "e2e4", "e4", 2, 1, 0);
  if (masters) {
    database
      .prepare("INSERT INTO move_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("lichess-masters", hashHi, hashLo, 202607, 0, 0, "d2d4", "d4", 1, 1, 1);
  }

  const encodedE4 = Buffer.alloc(2);
  encodedE4.writeUInt16LE(12 | (28 << 6));
  database
    .prepare("INSERT INTO game_lines VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(202607, 3, 2000, "alice", "bob", "Alice", "Bob", 2000, 2000, 1, encodedE4);
  database.close();
}

function query(overrides = {}) {
  return {
    source: "lichess-all",
    fen: INITIAL_FEN,
    speeds: ["blitz"],
    ratings: [2000],
    player: null,
    color: null,
    since: null,
    until: null,
    topGames: 0,
    recentGames: 0,
    ...overrides,
  };
}

test("missing local snapshot is unavailable without being an error", () => {
  withTempStore((path) => {
    const store = createLocalLichessOpeningStore(path);
    assert.equal(store.status().available, false);
    assert.deepEqual(store.query(query()), {
      available: false,
      white: 0,
      draws: 0,
      black: 0,
      moves: [],
      opening: null,
      topGames: [],
      recentGames: [],
      coverage: null,
      error: null,
    });
  });
});

test("aggregate and player queries are served from the local snapshot", () => {
  withTempStore((path) => {
    createFixture(path);
    const store = createLocalLichessOpeningStore(path);
    assert.equal(store.status().available, true);

    const aggregate = store.query(query());
    assert.equal(aggregate.available, true);
    assert.deepEqual(aggregate.moves, [{ san: "e4", uci: "e2e4", white: 2, draws: 1, black: 0 }]);
    assert.deepEqual(
      { white: aggregate.white, draws: aggregate.draws, black: aggregate.black },
      { white: 2, draws: 1, black: 0 },
    );

    const player = store.query(
      query({ source: "lichess-player", player: "Alice", color: "white" }),
    );
    assert.equal(player.available, true);
    assert.deepEqual(player.moves, [{ san: "e4", uci: "e2e4", white: 1, draws: 0, black: 0 }]);
  });
});

test("an exact miss stays authoritative and source coverage controls fallback", () => {
  withTempStore((path) => {
    createFixture(path);
    const store = createLocalLichessOpeningStore(path);

    const exactMiss = store.query(
      query({ fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" }),
    );
    assert.equal(exactMiss.available, true);
    assert.deepEqual(exactMiss.moves, []);

    const masters = store.query(query({ source: "lichess-masters", speeds: [], ratings: [] }));
    assert.equal(masters.available, false);
  });
});

test("an incomplete or unreadable snapshot fails closed", () => {
  withTempStore((path) => {
    createFixture(path, { complete: false });
    const store = createLocalLichessOpeningStore(path);
    assert.throws(() => store.status(), /incomplete/);
    assert.throws(() => store.query(query()), /incomplete/);
  });
});

function hashPosition(position) {
  const bytes = new TextEncoder().encode(position);
  const fnv1a = (offset) => {
    let hash = offset;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x00000100000001b3n);
    }
    return BigInt.asIntN(64, hash);
  };
  return [fnv1a(0xcbf29ce484222325n), fnv1a(0x84222325cbf29ce4n)];
}
