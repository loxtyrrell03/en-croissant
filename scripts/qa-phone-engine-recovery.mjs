import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

// Actual panel and recovery coordinator; tiny invented transport, isolated storage.
const { chromium } = createRequire(
  process.env.PHONE_QA_DEPENDENCIES || process.env.FIDE_QA_DEPENDENCIES || import.meta.url,
)("playwright");
const root = process.cwd(),
  out = path.resolve("tmp/phone-engine-recovery-qa");
await fs.mkdir(out, { recursive: true });
const relative = path.relative(root, out).replaceAll("\\", "/");
await fs.writeFile(
  path.join(out, "index.html"),
  `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/${relative}/entry.tsx"></script>`,
);
await fs.writeFile(
  path.join(out, "entry.tsx"),
  `
import React from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider} from '@mantine/core';import '@mantine/core/styles.css';
import {EngineUnderBoardPanel} from '/src/web/WebApp';import {PHONE_ENGINE_SETTINGS_KEY,DEFAULT_PHONE_ENGINE_SETTINGS} from '/src/web/phoneEngineSettings';
import {PHONE_CPU_RESOURCES_KEY} from '/src/web/phoneCpuPreferences';import {PHONE_SEARCH_PREFERENCES_KEY} from '/src/web/phoneSearchPreferences';import {publishPcServicesStatus} from '/src/web/pcServices';
import {PcEngineConnectionError} from '/src/web/pcEngineConnection';
localStorage.setItem(PHONE_ENGINE_SETTINGS_KEY,JSON.stringify({...DEFAULT_PHONE_ENGINE_SETTINGS,enabled:true,useCloud:false,depth:14,multipv:3}));
localStorage.setItem(PHONE_CPU_RESOURCES_KEY,JSON.stringify({cpuResources:null}));localStorage.setItem(PHONE_SEARCH_PREFERENCES_KEY,JSON.stringify({limit:null,lines:null}));
publishPcServicesStatus({ok:true,service:'en-croissant-service-controller',enabled:true,home:true,engine:true,busy:false,error:null});
const lines=[['e2e4','e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6'],['d2d4','d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7'],['g1f3','Nf3 d5 d4 Nf6 c4 e6 Nc3 Bb4']].map(([move,pv],i)=>({source:'stockfish',executionLocation:'gaming-pc',depth:14,multipv:i+1,score:{type:'cp',value:28-i*10},uciMoves:[move],sanMoves:pv.split(' '),nodes:12345,nps:123456}));
window.fx={calls:[],released:0,played:[],lines,fail:(kind='connection')=>fx.calls.at(-1).reject(kind==='connection'?new PcEngineConnectionError('Invented network interruption'):new Error('Invented protocol mismatch. Check the saved engine settings.')),publish:()=>fx.calls.at(-1).request.onUpdate(lines),complete:()=>fx.calls.at(-1).resolve(lines)};
const realFetch=window.fetch;window.fetch=(url,options)=>new URL(String(url),location.href).origin===location.origin&&!new URL(String(url),location.href).pathname.startsWith('/api/')?realFetch(url,options):Promise.reject(new Error('Unexpected external fixture fetch'));
document.body.style.cssText='margin:0;background:#141416';
const compact=new URL(location.href).searchParams.get('compact')==='1';
createRoot(document.getElementById('root')).render(<MantineProvider forceColorScheme='dark'><main style={{padding:8,maxWidth:760,boxSizing:'border-box',margin:'auto'}}><p style={{fontSize:12,color:'#bbb'}}>Invented engine connection test</p><EngineUnderBoardPanel compact={compact} currentFen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' upcomingFens={[]} onAnalysisLinesChange={()=>{}} onPlayMove={move=>fx.played.push(move)}/></main></MantineProvider>);
`,
);
await fs.writeFile(
  path.join(out, "engine.ts"),
  `export function stopWebStockfish18Search(){};export async function releaseWebPcEngine(){window.fx.released++};export function analyzeWithWebStockfish18(request){return new Promise((resolve,reject)=>{window.fx.calls.push({request,resolve,reject});request.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});});}`,
);
await build({
  root,
  configFile: false,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^(.*\/)?stockfishEngine$/, replacement: path.join(out, "engine.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  build: {
    outDir: path.join(out, "bundle"),
    emptyOutDir: false,
    copyPublicDir: false,
    rollupOptions: { input: path.join(out, "index.html") },
  },
  logLevel: "warn",
});
const server = await preview({
  root,
  configFile: false,
  build: { outDir: path.join(out, "bundle") },
  preview: { host: "127.0.0.1", port: 0 },
});
const origin = server.resolvedUrls.local[0].replace(/\/$/, ""),
  checks = [],
  errors = [],
  external = [];
const executablePath = process.env.PHONE_QA_BROWSER_EXECUTABLE || undefined;
const browser = await chromium.launch({ headless: true, executablePath });
const browserEvidence = {
  version: browser.version(),
  executable: executablePath || chromium.executablePath(),
};
try {
  for (const compact of [true, false]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/${relative}/index.html?compact=${compact ? 1 : 0}`);
    await page.waitForFunction(() => window.fx.calls.length === 1);
    await page.evaluate(() => {
      fx.publish();
      fx.fail();
    });
    await page.getByText(/Previous result shown/).waitFor();
    await page.waitForFunction(() => fx.calls.length === 2);
    for (const width of [320, 390])
      for (const scale of [1, 2]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${16 * scale}px`;
        }, scale);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const metrics = await page.evaluate(() => {
          const notice = [...document.querySelectorAll('[role="status"]')].find((node) =>
            node.textContent.includes("Previous result shown"),
          );
          const retry = [...document.querySelectorAll("button")].find(
            (node) => node.textContent.trim() === "Retry analysis",
          );
          const title = document
            .querySelector('[class*="enginePanelTitleArea"] .mantine-Text-root')
            ?.getBoundingClientRect();
          const tools = document
            .querySelector('[class*="enginePanelHeaderRight"]')
            ?.getBoundingClientRect();
          const headerOverlap = !!(
            title &&
            tools &&
            Math.min(title.right, tools.right) - Math.max(title.left, tools.left) > 1 &&
            Math.min(title.bottom, tools.bottom) - Math.max(title.top, tools.top) > 1
          );
          return {
            headerOverlap,
            overflow: document.documentElement.scrollWidth > innerWidth,
            notice: notice && {
              x: notice.getBoundingClientRect().x,
              right: notice.getBoundingClientRect().right,
              height: notice.getBoundingClientRect().height,
              scrollHeight: notice.scrollHeight,
              clientHeight: notice.clientHeight,
            },
            retry: retry && {
              x: retry.getBoundingClientRect().x,
              right: retry.getBoundingClientRect().right,
            },
            width: innerWidth,
          };
        });
        assert.equal(metrics.overflow, false);
        assert.equal(metrics.headerOverlap, false);
        assert.ok(
          metrics.notice &&
            metrics.notice.x >= 0 &&
            metrics.notice.right <= width &&
            metrics.notice.scrollHeight <= metrics.notice.clientHeight + 1,
        );
        assert.ok(metrics.retry && metrics.retry.x >= 0 && metrics.retry.right <= width);
        assert.equal(
          await page
            .getByRole("button", {
              name: compact ? "Play compact engine line 1" : "Play engine line 1",
              exact: true,
            })
            .count(),
          1,
        );
        await page.screenshot({
          path: path.join(out, `${compact ? "compact" : "full"}-${width}-${scale}x.png`),
          fullPage: true,
        });
        checks.push(
          `${compact ? "compact" : "full"} recovery retains lines and visible Retry at ${width}px/${scale * 100}% text`,
        );
      }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "16px";
    });
    await page.getByRole("button", { name: "Retry analysis", exact: true }).click();
    await page.waitForFunction(() => fx.calls.length === 3);
    assert.equal(await page.evaluate(() => fx.calls[1].request.signal.aborted), true);
    assert.deepEqual(
      await page.evaluate(() =>
        fx.calls.map(({ request: r }) => [r.fen, r.multipv, r.depth, r.useStoredEvaluations]),
      ),
      Array(3).fill(["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 3, 14, false]),
    );
    await page.evaluate(() => fx.complete());
    await page
      .getByRole("button", { name: "Retry analysis", exact: true })
      .waitFor({ state: "hidden" });
    await page.evaluate(() => {
      dispatchEvent(new Event("focus"));
      dispatchEvent(new Event("pageshow"));
    });
    assert.equal(await page.evaluate(() => fx.calls.length), 3);
    checks.push(
      `${compact ? "compact" : "full"} explicit Retry keeps exact settings and settled focus does not restart`,
    );
    if (compact) {
      const toggle = page.getByRole("switch", { name: "Toggle Stockfish analysis" });
      await toggle.focus();
      await toggle.press("Space");
    } else await page.getByRole("button", { name: "Pause Stockfish", exact: true }).click();
    await page.evaluate(() => {
      dispatchEvent(new Event("pageshow"));
      dispatchEvent(new Event("online"));
    });
    assert.equal(await page.evaluate(() => fx.calls.length), 3);
    checks.push(`${compact ? "compact" : "full"} Off remains Off after resume`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(
    path.join(out, "receipt.json"),
    JSON.stringify({ browser: browserEvidence, checks, errors, external }, null, 2),
  );
  console.log(
    JSON.stringify({ browser: browserEvidence, checks: checks.length, errors, external, out }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
