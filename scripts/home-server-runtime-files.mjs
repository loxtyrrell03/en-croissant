import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Follow static ESM imports and literal worker/helper URLs without executing the server.
// Computed runtime paths must remain explicit roots in start-home-server.ps1.
export async function collectHomeRuntimeFiles(root, entries) {
  const directory = resolve(root);
  const visited = new Set();
  async function visit(file) {
    const absolute = resolve(directory, file);
    const name = relative(directory, absolute);
    if (
      isAbsolute(name) ||
      name === ".." ||
      name.startsWith(`..${sep}`) ||
      resolve(directory, name) !== absolute
    )
      throw new Error(`Runtime dependency escapes its source directory: ${file}`);
    if (visited.has(name)) return;
    if (!(await stat(absolute)).isFile())
      throw new Error(`Runtime dependency is not a file: ${name}`);
    visited.add(name);
    if (!/\.[cm]?js$/.test(name)) return;
    const source = await readFile(absolute, "utf8");
    const imports = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bnew\s+URL\s*\(\s*)["'](\.[^"']+)["']/g;
    for (const match of source.matchAll(imports))
      await visit(relative(directory, resolve(dirname(absolute), match[1])));
  }
  for (const entry of entries) await visit(entry);
  return [...visited].sort();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = process.argv[2] ?? dirname(fileURLToPath(import.meta.url));
  const files = await collectHomeRuntimeFiles(root, process.argv.slice(3));
  process.stdout.write(files.join("\n"));
}
