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
  output = path.resolve(process.argv[2] || "tmp/phone-otb-start/renderer");
const baseline = process.argv.includes("--baseline");
await fs.mkdir(output, { recursive: true });
const before = new Map(
  baseline
    ? [
        "src/web/PhoneOtbImportPanel.tsx",
        "src/web/otbImport.ts",
        "src/web/OnlineGameAnalysisPanel.module.css",
      ].map((file) => [
        path.resolve(file).replaceAll("\\", "/"),
        execFileSync("git", ["show", "e758f643:" + file], { encoding: "utf8" }),
      ])
    : [],
);
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {MantineProvider} from '@mantine/core';import '@mantine/core/styles.css';import Phone from '/src/web/PhoneOtbImportPanel';
const params=new URL(location.href).searchParams,key='encroissant-web-otb-start',legacy='encroissant-web-otb-job';
const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
if(!params.has('resume')){localStorage.clear();set.call(localStorage,'encroissant-web-otb-player','Example Player');}
const f=window.fx={calls:[],pending:[],mode:params.get('mode')||'normal',failRead:params.has('readFail'),failWrite:params.has('writeFail'),failAck:params.has('ackFail'),
 record:()=>JSON.parse(get.call(localStorage,key)||'null'),jobs:()=>JSON.parse(get.call(localStorage,'fixture-jobs')||'{}'),
 release(){f.mode='normal';for(const resolve of f.pending.splice(0))resolve()},
};
Storage.prototype.getItem=function(k){if(f.failRead&&(k===key||k===legacy||k==='encroissant-web-otb-player'))throw Error('Example blocked storage');return get.call(this,k)};
Storage.prototype.setItem=function(k,v){if(k===key&&(f.failWrite||(f.failAck&&JSON.parse(v).accepted)))throw Error('Example full storage');return set.call(this,k,v)};
const realFetch=window.fetch;
window.fetch=async(url,options={})=>{
 const p=new URL(String(url),location.href).pathname;
 if(p==='/api/otb-import/players')return new Response(JSON.stringify({players:[{id:1503014,name:'Example Player',year:1998}]}));
 if(!p.startsWith('/api/otb-import/jobs'))return realFetch(url,options);
 const jobs=f.jobs();let id=p.split('/').at(-1);
 if(options.method==='PUT'||options.method==='POST'){
  const request=JSON.parse(options.body);if(options.method==='POST')id='legacy-'+Object.keys(jobs).length;
  f.calls.push({method:options.method,id,request,stored:f.record()});
  if(f.mode==='old')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405});
  jobs[id]??={id,status:'running',request,gameCount:0,artifactAvailable:false,progress:null,error:null};set.call(localStorage,'fixture-jobs',JSON.stringify(jobs));
  if(f.mode==='hold')await new Promise(resolve=>f.pending.push(resolve));
  if(f.mode==='lost'){f.mode='normal';throw Error('Example start reply was lost');}
  return new Response(JSON.stringify(jobs[id]));
 }
 if(options.method==='DELETE'&&jobs[id]){jobs[id].status='failed';jobs[id].error='Search stopped.';set.call(localStorage,'fixture-jobs',JSON.stringify(jobs));}
 return new Response(JSON.stringify(jobs[id]||{error:'Example job not found'}),{status:jobs[id]?200:404});
};
function App(){const[visible,setVisible]=useState(true),[scale,setScale]=useState(1);Object.assign(f,{setVisible:v=>flushSync(()=>setVisible(v)),setScale:v=>flushSync(()=>setScale(v))});
return <MantineProvider forceColorScheme='dark' theme={{scale}}><main style={{maxWidth:760,margin:'0 auto',padding:16}}><p>Invented player · isolated PC start recovery</p>{visible&&<Phone onAnalyzeGame={async()=>{}}/>}</main></MantineProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`;
await fs.writeFile(path.join(output, "entry.tsx"), entry);
await fs.writeFile(
  path.join(output, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/' +
    path.relative(root, path.join(output, "entry.tsx")).replaceAll("\\", "/") +
    '"></script></body></html>',
);
await build({
  root,
  configFile: false,
  plugins: [
    {
      name: "phone-start-baseline",
      enforce: "pre",
      load: (id) => before.get(id.replaceAll("\\", "/")) ?? null,
    },
    react(),
  ],
  resolve: { alias: { "@": path.resolve("src") } },
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
  preview: { port: 0, host: "127.0.0.1" },
});
const origin = server.resolvedUrls.local[0].replace(/\/$/, ""),
  url = origin + "/" + path.relative(root, path.join(output, "index.html")).replaceAll("\\", "/");
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({ viewport: { width: 760, height: 1050 } }),
  page = await context.newPage();
page.setDefaultTimeout(5000);
const checks = [],
  errors = [],
  external = [];
context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
page.on("pageerror", (e) => errors.push(e.message));
await context.route("**/*", (route) => {
  if (new URL(route.request().url()).origin !== origin) {
    external.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});
const button = (name, p = page) => p.getByRole("button", { name, exact: true });
async function open(query = "") {
  await page.goto(url + "?" + query);
  await page.getByLabel("Player full name", { exact: true }).waitFor();
}
async function start() {
  await button("Search OTB games on PC").click();
}
async function calls(count = 1, p = page) {
  await p.waitForFunction((n) => fx.calls.length >= n, count);
}
async function capture(name) {
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    name + " fits viewport",
  );
}
async function check(name, run) {
  try {
    await run();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: String(error) });
    await capture(name + "-failure");
    if (!baseline) throw error;
  }
}
try {
  await check("locked-request-readable-at-200-percent", async () => {
    await page.setViewportSize({ width: 360, height: 1050 });
    await open();
    await page.evaluate(() => fx.setScale(2));
    await start();
    await button("Stop search").waitFor();
    const style = await page
      .getByLabel("Player full name", { exact: true })
      .evaluate((input) => ({
        fontSize: parseFloat(getComputedStyle(input).fontSize),
        color: getComputedStyle(input).color,
      }));
    assert.ok(style.fontSize >= 30, "locked input text follows the user's text scale");
    assert.notEqual(style.color, "rgb(68, 68, 68)", "saved identity remains readable while locked");
    await capture("locked-request-360-2");
    await page.setViewportSize({ width: 760, height: 1050 });
  });
  await check("lost-reply-retries-same-search", async () => {
    await open("mode=lost");
    await start();
    await page.getByText("Example start reply was lost", { exact: true }).waitFor();
    await button("Retry connection").click();
    await button("Stop search").waitFor();
    const calls = await page.evaluate(() => fx.calls);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].id, calls[1].id);
    assert.deepEqual(calls[0].request, calls[1].request);
    assert.equal(calls[0].stored?.id, calls[0].id);
    assert.equal(calls[0].stored?.accepted, false);
    assert.equal(await page.evaluate(() => Object.keys(fx.jobs()).length), 1);
  });
  await check("pending-start-survives-view-navigation", async () => {
    await open("mode=hold");
    await button("Search OTB games on PC").evaluate((el) => {
      el.click();
      el.click();
    });
    await calls();
    await page.evaluate(() => {
      fx.setVisible(false);
      fx.setVisible(true);
    });
    assert.equal(await page.getByLabel("Player full name", { exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => fx.calls.length), 1);
    await page.evaluate(() => fx.release());
    await button("Stop search").waitFor();
    assert.equal(await page.evaluate(() => fx.record().accepted), true);
  });
  await check("reload-restores-original-request", async () => {
    await open("mode=lost");
    await page.getByLabel("Games since", { exact: true }).fill("2021");
    await button("PC search sources").click();
    await page.getByLabel("TWIC", { exact: true }).uncheck();
    await start();
    await calls();
    const record = await page.evaluate(() => fx.record());
    await open("resume");
    await button("Retry connection").waitFor();
    assert.equal(await page.getByLabel("Games since", { exact: true }).inputValue(), "2021");
    await button("PC search sources").click();
    assert.equal(await page.getByLabel("TWIC", { exact: true }).isChecked(), false);
    await button("Retry connection").click();
    await button("Stop search").waitFor();
    assert.deepEqual(await page.evaluate(() => fx.calls[0].request), record.request);
    assert.equal(await page.evaluate(() => fx.calls[0].id), record.id);
  });
  await check("storage-failure-precedes-network", async () => {
    await open("writeFail");
    await start();
    await page.getByText(/This browser could not read or save/).waitFor();
    assert.equal(await page.evaluate(() => fx.calls.length), 0);
    assert.equal(await page.evaluate(() => fx.record()), null);
    await page.evaluate(() => (fx.failWrite = false));
    await button("Retry connection").click();
    await start();
    await button("Stop search").waitFor();
  });
  await check("storage-read-failure-is-recoverable", async () => {
    await open("readFail");
    await page.getByText(/This browser could not read or save/).waitFor();
    assert.equal(await page.getByLabel("Player full name", { exact: true }).isDisabled(), true);
    await page.evaluate(() => (fx.failRead = false));
    await button("Retry connection").click();
    await page.getByLabel("Player full name", { exact: true }).fill("Example Player");
    await start();
    await button("Stop search").waitFor();
  });
  await check("acknowledgement-save-failure-retains-pc-job", async () => {
    await open("ackFail");
    await start();
    await button("Stop search").waitFor();
    await page.getByText(/This browser could not read or save/).waitFor();
    const record = await page.evaluate(() => fx.record());
    assert.equal(record.accepted, false);
    await open("resume");
    await button("Retry connection").click();
    await button("Stop search").waitFor();
    assert.equal(await page.evaluate(() => fx.calls[0].id), record.id);
    assert.equal(await page.evaluate(() => Object.keys(fx.jobs()).length), 1);
  });
  await check("old-service-never-falls-back-to-post", async () => {
    await open("mode=old");
    await start();
    await page.getByText(/PC phone service needs updating/).waitFor();
    assert.equal(await page.evaluate(() => fx.calls.length), 1);
    await page.evaluate(() => (fx.mode = "normal"));
    await button("Retry connection").click();
    await button("Stop search").waitFor();
    assert.ok(await page.evaluate(() => fx.calls.every((c) => c.method === "PUT")));
  });
  await check("two-tabs-share-one-pending-identity", async () => {
    await open("mode=hold");
    await start();
    await calls();
    const other = await context.newPage();
    other.setDefaultTimeout(5000);
    try {
      await other.goto(url + "?resume");
      await button("Retry connection", other).waitFor();
      assert.equal(await other.getByLabel("Player full name", { exact: true }).isDisabled(), true);
      await button("Retry connection", other).click();
      await button("Stop search", other).waitFor();
      await page.evaluate(() => fx.release());
      await button("Stop search").waitFor();
      assert.equal(await page.evaluate(() => Object.keys(fx.jobs()).length), 1);
      assert.equal(
        await page.evaluate(() => fx.record().id),
        await other.evaluate(() => fx.record().id),
      );
    } finally {
      await other.close();
    }
  });
  await check("recovery-layouts-and-controls", async () => {
    for (const width of [1100, 760, 360])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 1050 });
        await open("mode=lost");
        await page.evaluate((s) => fx.setScale(s), scale);
        await start();
        await page.getByText("Example start reply was lost", { exact: true }).waitFor();
        await capture("recovery-" + width + "-" + scale);
        assert.equal(await button("Retry connection").isEnabled(), true);
        const clipped = await page
          .locator("button span")
          .evaluateAll((nodes) =>
            nodes
              .filter(
                (n) =>
                  n.textContent?.trim() &&
                  n.clientWidth > 0 &&
                  (n.scrollWidth > n.clientWidth + 2 || n.scrollHeight > n.clientHeight + 2),
              )
              .map((n) => n.textContent),
          );
        assert.deepEqual(clipped, []);
      }
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} finally {
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ baseline, checks, errors, external }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
console.log(JSON.stringify({ baseline, checks, errors, external }, null, 2));
if (checks.some((c) => !c.passed)) process.exitCode = 1;
