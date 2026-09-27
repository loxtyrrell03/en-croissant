// Read-only comparison. Writes a compact receipt only when --output is supplied.
// This deliberately inspects the current working source, including uncommitted
// improvements, rather than silently substituting the last Novelty release.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const source = resolve(arg("--source") ?? resolve(target, "../outpost-chess"));
if (source === target) throw new Error("Source and target must differ");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (root, ...command) => execFileSync("git", ["--no-optional-locks", "-C", root, ...command], { encoding: "utf8" }).trim();
const walk = (root, path) => !existsSync(resolve(root, path)) ? [] : readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => {
  const child = `${path}/${entry.name}`;
  return entry.isDirectory() ? walk(root, child) : [child];
});
const inputPaths = [
  ...walk(source, "src/features/tournaments"),
  ...walk(source, "src-tauri/src/tournament"),
  "src-tauri/src/tournament.rs", "src-tauri/src/otb_import.rs", "src-tauri/src/otb_import/index.rs",
  "src-tauri/src/otb_packs.rs", "src-tauri/src/data_pack/otb_library.rs",
  "src/features/home/PlayerGameImportModal.tsx", "src/features/home/otbImportModel.ts",
  "src/features/home/playerImportPersistence.ts", "src/features/home/FidePlayerPicker.tsx",
  "src/features/settings/OtbDownloadControl.tsx", "src/features/settings/otbDownloads.ts",
  "src/features/settings/otbDownloadPresentation.ts", "src/features/settings/otbActivity.ts",
  "src/platform/bridge.ts", "package.json", "pnpm-lock.yaml",
].sort();
const sources = inputPaths.map(path => {
  const data = readFileSync(resolve(source, path));
  return { path, bytes: data.length, sha256: hash(data) };
});
const targets = [
  "src/components/panels/prep/OtbGameImportPanel.tsx", "src/utils/otbGameImport.ts",
  "src/web/PhoneOtbImportPanel.tsx", "src/web/otbImport.ts", "src/web/otbPrep.ts",
  "src/web/otbStartSession.ts", "src/web/WebApp.tsx", "src/web/storage.ts",
  "scripts/home-server.mjs", "scripts/otb-import-service.mjs",
  "src-tauri/src/otb_import.rs", "src-tauri/src/otb_import/index.rs",
  "src-tauri/src/otb_database_save.rs", "src-tauri/src/bin/collect_otb_games.rs",
].map(path => ({ path, exists: existsSync(resolve(target, path)), ...(existsSync(resolve(target, path)) ? { sha256: hash(readFileSync(resolve(target, path))) } : {}) }));
const functions = (root, path) => new Set([...readFileSync(resolve(root, path), "utf8").matchAll(/\b(?:async\s+)?fn\s+(\w+)\s*[<(]/g)].map(m => m[1]));
const nativeComparison = ["src-tauri/src/otb_import.rs", "src-tauri/src/otb_import/index.rs"].map(path => {
  const a = functions(source, path), b = functions(target, path);
  return { path, identical: hash(readFileSync(resolve(source, path))) === hash(readFileSync(resolve(target, path))), sourceOnlyFunctions: [...a].filter(f => !b.has(f)), targetOnlyFunctions: [...b].filter(f => !a.has(f)) };
});
const result = {
  schema: 1, inspectedAt: new Date().toISOString(),
  scope: "Current working source only; no feature integration or deployment certification",
  source: { repository: "outpost-chess (Novelty)", head: git(source, "rev-parse", "HEAD"), statusSha256: hash(git(source, "status", "--porcelain=v1", "--untracked-files=all")), files: sources },
  target: { repository: "en-croissant", head: git(target, "rev-parse", "HEAD"), tournamentFrontendPresent: existsSync(resolve(target, "src/features/tournaments")), tournamentNativePresent: existsSync(resolve(target, "src-tauri/src/tournament.rs")), files: targets },
  nativeComparison,
  requiredPairingPackage: JSON.parse(readFileSync(resolve(source, "package.json"), "utf8")).dependencies["@echecs/swiss"],
};
if (arg("--verify-source")) {
  const previous = JSON.parse(readFileSync(resolve(arg("--verify-source")), "utf8"));
  const changed = sources.filter(entry => previous.source.files.find(old => old.path === entry.path)?.sha256 !== entry.sha256).map(entry => entry.path);
  const missing = previous.source.files.filter(old => !sources.some(entry => entry.path === old.path)).map(entry => entry.path);
  if (changed.length || missing.length || previous.source.head !== result.source.head || previous.source.statusSha256 !== result.source.statusSha256) {
    console.error(JSON.stringify({ changed, missing, headChanged: previous.source.head !== result.source.head, statusChanged: previous.source.statusSha256 !== result.source.statusSha256 }, null, 2));
    process.exitCode = 1;
  } else console.log(`Novelty unchanged: ${sources.length} measured files, HEAD and complete Git status.`);
} else if (arg("--output")) {
  const output = resolve(arg("--output"));
  if (!relative(target, output) || relative(target, output).startsWith("..")) throw new Error("Receipt must be inside En Croissant");
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Recorded ${sources.length} Novelty inputs and ${targets.length} En Croissant inputs in ${relative(target, output)}`);
} else console.log(JSON.stringify(result, null, 2));
