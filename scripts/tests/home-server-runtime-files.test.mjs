import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { collectHomeRuntimeFiles } from "../home-server-runtime-files.mjs";

test("installed home runtime includes the complete real dependency graph", async () => {
  const files = await collectHomeRuntimeFiles(fileURLToPath(new URL("..", import.meta.url)), [
    "home-server.mjs",
  ]);
  assert.ok(files.includes("lichess-explorer-lane.mjs"));
  assert.ok(files.includes("otb-prep-worker.mjs"));
  assert.ok(files.some((f) => f.replaceAll("\\", "/") === "generated/otb-prep-database.js"));
  assert.ok(files.includes("terminate-collector-process-tree.ps1"));
});
test("discovers nested and dynamic literal imports and fails before staging absent files", async () => {
  const root = await mkdtemp(join(tmpdir(), "phone-runtime-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "main.mjs"), `import './nested/a.mjs'; import('./dynamic.mjs');`);
    await writeFile(
      join(root, "nested/a.mjs"),
      `import fs from 'node:fs'; export {default} from '../dynamic.mjs';`,
    );
    await writeFile(join(root, "dynamic.mjs"), `export default 1;`);
    const files = await collectHomeRuntimeFiles(root, ["main.mjs"]);
    assert.equal(files.length, 3);
    await rm(join(root, "dynamic.mjs"));
    await assert.rejects(() => collectHomeRuntimeFiles(root, ["main.mjs"]), /ENOENT/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "phone-runtime-"));
    await rm(root, { recursive: true, force: true });
  }
});
