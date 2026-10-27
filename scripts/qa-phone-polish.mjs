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
const output = path.resolve(process.env.PHONE_QA_OUTPUT || "tmp/phone-polish/renderer");
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
 localStorage.setItem(PHONE_ENGINE_SETTINGS_KEY,JSON.stringify({...DEFAULT_PHONE_ENGINE_SETTINGS,enabled:false}));
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
const selectedScenarios = process.env.PHONE_QA_SCENARIOS?.split(",");
const receiptPath = path.join(output, selectedScenarios ? "focused-receipt.json" : "receipt.json");
const scenarios = [
  ["board", "Moves"],
  ["board", "Prep"],
  ["board", "Database"],
  ["board", "Analysis"],
  ["board", "Coach"],
  ["import", null],
  ["files", null],
  ["tournaments", null],
  ["review", null],
  ["stats", null],
].filter(
  ([view, panel]) => !selectedScenarios || selectedScenarios.includes(`${view}:${panel ?? ""}`),
);
async function measurements(page) {
  return page.evaluate(() => {
    const width = innerWidth,
      visible = (el) =>
        el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0;
    const elements = [
      ...document.querySelectorAll(
        'button,[role="tab"],input:not([type="hidden"]),textarea,select,.mantine-SegmentedControl-root',
      ),
    ].filter(visible);
    const overflow = elements
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: (
            el.getAttribute("aria-label") ||
            el.textContent ||
            el.getAttribute("placeholder") ||
            ""
          )
            .trim()
            .slice(0, 100),
          x: r.x,
          width: r.width,
          height: r.height,
        };
      })
      .filter((r) => r.x < -1 || r.x + r.width > width + 1);
    const clipped = [
      ...document.querySelectorAll(".mantine-Button-label,.mantine-SegmentedControl-label,[data-hosted-path] .mantine-Badge-label"),
    ]
      .filter(visible)
      .flatMap((el) => {
        const r = el.getBoundingClientRect(),
          range = document.createRange();
        range.selectNodeContents(el);
        const t = range.getBoundingClientRect();
        return t.width > r.width + 2 || t.height > r.height + 2
          ? [
              {
                text: el.textContent.trim(),
                labelWidth: r.width,
                textWidth: t.width,
                labelHeight: r.height,
                textHeight: t.height,
              },
            ]
          : [];
      });
    const engineHeaderClipped = [
      ...document.querySelectorAll(
        '[class*="enginePanelTitleArea"] .mantine-Text-root,[class*="enginePanelTitleArea"] .mantine-Code-root',
      ),
    ]
      .filter(visible)
      .flatMap((el) => {
        const bounds = el.getBoundingClientRect(),
          range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        return text.width > bounds.width + 2 || text.height > bounds.height + 2
          ? [
              {
                text: el.textContent.trim(),
                labelWidth: bounds.width,
                textWidth: text.width,
                labelHeight: bounds.height,
                textHeight: text.height,
              },
            ]
          : [];
      });
    return {
      viewport: width,
      pageWidth: document.documentElement.scrollWidth,
      overflow,
      clipped,
      engineHeaderClipped,
    };
  });
}
try {
  for (const [width, scale] of [
    [320, 1],
    [390, 1],
    [760, 1],
    [320, 2],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror", (e) => errors.push({ width, scale, error: e.message }));
    await page.goto(`${origin}/${relative}/index.html`);
    await page.locator('button[data-view="import"]').click();
    const paste = page.getByLabel("Paste PGN or FEN", { exact: true });
    await paste.fill(fixturePgn);
    // Real component handoff, parser and IndexedDB session, rather than a drawn fixture.
    await page.getByRole("button", { name: "Import pasted games", exact: true }).click();
    await page.locator('[data-panel="moves"]').waitFor();
    const notice = page.locator(".mantine-Notification-root").filter({ hasText: "PGN imported" });
    await notice.getByRole("button").click();
    await notice.waitFor({ state: "hidden" });
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, scale);
    for (const [view, panel] of scenarios) {
      const name = `${view}${panel ? "-" + panel.toLowerCase() : ""}-${width}-${scale}`;
      try {
        await page.locator(`button[data-view="${view}"]`).click();
        if (panel) await page.getByRole("tab", { name: panel, exact: true }).click();
        await page.waitForFunction(() =>
          document
            .getAnimations()
            .every(
              (animation) =>
                animation.playState !== "running" ||
                animation.effect.getTiming().iterations === Infinity,
            ),
        );
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const result = await measurements(page);
        await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
        checks.push({
          name,
          pass:
            result.pageWidth <= width + 1 &&
            result.overflow.length === 0 &&
            result.clipped.length === 0 &&
            result.engineHeaderClipped.length === 0,
          ...result,
        });
      } catch (e) {
        checks.push({ name, pass: false, error: String(e) });
      }
    }
    if (!selectedScenarios && scale === 1 && width === 390) {
      await page.locator('button[data-view="board"]').click();
      await page.getByRole("button", { name: "First move", exact: true }).click();
      await page.getByRole("button", { name: "Next move", exact: true }).click();
      const board = page.locator("cg-board").first();
      await board.scrollIntoViewIfNeeded();
      const bounds = await board.boundingBox();
      await board.tap({ position: { x: (bounds.width * 2.5) / 8, y: (bounds.height * 1.5) / 8 } });
      await board.tap({ position: { x: (bounds.width * 2.5) / 8, y: (bounds.height * 3.5) / 8 } });
      await page.waitForFunction(
        () =>
          window.fx.session
            .getSnapshot()
            .state.board.line.map((move) => move.san)
            .join(",") === "e4,c5",
      );
      const game = await page.evaluate(() => {
        const state = window.fx.session.getSnapshot().state;
        return state.gamesByDatabase[state.board.sourceDatabaseId].find(
          (game) => game.id === state.board.sourceGameId,
        );
      });
      assert.deepEqual(
        game.moves.map((move) => move.san),
        ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
      );
      assert.deepEqual(
        game.moves[0].variations[0].map((move) => move.san),
        ["c5"],
      );
      await page.getByRole("button", { name: "Reset position", exact: true }).click();
      assert.equal(
        await page.evaluate(() => window.fx.session.getSnapshot().state.board.cursor),
        0,
      );
      assert.deepEqual(
        await page.evaluate(() =>
          window.fx.session.getSnapshot().state.board.line.map((m) => m.san),
        ),
        ["e4", "c5"],
      );
      await page.getByRole("button", { name: "Reset line", exact: true }).click();
      assert.equal(
        await page.evaluate(() => window.fx.session.getSnapshot().state.board.cursor),
        1,
      );
      assert.deepEqual(
        await page.evaluate(() =>
          window.fx.session.getSnapshot().state.board.line.map((move) => move.san),
        ),
        ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
      );
      await page.getByRole("button", { name: "1... c5", exact: true }).click();
      assert.deepEqual(
        await page.evaluate(() =>
          window.fx.session.getSnapshot().state.board.line.map((move) => move.san),
        ),
        ["e4", "c5"],
      );
      // Chessground animates pieces with requestAnimationFrame, not CSS transitions.
      // Verify the rendered c5 pawn has arrived, not only the saved line.
      await page.waitForFunction(() => {
        const board = document.querySelector("cg-board"),
          bounds = board.getBoundingClientRect();
        return [...board.querySelectorAll("piece.black.pawn")].some((piece) => {
          const rect = piece.getBoundingClientRect();
          return (
            Math.abs(rect.x + rect.width / 2 - (bounds.x + (bounds.width * 2.5) / 8)) < 2 &&
            Math.abs(rect.y + rect.height / 2 - (bounds.y + (bounds.height * 3.5) / 8)) < 2
          );
        });
      });
      await page.screenshot({
        path: path.join(output, "variation-touch-mainline-390.png"),
        fullPage: true,
      });
      checks.push({ name: "touch-variation-preserves-mainline-and-reselects", pass: true });
      checks.push({ name: "visible-position-and-line-resets-retain-variation", pass: true });
      await page.locator('button[data-view="import"]').click();
      await paste.fill("invalid example input");
      await page.getByRole("button", { name: "Import pasted games", exact: true }).click();
      assert.equal(await paste.inputValue(), "invalid example input");
      const invalid = await measurements(page);
      await page.screenshot({ path: path.join(output, "import-invalid-390.png"), fullPage: true });
      checks.push({ name: "invalid-import-retains-draft", pass: true, ...invalid });
      await paste.fill("8/8/8/8/8/4k3/8/4K3 w - - 0 1");
      await page.getByRole("button", { name: "Open position", exact: true }).click();
      try {
        await page.locator("[data-panel]").waitFor();
        assert.equal(
          await page.evaluate(() => window.fx.session.getSnapshot().state.board.startFen),
          "8/8/8/8/8/4k3/8/4K3 w - - 0 1",
        );
        checks.push({ name: "fen-opens-exact-position", pass: true });
      } catch (error) {
        checks.push({
          name: "fen-opens-exact-position",
          pass: false,
          error: String(error),
          visibleText: await page.locator("main").innerText(),
        });
        await page.screenshot({ path: path.join(output, "fen-import-failed.png"), fullPage: true });
      }
      await page.locator('button[data-view="import"]').click();
      await paste.fill("draft retained across navigation");
      await page.locator('button[data-view="files"]').click();
      await page.locator('button[data-view="import"]').click();
      assert.equal(await paste.inputValue(), "draft retained across navigation");
      checks.push({ name: "manual-import-draft-navigation", pass: true });
    }
    await page.locator('button[data-view="files"]').click();
    await page.getByRole("button", { name: "Open archive", exact: true }).click();
    const archiveRootLayout = await measurements(page);
    checks.push({
      name: `archive-routing-label-${width}-${scale}`,
      pass: archiveRootLayout.overflow.length === 0 && archiveRootLayout.clipped.length === 0,
      ...archiveRootLayout,
    });
    await page.locator('[data-hosted-path="Archive examples"] > button').click();
    await page.locator('[data-hosted-path="Archive examples/old.pgn"]').waitFor();
    assert.equal(
      await page.locator('[data-hosted-path="Archive examples/current.pgn"]').count(),
      0,
    );
    const archiveLayout = await measurements(page);
    await page.screenshot({
      path: path.join(output, `archive-only-${width}-${scale}.png`),
      fullPage: true,
    });
    checks.push({
      name: `archive-only-nested-${width}-${scale}`,
      pass: archiveLayout.overflow.length === 0 && archiveLayout.clipped.length === 0,
      ...archiveLayout,
    });
    await page.getByRole("button", { name: "Back to active sources", exact: true }).click();
    assert.equal(await page.locator('[data-hosted-path="Archive examples/old.pgn"]').count(), 0);
    await page.locator('[data-hosted-path="Archive examples/current.pgn"]').waitFor();
    await page.evaluate(() => {
      sessionStorage.setItem("fixture-latest-build", "fixture-new");
      window.dispatchEvent(new Event("focus"));
    });
    const update = page.getByRole("button", { name: "Update app", exact: true });
    await update.waitFor();
    const updateLayout = await measurements(page);
    checks.push({
      name: `update-visible-${width}-${scale}`,
      pass: updateLayout.overflow.length === 0 && updateLayout.clipped.length === 0,
      ...updateLayout,
    });
    if (width === 390 && scale === 1) {
      await page.locator('button[data-view="import"]').click();
      await paste.fill("Keep this unfinished PGN draft across update");
      const countBefore = await page.evaluate(
        () => window.fx.session.getSnapshot().state.databases.length,
      );
      await Promise.all([page.waitForEvent("load"), update.click()]);
      await page.locator('button[data-view="import"]').click();
      assert.equal(await paste.inputValue(), "Keep this unfinished PGN draft across update");
      assert.equal(
        await page.evaluate(() => window.fx.session.getSnapshot().state.databases.length),
        countBefore,
      );
      assert.equal(await page.getByRole("button", { name: "Update app", exact: true }).count(), 0);
      checks.push({ name: "update-reloads-new-build-and-retains-workspace-and-paste", pass: true });
    }
    await context.close();
  }
} finally {
  await fs.writeFile(receiptPath, JSON.stringify({ checks, errors, external }, null, 2));
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
console.log(
  JSON.stringify(
    {
      passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass),
      errors,
      externalRequestsBlocked: external.length,
      receipt: receiptPath,
    },
    null,
    2,
  ),
);
if (checks.some((c) => !c.pass) || errors.length) process.exitCode = 1;
