import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

// Built application, invented tiny game/library, fresh browser context only.
// All API requests are fixtures; no owner service, browser profile or data access.
const dependencyRoot = process.env.PHONE_QA_DEPENDENCIES || process.env.FIDE_QA_DEPENDENCIES;
const { chromium } = createRequire(dependencyRoot || import.meta.url)("playwright");
const root = process.cwd();
const output = path.resolve(process.env.PHONE_QA_OUTPUT || "tmp/phone-engine-spacing/renderer");
await fs.mkdir(output, { recursive: true });
const relative = path.relative(root, output).replaceAll("\\", "/");
const fixturePgn =
  '[Event "Invented example"]\n[White "Jordan Vale"]\n[Black "Sam Rivera"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {createEmptyWebState} from '/src/web/storage';import {webStateSession} from '/src/web/webStateSession';
import {parsePgnDatabase} from '/src/web/pgn';
import {DEFAULT_PHONE_ENGINE_SETTINGS,PHONE_ENGINE_SETTINGS_KEY} from '/src/web/phoneEngineSettings';
const pgn=${JSON.stringify(fixturePgn)};
const imported=parsePgnDatabase('Example study.pgn',pgn,1234);
const fx=window.fx={session:webStateSession,calls:[],pgn};
async function setup(){
 localStorage.setItem(PHONE_ENGINE_SETTINGS_KEY,JSON.stringify({...DEFAULT_PHONE_ENGINE_SETTINGS,enabled:true}));
 const state=createEmptyWebState();state.databases=[imported.database];state.gamesByDatabase[imported.database.id]=imported.games;
 state.sourceArchives={databaseIds:[],hostedPaths:['Archive examples/old.pgn']};
 const build=document.createElement('meta');build.name='en-croissant-build';build.content=sessionStorage.getItem('fixture-latest-build')||'fixture-old';document.head.append(build);
 await new Promise((resolve,reject)=>{const request=indexedDB.open('en-croissant-web-companion',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),read=store.get('main');read.onsuccess=()=>{if(!read.result)store.put(state,'main')};tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}});
 const realFetch=window.fetch;
 const files=[{type:'file',name:'Example study',filename:'Example study.pgn',extension:'pgn',path:'Example study.pgn',url:'/web-library/files/example.pgn',lastModified:1234,sizeBytes:pgn.length},{type:'file',name:'Long example opening repertoire and endgame notes',filename:'Long example opening repertoire and endgame notes.pgn',extension:'pgn',path:'Long example opening repertoire and endgame notes.pgn',url:'/web-library/files/long.pgn',lastModified:1234,sizeBytes:pgn.length}];
 for(const name of ['old','current'])files.push({type:'file',name:name==='old'?'Long archived example repertoire and annotated practice games':name,filename:name+'.pgn',extension:'pgn',path:'Archive examples/'+name+'.pgn',url:'/web-library/files/'+name+'.pgn',lastModified:1234,sizeBytes:pgn.length});
 window.fetch=async(url,options={})=>{const u=new URL(typeof url==='string'?url:url.url,location.href),p=u.pathname;fx.calls.push({path:p,method:options.method||'GET'});
  if(p==='/api/pc-services')return Response.json({ok:true,service:'en-croissant-service-controller',enabled:true,busy:false,home:true,engine:true,error:null});
  if(p==='/api/personal-sync/status')return Response.json({enabled:false});
  if(p==='/app-version.json')return Response.json({sourceCommit:sessionStorage.getItem('fixture-latest-build')||'fixture-old'});
  if(p==='/api/tournaments'){const body=JSON.parse(options.body||'{}');return Response.json({result:body.method==='settingsGet'?null:body.method==='discoverTournaments'?{events:[],sourceCount:0,sourceLimitReached:false,fetchedAt:new Date().toISOString()}:[]});}
  if(p==='/api/web-state')return Response.json({state:{}});
  if(p.endsWith('/web-library/manifest.json'))return Response.json({version:1,generatedAt:'2026-10-27T09:00:00Z',sourceName:'Invented QA library',files});
  if(p.includes('/web-library/files/'))return new Response(pgn);
  if(p.startsWith('/api/')||p.startsWith('/v1/'))return Response.json({error:'Unavailable in isolated UI fixture'},{status:404});
  return realFetch(url,options);
 };
 Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>({update:async()=>{}}),addEventListener(){},removeEventListener(){}}});
 const{default:WebApp}=await import('/src/web/WebApp');createRoot(document.getElementById('root')).render(<WebApp/>);
}
void setup();
`;
await fs.writeFile(path.join(output, "entry.tsx"), entry);
await fs.writeFile(
  path.join(output, "engine.ts"),
  `
export function stopWebStockfish18Search(){}; export async function releaseWebPcEngine(){};
export async function analyzeWithWebStockfish18(request){
 const moves=['Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Nb8','d4','Nbd7','Nbd2','Bb7','Bc2','Re8','Nf1','Bf8','Ng3','g6','a4','c5'];
 const lines=Array.from({length: request.multipv || 3},(_,i)=>({source:'stockfish',multipv:i+1,depth:18,score:{type:'cp',value:32-i*10},uciMoves:['b5a4','g8f6'],sanMoves:moves,nodes:1250000,nps:450000,timeMs:2800}));
 if(window.fx.engineState==='error') throw new Error('Example connection unavailable. Retry when the PC is ready.');
 if(window.fx.engineState==='loading') return new Promise(()=>{});
 request.onProgress?.(lines);return lines;
}`,
);
await fs.writeFile(
  path.join(output, "auth.ts"),
  "export async function loadSharedLichessCredential(){return null} export async function saveSharedLichessCredential(){}\n",
);
await fs.writeFile(
  path.join(output, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/${relative}/entry.tsx"></script></body></html>`,
);
if (!process.argv.includes("--reuse-build"))
  await build({
    root,
    configFile: false,
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^(.*\/)?stockfishEngine$/, replacement: path.join(output, "engine.ts") },
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
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });
const checks = [],
  errors = [],
  external = [];
try {
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [320, 740],
    [320, 568],
    [430, 932],
    [760, 1000],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/${relative}/index.html`);
    await page.locator('button[data-view="import"]').click();
    await page.getByLabel("Paste PGN or FEN", { exact: true }).fill(fixturePgn);
    await page.getByRole("button", { name: "Import pasted games", exact: true }).click();
    const notice = page.locator(".mantine-Notification-root").filter({ hasText: "PGN imported" });
    await notice.getByRole("button").click();
    await notice.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Play engine line 3", exact: true }).waitFor();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const movesEngine = await page.locator('[class*="enginePanelShell"]').boundingBox();
    checks.push({
      name: "moves-engine-" + width + "-" + height,
      pass: height < 650 || movesEngine.y + movesEngine.height <= height,
    });
    await page.getByRole("tab", { name: "Analysis", exact: true }).click();
    await page.getByRole("button", { name: "Play engine line 3", exact: true }).waitFor();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              scrollTo(0, 0);
              resolve();
            }),
          ),
        ),
    );
    const layout = await page.evaluate(() => {
      const bounds = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        board: bounds("cg-board"),
        engine: bounds('[class*="enginePanelShell"]'),
        overflow: document.documentElement.scrollWidth > innerWidth,
        rows: [...document.querySelectorAll('[class*="engineAnalysisMoveButton"]')].map((el) => ({
          height: el.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(el).lineHeight),
          nowrap: getComputedStyle(el).whiteSpace === "nowrap",
        })),
      };
    });
    const fits = layout.board.top >= 0 && layout.engine.bottom <= height && !layout.overflow;
    checks.push({
      name: `live-${width}-${height}`,
      pass:
        (height < 650 ? layout.board.width >= 176 && !layout.overflow : fits) &&
        layout.rows.every((r) => r.nowrap),
      ...layout,
    });
    await page.screenshot({
      path: path.join(output, `live-${width}-${height}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Play engine line 1", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.fx.session.getSnapshot().state.board.line.at(-1).uci),
      "b5a4",
    );
    checks.push({ name: `play-first-move-${width}`, pass: true });
    if (width === 390) {
      await page.getByRole("button", { name: "Engine settings", exact: true }).click();
      await page.getByText("Nodes", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.getByRole("button", { name: "Engine settings", exact: true }).click();
      checks.push({ name: "settings-and-metrics-reachable", pass: true });
      for (const state of ["off", "loading", "error"]) {
        await page.getByRole("button", { name: /^Pause Stockfish/ }).click();
        if (state !== "off") {
          await page.evaluate((state) => {
            window.fx.engineState = state;
          }, state);
          await page.getByRole("button", { name: /^Start Stockfish/ }).click();
        }
        await page
          .getByText(
            state === "off"
              ? "Inactive engine"
              : state === "loading"
                ? /Waiting for Stockfish lines/
                : "Engine unavailable",
            { exact: state !== "loading" },
          )
          .waitFor();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  scrollTo(0, 0);
                  resolve();
                }),
              ),
            ),
        );
        const bounds = await page.locator('[class*="enginePanelShell"]').boundingBox();
        checks.push({ name: state + "-fits", pass: bounds.y + bounds.height <= height });
        await page.screenshot({ path: path.join(output, state + ".png"), fullPage: true });
        if (state === "off") await page.getByRole("button", { name: /^Start Stockfish/ }).click();
      }
      await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: path.join(output, "large-text.png"), fullPage: true });
      checks.push({ name: "large-text-scrolls-without-horizontal-clipping", pass: true });
    }
    await context.close();
  }
} finally {
  await fs.writeFile(
    path.join(output, "receipt.json"),
    JSON.stringify({ checks, errors, external }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
console.log(JSON.stringify({ checks, errors }, null, 2));
if (checks.some((c) => !c.pass) || errors.length) process.exitCode = 1;
