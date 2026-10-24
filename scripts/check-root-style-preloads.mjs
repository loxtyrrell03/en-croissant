import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSync } from "@babel/core";

/** Inspect emitted imports, rather than the source spelling or asset presence. */
export function checkRootStylePreloads(code, expectedStyles) {
  const ast = parseSync(code, {
    configFile: false,
    babelrc: false,
    parserOpts: { createImportExpressions: true },
  });
  let dependencyTable;
  const imports = [];
  function visit(node, ancestors = []) {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "AssignmentExpression" &&
      node.left.type === "MemberExpression" &&
      node.left.object.name === "m" &&
      node.left.property.name === "f" &&
      node.right.type === "ArrayExpression" &&
      node.right.elements.every((item) => item?.type === "StringLiteral")
    ) {
      dependencyTable = node.right.elements.map((item) => item.value);
    }
    if (node.type === "ImportExpression" && node.source.type === "StringLiteral") {
      for (const root of Object.keys(expectedStyles)) {
        if (!new RegExp(`(?:^|/)${root}-[^/]+\\.js$`).test(node.source.value)) continue;
        const preload = [...ancestors]
          .reverse()
          .find(
            (parent) =>
              parent.type === "CallExpression" &&
              parent.arguments.some(
                (argument) =>
                  argument.type === "CallExpression" && argument.callee.name === "__vite__mapDeps",
              ),
          );
        const map = preload?.arguments.find(
          (argument) =>
            argument.type === "CallExpression" && argument.callee.name === "__vite__mapDeps",
        );
        assert.equal(map?.arguments[0]?.type, "ArrayExpression", `${root} has no CSS preload list`);
        imports.push({ root, indices: map.arguments[0].elements.map((item) => item.value) });
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments"].includes(key)) continue;
      if (Array.isArray(child)) child.forEach((item) => visit(item, [...ancestors, node]));
      else if (child && typeof child === "object") visit(child, [...ancestors, node]);
    }
  }
  visit(ast);
  assert.ok(dependencyTable, "Vite preload dependency table is missing");
  return Object.entries(expectedStyles).map(([root, styles]) => {
    const matches = imports.filter((item) => item.root === root);
    assert.ok(matches.length, `${root} import is missing`);
    assert.ok(styles.length, `${root} stylesheet is missing from the bundle`);
    for (const item of matches) {
      const dependencies = item.indices.map((index) => dependencyTable[index]);
      for (const style of styles) {
        assert.ok(dependencies.includes(style), `${root} does not preload ${style}`);
      }
    }
    return { root, styles, imports: matches.length };
  });
}

export function rootStylePreloadGuard() {
  return {
    name: "root-style-preload-guard",
    apply: "build",
    writeBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (item) =>
          item.type === "chunk" &&
          item.isEntry &&
          (item.facadeModuleId?.endsWith("/index.html") ||
            Object.keys(item.modules || {}).some((id) => /[/\\]src[/\\]index\.tsx$/.test(id))),
      );
      assert.ok(entry, "Application entry is missing from the bundle");
      const names = Object.keys(bundle);
      checkRootStylePreloads(
        entry.code,
        Object.fromEntries(
          ["App", "WebApp"].map((root) => [
            root,
            names.filter((name) => new RegExp(`(?:^|/)${root}-[^/]+\\.css$`).test(name)),
          ]),
        ),
      );
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dist = resolve(process.argv[2] || "dist");
  const html = await readFile(join(dist, "index.html"), "utf8");
  const entry = html.match(/src="\/?(assets\/index-[^"]+\.js)"/)?.[1];
  assert.ok(entry, "Built entry script is missing");
  const names = await readdir(join(dist, "assets"));
  const report = checkRootStylePreloads(
    await readFile(join(dist, entry), "utf8"),
    Object.fromEntries(
      ["App", "WebApp"].map((root) => [
        root,
        names
          .filter((name) => new RegExp(`^${root}-.*\\.css$`).test(name))
          .map((name) => `assets/${name}`),
      ]),
    ),
  );
  console.log(JSON.stringify({ entry, roots: report }, null, 2));
}
