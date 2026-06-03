import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import * as os from "node:os";

const HIDDEN_REPORT_ARTIFACT_DIRECTORIES = new Set([
  "report-render",
  "report-render-pdf",
  "report-print-pages",
  "source-pgns",
]);

const sourceRoot = resolve(
  process.env.EN_CROISSANT_WEB_FILES_DIR ||
    getCliValue("--source") ||
    join(os.homedir(), "Documents", "EnCroissant"),
);
const outputRoot = resolve(getCliValue("--output") || "public/web-library");
const filesRoot = join(outputRoot, "files");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(filesRoot, { recursive: true });

const files = [];
await collectFiles(sourceRoot);

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceName: basename(sourceRoot),
  files: files.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" })),
};

await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Published ${manifest.files.length} web library files from ${sourceRoot}`);
console.log(`Output: ${outputRoot}`);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && HIDDEN_REPORT_ARTIFACT_DIRECTORIES.has(entry.name.toLowerCase())) {
      continue;
    }

    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolutePath);
      continue;
    }

    if (!entry.isFile()) continue;

    const lowerName = entry.name.toLowerCase();
    const extension = lowerName.endsWith(".pgn") ? "pgn" : lowerName.endsWith(".pdf") ? "pdf" : null;
    if (!extension) continue;

    const relativePath = normalizePath(relative(sourceRoot, absolutePath));
    const outputPath = join(filesRoot, ...relativePath.split("/"));
    const fileStat = await stat(absolutePath);

    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(absolutePath, outputPath);

    files.push({
      type: "file",
      name: entry.name.replace(/\.(pgn|pdf)$/i, ""),
      filename: entry.name,
      extension,
      path: relativePath,
      url: `files/${encodePath(relativePath)}`,
      lastModified: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
    });
  }
}

function getCliValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}
