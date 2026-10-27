import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { archiveSnapshot, buildArchiveTargets, writeArchive } from "./archives.mjs";

function fixture(t) {
  const db = new DatabaseSync(":memory:"),
    ledger = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  ledger.exec("CREATE TABLE recovery(id TEXT PRIMARY KEY,kind TEXT,payload TEXT,created_at TEXT)");
  const targets = buildArchiveTargets(
    new Map([
      ["Lessons", {}],
      ["Lessons/game.pgn", {}],
      ["Lesson/game.pgn", {}],
    ]),
    new Map([
      ["one", { id: 1, hostedPath: "Databases/Desktop/One [1]" }],
      ["two", { id: 2, hostedPath: "Databases/Desktop/Two [2]" }],
    ]),
  );
  const put = (key, value) =>
    db.prepare("INSERT OR REPLACE INTO meta VALUES(?,?)").run(key, JSON.stringify(value));
  const snapshot = () => archiveSnapshot(db, targets, "shared");
  const write = (path, archived, expected = snapshot().targets[path]) =>
    writeArchive({
      db,
      ledger,
      targets,
      id: "shared",
      body: { libraryId: "shared", path, archived, expected },
    });
  t.after(() => {
    db.close();
    ledger.close();
  });
  return { db, ledger, targets, put, snapshot, write };
}

test("Novelty file and collection archives map onto current stable phone paths", (t) => {
  const f = fixture(t);
  f.put("files.state", {
    Lessons: { archived: true, pinned: true },
    "Lessons/game.pgn": { archived: true, kind: "repertoire" },
  });
  f.put("outpost.library.archivedCollectionIds", [2]);
  const snapshot = f.snapshot();
  assert(snapshot.hostedPaths.includes("Lessons"));
  assert(snapshot.hostedPaths.includes("Databases/Desktop/Two [2]"));
  assert(!snapshot.hostedPaths.includes("Databases"));
  assert(!snapshot.hostedPaths.includes("Lesson/game.pgn"));
  f.write("Lessons", false);
  const labels = JSON.parse(
    f.db.prepare("SELECT value FROM meta WHERE key='files.state'").get().value,
  );
  assert.equal(labels.Lessons.pinned, true);
  assert.equal(labels["Lessons/game.pgn"].archived, true);
  assert.equal(labels["Lessons/game.pgn"].kind, "repertoire");
});

test("phone collection archive updates preserve unrelated IDs and support checked recovery", (t) => {
  const f = fixture(t);
  f.put("outpost.library.archivedCollectionIds", [2, 99]);
  const expected = f.snapshot().targets["Databases/Desktop/One [1]"];
  const first = f.write("Databases/Desktop/One [1]", true, expected);
  assert(first.hostedPaths.includes("Databases"));
  assert.deepEqual(
    JSON.parse(
      f.db.prepare("SELECT value FROM meta WHERE key='outpost.library.archivedCollectionIds'").get()
        .value,
    ),
    [1, 2, 99],
  );
  f.write("Databases/Desktop/One [1]", true, expected);
  assert.equal(f.ledger.prepare("SELECT count(*) n FROM recovery").get().n, 1);
  f.write("Databases/Desktop", false);
  assert.deepEqual(
    JSON.parse(
      f.db.prepare("SELECT value FROM meta WHERE key='outpost.library.archivedCollectionIds'").get()
        .value,
    ),
    [99],
  );
});

test("concurrent target changes reject without overwriting and malformed labels remain intact", (t) => {
  const f = fixture(t),
    path = "Databases/Desktop",
    expected = f.snapshot().targets[path];
  f.put("outpost.library.archivedCollectionIds", [2]);
  assert.throws(() => f.write(path, true, expected), /changed on the PC/);
  assert.deepEqual(
    JSON.parse(
      f.db.prepare("SELECT value FROM meta WHERE key='outpost.library.archivedCollectionIds'").get()
        .value,
    ),
    [2],
  );
  f.put("files.state", { Lessons: { archived: "invalid" } });
  assert.throws(() => f.snapshot(), /could not be read/);
  assert.throws(() => f.write("unrelated", true), /could not be read/);
});

test("archive-only metadata changes produce a new catalogue revision", (t) => {
  const f = fixture(t),
    old = f.snapshot();
  f.put("files.state", { Lessons: { archived: true } });
  assert.notEqual(f.snapshot().revision, old.revision);
  assert.throws(
    () =>
      writeArchive({
        db: f.db,
        ledger: f.ledger,
        targets: f.targets,
        id: "shared",
        body: {
          libraryId: "another",
          path: "Lessons",
          archived: true,
          expected: old.targets.Lessons,
        },
      }),
    /Invalid/,
  );
});
