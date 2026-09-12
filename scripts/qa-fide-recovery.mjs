// Dedicated, isolated real-component harness. Provider replies and native module
// boundaries are fixtures; it never opens the installed app or creates a database.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
const require = createRequire(process.env.FIDE_QA_DEPENDENCIES || import.meta.url);
const { chromium } = require("playwright");
const root = process.cwd(),
  baseline = process.argv.includes("--baseline");
const output = resolve(root, process.argv[2] || "tmp/fide-recovery/renderer");
await mkdir(output, { recursive: true });
const fixtureModules = {
  "@/bindings": `export const commands={collectOtbGames:async request=>{fixture.imports.push(request);return {status:'error',error:'Fixture stopped after request validation'};}};export const events={otbImportProgress:{listen:async()=>()=>{}}};`,
  "@/state/atoms": `import {atom} from 'jotai';export const databaseConversionStateAtom=atom({});`,
  "@/utils/db": `export const getDatabases=async()=>[];`,
  "@/utils/directories": `export const getDatabasesDir=async()=>{fixture.paths++;return 'C:/Fixture';};`,
  "@/utils/onlineGameImport": `export const resetDatabaseConversionState=()=>{};`,
  "@tauri-apps/api/path": `export const resolve=async(...p)=>{fixture.paths++;return p.join('/');};export const appCacheDir=async()=>'C:/Fixture/cache';export const tempDir=async()=>'C:/Fixture/temp';`,
  "@tauri-apps/plugin-dialog": `export const open=async()=>null;`,
  "@tauri-apps/plugin-log": `export const error=()=>{},warn=()=>{},info=()=>{},debug=()=>{},trace=()=>{};`,
};
const before = new Map();
if (baseline)
  for (const file of [
    "src/components/common/FidePlayerSearchInput.tsx",
    "src/components/panels/prep/OtbGameImportPanel.tsx",
    "src/web/PhoneOtbImportPanel.tsx",
    "src/utils/fideApi.ts",
    "src/utils/fidePlayer.ts",
    "src/web/otbImport.ts",
  ]) {
    before.set(
      resolve(root, file).replaceAll("\\", "/"),
      execFileSync("git", ["show", "b9ab5156:" + file], { cwd: root, encoding: "utf8" }),
    );
  }
const plugin = {
  name: "fide-boundary-fixture",
  enforce: "pre",
  resolveId(id) {
    const key = Object.keys(fixtureModules).find(
      (key) =>
        id === key ||
        (key.startsWith("@/") &&
          id.replaceAll("\\", "/").replace(/\.tsx?$/, "") ===
            resolve(root, "src", key.slice(2)).replaceAll("\\", "/")),
    );
    if (key) return "\0fide-fixture:" + key;
  },
  load(id) {
    if (id.startsWith("\0fide-fixture:")) return fixtureModules[id.slice(14)];
    return before.get(id.replaceAll("\\", "/")) ?? null;
  },
};
await writeFile(
  resolve(output, "entry.tsx"),
  `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {MantineProvider,Button,Modal} from '@mantine/core';import '@mantine/core/styles.css';import {Notifications} from '@mantine/notifications';import '@mantine/notifications/styles.css';
import {FidePlayerSearchInput} from '/src/components/common/FidePlayerSearchInput';import {searchFidePlayers} from '/src/utils/fideApi';import {searchWebFidePlayers} from '/src/web/otbImport';
import Phone from '/src/web/PhoneOtbImportPanel';import Desktop from '/src/components/panels/prep/OtbGameImportPanel';
const mode=new URLSearchParams(location.search).get('mode')||'desktop-picker';const phone=mode.startsWith('phone');
window.fixture={status:200,hold:false,players:Array.from({length:8},(_,i)=>({id:12345+i,name:'Example, '+['Alex','Alexandra','Benedict','Charlotte','Dominic','Eleanor','Frederick','Georgina'][i],year:1990+i,federation:'ENG',standard:2200-i*10})),requests:[],pending:[],imports:[],paths:0,selected:[]};
const f=window.fixture;const realFetch=window.fetch;
window.fetch=(url,options)=>{const u=String(url);if(u.includes('/api/fide/player')||u.includes('/api/otb-import/players')){
 const q=u.includes('?')?new URL(u,location.origin).searchParams.get('q'):u.split('/').pop();const request={q,aborted:false};f.requests.push(request);options?.signal?.addEventListener('abort',()=>request.aborted=true);
 const response=()=>{const players=f.players;const body=f.status===200?(u.includes('/api/otb-import/')?{players:/^\\d+$/.test(q)?players.filter(player=>player.id===Number(q)):players}:/^\\d+$/.test(q)?players[0]:players):{error:'FIDE lookup unavailable. Retry the search.'};return new Response(JSON.stringify(body),{status:f.status});};
 return f.hold?new Promise(resolve=>f.pending.push(()=>resolve(response()))):Promise.resolve(response());
 }if(u.includes('/api/otb-import/jobs')&&options?.method==='POST'){f.imports.push(JSON.parse(options.body));return Promise.resolve(new Response(JSON.stringify({error:'Fixture stopped after request validation'}),{status:503}));}return realFetch(url,options);};
function App(){const [value,setValue]=useState(''),[selected,setSelected]=useState(null),[disabled,setDisabled]=useState(false),[visible,setVisible]=useState(true),[scale,setScale]=useState(1);
 Object.assign(f,{setValue:v=>flushSync(()=>setValue(v)),setDisabled:v=>flushSync(()=>setDisabled(v)),setVisible:v=>flushSync(()=>setVisible(v)),setScale:v=>flushSync(()=>setScale(v))});
 const picker=<><FidePlayerSearchInput mobileInline={phone} value={value} onChange={v=>{setValue(v);setSelected(null);}} selected={selected} onSelect={p=>{f.selected.push(p);setSelected(p);setValue(p.name);}} searchPlayers={phone?searchWebFidePlayers:searchFidePlayers} disabled={disabled}/><Button variant="default">Outside field</Button></>;
 return <MantineProvider forceColorScheme="dark" theme={{scale}}><Notifications/><main style={{maxWidth:760,margin:'0 auto',padding:16}}><p>Invented player data · isolated FIDE acceptance</p>{visible&&(mode.endsWith('picker')?(phone?picker:<Modal opened title="Find a player" onClose={()=>setVisible(false)}>{picker}</Modal>):phone?<Phone onAnalyzeGame={async()=>{}}/>:<Desktop initialPlayerName="" databaseDir="C:/Fixture" localDatabases={[]} controlSize="sm" dense={false} variant="dialog" onImported={()=>{}}/>)}</main></MantineProvider>;
}createRoot(document.getElementById('root')).render(<App/>);
`,
);
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="${("/" + resolve(output, "entry.tsx").slice(root.length + 1)).replaceAll("\\", "/")}"></script></body></html>`,
);
await build({
  root,
  configFile: false,
  plugins: [plugin, react()],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    outDir: resolve(output, "bundle"),
    emptyOutDir: false,
    copyPublicDir: false,
    rollupOptions: { input: resolve(output, "index.html") },
  },
  logLevel: "warn",
});
const previewServer = await preview({
  root,
  configFile: false,
  build: { outDir: resolve(output, "bundle") },
  preview: { port: 0, host: "127.0.0.1" },
});
const server = { close: () => new Promise((resolve) => previewServer.httpServer.close(resolve)) };
const origin = previewServer.resolvedUrls.local[0].replace(/\/$/, "");
const url =
  origin +
  "/" +
  resolve(output, "index.html")
    .slice(root.length + 1)
    .replaceAll("\\", "/");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.setDefaultTimeout(4000);
page.setDefaultNavigationTimeout(30000);
const errors = [],
  external = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
await page
  .context()
  .route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : (external.push(route.request().url()), route.abort()),
  );
const input = () => page.getByRole("combobox").first();
const button = (name) => page.getByRole("button", { name, exact: true });
async function open(mode) {
  await page.goto(url + "?mode=" + mode);
  await input().waitFor();
}
async function capture(name) {
  await page.screenshot({ path: resolve(output, name + ".png"), fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    name + " fits",
  );
}
async function requests(n) {
  await page.waitForFunction((n) => fixture.requests.length >= n, n);
}
async function check(name, test) {
  try {
    await test();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: String(error) });
    await capture(name + "-failure").catch(() => {});
    if (!baseline) throw error;
  }
}
try {
  for (const target of ["desktop", "phone"]) {
    await check(target + "-picker-retry", async () => {
      await open(target + "-picker");
      await page.evaluate(() => (fixture.status = 503));
      await input().fill("Example");
      await button("Retry search").waitFor();
      assert.equal(await page.getByRole("option").count(), 0);
      assert.doesNotMatch(await page.locator("body").innerText(), /No FIDE match/);
      await capture(target + "-failure");
      await page.evaluate(() => (fixture.status = 200));
      await button("Retry search").click();
      await page.getByRole("option").first().waitFor();
      assert.match(await page.getByRole("option").first().innerText(), /FIDE 12345/);
      assert.match(await page.getByRole("option").first().innerText(), /Standard 2200/);
      await page.getByRole("option").first().click();
      assert.equal(await input().inputValue(), "Example, Alex");
    });
    await check(target + "-picker-abandonment", async () => {
      for (const action of ["clear", "short", "disable", "unmount"]) {
        await open(target + "-picker");
        await page.evaluate(() => (fixture.hold = true));
        await input().fill("Example");
        await requests(1);
        if (action === "clear") await input().fill("");
        else if (action === "short") await input().fill("Ex");
        else
          await page.evaluate(
            (action) =>
              action === "disable" ? fixture.setDisabled(true) : fixture.setVisible(false),
            action,
          );
        await page.evaluate(() => fixture.pending.shift()());
        await page.waitForTimeout(30);
        assert.equal(await page.getByRole("option").count(), 0);
        assert.ok(
          await page.evaluate(() => fixture.requests[0].aborted),
          action + " aborts the request",
        );
      }
    });
    await check(target + "-picker-empty-and-selection", async () => {
      await open(target + "-picker");
      await page.evaluate(() => (fixture.players = []));
      await input().fill("Nobody");
      await page.getByText(/No FIDE match/).waitFor();
      assert.equal(await button("Retry search").count(), 0);
      await open(target + "-picker");
      await input().fill("Example");
      await page.getByRole("option").first().waitFor();
      await page.evaluate(() => (fixture.hold = true));
      await input().fill("Different");
      await input().press("Enter");
      assert.equal(await page.evaluate(() => fixture.selected.length), 0);
    });
    await check(target + "-picker-layouts", async () => {
      for (const width of [1100, 760, 360])
        for (const scale of [1, 2]) {
          await page.setViewportSize({ width, height: 900 });
          await open(target + "-picker");
          await page.evaluate((scale) => fixture.setScale(scale), scale);
          await input().fill("Example");
          await page.getByRole("option").first().waitFor();
          await capture(target + "-picker-" + width + "-" + scale);
        }
      await page.setViewportSize({ width: 1100, height: 900 });
    });
    const start = () =>
      button(target === "phone" ? "Search OTB games on PC" : "Find OTB games + use");
    await check(target + "-import-failure-retry", async () => {
      await open(target + "-import");
      await page.evaluate(() => (fixture.status = 503));
      await input().fill("12345");
      await start().click();
      await page
        .getByText(/lookup.*unavailable/i)
        .first()
        .waitFor();
      assert.equal(await page.evaluate(() => fixture.imports.length), 0);
      assert.equal(await page.evaluate(() => fixture.paths), 0);
      await page.waitForFunction(() => !document.querySelector('[data-loading="true"]'));
      await page.evaluate(() => (fixture.status = 200));
      await start().click();
      await page.waitForFunction(() => fixture.imports.length === 1);
      const request = await page.evaluate(() => fixture.imports[0]);
      assert.equal(request.playerName, "Example, Alex");
      assert.equal(String(request.fideId), "12345");
      assert.equal(request.fromYear, 1990);
    });
    await check(target + "-import-miss-conflict", async () => {
      await open(target + "-import");
      await page.evaluate(() => {
        fixture.status = 404;
        fixture.players = [];
      });
      await input().fill("12345");
      await start().click();
      await page
        .getByText(/No player|lookup unavailable/)
        .first()
        .waitFor();
      assert.equal(await page.evaluate(() => fixture.imports.length), 0);
      await open(target + "-import");
      await page.evaluate(() => (fixture.hold = true));
      await input().fill("12345");
      await page.getByLabel("FIDE ID", { exact: true }).fill("54321");
      await start().click();
      await page.getByText(/two FIDE IDs differ/).waitFor();
      assert.equal(await page.evaluate(() => fixture.imports.length), 0);
    });
    await check(target + "-autofill-replacement", async () => {
      await open(target + "-import");
      await page.evaluate(() => (fixture.hold = true));
      await page.getByLabel("FIDE ID", { exact: true }).fill("12345");
      await input().focus();
      await requests(1);
      await input().fill("Different person");
      await page.evaluate(() => fixture.pending.shift()());
      await page.waitForTimeout(30);
      assert.equal(await input().inputValue(), "Different person");
      assert.ok(await page.evaluate(() => fixture.requests[0].aborted));
    });
    await check(target + "-preflight-stop-unmount", async () => {
      for (const action of ["stop", "unmount"]) {
        await open(target + "-import");
        await page.evaluate(() => (fixture.hold = true));
        await input().fill("12345");
        await start().click();
        await requests(1);
        if (action === "stop") await button("Stop FIDE search").click();
        else await page.evaluate(() => fixture.setVisible(false));
        await page.evaluate(() => fixture.pending.splice(0).forEach((resolve) => resolve()));
        await page.waitForTimeout(40);
        assert.equal(await page.evaluate(() => fixture.imports.length), 0);
        assert.ok(await page.evaluate(() => fixture.requests.every((request) => request.aborted)));
      }
    });
  }
  await check("desktop-short-keyboard-scroll", async () => {
    await page.setViewportSize({ width: 360, height: 600 });
    await open("desktop-picker");
    await page.evaluate(() => fixture.setScale(2));
    await input().fill("Example");
    await page.getByRole("option").first().waitFor();
    for (let i = 0; i < 8; i++) await input().press("ArrowDown");
    const active = page.locator('[role="option"][data-combobox-selected]');
    assert.match(await active.innerText(), /Georgina/);
    assert.ok(
      await active.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }),
      "keyboard-selected row fits the viewport",
    );
    await capture("desktop-short-keyboard");
    await input().press("Enter");
    assert.equal(await page.evaluate(() => fixture.selected[0]?.id), 12352);
    await page.setViewportSize({ width: 1100, height: 900 });
  });
  await check("desktop-focus-return", async () => {
    await open("desktop-picker");
    await page.evaluate(() => (fixture.hold = true));
    await input().fill("Example");
    await requests(1);
    await button("Outside field").click();
    await page.evaluate(() => fixture.pending.shift()());
    await page.waitForTimeout(30);
    assert.equal(await page.getByRole("option").count(), 0);
    await input().focus();
    await page.getByRole("option").first().waitFor();
    await input().press("ArrowDown");
    await input().press("Enter");
    assert.equal(await page.evaluate(() => fixture.selected.length), 1);
  });
} finally {
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify({ baseline, checks, errors, external }, null, 2),
  );
  await browser.close();
  await server.close();
}
assert.equal(errors.length, 0, "page errors");
assert.equal(external.length, 0, "external requests");
assert.ok(checks.every((check) => check.passed));
console.log(JSON.stringify({ passed: checks.length, output }));
