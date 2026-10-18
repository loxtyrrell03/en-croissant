import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

// Isolated invented collections: never connects to the owner's phone service or databases.
const { chromium, webkit } = createRequire(process.env.FIDE_QA_DEPENDENCIES || import.meta.url)(
  "playwright",
);
const root = process.cwd();
const output = path.resolve("tmp/phone-database-search");
await fs.mkdir(output, { recursive: true });
await fs.writeFile(
  path.join(output, "entry.tsx"),
  `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{MantineProvider}from'@mantine/core';import'@mantine/core/styles.css';
import DatabaseFolderSelect from '/src/components/common/DatabaseFolderSelect';
function App(){const[value,setValue]=useState(null);return <MantineProvider><div style={{padding:8}}>
<DatabaseFolderSelect size="xs" label="Prep source" value={value} onChange={setValue} data={[
{group:'Desktop',items:Array.from({length:30},(_,i)=>({value:'example-'+i,label:'Alex Example '+i+' - OTB prep'}))},
{group:'Library',items:[{value:'other',label:'Other Example - as Black'}]}]}/>
<output aria-label="Selected database">{value}</output></div></MantineProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`,
);
const relative = path.relative(root, output).replaceAll("\\", "/");
await fs.writeFile(
  path.join(output, "index.html"),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/${relative}/entry.tsx"></script></body></html>`,
);
await build({
  root,
  configFile: false,
  plugins: [react()],
  resolve: { alias: { "@": path.resolve("src") } },
  build: {
    outDir: path.join(output, "bundle"),
    copyPublicDir: false,
    rollupOptions: { input: path.join(output, "index.html") },
  },
  logLevel: "warn",
});
const server = await preview({
  root,
  configFile: false,
  build: { outDir: path.join(output, "bundle") },
  preview: { host: "127.0.0.1", port: 0 },
});
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const checks = [],
  errors = [];
try {
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const width of [320, 390]) {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          hasTouch: true,
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push({ engine, width, error: error.message }));
        await context.route("**/*", (route) =>
          new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
        );
        await page.goto(origin + "/" + relative + "/index.html");
        await page.getByRole("button", { name: "Select database" }).click();
        const search = page.getByRole("textbox", { name: "Search databases" });
        await search.tap();
        assert.equal(await search.evaluate((el) => getComputedStyle(el).fontSize), "16px");
        await search.fill("Alex");
        await page.setViewportSize({ width, height: 320 });
        await page.waitForFunction(() => window.visualViewport.height <= 320);
        assert.equal(await search.evaluate((el) => document.activeElement === el), true);
        await page
          .getByRole("button", { name: "Alex Example 29 - OTB prep Desktop", exact: true })
          .scrollIntoViewIfNeeded();
        // Mantine's attribute is version dependent; the search parent contains the scroll area.
        const bounds = await search.evaluate((el) => {
          const rect = el.closest('[role="dialog"]').getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
        });
        assert.ok(bounds.x >= -1 && bounds.right <= width + 1, JSON.stringify(bounds));
        assert.ok(bounds.y >= -1 && bounds.bottom <= 321, JSON.stringify(bounds));
        await page.screenshot({ path: path.join(output, `${engine}-${width}-keyboard.png`) });
        await page
          .getByRole("button", { name: "Alex Example 29 - OTB prep Desktop", exact: true })
          .tap();
        await page.getByRole("textbox", { name: "Search databases" }).waitFor({ state: "hidden" });
        assert.equal(await page.getByLabel("Selected database").textContent(), "example-29");
        checks.push({ engine, width, keyboardViewportHeight: 320, pass: true, bounds });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(
    path.join(output, "receipt.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await server.httpServer.close();
}
console.log(JSON.stringify({ checks, errors }, null, 2));
