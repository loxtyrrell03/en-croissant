import { randomUUID } from "node:crypto";
import { digest } from "./files.mjs";

const filesKey = "files.state";
const collectionsKey = "outpost.library.archivedCollectionIds";
const inside = (child, parent) => child === parent || child.startsWith(`${parent}/`);
const read = (db, key) => db.prepare("SELECT value FROM meta WHERE key=?").get(key)?.value ?? null;

function labels(db) {
  const rawFiles = read(db, filesKey),
    rawCollections = read(db, collectionsKey);
  const files = rawFiles === null ? {} : JSON.parse(rawFiles);
  const collections = rawCollections === null ? [] : JSON.parse(rawCollections);
  if (
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    Object.values(files).some(
      (value) =>
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ("archived" in value && typeof value.archived !== "boolean"),
    ) ||
    !Array.isArray(collections) ||
    collections.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw Error("Desktop archive labels could not be read. No labels were changed.");
  }
  return { files, collections: new Set(collections), rawFiles, rawCollections };
}

function targetState(labels, target) {
  return target.kind === "file"
    ? Boolean(labels.files[target.relative]?.archived)
    : target.ids.map((id) => [id, labels.collections.has(id)]);
}

export function archiveSnapshot(db, targets, id) {
  const current = labels(db),
    paths = [],
    revisions = {},
    collectionPaths = {};
  for (const [path, target] of targets) {
    const state = targetState(current, target);
    revisions[path] = digest(JSON.stringify(state));
    if (target.kind === "collection" && target.ids.length === 1 && !path.endsWith("/games.pgn"))
      collectionPaths[target.ids[0]] = path;
    if (
      target.kind === "file" ? state : state.length > 0 && state.every(([, archived]) => archived)
    )
      paths.push(path);
  }
  return {
    version: 1,
    libraryId: id,
    revision: digest(JSON.stringify([current.rawFiles, current.rawCollections, revisions])),
    hostedPaths: paths.sort((a, b) => b.length - a.length),
    targets: revisions,
    collectionPaths,
  };
}

/** One explicit archive operation, checked against that item's last read labels.
 * Other labels, pinning, file kinds, game content and downloaded references stay intact. */
export function writeArchive({ db, ledger, targets, id, body }) {
  if (
    !body ||
    typeof body.path !== "string" ||
    typeof body.archived !== "boolean" ||
    typeof body.expected !== "string" ||
    body.libraryId !== id
  )
    throw Error("Invalid shared archive request");
  const target = targets.get(body.path);
  if (!target)
    throw Error(
      "This shared file or database moved. Refresh Files before changing its archive label.",
    );
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = labels(db),
      state = targetState(current, target);
    const already =
      target.kind === "file"
        ? state === body.archived
        : state.every(([, archived]) => archived === body.archived);
    if (!already && digest(JSON.stringify(state)) !== body.expected) {
      const error = Error("This archive label changed on the PC. Refresh Files before retrying.");
      error.status = 409;
      throw error;
    }
    if (!already) {
      const key = target.kind === "file" ? filesKey : collectionsKey;
      const before = target.kind === "file" ? current.rawFiles : current.rawCollections;
      if (target.kind === "file")
        current.files[target.relative] = {
          ...current.files[target.relative],
          archived: body.archived,
        };
      else
        for (const collection of target.ids) {
          if (body.archived) current.collections.add(collection);
          else current.collections.delete(collection);
        }
      const value = JSON.stringify(
        target.kind === "file" ? current.files : [...current.collections].sort((a, b) => a - b),
      );
      ledger
        .prepare("INSERT INTO recovery VALUES(?,?,?,?)")
        .run(
          randomUUID(),
          "archive-label",
          JSON.stringify({ key, before, after: value }),
          new Date().toISOString(),
        );
      db.prepare(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(key, value);
      if (read(db, key) !== value) throw Error("Archive label readback failed");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return archiveSnapshot(db, targets, id);
}

export function buildArchiveTargets(files, collections) {
  const targets = new Map([...files].map(([relative]) => [relative, { kind: "file", relative }]));
  for (const collection of collections.values()) {
    const parts = collection.hostedPath.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      if (targets.get(path)?.kind === "file") continue;
      const ids = [...collections.values()]
        .filter((other) => inside(other.hostedPath, path))
        .map((other) => other.id);
      targets.set(path, { kind: "collection", ids });
    }
    targets.set(`${collection.hostedPath}/games.pgn`, { kind: "collection", ids: [collection.id] });
  }
  return targets;
}
