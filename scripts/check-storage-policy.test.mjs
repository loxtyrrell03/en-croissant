import test from 'node:test';
import assert from 'node:assert/strict';
import { storageViolation } from './check-storage-policy.mjs';

test('blocks the tracked material that inflated every historical delivery checkout', () => {
  for (const name of ['node_modules.incomplete-from-laptop-archive/a.wasm', 'node_modules.backup/lib.js', 'Vlad video.webm', 'download.mp4.part', 'src-tauri/target/debug/deps/build.rlib', 'tmp/store/shards/0000.bin.zst']) {
    assert.ok(storageViolation(name, 2 * 1024 * 1024), name);
  }
});
test('preserves normal source, tests, small fixtures and intentional website media', () => {
  for (const name of ['src/local_eval.rs', 'tests/local_eval.test.ts', 'tests/fixtures/example.sqlite', 'website/assets/demos/feature.webm']) {
    assert.equal(storageViolation(name, 512 * 1024), null, name);
  }
});
test('blocks oversized files regardless of extension or renamed output folder', () => {
  assert.ok(storageViolation('docs/renamed-output.json', 51 * 1024 * 1024));
});
test('keeps small reports but rejects repeated benchmark archives and restored jobs', () => {
  assert.ok(storageViolation('docs/benchmarks/research/jobs/example.json.gz', 1024));
  assert.ok(storageViolation('docs/benchmarks/research/job-part-00.tar.gz', 2 * 1024 * 1024));
  assert.equal(storageViolation('docs/benchmarks/research/REPORT.md', 1024), null);
  assert.equal(storageViolation('docs/benchmarks/research/archive-index.json', 1024), null);
});
