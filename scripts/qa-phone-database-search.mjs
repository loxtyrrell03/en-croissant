import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

// Isolated invented collections: never connects to the owner's phone service or databases.
const { chromium, webkit } = createRequire(process.env.FIDE_QA_DEPENDENCIES || import.meta.url)(
  "playwright",
);
const root = process.cwd();
const baselineRef = process.argv
  .find((arg) => arg.startsWith("--baseline-ref="))
  ?.slice("--baseline-ref=".length);
const output = path.resolve("tmp/phone-database-search", baselineRef ? "baseline" : "current");
const baselineSource = baselineRef
  ? execFileSync("git", ["show", baselineRef + ":src/web/WebApp.tsx"], { encoding: "utf8" })
  : null;
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
  path.join(output, "prep.tsx"),
  `
import React from 'react';import{createRoot}from'react-dom/client';import{createEmptyWebState}from'/src/web/storage';import{parsePgnDatabase}from'/src/web/pgn';
async function setup(){
 const state=createEmptyWebState();state.board.orientation='black';
 state.databases=['Alex Example - OTB prep (12 games)','Study games','Pat Example - as Black (5 games)'].map((name,i)=>({id:'example-'+i,name:name+'.pgn',sourceKind:'source',hostedLazy:true,importedAt:1,updatedAt:1,gameCount:12,sizeBytes:100,playerNames:[]}));
 for(const db of state.databases)state.gamesByDatabase[db.id]=[];
 if(new URL(location.href).searchParams.has('queuedPrep')){state.board.orientation='white';state.prepWorkspaces=[{id:'previous-prep',name:'Previous opponent prep',opponent:'Previous Example',userColor:'white',sourceIds:['example-0'],startFen:state.board.startFen,line:[],notesByFen:{keep:'Existing notes'},preparedMoves:{keep:123},createdAt:1,updatedAt:1}];state.activePrepId='previous-prep'}
 if(!localStorage.getItem('fixture-seeded')){await new Promise((resolve,reject)=>{const request=indexedDB.open('en-croissant-web-companion',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(state,'main');tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}});localStorage.setItem('fixture-seeded','true')}
 window.readFixtureState=()=>new Promise(resolve=>{const request=indexedDB.open('en-croissant-web-companion',1);request.onsuccess=()=>{const db=request.result,read=db.transaction('state','readonly').objectStore('state').get('main');read.onsuccess=()=>{resolve(read.result);db.close()}}});
 const imported=parsePgnDatabase('Example OTB prep.pgn','[White "Example, Alex"]\\n[Black "Other"]\\n\\n1. e4 e5 *',1234);imported.database.sourceKind='source';
 const realFetch=window.fetch;window.fetch=async(url,options)=>{const p=new URL(String(url),location.href).pathname;
 if(p==='/api/web-state'&&new URL(location.href).searchParams.has('queuedPrep'))return Response.json({state:{requestedOtbPrep:{id:'example-request-1',jobId:'otb-example',userColor:'black'}}});
 if(p.startsWith('/api/otb-import/jobs/')){if(new URL(location.href).searchParams.has('failJob'))return Response.json({error:'Example missing job'},{status:404});
 if(p.endsWith('/artifact'))return Response.json({jobId:'otb-example',games:[],prepDatabase:imported});
 return Response.json({id:'otb-example',status:'completed',request:{playerName:'Example, Alex',fromYear:1900},artifactAvailable:true,createdAt:'2026-10-18T12:00:00Z',report:{playerName:'Example, Alex'}})};
 if(p.startsWith('/api/')||p.startsWith('/v1/'))return Response.json({},{status:404});return realFetch(url,options)};
 const{default:WebApp}=await import('/src/web/WebApp');createRoot(document.getElementById('root')).render(<WebApp/>);
}void setup();
`,
);
await fs.writeFile(
  path.join(output, "auth.ts"),
  "export async function loadSharedLichessCredential(){return null} export async function saveSharedLichessCredential(){}\n",
);
await fs.writeFile(
  path.join(output, "prep.html"),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/${relative}/prep.tsx"></script></body></html>`,
);
await fs.writeFile(
  path.join(output, "index.html"),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/${relative}/entry.tsx"></script></body></html>`,
);
await build({
  root,
  configFile: false,
  plugins: [
    {
      name: "orientation-baseline",
      enforce: "pre",
      load: (id) =>
        baselineSource &&
        id.replaceAll("\\", "/") === path.resolve("src/web/WebApp.tsx").replaceAll("\\", "/")
          ? baselineSource
          : null,
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
    copyPublicDir: false,
    rollupOptions: { input: [path.join(output, "index.html"), path.join(output, "prep.html")] },
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
      for (const queued of [false, true])
        for (const fail of [false, true]) {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          page.on("pageerror", (error) =>
            errors.push({ engine, link: true, error: error.message }),
          );
          await context.route("**/*", (route) =>
            new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
          );
          await page.goto(
            origin +
              "/" +
              relative +
              (queued ? "/prep.html?queuedPrep=1" : "/prep.html?otbPrep=otb-example&side=black") +
              (fail ? "&failJob=1" : ""),
          );
          if (fail) {
            await page
              .getByText(queued ? "Could not load requested prep" : "Could not open prep", {
                exact: true,
              })
              .waitFor();
            assert.equal(
              (await page.evaluate(() => window.readFixtureState())).activePrepId,
              queued ? "previous-prep" : null,
            );
          } else {
            await page.getByRole("button", { name: /^e4 WDL/ }).waitFor();
            await page.locator(".cg-wrap.orientation-black").waitFor();
            let saved = await page.evaluate(() => window.readFixtureState());
            assert.equal(saved.activePrepId, "prep-otb-example");
            assert.equal(saved.databases.length, 4);
            assert.equal(saved.prepWorkspaces[0].userColor, "black");
            if (queued) assert.equal(saved.lastAppliedPhonePrepRequestId, "example-request-1");
            if (queued)
              assert.deepEqual(
                saved.prepWorkspaces.find((p) => p.id === "previous-prep").notesByFen,
                { keep: "Existing notes" },
              );
            await page.reload();
            if (queued) await page.getByRole("tab", { name: "Prep", exact: true }).click();
            else await page.getByText("Prep ready", { exact: true }).waitFor();
            await page.getByRole("button", { name: /^e4 WDL/ }).waitFor();
            saved = await page.evaluate(() => window.readFixtureState());
            assert.equal(saved.prepWorkspaces.length, queued ? 2 : 1);
            assert.equal(saved.databases.length, 4);
            assert.equal(saved.prepWorkspaces[0].userColor, "black");
            await page.screenshot({
              path: path.join(output, `${engine}-ready-black-${queued ? "home" : "link"}.png`),
              fullPage: true,
            });
          }
          checks.push({
            engine,
            prepLink: !queued,
            queuedHomePrep: queued,
            missingJob: fail,
            pass: true,
          });
          await context.close();
        }
      const prepContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      const prepPage = await prepContext.newPage();
      prepPage.setDefaultTimeout(6000);
      prepPage.on("pageerror", (error) =>
        errors.push({ engine, prep: true, error: error.message }),
      );
      await prepContext.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      await prepPage.goto(origin + "/" + relative + "/prep.html");
      await prepPage.getByRole("tab", { name: "Prep", exact: true }).click();
      const username = prepPage.getByRole("textbox", { name: "Username", exact: true });
      await prepPage.waitForFunction(
        () => document.querySelector('input[placeholder="All players"]')?.value === "Alex Example",
      );
      await prepPage.screenshot({
        path: path.join(output, `${engine}-initial-prep.png`),
        fullPage: true,
      });
      assert.equal(await prepPage.locator(".cg-wrap.orientation-white").count(), 1);
      await prepPage.getByText("I'm Black", { exact: true }).click();
      await prepPage.locator(".cg-wrap.orientation-black").waitFor();
      await prepPage.getByText("I'm White", { exact: true }).click();
      await prepPage.locator(".cg-wrap.orientation-white").waitFor();
      await username.fill("");
      await prepPage.getByRole("button", { name: "Builder", exact: true }).click();
      assert.equal(await username.inputValue(), "");
      async function choose(current, next) {
        await prepPage.getByRole("button", { name: current, exact: true }).click();
        await prepPage
          .getByRole("button", {
            name: new RegExp("^" + next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: |$)"),
          })
          .click();
      }
      await choose("Alex Example - OTB prep (12 games)", "Study games");
      assert.equal(await username.inputValue(), "");
      await choose("Study games", "Alex Example - OTB prep (12 games)");
      await prepPage.waitForFunction(
        () => document.querySelector('input[placeholder="All players"]')?.value === "Alex Example",
      );
      assert.equal(
        await prepPage.getByRole("radio", { name: "I'm White", exact: true }).isChecked(),
        true,
      );
      assert.equal(await prepPage.locator(".cg-wrap.orientation-white").count(), 1);
      await prepPage.screenshot({
        path: path.join(output, `${engine}-prep-white.png`),
        fullPage: true,
      });
      checks.push({
        engine,
        prepAutofill: true,
        manualClear: true,
        genericCollection: true,
        reselect: true,
        userSide: "white",
        pass: true,
      });
      await prepContext.close();
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
