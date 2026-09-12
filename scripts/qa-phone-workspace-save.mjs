import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(process.env.FIDE_QA_DEPENDENCIES || import.meta.url);
const { chromium } = require("playwright");
const root = process.cwd(),
  output = path.resolve(process.argv[2] || "tmp/phone-workspace-save/renderer");
const baseline = process.argv.includes("--baseline");
await fs.mkdir(output, { recursive: true });
const before = new Map(
  baseline
    ? [
        "src/web/WebApp.tsx",
        "src/web/storage.ts",
        "src/web/otbPrep.ts",
        "src/web/webAppLifecycle.ts",
      ].map((file) => [
        path.resolve(file).replaceAll("\\", "/"),
        execFileSync("git", ["show", "53d82fb6:" + file], { encoding: "utf8" }),
      ])
    : [],
);
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {createEmptyWebState} from '/src/web/storage';import {webStateSession} from '/src/web/webStateSession';
import {parsePgnDatabase} from '/src/web/pgn';import {DEFAULT_WEB_OTB_IMPORT_SOURCES} from '/src/web/otbImport';
const params=new URL(location.href).searchParams;
const fx=window.fx={abortWrites:params.has('abort'),holdWrites:params.has('hold'),failOpen:params.has('openFail'),complete:params.has('otb'),writes:0,commits:0,requestSuccess:0,saved:null,session:webStateSession};
const originalOpen=indexedDB.open.bind(indexedDB);
fx.readSaved=()=>new Promise((resolve,reject)=>{const request=originalOpen('en-croissant-web-companion',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readonly'),read=tx.objectStore('state').get('main');read.onsuccess=()=>resolve(read.result);tx.oncomplete=()=>db.close()};request.onerror=()=>reject(request.error)});
fx.replaceSaved=value=>new Promise((resolve,reject)=>{const request=originalOpen('en-croissant-web-companion',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,'main');tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}});
async function setup(){
 if(!localStorage.getItem('fixture-seeded')){
  localStorage.clear();
  await new Promise((resolve,reject)=>{const request=originalOpen('en-croissant-web-companion',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(params.has('invalid')?{version:1,databases:'damaged-example'}:createEmptyWebState(),'main');tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}});
  localStorage.setItem('fixture-seeded','true');
 }
 fx.saved=await fx.readSaved();
 if(params.has('otb'))localStorage.setItem('encroissant-web-otb-job','fixture-workspace-job');
 indexedDB.open=function(...args){if(fx.failOpen)throw new DOMException('Example browser storage blocked','SecurityError');return originalOpen(...args)};
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,...args){
  const request=put.call(this,value,...args);fx.writes++;
  const saved=structuredClone(value);this.transaction.addEventListener('complete',()=>{fx.commits++;fx.saved=saved});
  request.addEventListener('success',()=>{
   fx.requestSuccess++;
   if(fx.abortWrites){this.transaction.abort();return}
   if(fx.holdWrites){const store=this;const hold=()=>{const read=store.get('main');read.onsuccess=()=>{if(fx.holdWrites)hold()}};hold()}
  });return request;
 };
 const imported=parsePgnDatabase('Example OTB collection.pgn','[White "Example Player"]\\n[Black "Example Opponent"]\\n\\n1. e4 e5 2. Nf3 Nc6 *',1234);
 fx.databaseId=imported.database.id;
 const realFetch=window.fetch;
 window.fetch=async(url,options)=>{
  const p=new URL(String(url),location.href).pathname;
  if(p==='/v1/engine/release')return Response.json({ok:true});
  if(p.startsWith('/api/otb-import/jobs/'))return Response.json({id:'fixture-workspace-job',status:fx.complete?'completed':'running',request:{playerName:'Example Player',fromYear:2000,sources:DEFAULT_WEB_OTB_IMPORT_SOURCES},report:{playerName:'Example Player',cancelled:false,gamesFound:1,duplicatesRemoved:0},games:[],gameCount:1,prepDatabase:fx.complete?imported:null,createdAt:'2026-09-12T12:00:00Z',updatedAt:'2026-09-12T12:01:00Z',completedAt:'2026-09-12T12:01:00Z',error:null});
  if(p.startsWith('/api/'))return Response.json({},{status:404});
  return realFetch(url,options);
 };
 Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>({update:async()=>{}}),addEventListener(){},removeEventListener(){}}});
 const {default:WebApp}=await import('/src/web/WebApp');
 let mount;fx.mount=()=>{mount=createRoot(document.getElementById('root'));flushSync(()=>mount.render(<WebApp/>))};fx.unmount=()=>flushSync(()=>mount.unmount());fx.mount();
}
void setup();
`;
await fs.writeFile(path.join(output, "entry.tsx"), entry);
await fs.writeFile(
  path.join(output, "auth.ts"),
  "export async function loadSharedLichessCredential(){return null} export async function saveSharedLichessCredential(){}\n",
);
const relative = path.relative(root, output).replaceAll("\\", "/");
await fs.writeFile(
  path.join(output, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/${relative}/entry.tsx"></script></body></html>`,
);
await build({
  root,
  configFile: false,
  plugins: [
    {
      name: "workspace-baseline",
      enforce: "pre",
      load: (id) => before.get(id.replaceAll("\\", "/")) ?? null,
    },
    react(),
  ],
  resolve: {
    alias: [
      { find: "@/utils/sharedLichessAuth", replacement: path.join(output, "auth.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  build: {
    outDir: path.join(output, "bundle"),
    emptyOutDir: false,
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
const origin = server.resolvedUrls.local[0].replace(/\/$/, ""),
  url = origin + "/" + relative + "/index.html";
const browser = await chromium.launch({ headless: true }),
  checks = [],
  errors = [],
  external = [];
async function check(name, query, run) {
  const context = await browser.newContext({ viewport: { width: 760, height: 1100 } }),
    page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on("pageerror", (error) => errors.push({ name, error: error.message }));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  try {
    await page.goto(url + query);
    await run(page);
    checks.push({ name, pass: true });
  } catch (error) {
    checks.push({ name, pass: false, error: String(error) });
    await page.screenshot({ path: path.join(output, name + "-failed.png"), fullPage: true });
  } finally {
    await context.close();
  }
}
const imported = (page) => page.getByRole("button", { name: "Import pasted games", exact: true });
async function addPgn(page) {
  await page.locator('button[data-view="import"]').click();
  await page
    .getByLabel("Or paste PGN")
    .fill('[White "Another Example"]\n[Black "Opponent"]\n\n1. d4 d5 *');
  await imported(page).click();
}
try {
  await check("load-retry-preserves-store", "?openFail", async (page) => {
    await page.getByRole("button", { name: "Retry loading", exact: true }).waitFor();
    assert.equal(await page.locator('input[type="file"]').first().isDisabled(), true);
    assert.equal(await page.evaluate(() => window.fx.writes), 0);
    for (const width of [1100, 760, 360])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate(
          (scale) => document.documentElement.style.setProperty("--mantine-scale", String(scale)),
          scale,
        );
        const button = page.getByRole("button", { name: "Retry loading", exact: true });
        const bounds = await button.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        const alert = page.getByRole("alert").filter({ has: button });
        assert.ok(await alert.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        await page.screenshot({
          path: path.join(output, `load-${width}-${scale}.png`),
          fullPage: true,
        });
      }
    await page.setViewportSize({ width: 760, height: 1100 });
    await page.evaluate(() => document.documentElement.style.setProperty("--mantine-scale", "1"));

    await page.evaluate(() => {
      window.fx.failOpen = false;
    });
    await page.getByRole("button", { name: "Retry loading", exact: true }).click();
    await addPgn(page);
    await page.waitForFunction(() => window.fx.saved.databases.length === 1);
  });
  await check("invalid-data-stays-gated", "?invalid", async (page) => {
    await page.getByRole("button", { name: "Retry loading", exact: true }).click();
    await page.getByRole("button", { name: "Retry loading", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fx.readSaved()), {
      version: 1,
      databases: "damaged-example",
    });
    assert.equal(await page.evaluate(() => window.fx.writes), 0);
  });
  await check("abort-after-request-success-retries-latest", "?otb&abort", async (page) => {
    await page.waitForFunction(() => window.fx.requestSuccess > 0);
    assert.equal(await page.evaluate(() => window.fx.commits), 0);
    assert.equal(await page.getByText("OTB games imported", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
    await addPgn(page);
    await page.evaluate(() => {
      window.fx.abortWrites = false;
      window.fx.holdWrites = true;
    });
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await page.waitForFunction(() => window.fx.requestSuccess === 2);
    assert.equal(await page.getByRole("button", { name: "Retry save", exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.fx.commits), 0);
    await page.evaluate(() => {
      window.fx.holdWrites = false;
    });
    await page.waitForFunction(
      () =>
        window.fx.saved.databases.length === 2 &&
        window.fx.saved.completedOtbImports?.["fixture-workspace-job"],
    );
    assert.equal(await page.getByRole("button", { name: "Retry save", exact: true }).count(), 0);
    await page.reload();
    await page.locator('button[data-view="import"]').click();
    await page.getByText("Example OTB collection", { exact: false }).first().waitFor();
    assert.equal(await page.evaluate(() => window.fx.saved.databases.length), 2);
  });
  await check("commit-before-success-and-remount", "?otb&hold", async (page) => {
    await page.waitForFunction(() => window.fx.requestSuccess > 0);
    assert.equal(await page.getByText("OTB games imported", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.fx.saved.completedOtbImports), undefined);
    await page.evaluate(() => {
      window.fx.unmount();
      window.fx.mount();
    });
    assert.equal(await page.evaluate(() => window.fx.writes), 1);
    await page.evaluate(() => {
      window.fx.holdWrites = false;
    });
    await page.waitForFunction(
      () => window.fx.saved.completedOtbImports?.["fixture-workspace-job"],
    );
    assert.equal(
      await page.locator('button[data-view="board"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.evaluate(() => window.fx.writes), 1);
  });
  if (!baseline)
    await check("removal-during-save-keeps-current-view", "?otb&hold", async (page) => {
      await page.waitForFunction(() => window.fx.requestSuccess > 0);
      await page.evaluate(() => {
        const session = window.fx.session;
        session.setState((state) => ({
          ...state,
          databases: [],
          gamesByDatabase: {},
          prepWorkspaces: [],
        }));
        window.fx.holdWrites = false;
      });
      await page.waitForFunction(() => window.fx.commits === 2);
      assert.equal(await page.getByText("OTB games imported", { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.fx.saved.databases.length), 0);
      assert.equal(
        await page.locator('button[data-view="board"]').getAttribute("aria-pressed"),
        "true",
      );
    });
  await check("receipt-prevents-resurrection", "?otb", async (page) => {
    await page.waitForFunction(() => window.fx.saved.databases.length === 1);
    // Reload a saved fixture with that collection/Prep deliberately removed.
    await page.evaluate(async () => {
      const saved = await window.fx.readSaved();
      await window.fx.replaceSaved({
        ...saved,
        databases: [],
        gamesByDatabase: {},
        prepWorkspaces: [],
      });
    });
    await page.reload();
    await page.locator('button[data-view="board"]').waitFor();
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.fx.saved.databases.length), 0);
    assert.equal(await page.evaluate(() => window.fx.writes), 0);
  });
  await check("recovery-layouts", "?abort", async (page) => {
    await addPgn(page);
    await page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
    for (const width of [1100, 760, 360])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate(
          (scale) => document.documentElement.style.setProperty("--mantine-scale", String(scale)),
          scale,
        );
        const button = page.getByRole("button", { name: "Retry save", exact: true });
        await button.scrollIntoViewIfNeeded();
        const bounds = await button.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        const alert = page.getByRole("alert").filter({ has: button });
        const measurement = await alert.evaluate((el) => ({
          width: el.clientWidth,
          scroll: el.scrollWidth,
          text: parseFloat(getComputedStyle(el.querySelector("p")).fontSize),
        }));
        assert.ok(measurement.scroll <= measurement.width + 1);
        assert.ok(measurement.text >= 14 * scale - 0.1);
        await page.screenshot({
          path: path.join(output, `save-${width}-${scale}.png`),
          fullPage: true,
        });
      }
  });
} finally {
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ baseline, checks, errors, external }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
console.log(JSON.stringify({ baseline, checks, errors, external }, null, 2));
if (checks.some((check) => !check.pass) || errors.length || external.length) process.exitCode = 1;
