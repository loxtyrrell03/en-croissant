import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { zstdCompressSync } from "node:zlib";
import { createLocalLichessEvalStore } from "../lichess-local-eval-reader.mjs";

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
async function fixture(run) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, "en-eval-readiness-"));
  try {
    await run(root);
  } finally {
    const target = await realpath(root);
    assert.equal(dirname(target), parent);
    assert.ok(basename(target).startsWith("en-eval-readiness-"));
    await rm(target, { recursive: true, force: true });
  }
}

test("an actually absent store remains distinct from an access-check error", async () => {
  await fixture(async (root) => {
    const missing = createLocalLichessEvalStore(join(root, "absent"));
    assert.equal(missing.status.available, false);
    assert.equal(missing.status.error, null);
    assert.equal(await missing.lookup(FEN), null);

    const inaccessible = createLocalLichessEvalStore(join(root, "invalid\0store"));
    assert.equal(inaccessible.status.available, false);
    assert.ok(inaccessible.status.error, "failed access must not be reported as uninstalled");
    await assert.rejects(inaccessible.lookup(FEN));
  });
});

test("a regular file at the requested store path is retained and reported as an error", async () => {
  await fixture(async (root) => {
    const path = join(root, "owner-fixture.txt");
    await writeFile(path, "synthetic source must survive");
    const store = createLocalLichessEvalStore(path);
    assert.equal(store.status.available, false);
    assert.ok(store.status.error);
    await assert.rejects(store.lookup(FEN));
    assert.equal(await readFile(path, "utf8"), "synthetic source must survive");
  });
});

test("an empty existing directory is genuinely uninstalled", async () => {
  await fixture(async (root) => {
    const store = createLocalLichessEvalStore(root);
    assert.equal(store.status.available, false);
    assert.equal(store.status.error, null);
    assert.equal(await store.lookup(FEN), null);
  });
});

test("a corrupt or incomplete manifest cannot become an ordinary position miss", async () => {
  await fixture(async (root) => {
    for (const manifest of ["{", JSON.stringify({ complete: false })]) {
      await writeFile(join(root, "manifest.json"), manifest);
      const store = createLocalLichessEvalStore(root);
      assert.equal(store.status.available, false);
      assert.ok(store.status.error);
      await assert.rejects(store.lookup(FEN));
    }
  });
});

test("shard access failures are visible while an absent shard retains the existing miss contract", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        format: "en-croissant-lichess-eval-compact",
        complete: true,
        version: 2,
        positions: 0,
        shardCount: 1,
        maxPvs: 5,
      }),
    );
    const missing = createLocalLichessEvalStore(root);
    assert.equal(missing.status.available, true);
    assert.equal(await missing.lookup(FEN), null);
    // A file where the shards directory belongs produces a real path-access
    // failure, rather than a fabricated parser exception or owner-data edit.
    await writeFile(join(root, "shards"), "synthetic blocker");
    const blocked = createLocalLichessEvalStore(root);
    await assert.rejects(blocked.lookup(FEN));
    assert.equal(await readFile(join(root, "shards"), "utf8"), "synthetic blocker");
  });
});

test("a valid empty shard is a miss, while an unreadable compressed shard is an error", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        format: "en-croissant-lichess-eval-compact",
        complete: true,
        version: 2,
        positions: 0,
        shardCount: 1,
        maxPvs: 5,
      }),
    );
    await mkdir(join(root, "shards"));
    const shard = join(root, "shards", "0000.bin.zst");
    const emptyIndex = Buffer.alloc(8);
    emptyIndex.write("LEI2", 4);
    await writeFile(shard, zstdCompressSync(emptyIndex));
    assert.equal(await createLocalLichessEvalStore(root).lookup(FEN), null);
    await writeFile(shard, "not a compressed shard");
    await assert.rejects(createLocalLichessEvalStore(root).lookup(FEN));
  });
});
