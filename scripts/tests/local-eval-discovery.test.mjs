import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { FEN, writeEvaluationStore as store } from "./fixtures/local-eval-store.mjs";
import {
  createDefaultLocalLichessEvalStore,
  createLocalLichessEvalStore,
  sharedLocalEvaluationPath,
} from "../lichess-local-eval-reader.mjs";

async function fixture(run) {
  const parent = realpathSync.native(tmpdir()),
    root = mkdtempSync(join(parent, "en-eval-discovery-"));
  try {
    await run(root);
  } finally {
    const actual = realpathSync.native(root);
    assert.equal(dirname(actual), parent);
    assert.ok(basename(actual).startsWith("en-eval-discovery-"));
    rmSync(actual, { recursive: true, force: true });
  }
}

function locations(root) {
  return {
    legacyPath: join(root, "profile", "lichess-cloud-evals"),
    sharedPath: join(root, "shared"),
  };
}
const cp = async (source) => (await source.lookup(FEN, 1)).pvs[0].cp;

test("shared discovery serves a real stored score without creating a profile or copying data", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    store(paths.sharedPath);
    const bytes = readFileSync(join(paths.sharedPath, "manifest.json"));
    const source = createDefaultLocalLichessEvalStore(paths);
    assert.equal(source.status.available, true);
    assert.equal(source.status.path, realpathSync.native(paths.sharedPath));
    assert.equal(await cp(source), 24);
    assert.equal(readdirSync(root).join(","), "shared");
    assert.deepEqual(readFileSync(join(paths.sharedPath, "manifest.json")), bytes);
  }));

test("missing and empty roots remain uninstalled without creating either store", async () =>
  fixture(async (root) => {
    const paths = locations(root),
      source = createDefaultLocalLichessEvalStore(paths);
    assert.equal(source.status.available, false);
    assert.equal(source.status.error, null);
    assert.equal(await source.lookup(FEN), null);
    assert.deepEqual(readdirSync(root), []);
    mkdirSync(paths.legacyPath, { recursive: true });
    mkdirSync(paths.sharedPath);
    assert.equal(source.status.available, false);
    assert.equal(source.status.error, null);
  }));

test("a confirmed empty legacy folder can use the shared store", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    mkdirSync(paths.legacyPath, { recursive: true });
    store(paths.sharedPath);
    assert.equal(await cp(createDefaultLocalLichessEvalStore(paths)), 24);
    assert.deepEqual(readdirSync(paths.legacyPath), []);
  }));

test("existing legacy data remains ahead of another shared store", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    store(paths.legacyPath, 31);
    store(paths.sharedPath, 24);
    const source = createDefaultLocalLichessEvalStore(paths);
    assert.equal(await cp(source), 31);
    assert.equal(source.status.path, realpathSync.native(paths.legacyPath));
  }));

test("configured custom or missing paths never fall through to other stores", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    store(paths.legacyPath, 31);
    store(paths.sharedPath, 24);
    const explicitPath = join(root, "custom");
    store(explicitPath, 43);
    assert.equal(await cp(createDefaultLocalLichessEvalStore({ ...paths, explicitPath })), 43);
    const missing = createDefaultLocalLichessEvalStore({
      ...paths,
      explicitPath: join(root, "pinned-missing"),
    });
    assert.equal(missing.status.available, false);
    assert.equal(await missing.lookup(FEN), null);
    assert.equal(missing.status.path, join(root, "pinned-missing"));
  }));

test("corrupt and incomplete legacy data is reported instead of silently switching", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    mkdirSync(paths.legacyPath, { recursive: true });
    store(paths.sharedPath);
    const owner = join(paths.legacyPath, "owner.txt");
    writeFileSync(owner, "retained fixture");
    const source = createDefaultLocalLichessEvalStore(paths);
    assert.equal(source.status.available, false);
    assert.ok(source.status.error);
    await assert.rejects(source.lookup(FEN));
    assert.equal(readFileSync(owner, "utf8"), "retained fixture");
  }));

test("a file at a shared-root path is unavailable, not a missing installation", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    writeFileSync(paths.sharedPath, "retained fixture");
    const source = createDefaultLocalLichessEvalStore(paths);
    assert.equal(source.status.available, false);
    assert.ok(source.status.error);
    await assert.rejects(source.lookup(FEN));
    assert.equal(readFileSync(paths.sharedPath, "utf8"), "retained fixture");
  }));

test("foreign, incomplete and oversized manifests remain visible failures", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    store(paths.sharedPath);
    const manifest = join(paths.sharedPath, "manifest.json");
    const valid = JSON.parse(readFileSync(manifest, "utf8"));
    const source = createDefaultLocalLichessEvalStore(paths);
    for (const bytes of [
      "{}",
      JSON.stringify({ ...valid, complete: false }),
      Buffer.alloc(1024 * 1024 + 1, 32),
    ]) {
      writeFileSync(manifest, bytes);
      assert.equal(source.status.available, false);
      assert.ok(source.status.error);
      await assert.rejects(source.lookup(FEN));
    }
    writeFileSync(manifest, JSON.stringify(valid));
    assert.equal(await cp(source), 24, "failed checks are immediately retryable after repair");
  }));

test("configured readers also reject a syntactically valid oversized manifest", async () =>
  fixture(async (root) => {
    const target = store(join(root, "explicit"));
    const manifest = join(target.path, "manifest.json");
    writeFileSync(manifest, readFileSync(manifest, "utf8") + " ".repeat(1024 * 1024));
    const source = createLocalLichessEvalStore(target.path);
    assert.equal(source.status.available, false);
    assert.match(source.status.error, /bound/);
    await assert.rejects(source.lookup(FEN), /bound/);
  }));

test("bad sample records fail compatibility checks and recover without a long error cache", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    const target = store(paths.sharedPath),
      original = readFileSync(target.shard);
    writeFileSync(target.shard, "bad compressed fixture");
    const source = createDefaultLocalLichessEvalStore(paths);
    assert.equal(source.status.available, false);
    await assert.rejects(source.lookup(FEN));
    writeFileSync(target.shard, original);
    assert.equal(await cp(source), 24);
  }));

test("both supported record versions are recognized through their actual decoders", async () =>
  fixture(async (root) => {
    for (const version of [1, 2]) {
      const paths = locations(join(root, `v${version}`));
      store(paths.sharedPath, version + 20, version);
      assert.equal(await cp(createDefaultLocalLichessEvalStore(paths)), version + 20);
    }
  }));

test("metadata content changes are noticed even without a changed file length", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    store(paths.sharedPath);
    const source = createDefaultLocalLichessEvalStore(paths);
    assert.equal(source.status.available, true);
    const manifest = join(paths.sharedPath, "manifest.json"),
      before = statSync(manifest);
    let text = readFileSync(manifest, "utf8");
    text = text.replace('"positions":1', '"positions":0');
    writeFileSync(manifest, text);
    utimesSync(manifest, before.atime, before.mtime);
    assert.equal(statSync(manifest).size, before.size);
    assert.equal(source.status.available, false);
    await assert.rejects(source.lookup(FEN));
  }));

test("a periodic recheck detects a changed sample and a repaired failure can retry immediately", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    const target = store(paths.sharedPath),
      original = readFileSync(target.shard);
    let time = 0;
    const source = createDefaultLocalLichessEvalStore({ ...paths, now: () => time });
    assert.equal(source.status.available, true);
    writeFileSync(target.shard, "bad compressed fixture");
    time = 30_001;
    assert.equal(source.status.available, false);
    writeFileSync(target.shard, original);
    assert.equal(await cp(source), 24);
  }));

test("an in-flight result cannot cross a default-source change", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    store(paths.sharedPath, 24);
    const source = createDefaultLocalLichessEvalStore(paths);
    const pending = source.lookup(FEN);
    store(paths.legacyPath, 31);
    await assert.rejects(pending, /source changed/);
    assert.equal(await cp(source), 31);
  }));

test("root aliases reuse data while linked shard folders are refused", async () =>
  fixture(async (root) => {
    const paths = locations(root),
      target = store(join(root, "retained"));
    symlinkSync(target.path, paths.sharedPath, process.platform === "win32" ? "junction" : "dir");
    try {
      assert.equal(await cp(createDefaultLocalLichessEvalStore(paths)), 24);
      const realShards = join(root, "retained-shards");
      renameSync(join(target.path, "shards"), realShards);
      symlinkSync(
        realShards,
        join(target.path, "shards"),
        process.platform === "win32" ? "junction" : "dir",
      );
      try {
        const failed = createDefaultLocalLichessEvalStore(paths);
        assert.equal(failed.status.available, false);
        await assert.rejects(failed.lookup(FEN));
      } finally {
        unlinkSync(join(target.path, "shards"));
      }
    } finally {
      unlinkSync(paths.sharedPath);
    }
  }));

test("failed access checks do not become an ordinary miss", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    const source = createDefaultLocalLichessEvalStore({
      ...paths,
      sharedPath: join(root, "bad\0path"),
    });
    assert.equal(source.status.available, false);
    assert.ok(source.status.error);
    await assert.rejects(source.lookup(FEN));
  }));

test("platform shared roots follow the same names as native discovery", () => {
  for (const platform of ["win32", "darwin"])
    assert.equal(
      sharedLocalEvaluationPath("base", platform),
      join("base", "ChessData", "lichess", "evaluations"),
    );
  assert.equal(
    sharedLocalEvaluationPath("base", "linux"),
    join("base", "chess-data", "lichess", "evaluations"),
  );
  assert.equal(sharedLocalEvaluationPath("base", "other"), null);
});

for (const version of [1, 2])
  test(`sample compatibility rejects invalid encoded fields in version ${version}`, async () =>
    fixture(async (root) => {
      const paths = locations(root),
        target = store(paths.sharedPath, 24, version);
      const original = zstdDecompressSync(readFileSync(target.shard));
      const source = createDefaultLocalLichessEvalStore(paths);
      for (const kind of ["score", "move", "count", "bucket"]) {
        const raw = Buffer.from(original);
        if (kind === "score") raw[28] = 7;
        if (kind === "move") raw.writeUInt16LE(0x5000, version === 1 ? 24 : 30);
        if (kind === "count") raw[version === 1 ? 18 : 20] = 0;
        if (kind === "bucket") raw[version === 1 ? 8 : 10] ^= 1;
        writeFileSync(target.shard, zstdCompressSync(raw));
        assert.equal(source.status.available, false, kind);
        await assert.rejects(source.lookup(FEN));
      }
      writeFileSync(target.shard, zstdCompressSync(original));
      assert.equal(await cp(source), 24);
    }));

test("discovered source metadata uses the native numeric and text schema", async () =>
  fixture(async (root) => {
    const paths = locations(root);
    store(paths.sharedPath);
    const manifest = join(paths.sharedPath, "manifest.json");
    const original = JSON.parse(readFileSync(manifest, "utf8")),
      source = createDefaultLocalLichessEvalStore(paths);
    for (const fields of [{ builtAt: "foreign date" }, { skipped: -1 }, { source: {} }]) {
      writeFileSync(manifest, JSON.stringify({ ...original, ...fields }));
      assert.equal(source.status.available, false);
      await assert.rejects(source.lookup(FEN));
    }
    writeFileSync(manifest, JSON.stringify(original));
    assert.equal(await cp(source), 24);
  }));
