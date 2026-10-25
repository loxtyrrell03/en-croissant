import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export function stockfishBuildArchitecture(platform, architecture, args) {
  const index = args.indexOf("--target");
  const target = args.find((arg) => arg.startsWith("--target="))?.slice(9) ??
    (index >= 0 ? args[index + 1] : undefined);
  const explicit = args.includes("--target") || args.some((arg) => arg.startsWith("--target="));
  if (explicit) {
    if (!target || target.startsWith("--")) throw new Error("Missing desktop target.");
    if (!target.includes("-windows-")) return null;
    if (target.startsWith("aarch64-")) return "arm64";
    if (target.startsWith("x86_64-")) return "x64";
    throw new Error(`No pinned Stockfish asset for ${target}.`);
  }
  if (platform !== "win32") return null;
  if (architecture === "x64") return "x64";
  if (architecture === "arm64") return "arm64";
  throw new Error(`No pinned Stockfish asset for ${architecture}.`);
}

export function desktopBuildSteps(root, platform, architecture, args) {
  const asset = stockfishBuildArchitecture(platform, architecture, args);
  const stageRoot = resolve(root, "src-tauri/target/bundled-engines");
  return [
    ...(asset ? [{
      command: "cargo",
      args: ["run", "--manifest-path", join(root, "src-tauri/Cargo.toml"), "--bin", "stage_stockfish19", "-j", "2", "--",
        "--stage-root", stageRoot, "--arch", asset],
    }] : []),
    {
      command: process.execPath,
      args: [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "build", "--no-bundle",
        ...(asset ? ["--config", join(stageRoot, "tauri.stockfish.conf.json")] : []), ...args],
    },
  ];
}

async function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  for (const step of desktopBuildSteps(root, process.platform, process.arch, process.argv.slice(2))) {
    await new Promise((done, reject) => {
      const child = spawn(step.command, step.args, { cwd: root, windowsHide: true, stdio: "inherit",
        env: { ...process.env, VITE_EN_CROISSANT_HOME_BUILD: "0" } });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? done() : reject(new Error(`Desktop build step failed (${code}).`)));
    });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
