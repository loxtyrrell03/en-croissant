import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import * as os from "node:os";

// Fast selective publish for the phone web app: copies specific PGN/PDF files
// from the local files root straight into the GitHub Pages checkout's
// web-library, upserts manifest.json, commits, and pushes. No Vite build, no
// full library regeneration, no database exports. Use `npm run web:publish`
// for code changes or full library rebuilds.
//
// Usage:
//   npm run web:push -- <pattern> [pattern...] [--dry-run] [--no-push] [--message "msg"]
//   npm run web:push -- --changed [--dry-run]
//
// Patterns match hosted-relative paths and filenames case-insensitively.
// `*` and `?` wildcards are supported; a pattern without wildcards matches as
// a substring. `--changed` selects every source file that is new or newer
// than the copy recorded in the live site manifest.

const HIDDEN_REPORT_ARTIFACT_DIRECTORIES = new Set([
  "report-render",
  "report-render-pdf",
  "report-print-pages",
  "source-pgns",
]);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const patterns = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--message") {
    i += 1;
    continue;
  }
  if (!args[i].startsWith("--")) patterns.push(args[i]);
}
const dryRun = flags.has("--dry-run");
const noPush = flags.has("--no-push");
const useChanged = flags.has("--changed");
const commitMessage = getCliValue("--message");

if (patterns.length === 0 && !useChanged) {
  console.log("Nothing selected. Pass one or more patterns, or --changed.");
  console.log('Examples: npm run web:push -- "Sameera*"');
  console.log("          npm run web:push -- --changed --dry-run");
  process.exit(1);
}

const sourceRoot = resolve(
  process.env.EN_CROISSANT_WEB_FILES_DIR || join(os.homedir(), "Documents", "EnCroissant"),
);
const localAppData = process.env.LOCALAPPDATA || join(os.homedir(), "AppData", "Local");
const pagesRepo = resolve(
  process.env.EN_CROISSANT_PAGES_REPO ||
    join(localAppData, "EnCroissantWebSync", "loxtyrrell03.github.io"),
);
const repoRoot = resolve(".");
const publicLibraryRoot = join(repoRoot, "public", "web-library");
const pagesLibraryRoot = join(pagesRepo, "web-library");

assertPagesRepo(pagesRepo);
runGit(["pull", "--ff-only", "origin", "main"]);

const manifestPath = join(pagesLibraryRoot, "manifest.json");
const manifest = await readJsonFile(manifestPath);
if (!manifest || !Array.isArray(manifest.files)) {
  console.error(`No hosted manifest at ${manifestPath}.`);
  console.error("Run a full `npm run web:publish` once before using web:push.");
  process.exit(1);
}

const manifestByPath = new Map(manifest.files.map((file) => [file.path, file]));
const sourceFiles = [];
await collectSourceFiles(sourceRoot);

const matchers = patterns.map(patternToMatcher);
const selected = sourceFiles.filter((file) => {
  if (useChanged) {
    const existing = manifestByPath.get(file.path);
    const changed =
      !existing ||
      Number(existing.lastModified) !== file.lastModified ||
      Number(existing.sizeBytes) !== file.sizeBytes;
    if (!changed) return false;
    return matchers.length === 0 || matchers.some((m) => m(file));
  }
  return matchers.some((m) => m(file));
});

if (selected.length === 0) {
  console.log(
    useChanged && matchers.length === 0
      ? "No source files differ from the hosted manifest."
      : "No PGN/PDF files under the source root match. Nothing pushed.",
  );
  console.log(`Source root: ${sourceRoot}`);
  process.exit(0);
}

console.log(`${dryRun ? "Would push" : "Pushing"} ${selected.length} file(s):`);
for (const file of selected) {
  const existing = manifestByPath.get(file.path);
  const status = !existing
    ? "new"
    : Number(existing.lastModified) !== file.lastModified ||
        Number(existing.sizeBytes) !== file.sizeBytes
      ? "update"
      : "same content stamp";
  console.log(`  [${status}] ${file.path} (${formatKb(file.sizeBytes)})`);
}

if (dryRun) {
  console.log("Dry run - no files copied, no commit.");
  process.exit(0);
}

const touchedPagesPaths = ["web-library/manifest.json"];
for (const file of selected) {
  const relativeSegments = file.path.split("/");
  const pagesTarget = join(pagesLibraryRoot, "files", ...relativeSegments);
  await mkdir(dirname(pagesTarget), { recursive: true });
  await copyFile(file.absolutePath, pagesTarget);
  touchedPagesPaths.push(`web-library/files/${file.path}`);

  // Keep the local public copy in sync so the next full publish and local dev
  // don't regress the pushed content.
  if (existsSync(join(publicLibraryRoot, "manifest.json"))) {
    const publicTarget = join(publicLibraryRoot, "files", ...relativeSegments);
    await mkdir(dirname(publicTarget), { recursive: true });
    await copyFile(file.absolutePath, publicTarget);
  }

  manifestByPath.set(file.path, {
    type: "file",
    name: file.filename.replace(/\.(pgn|pdf)$/i, ""),
    filename: file.filename,
    extension: file.extension,
    path: file.path,
    url: `files/${encodePath(file.path)}`,
    lastModified: file.lastModified,
    sizeBytes: file.sizeBytes,
  });
}

manifest.files = [...manifestByPath.values()].sort((a, b) =>
  a.path.localeCompare(b.path, undefined, { sensitivity: "base" }),
);
manifest.generatedAt = new Date().toISOString();
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(manifestPath, manifestJson);
if (existsSync(join(publicLibraryRoot, "manifest.json"))) {
  await writeFile(join(publicLibraryRoot, "manifest.json"), manifestJson);
}

runGit(["add", "--", ...touchedPagesPaths]);
const staged = spawnSync("git", ["-C", pagesRepo, "diff", "--cached", "--quiet"]);
if (staged.status === 0) {
  console.log("Hosted copies already match - nothing to commit.");
  process.exit(0);
}

const message =
  commitMessage ||
  `Push web files: ${selected.length === 1 ? selected[0].path : `${selected.length} files`}`;
runGit(["commit", "-m", message]);

if (noPush) {
  console.log("Committed without push (--no-push).");
  process.exit(0);
}

runGit(["push", "origin", "main"]);
console.log(`Pushed ${selected.length} file(s) to the phone site.`);
console.log("The phone picks up the new manifest on its next app load.");

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (HIDDEN_REPORT_ARTIFACT_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      await collectSourceFiles(absolutePath);
      continue;
    }
    if (!entry.isFile()) continue;

    const lowerName = entry.name.toLowerCase();
    const extension = lowerName.endsWith(".pgn") ? "pgn" : lowerName.endsWith(".pdf") ? "pdf" : null;
    if (!extension) continue;

    const fileStat = await stat(absolutePath);
    sourceFiles.push({
      absolutePath,
      filename: entry.name,
      extension,
      path: relative(sourceRoot, absolutePath).split(sep).join("/"),
      lastModified: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
    });
  }
}

function patternToMatcher(pattern) {
  const lower = pattern.toLowerCase();
  if (!/[*?]/.test(lower)) {
    return (file) =>
      file.path.toLowerCase().includes(lower) || file.filename.toLowerCase().includes(lower);
  }
  const regex = new RegExp(
    `^${lower.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
  );
  return (file) => regex.test(file.path.toLowerCase()) || regex.test(file.filename.toLowerCase());
}

function assertPagesRepo(path) {
  if (!existsSync(join(path, ".git"))) {
    console.error(`Pages repository is not a git checkout: ${path}`);
    console.error("Run `npm run web:publish` once to clone it.");
    process.exit(1);
  }
  const remote = spawnSync("git", ["-C", path, "remote", "get-url", "origin"], {
    encoding: "utf8",
  });
  if (remote.status !== 0 || !/loxtyrrell03\.github\.io/.test(remote.stdout)) {
    console.error(`Refusing to deploy to unexpected git remote: ${remote.stdout?.trim()}`);
    process.exit(1);
  }
}

function runGit(gitArgs) {
  const result = spawnSync("git", ["-C", pagesRepo, ...gitArgs], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`git ${gitArgs[0]} failed with code ${result.status}`);
    process.exit(1);
  }
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function formatKb(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getCliValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
