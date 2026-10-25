import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCompressionNotices } from "../verify-compression-notices.mjs";

const source = fileURLToPath(new URL("../../", import.meta.url));
const files = [
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "licenses/zstd/manifest.json",
  "licenses/zstd/rust-wrapper-MIT.txt",
  "licenses/zstd/zstandard-BSD-3-Clause.txt",
  "licenses/THIRD_PARTY_NOTICES.txt",
  "src-tauri/tournament-core/Cargo.lock",
  "licenses/zstd/helper-manifest.json",
  "licenses/zstd/rust-wrapper-BSD-3-Clause.txt",
  "licenses/PHONE_HELPER_NOTICES.txt",
];
function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), "encroissant-notice-fixture-"));
  try {
    for (const name of files) {
      const target = path.join(root, name);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(source, name), target);
    }
    run(root);
  } finally {
    const actual = realpathSync(root),
      parent = realpathSync(tmpdir());
    assert.equal(path.relative(parent, actual), path.basename(actual));
    assert.ok(path.basename(actual).startsWith("encroissant-notice-fixture-"));
    rmSync(actual, { recursive: true });
    assert.equal(existsSync(actual), false);
  }
}
function edit(root, name, update) {
  const target = path.join(root, name);
  writeFileSync(target, update(readFileSync(target, "utf8")));
}
test("current locked wrappers and bundled C grants match exact distributed bytes", () => {
  assert.deepEqual(verifyCompressionNotices(source), { packages: 3, grants: 4 });
});
test("a changed locked compression version needs a fresh notice review", () =>
  fixture((root) => {
    edit(root, "src-tauri/Cargo.lock", (text) =>
      text.replace(/name = "zstd"\r?\nversion = "0\.13\.2"/, 'name = "zstd"\nversion = "0.13.3"'),
    );
    assert.throws(() => verifyCompressionNotices(root), /changed zstd versions/);
  }));
test("changed grant bytes and incomplete distributed text fail independently", () => {
  fixture((root) => {
    edit(root, "licenses/zstd/rust-wrapper-MIT.txt", (text) => text + "changed");
    assert.throws(() => verifyCompressionNotices(root), /Exact licence text changed/);
  });
  fixture((root) => {
    edit(root, "licenses/THIRD_PARTY_NOTICES.txt", (text) =>
      text.replace("All rights reserved.", ""),
    );
    assert.throws(() => verifyCompressionNotices(root), /omits full notice/);
  });
});
test("native package mapping cannot silently lose the standalone notices", () =>
  fixture((root) => {
    edit(root, "src-tauri/tauri.conf.json", (text) => {
      const config = JSON.parse(text);
      delete config.bundle.resources["../licenses/THIRD_PARTY_NOTICES.txt"];
      return JSON.stringify(config);
    });
    assert.throws(() => verifyCompressionNotices(root), /must include third-party notices/);
  }));
test("omitting the bundled C grant cannot pass with wrapper notices alone", () =>
  fixture((root) => {
    edit(root, "licenses/zstd/manifest.json", (text) => {
      const manifest = JSON.parse(text);
      manifest.entries = manifest.entries.filter((entry) => entry.sourcePath !== "zstd/LICENSE");
      return JSON.stringify(manifest);
    });
    assert.throws(() => verifyCompressionNotices(root), /Both wrapper and bundled C notices/);
  }));

test("the hosted helper uses its own locked versions and complete grant texts", () => {
  assert.deepEqual(verifyCompressionNotices(source, "hosted-helper"), { packages: 3, grants: 4 });
});
test("native labels cannot replace newer helper wrapper grants", () =>
  fixture((root) => {
    edit(root, "licenses/PHONE_HELPER_NOTICES.txt", (text) =>
      text.replace(
        "zstd-safe 7.3.0 - Rust wrapper\nSelected licence: BSD-3-Clause",
        "zstd-safe 7.3.0 - Rust wrapper\nSelected licence: MIT",
      ),
    );
    assert.throws(
      () => verifyCompressionNotices(root, "hosted-helper"),
      /mislabels the zstd-safe grant/,
    );
  }));
test("a helper lockfile change is checked independently from the native lockfile", () =>
  fixture((root) => {
    edit(root, "src-tauri/tournament-core/Cargo.lock", (text) =>
      text.replace(
        /name = "zstd-safe"\r?\nversion = "7\.3\.0"/,
        'name = "zstd-safe"\nversion = "7.4.0"',
      ),
    );
    assert.deepEqual(verifyCompressionNotices(root), { packages: 3, grants: 4 });
    assert.throws(
      () => verifyCompressionNotices(root, "hosted-helper"),
      /changed zstd-safe versions/,
    );
  }));
test("native notices cannot substitute for the complete hosted helper file", () =>
  fixture((root) => {
    edit(root, "licenses/PHONE_HELPER_NOTICES.txt", () =>
      readFileSync(path.join(root, "licenses/THIRD_PARTY_NOTICES.txt"), "utf8"),
    );
    assert.throws(
      () => verifyCompressionNotices(root, "hosted-helper"),
      /omits version|omits full notice/,
    );
  }));
test("the newer BSD wrapper notice cannot silently change", () =>
  fixture((root) => {
    edit(root, "licenses/zstd/rust-wrapper-BSD-3-Clause.txt", (text) => text + "changed");
    assert.throws(
      () => verifyCompressionNotices(root, "hosted-helper"),
      /Exact licence text changed/,
    );
  }));
