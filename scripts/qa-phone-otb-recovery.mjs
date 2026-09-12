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
  output = path.resolve(process.argv[2] || "tmp/phone-otb-recovery/renderer"),
  baseline = process.argv.includes("--baseline");
await fs.mkdir(output, { recursive: true });
const before = new Map(
  baseline
    ? ["src/web/PhoneOtbImportPanel.tsx", "src/web/otbStartSession.ts", "src/web/otbImport.ts"].map(
        (file) => [
          path.resolve(file).replaceAll("\\", "/"),
          execFileSync("git", ["show", "8e7ad15f:" + file], { encoding: "utf8" }),
        ],
      )
    : [],
);
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {MantineProvider} from '@mantine/core';import '@mantine/core/styles.css';import Phone from '/src/web/PhoneOtbImportPanel';
import * as session from '/src/web/otbStartSession';import {getWebServerUrl} from '/src/web/serverUrl';import {DEFAULT_WEB_OTB_IMPORT_SOURCES} from '/src/web/otbImport';
const params=new URL(location.href).searchParams,key='encroissant-web-otb-start',legacy='encroissant-web-otb-job';
const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
const id='otb-00000000-0000-4000-8000-000000000001',endpoint=new URL(getWebServerUrl('api/otb-import/jobs'),location.href).href;
const request={playerName:'Example Player',fideId:'1503014',fromYear:2024,sources:DEFAULT_WEB_OTB_IMPORT_SOURCES};
const record={version:1,id,server:endpoint,request,accepted:true};
if(!params.has('resume')){
 localStorage.clear();set.call(localStorage,legacy,id);
 const kind=params.get('kind');
 if(kind==='invalid')set.call(localStorage,key,'{broken example record');
 else if(kind==='foreign')set.call(localStorage,key,JSON.stringify({...record,server:'https://another-pc.example/api/otb-import/jobs'}));
 else if(kind==='legacy-invalid')set.call(localStorage,legacy,'bad example ID?');
 else if(kind!=='legacy')set.call(localStorage,key,JSON.stringify(record));
}
const fx=window.fx={session,key,legacy,id,record,request,calls:[],mode:'missing',failSetAside:false,failUndo:false,readFail:false,hold:false,pending:[],
 raw:()=>({startRaw:get.call(localStorage,key),legacyRaw:get.call(localStorage,legacy)}),
 stored:()=>JSON.parse(get.call(localStorage,key)||'null'),
 release(){fx.hold=false;for(const resolve of fx.pending.splice(0))resolve()},
 change(){set.call(localStorage,key,JSON.stringify({...record,id:id.slice(0,-2)+'99',request:{...request,playerName:'Newer Example'}}))},
};
Storage.prototype.getItem=function(k){if(fx.readFail&&(k===key||k===legacy))throw Error('Example storage read blocked');return get.call(this,k)};
Storage.prototype.setItem=function(k,v){if(k===key&&fx.failSetAside&&JSON.parse(v).state==='idle')throw Error('Example browser storage is full');return set.call(this,k,v)};
Storage.prototype.removeItem=function(k){if(k===key&&fx.failUndo)throw Error('Example restore blocked');return remove.call(this,k)};
const realFetch=window.fetch;
window.fetch=async(url,options={})=>{
 const p=new URL(String(url),location.href).pathname;
 if(p==='/api/otb-import/players')return Response.json({players:[{id:1503014,name:'Example Player',year:1998}]});
 if(!p.startsWith('/api/otb-import/jobs'))return realFetch(url,options);
 const jobId=p.split('/').at(-1);fx.calls.push({method:options.method||'GET',id:jobId});
 if(fx.hold)await new Promise(resolve=>fx.pending.push(resolve));
 if(options.method==='PUT')return Response.json({id:jobId,status:'running',request:JSON.parse(options.body),gameCount:0,artifactAvailable:false});
 if(jobId!==id)return Response.json({id:jobId,status:'running',request:{...request,playerName:'Newer Example'},gameCount:0,artifactAvailable:false});
 if(fx.mode==='found')return Response.json({id,status:'running',request,gameCount:0,artifactAvailable:false});
 if(fx.mode==='proxy')return Response.json({error:'Example proxy route unavailable'},{status:404});
 return Response.json({error:'OTB import job not found.'},{status:404});
};
function App(){const[visible,setVisible]=useState(true),[scale,setScale]=useState(1);Object.assign(fx,{setVisible:value=>flushSync(()=>setVisible(value)),setScale:value=>flushSync(()=>setScale(value))});
return <MantineProvider forceColorScheme='dark' theme={{scale}}><main style={{maxWidth:760,margin:'0 auto',padding:16}}><p>Invented player · isolated PC search recovery</p>{visible&&<Phone onAnalyzeGame={async()=>{}}/>}</main></MantineProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`;
await fs.writeFile(path.join(output, "entry.tsx"), entry);
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
      name: "recovery-baseline",
      enforce: "pre",
      load: (id) => before.get(id.replaceAll("\\", "/")) ?? null,
    },
    react(),
  ],
  resolve: { alias: { "@": path.resolve("src") } },
  define: { "import.meta.env.VITE_EN_CROISSANT_SERVER_URL": JSON.stringify("") },
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
  const context = await browser.newContext({
      viewport: { width: 760, height: 1150 },
      acceptDownloads: true,
    }),
    page = await context.newPage();
  page.setDefaultTimeout(6000);
  context.on("page", (p) =>
    p.on("pageerror", (error) => errors.push({ name, error: error.message })),
  );
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
    await run(page, context);
    checks.push({ name, pass: true });
  } catch (error) {
    checks.push({ name, pass: false, error: String(error) });
    await page.screenshot({ path: path.join(output, name + "-failed.png"), fullPage: true });
  } finally {
    await context.close();
  }
}
const aside = (page) => page.getByRole("button", { name: "Set aside search", exact: true }),
  confirm = (page) => page.getByRole("button", { name: "Keep details and continue", exact: true });
const search = (page) => page.getByRole("button", { name: "Search OTB games on PC", exact: true });
async function setAside(page) {
  await aside(page).click();
  await confirm(page).click();
  await page.getByRole("button", { name: "Undo set aside", exact: true }).waitFor();
}
try {
  await check("missing-read-retry-and-remount", "", async (page) => {
    await page.waitForFunction(() => window.fx.calls.length > 0);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.fx.calls.length), 1);
    await aside(page).waitFor();
    assert.equal(await search(page).isDisabled(), true);
    await page.evaluate(() => {
      window.fx.setVisible(false);
      window.fx.setVisible(true);
    });
    await aside(page).waitFor();
    assert.equal(await page.evaluate(() => window.fx.calls.length), 1);
    await page.evaluate(() => {
      window.fx.mode = "found";
    });
    await page.getByRole("button", { name: "Retry loading", exact: true }).click();
    await page.getByRole("button", { name: "Stop search", exact: true }).waitFor();
    assert.equal(await aside(page).count(), 0);
  });
  await check("review-copy-undo-and-new-search", "", async (page) => {
    await aside(page).waitFor();
    const original = await page.evaluate(() => window.fx.raw());
    await aside(page).click();
    await page.getByRole("button", { name: "Back", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Back", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await aside(page).evaluate((el) => el === document.activeElement), true);
    assert.deepEqual(await page.evaluate(() => window.fx.raw()), original);
    await setAside(page);
    assert.equal(await search(page).isEnabled(), true);
    assert.equal(
      await page.getByText("The PC could not find this saved search.", { exact: true }).count(),
      0,
    );
    const kept = await page.evaluate(() => window.fx.stored().previousSearches[0]);
    assert.equal(kept.startRaw, original.startRaw);
    assert.equal(kept.legacyRaw, original.legacyRaw);
    await page.getByText("Kept search details (1)", { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download details", exact: true }).click();
    const download = await downloadPromise;
    assert.deepEqual(JSON.parse(await fs.readFile(await download.path(), "utf8")), kept);
    await page.getByRole("button", { name: "Undo set aside", exact: true }).click();
    await aside(page).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fx.raw()), original);
    await setAside(page);
    await search(page).click();
    await page.getByRole("button", { name: "Stop search", exact: true }).waitFor();
    const saved = await page.evaluate(() => window.fx.stored());
    assert.equal(saved.previousSearches[0].startRaw, original.startRaw);
    assert.equal(
      await page.evaluate(() => window.fx.calls.filter((call) => call.method === "PUT").length),
      1,
    );
    assert.equal(
      await page.getByRole("button", { name: "Undo set aside", exact: true }).count(),
      0,
    );
  });
  for (const kind of ["invalid", "foreign", "legacy-invalid"])
    await check("record-" + kind, "?kind=" + kind, async (page) => {
      await aside(page).waitFor();
      const original = await page.evaluate(() => window.fx.raw());
      await setAside(page);
      assert.equal(await page.evaluate(() => window.fx.calls.length), 0);
      const saved = await page.evaluate(() => window.fx.stored());
      assert.equal(saved.previousSearches[0].startRaw, original.startRaw);
      assert.equal(saved.previousSearches[0].legacyRaw, original.legacyRaw);
      await page.goto(url + "?resume");
      await page.getByRole("button", { name: "Undo set aside", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.fx.calls.length), 0);
    });
  await check("pending-recovery-survives-navigation", "", async (page) => {
    await aside(page).click();
    await page.evaluate(() => {
      window.fx.hold = true;
    });
    await confirm(page).click();
    await page.waitForFunction(() => window.fx.pending.length === 1);
    await page.evaluate(() => {
      window.fx.setVisible(false);
      window.fx.release();
    });
    await page.waitForFunction(() => window.fx.stored().state === "idle");
    await page.evaluate(() => window.fx.setVisible(true));
    await page.getByRole("button", { name: "Undo set aside", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fx.stored().previousSearches.length), 1);
    assert.ok((await page.evaluate(() => window.fx.calls)).every((call) => call.method === "GET"));
  });
  await check("save-failure-and-retry", "", async (page) => {
    await aside(page).waitFor();
    const original = await page.evaluate(() => window.fx.raw());
    await page.evaluate(() => {
      window.fx.failSetAside = true;
    });
    await aside(page).click();
    await confirm(page).click();
    await page.getByText("Example browser storage is full", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fx.raw()), original);
    assert.equal(
      await page.getByRole("button", { name: "Retry connection", exact: true }).count(),
      0,
    );
    await page.evaluate(() => {
      window.fx.failSetAside = false;
    });
    await confirm(page).click();
    await page.getByRole("button", { name: "Undo set aside", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fx.stored().previousSearches.length), 1);
  });
  await check("reappearing-job-retained", "", async (page) => {
    await aside(page).waitFor();
    const original = await page.evaluate(() => window.fx.raw());
    await aside(page).click();
    await page.evaluate(() => {
      window.fx.mode = "found";
    });
    await confirm(page).click();
    await page.getByRole("button", { name: "Stop search", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fx.raw()), original);
    assert.equal(await confirm(page).count(), 0);
  });
  await check("other-tab-selection-retained", "", async (page, context) => {
    await aside(page).click();
    await page.evaluate(() => {
      window.fx.hold = true;
    });
    await confirm(page).click();
    await page.waitForFunction(() => window.fx.pending.length === 1);
    const other = await context.newPage();
    await other.goto(url + "?resume");
    await other.evaluate(() => window.fx.change());
    await page.evaluate(() => window.fx.release());
    await page.getByRole("button", { name: "Stop search", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Player full name").inputValue(), "Newer Example");
    assert.match(await page.evaluate(() => window.fx.stored().id), /99$/);
    assert.equal(await page.evaluate(() => window.fx.stored().previousSearches?.length || 0), 0);
  });
  await check("review-layouts", "?kind=invalid", async (page) => {
    await aside(page).click();
    for (const width of [1100, 760, 360])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 1400 });
        await page.evaluate((scale) => window.fx.setScale(scale), scale);
        await confirm(page).scrollIntoViewIfNeeded();
        const box = await confirm(page).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        assert.ok(await confirm(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        await page.screenshot({
          path: path.join(output, `review-${width}-${scale}.png`),
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
