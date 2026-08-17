import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildHostedLibraryIndex,
  getHostedLibraryScope,
  HostedLibraryIndexCache,
  listHostedLibraryDirectory,
} from "../home-library-index.mjs";

const manifest = {
  version: 1,
  generatedAt: "2026-07-20T12:00:00.000Z",
  sourceName: "EnCroissant",
  pinnedPaths: ["Prep/Pinned"],
  files: [
    hostedFile("Prep/Pinned/one.pgn", "pgn", 10, 1),
    hostedFile("Prep/Pinned/nested/two.pgn", "pgn", 20, 2),
    hostedFile("Prep/report.pdf", "pdf", 30, 3),
  ],
};

test("builds compact directory listings without returning the complete manifest", () => {
  const index = buildHostedLibraryIndex(manifest);
  const root = listHostedLibraryDirectory(index, "");
  const prep = listHostedLibraryDirectory(index, "Prep");
  const pinned = prep.entries[0];

  assert.deepEqual(root.entries.map((entry) => entry.name), ["Prep"]);
  assert.deepEqual(prep.entries.map((entry) => entry.name), ["Pinned", "report"]);
  assert.equal(pinned.type, "directory");
  assert.equal(pinned.pgnFileCount, 2);
  assert.equal(pinned.directPgnFileCount, 1);
  assert.equal(pinned.sizeBytes, 30);
  assert.equal(pinned.pinned, true);
  assert.equal(JSON.stringify(prep).includes("two.pgn"), false);
});

test("returns recursive file metadata only when a folder is opened for import", () => {
  const index = buildHostedLibraryIndex(manifest);
  const scope = getHostedLibraryScope(index, "Prep/Pinned");

  assert.deepEqual(
    scope.files.map((file) => file.path),
    ["Prep/Pinned/one.pgn", "Prep/Pinned/nested/two.pgn"],
  );
  assert.deepEqual(scope.pinnedPaths, ["Prep/Pinned"]);
});

test("reuses the parsed index until the manifest file changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "en-croissant-library-index-"));
  const manifestPath = join(directory, "manifest.json");
  try {
    await writeFile(manifestPath, JSON.stringify(manifest));
    const cache = new HostedLibraryIndexCache(manifestPath);
    const first = await cache.get();
    const second = await cache.get();
    assert.equal(second, first);

    const updated = { ...manifest, files: [...manifest.files, hostedFile("new.pgn", "pgn", 5, 4)] };
    await writeFile(manifestPath, `${JSON.stringify(updated)} `);
    const third = await cache.get();
    assert.notEqual(third, first);
    assert.equal(listHostedLibraryDirectory(third, "").entries.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function hostedFile(path, extension, sizeBytes, lastModified) {
  const filename = path.split("/").at(-1);
  return {
    type: "file",
    name: filename.replace(/\.(pgn|pdf)$/i, ""),
    filename,
    extension,
    path,
    url: `files/${path}`,
    lastModified,
    sizeBytes,
  };
}
