import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopBuildSteps, stockfishBuildArchitecture } from "../build-desktop.mjs";

test("Windows desktop builds stage the matching universal asset before Tauri", () => {
  for (const [arch, asset] of [["x64", "x64"], ["arm64", "arm64"]]) {
    const steps = desktopBuildSteps(process.cwd(), "win32", arch, ["--debug"]);
    assert.equal(steps[0].command, "cargo");
    assert.equal(steps[0].args.at(-1), asset);
    assert.ok(steps[0].args.includes("stage_stockfish19"));
    assert.equal(steps[1].command, process.execPath);
    assert.ok(steps[1].args.includes("--no-bundle"));
    assert.ok(steps[1].args.includes("--config"));
    assert.equal(steps[1].args.at(-1), "--debug");
    assert.ok(steps[1].args.some((arg) => arg.endsWith("tauri.stockfish.conf.json")));
  }
});
test("explicit cross targets select their own asset and keep other platforms' existing build", () => {
  assert.equal(stockfishBuildArchitecture("win32", "x64", ["--target", "aarch64-pc-windows-msvc"]), "arm64");
  assert.equal(stockfishBuildArchitecture("linux", "x64", ["--target=x86_64-pc-windows-msvc"]), "x64");
  assert.equal(stockfishBuildArchitecture("linux", "x64", ["--target=x86_64-pc-windows-gnu"]), "x64");
  const steps = desktopBuildSteps(process.cwd(), "win32", "x64", ["--target", "aarch64-apple-darwin"]);
  assert.equal(steps.length, 1);
  assert.ok(!steps[0].args.includes("--config"));
  assert.equal(desktopBuildSteps(process.cwd(), "linux", "x64", []).length, 1);
  assert.throws(() => stockfishBuildArchitecture("win32", "ia32", []), /No pinned/);
  assert.throws(() => stockfishBuildArchitecture("win32", "x64", ["--target"]), /Missing/);
});
