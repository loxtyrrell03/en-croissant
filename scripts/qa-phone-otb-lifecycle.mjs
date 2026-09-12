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
  output = path.resolve(process.argv[2] || "tmp/phone-otb-lifecycle/renderer");
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
        execFileSync("git", ["show", "209e824f:" + file], { encoding: "utf8" }),
      ])
    : [],
);
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {MantineProvider} from '@mantine/core';import '@mantine/core/styles.css';
import Phone from '/src/web/PhoneOtbImportPanel';
import {WEB_OTB_JOB_STORAGE_KEY,WEB_OTB_PREP_HANDLED_JOB_STORAGE_KEY} from '/src/web/otbImport';
const params=new URL(location.href).searchParams;
const f=window.fx={calls:[],pending:[],holds:new Set(params.get('hold')?[params.get('hold')]:[]),failures:{},stopMode:'completed',analyzed:[],
 job:{id:'job-1',status:params.has('complete')?'completed':'running',request:{playerName:'Example Player',fideId:'1503014',fromYear:2024},gameCount:1,artifactAvailable:true,createdAt:'2026-09-12',updatedAt:'2026-09-12',progress:null,error:null},
 game:{id:'game-1',pgn:'[White "Example A"]\\n[Black "Example B"]\\n\\n1. e4 e5 *',white:'Example A',black:'Example B',event:'Example Open',date:'2026.09.12',result:'*'},
 release(name){const index=f.pending.findIndex(p=>p.name===name);if(index>=0)f.pending.splice(index,1)[0].resolve()},
 async call(name,action){f.calls.push(name);const value=action?.();if(f.holds.has(name))await new Promise(resolve=>f.pending.push({name,resolve}));if(f.failures[name]){f.failures[name]--;throw Error('Example '+name+' failure')}return value},
};
localStorage.setItem('encroissant-web-otb-player','Example Player');
if(params.get('mode')!=='new')localStorage.setItem(WEB_OTB_JOB_STORAGE_KEY,'job-1');else localStorage.removeItem(WEB_OTB_JOB_STORAGE_KEY);
localStorage.setItem(WEB_OTB_PREP_HANDLED_JOB_STORAGE_KEY,'job-1');
const realFetch=window.fetch;
window.fetch=async(url,options={})=>{
 const p=new URL(String(url),location.href).pathname;
 if(p==='/api/otb-import/players')return new Response(JSON.stringify({players:[{id:1503014,name:'Example Player',year:1998}]}));
 if(!p.startsWith('/api/otb-import/jobs'))return realFetch(url,options);
 let body;
 if(options.method==='POST')body=await f.call('start',()=>structuredClone(f.job));
 else if(options.method==='DELETE')body=await f.call('stop',()=>{if(f.stopMode==='failed'){f.job.status='failed';f.job.error='Search stopped.'}else if(f.stopMode==='completed')f.job.status='completed';return structuredClone(f.job)});
 else if(p.endsWith('/artifact'))body=await f.call('artifact',()=>({jobId:f.job.id,games:[f.game],prepDatabase:{games:[f.game]}}));
 else body=await f.call('status',()=>structuredClone(f.job));
 return new Response(JSON.stringify(body),{status:200});
};
function App(){const [visible,setVisible]=useState(true),[scale,setScale]=useState(1);Object.assign(f,{setVisible:v=>flushSync(()=>setVisible(v)),setScale:v=>flushSync(()=>setScale(v))});
 return <MantineProvider forceColorScheme='dark' theme={{scale}}><main style={{maxWidth:760,margin:'0 auto',padding:16}}><p>Invented games · isolated PC import lifecycle</p>{visible&&<Phone onAnalyzeGame={async game=>{await f.call('analyze',()=>f.analyzed.push(game.id));}}/>}</main></MantineProvider>;
}createRoot(document.getElementById('root')).render(<App/>);
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
      name: "phone-lifecycle-baseline",
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
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const url =
  origin + "/" + path.relative(root, path.join(output, "index.html")).replaceAll("\\", "/");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 760, height: 1000 } });
page.setDefaultTimeout(5000);
const checks = [],
  errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.context().route("**/*", (route) => {
  if (new URL(route.request().url()).origin !== origin) {
    external.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});
const button = (name) => page.getByRole("button", { name, exact: true });
async function open(extra = "") {
  await page.goto(url + "?" + extra);
  await page.getByLabel("Player full name", { exact: true }).waitFor();
}
async function calls(name, count = 1) {
  await page.waitForFunction(
    ({ name, count }) => fx.calls.filter((c) => c === name).length >= count,
    { name, count },
  );
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
  await check("stop-completion-keeps-result", async () => {
    await open();
    await button("Stop search").click();
    await button("Analyze").waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("encroissant-web-otb-job")),
      "job-1",
    );
    await button("Analyze").click();
    await calls("analyze");
  });
  await check("stop-failure-keeps-status", async () => {
    await open();
    await page.evaluate(() => (fx.stopMode = "failed"));
    await button("Stop search").click();
    await page.getByText("Search stopped.", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("encroissant-web-otb-job")),
      "job-1",
    );
    await button("Search OTB games on PC").click();
    await calls("start");
  });
  await check("stop-double-click-and-late-poll", async () => {
    await open("hold=stop");
    await button("Stop search").evaluate((el) => {
      el.click();
      el.click();
    });
    await calls("stop");
    assert.equal(await page.evaluate(() => fx.calls.filter((c) => c === "stop").length), 1);
    await page.evaluate(() => fx.release("stop"));
    await button("Analyze").waitFor();
  });
  await check("result-loading-is-not-empty", async () => {
    await open("hold=artifact");
    await button("Stop search").click();
    await calls("artifact");
    await page.getByText("Loading the saved games from your PC…", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByText("The PC search completed without any usable OTB games.", { exact: true })
        .count(),
      0,
    );
    await page.evaluate(() => {
      fx.failures.artifact = 1;
      fx.release("artifact");
    });
    await page
      .getByText("Example artifact failure Retrying automatically…", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByText("The PC search completed without any usable OTB games.", { exact: true })
        .count(),
      0,
    );
    await page.evaluate(() => fx.holds.delete("artifact"));
    await button("Analyze").waitFor();
  });
  await check("restore-waits-before-new-search", async () => {
    await open("hold=status");
    await calls("status");
    assert.ok(await button("Search OTB games on PC").isDisabled());
    await page.getByText("Checking the saved PC search…", { exact: true }).waitFor();
    await page.evaluate(() => {
      fx.holds.delete("status");
      fx.release("status");
    });
    await button("Stop search").waitFor();
    assert.equal(await page.getByLabel("FIDE ID", { exact: true }).inputValue(), "1503014");
    assert.equal(await page.getByLabel("Games since", { exact: true }).inputValue(), "2024");
  });
  await check("stop-error-survives-poll-and-retries", async () => {
    await open();
    await page.evaluate(() => {
      fx.stopMode = "running";
      fx.failures.stop = 1;
    });
    await button("Stop search").click();
    await page.getByText("Example stop failure", { exact: true }).waitFor();
    await calls("status", 3);
    assert.equal(await page.getByText("Example stop failure", { exact: true }).count(), 1);
    await page.evaluate(() => (fx.stopMode = "completed"));
    await button("Stop search").click();
    await button("Analyze").waitFor();
  });
  await check("analyze-double-click-retry", async () => {
    await open("complete=1");
    await button("Analyze").waitFor();
    await page.evaluate(() => {
      fx.holds.add("analyze");
      fx.failures.analyze = 1;
    });
    await button("Analyze").evaluate((el) => {
      el.click();
      el.click();
    });
    await calls("analyze");
    assert.equal(await page.evaluate(() => fx.calls.filter((c) => c === "analyze").length), 1);
    await page.evaluate(() => fx.release("analyze"));
    await page.getByText("Example analyze failure", { exact: true }).waitFor();
    await page.evaluate(() => fx.holds.delete("analyze"));
    await button("Analyze").click();
    await calls("analyze", 2);
  });
  await check("unmount-does-not-clear-completed-job", async () => {
    await open("hold=stop");
    await button("Stop search").click();
    await calls("stop");
    await page.evaluate(() => fx.setVisible(false));
    await page.evaluate(() => fx.release("stop"));
    await page.waitForTimeout(80);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("encroissant-web-otb-job")),
      "job-1",
    );
    await page.evaluate(() => fx.setVisible(true));
    await button("Analyze").waitFor();
  });
  await check("responsive-result-and-error", async () => {
    for (const width of [1100, 760, 360])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 1000 });
        await open("complete=1");
        await page.evaluate((scale) => fx.setScale(scale), scale);
        await button("Analyze").waitFor();
        await button("Analyze").scrollIntoViewIfNeeded();
        await capture("result-" + width + "-" + scale);
        const clipped = await page
          .locator(".mantine-Button-label")
          .evaluateAll((nodes) =>
            nodes
              .filter(
                (el) =>
                  el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
              )
              .map((el) => el.textContent),
          );
        assert.deepEqual(clipped, [], "Action labels remain complete at larger text");
        await page.evaluate(() => (fx.failures.analyze = 1));
        await button("Analyze").click();
        await page.getByText("Example analyze failure", { exact: true }).waitFor();
        await capture("error-" + width + "-" + scale);
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
if (errors.length || external.length || (!baseline && checks.some((c) => !c.passed)))
  process.exitCode = 1;
