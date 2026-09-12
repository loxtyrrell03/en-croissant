// Isolated actual profile, game-header and board-bar components. Public lookup
// responses and the native opener are explicit module fixtures.
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
const output = resolve(root, process.argv[2] || "tmp/fide-profile/renderer");
await mkdir(output, { recursive: true });
const before = new Map();
if (baseline)
  for (const file of [
    "src/components/databases/FideInfo.tsx",
    "src/components/common/GameInfo.tsx",
    "src/components/boards/BoardBar.tsx",
  ])
    before.set(
      resolve(root, file).replaceAll("\\", "/"),
      execFileSync("git", ["show", "9d72e288:" + file], { encoding: "utf8" }),
    );
const oldApi = execFileSync("git", ["show", "9d72e288:src/utils/lichess/api.tsx"], {
  encoding: "utf8",
});
const modules = {
  "@tauri-apps/api/core": `export const isTauri=()=>fixture.native;`,
  "@tauri-apps/plugin-opener": `export const openUrl=async url=>{fixture.links.push(url);if(fixture.holdLink)await new Promise((resolve,reject)=>fixture.pendingLinks.push({resolve,reject}));if(fixture.failLink)throw Error('Fixture browser unavailable');};`,
  "react-i18next": `const translations={'Databases.FIDE.Title':'FIDE player','Common.Loading':'Loading…','Databases.FIDE.Standard':'Standard','Databases.FIDE.Rapid':'Rapid','Databases.FIDE.Blitz':'Blitz','Databases.FIDE.NotRated':'Not rated','Databases.FIDE.PlayerNotFound':'Player not found','Databases.FIDE.SearchError':'Search failed','Databases.FIDE.ClosestMatchTo':'Closest match to'};export const useTranslation=()=>({t:(key,args)=>key==='Databases.FIDE.Born'?'Born '+args.year:translations[key]||key});`,
};
if (baseline)
  modules["@/utils/lichess/api"] =
    `const baseURL='https://lichess.org/api';const apiHeaders=x=>x;${oldApi.slice(oldApi.indexOf("export async function getFidePlayer(query: string)"))}`.replace(
      "query: string",
      "query",
    );
const plugin = {
  name: "fide-profile-boundaries",
  enforce: "pre",
  resolveId(id) {
    const key = Object.keys(modules).find(
      (key) =>
        id === key ||
        (key.startsWith("@/") &&
          id.replaceAll("\\", "/").replace(/\.tsx?$/, "") ===
            resolve(root, "src", key.slice(2)).replaceAll("\\", "/")),
    );
    if (key) return "\0profile:" + key;
  },
  load(id) {
    if (id.replaceAll("\\", "/").endsWith("/src/components/common/TreeStateContext.tsx"))
      return `import {createContext} from 'react';export const TreeStateContext=createContext(null);`;
    return id.startsWith("\0profile:")
      ? modules[id.slice(9)]
      : (before.get(id.replaceAll("\\", "/")) ?? null);
  },
};
await writeFile(
  resolve(output, "entry.tsx"),
  `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {MantineProvider,Button} from '@mantine/core';import '@mantine/core/styles.css';
import FideInfo from '/src/components/databases/FideInfo';import GameInfo from '/src/components/common/GameInfo';import {BoardBar} from '/src/components/boards/BoardBar';
window.fixture={native:true,status:200,hold:false,requests:[],pending:[],links:[],holdLink:false,failLink:false,pendingLinks:[],headers:{id:0,fen:'',event:'Example event',site:'',result:'*',white:'Example, Alex',black:'Example, Blair',other:{WhiteFideId:'12345',BlackFideId:'12346'}},players:[{id:12345,name:'Example, Alex',year:1990,federation:'ENG',standard:2200},{id:12346,name:'Example, Alex',year:2001,federation:'FRA',rapid:1900}]};
const f=fixture,original=window.fetch;window.fetch=(url,options)=>{if(!String(url).includes('lichess.org/api/fide/player'))return original(url,options);const u=new URL(String(url));const q=u.searchParams.get('q')||u.pathname.split('/').pop();const request={q,aborted:false};f.requests.push(request);options?.signal?.addEventListener('abort',()=>request.aborted=true);const reply=()=>{const numeric=/^\\d+$/.test(q);const body=numeric?f.players.find(p=>p.id===Number(q)):f.players;return new Response(JSON.stringify(body??{}),{status:numeric&&!body&&f.status===200?404:f.status});};return f.hold?new Promise(resolve=>f.pending.push(()=>resolve(reply()))):Promise.resolve(reply());};
const mode=new URLSearchParams(location.search).get('mode');
function App(){const [opened,setOpened]=useState(false),[name,setName]=useState('Example'),[id,setId]=useState(undefined),[scale,setScale]=useState(1),[headers,setHeaders]=useState(f.headers);
Object.assign(f,{setName:v=>flushSync(()=>setName(v)),setId:v=>flushSync(()=>setId(v)),setOpened:v=>flushSync(()=>setOpened(v)),setScale:v=>flushSync(()=>setScale(v)),setHeaders:v=>flushSync(()=>setHeaders(v))});
return <MantineProvider forceColorScheme="dark" theme={{scale}}><main style={{padding:16,maxWidth:1100,margin:'auto'}}><p>Invented player data · isolated profile acceptance</p>{mode==='headers'?<GameInfo headers={headers}/>:<><Button onClick={()=>setOpened(true)}>Open profile</Button>{mode==='bar'&&<BoardBar name={name} height="40px" onNameClick={()=>setOpened(true)}/>}<FideInfo opened={opened} setOpened={setOpened} name={name} fideId={id}/></>}</main></MantineProvider>;
}createRoot(document.getElementById('root')).render(<App/>);
`,
);
const relative = (path) =>
  "/" +
  resolve(output, path)
    .slice(root.length + 1)
    .replaceAll("\\", "/");
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="${relative("entry.tsx")}"></script></body></html>`,
);
await build({
  root,
  configFile: false,
  plugins: [plugin, react()],
  resolve: { alias: { "@": resolve(root, "src") } },
  logLevel: "warn",
  build: {
    outDir: resolve(output, "bundle"),
    emptyOutDir: false,
    copyPublicDir: false,
    rollupOptions: { input: resolve(output, "index.html") },
  },
});
const server = await preview({
  root,
  configFile: false,
  build: { outDir: resolve(output, "bundle") },
  preview: { host: "127.0.0.1", port: 0 },
});
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.setDefaultTimeout(3500);
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
const button = (name) => page.getByRole("button", { name, exact: true });
const input = () => page.getByRole("textbox", { name: "Name or FIDE ID" });
const matches = () => page.getByRole("group", { name: "FIDE matches" });
const candidate = (id) =>
  matches()
    .getByRole("button")
    .filter({ hasText: "FIDE " + id });
async function open(mode = "profile") {
  await page.goto(origin + relative("index.html") + "?mode=" + mode);
  if (mode !== "headers") await button("Open profile").waitFor();
}
async function show() {
  await button("Open profile").click();
  await page.getByRole("dialog").waitFor();
}
async function capture(name) {
  if (await page.getByRole("dialog").count())
    await page.waitForFunction(() => {
      let el = document.querySelector("[role=dialog]");
      while (el) {
        if (Number(getComputedStyle(el).opacity) < 1) return false;
        el = el.parentElement;
      }
      return true;
    });
  await page.screenshot({
    path: resolve(output, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "viewport fits",
  );
}
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: String(error) });
    await capture(name + "-failure").catch(() => {});
    if (!baseline) throw error;
  }
}
try {
  await check("explicit-identity-and-back", async () => {
    await open();
    await show();
    await candidate(12345).waitFor();
    assert.equal(await page.getByRole("link", { name: "Open FIDE profile" }).count(), 0);
    await candidate(12346).click();
    await page.getByText("FIDE 12346", { exact: true }).waitFor();
    assert.match(await page.getByRole("dialog").innerText(), /Rapid[\s\S]*1900/);
    await button("Back to matches").click();
    assert.equal(await candidate(12346).evaluate((el) => el === document.activeElement), true);
    await candidate(12345).press("Enter");
    assert.equal(
      await page.getByRole("link", { name: "Open FIDE profile" }).getAttribute("href"),
      "https://ratings.fide.com/profile/12345",
    );
    assert.doesNotMatch(await page.getByRole("dialog").innerText(), /Closest match/);
  });
  await check("refine-empty-failure-retry", async () => {
    await open();
    await show();
    await candidate(12345).waitFor();
    await page.evaluate(() => (fixture.status = 503));
    await input().fill("Changed");
    await button("Search").click();
    await page.getByRole("alert").waitFor();
    await page.evaluate(() => (fixture.status = 200));
    await button("Retry search").click();
    await candidate(12345).waitFor();
    await input().fill("99999");
    await button("Search").click();
    await page.getByText(/No FIDE player found/).waitFor();
    await input().fill("");
    assert.ok(await button("Search").isDisabled());
  });
  await check("replacement-cancels-old-profile", async () => {
    await open();
    await page.evaluate(() => (fixture.hold = true));
    await show();
    await page.waitForFunction(() => fixture.requests.length === 1);
    await input().fill("12346");
    await page.evaluate(() => (fixture.hold = false));
    await button("Search").click();
    await page.getByText("FIDE 12346", { exact: true }).waitFor();
    await page.evaluate(() => fixture.pending.shift()());
    await page.waitForTimeout(30);
    assert.equal(await matches().count(), 0);
    assert.ok(await page.evaluate(() => fixture.requests[0].aborted));
  });
  await check("close-reopen-and-prop-change", async () => {
    await open();
    await page.evaluate(() => (fixture.hold = true));
    await show();
    await page.waitForFunction(() => fixture.requests.length === 1);
    await input().press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.ok(await button("Open profile").evaluate((el) => el === document.activeElement));
    await page.evaluate(() => {
      fixture.pending.shift()();
      fixture.hold = false;
      fixture.setId("12345");
    });
    await show();
    await page.getByText("FIDE 12345", { exact: true }).waitFor();
    await page.evaluate(() => fixture.setId("12346"));
    await page.getByText("FIDE 12346", { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => fixture.requests[0].aborted));
  });
  await check("native-link-retry-and-ownership", async () => {
    await open();
    await page.evaluate(() => fixture.setId("12345"));
    await show();
    const link = page.getByRole("link", { name: "Open FIDE profile" });
    await link.waitFor();
    await page.evaluate(() => (fixture.failLink = true));
    await link.click();
    await page.getByRole("alert").waitFor();
    await page.evaluate(() => {
      fixture.failLink = false;
      fixture.holdLink = true;
    });
    await link.evaluate((el) => {
      el.click();
      el.click();
    });
    assert.equal(await page.evaluate(() => fixture.links.length), 2);
    assert.ok(await link.getAttribute("aria-busy"));
    await page.evaluate(() => fixture.setId("12346"));
    await page.getByText("FIDE 12346", { exact: true }).waitFor();
    await page.evaluate(() => fixture.pendingLinks.shift().reject(Error("late failure")));
    await page.waitForTimeout(30);
    assert.equal(await page.getByRole("alert").count(), 0);
  });
  await check("ordinary-browser-link", async () => {
    await open();
    await page.evaluate(() => {
      fixture.native = false;
      fixture.setId("12345");
    });
    await show();
    const link = page.getByRole("link", { name: "Open FIDE profile" });
    await link.waitFor();
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match(await link.getAttribute("rel"), /noopener/);
    await link.evaluate((el) =>
      el.addEventListener("click", (event) => {
        fixture.prevented = event.defaultPrevented;
        event.preventDefault();
      }),
    );
    await link.click();
    assert.equal(await page.evaluate(() => fixture.links.length), 0);
    assert.equal(await page.evaluate(() => fixture.prevented), false);
  });
  await check("blank-name-and-id-only", async () => {
    await open();
    await page.evaluate(() => fixture.setName("?"));
    await show();
    await input().waitFor();
    assert.equal(await page.evaluate(() => fixture.requests.length), 0);
    assert.ok(await button("Search").isDisabled());
    await input().fill("Example");
    await button("Search").click();
    await candidate(12345).waitFor();
    await open();
    await page.evaluate(() => {
      fixture.setName("");
      fixture.setId("12346");
    });
    await show();
    await page.getByText("FIDE 12346", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => fixture.requests[0].q), "12346");
  });
  await check("real-header-ids-and-preservation", async () => {
    await open("headers");
    const before = await page.evaluate(() => JSON.stringify(fixture.headers));
    await button("White player FIDE info").press("Enter");
    await page.getByText("FIDE 12345", { exact: true }).waitFor();
    await input().fill("12346");
    await button("Search").click();
    await page.getByText("FIDE 12346", { exact: true }).waitFor();
    await input().press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => JSON.stringify(fixture.headers)), before);
    await button("Black player FIDE info").press("Space");
    await page.getByText("FIDE 12346", { exact: true }).waitFor();
  });
  await check("board-name-keyboard", async () => {
    await open("bar");
    await button("Example FIDE info").press("Enter");
    await candidate(12345).waitFor();
    await input().press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.evaluate(() => fixture.setName("?"));
    await button("Player FIDE info").press("Space");
    await input().waitFor();
    assert.ok(await button("Search").isDisabled());
  });
  await check("profile-layouts-and-focus", async () => {
    for (const width of [1100, 760, 360])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 900 });
        await open();
        await page.evaluate((scale) => fixture.setScale(scale), scale);
        await show();
        await candidate(12345).waitFor();
        await capture("matches-" + width + "-" + scale);
        await candidate(12346).click();
        await page.getByText("FIDE 12346", { exact: true }).waitFor();
        for (const label of ["Standard", "Rapid", "Blitz"])
          assert.ok(
            await page
              .getByText(label, { exact: true })
              .evaluate((el) => el.scrollWidth <= el.clientWidth),
            label + " label fits",
          );
        await page.getByText("Blitz", { exact: true }).scrollIntoViewIfNeeded();
        await capture("ratings-" + width + "-" + scale);
        await page.getByText("FIDE 12346", { exact: true }).scrollIntoViewIfNeeded();
        await capture("detail-" + width + "-" + scale);
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press("Tab");
          assert.ok(
            await page.getByRole("dialog").evaluate((el) => el.contains(document.activeElement)),
          );
        }
      }
  });
} finally {
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify({ baseline, checks, errors, external }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
assert.equal(errors.length, 0);
assert.equal(external.length, 0);
assert.ok(checks.every((check) => check.passed));
console.log(JSON.stringify({ passed: checks.length, output }));
