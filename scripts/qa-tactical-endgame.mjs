// Isolated real React result/lookup/worker path. Public tablebase HTTP replies
// are intercepted fixtures; no owner app or private position is accessed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(process.env.TACTICAL_QA_DEPENDENCIES || import.meta.url);
const { chromium } = require("playwright");
const captureMode = process.argv.includes("--drawing-capture");
const root = process.cwd(),
  output = resolve(
    root,
    captureMode ? "tmp/tactical-drawing-capture-adapter109" : "tmp/tactical-endgame-adapter109",
  );
await mkdir(output, { recursive: true });
const receipt = JSON.parse(
  await readFile(
    captureMode
      ? "benchmarks/tactical-relevance/drawing-capture-tablebase-verified.json"
      : "benchmarks/tactical-relevance/tablebase-relevance-verified.json",
    "utf8",
  ),
);
const row = receipt.cases.find((r) => r.id === (captureMode ? "king-rook-rescue" : "EKWHC:g4f4"));
const records = captureMode
  ? [{ fen: row.fen, result: row.result }]
  : receipt.queries.filter((r) => r.id === row.id);
const moveLabel = captureMode ? "Kxe5" : "Kf4";
const headline = captureMode ? "Drawing Capture found" : "Zugzwang found";
const verifiedText = captureMode
  ? "Saving draw verified after Kxe5."
  : "Zugzwang verified after Kf4.";
await writeFile(
  resolve(output, "entry.tsx"),
  `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{MantineProvider}from'@mantine/core';import'@mantine/core/styles.css';
import{TacticalEndgameResult}from'@/components/panels/tactics/TacticalEndgameResult';
import{buildLiveTacticalScan}from'@/utils/tacticalMotifs/liveTactics';
const input={fen:${JSON.stringify(row.fen)},pvUci:${JSON.stringify(captureMode ? [row.move] : ["g4f4", "f6e6", "f4e4", "e6d6", "e4f5"])},engineName:'Stockfish',depth:16};
const scan=buildLiveTacticalScan(input);window.fixture={last:null,updates:0};
function App(){const[epoch,setEpoch]=useState(0);const[scale,setScale]=useState(1);
window.fixture.reset=()=>flushSync(()=>{window.fixture.last=null;window.fixture.updates=0;setEpoch(v=>v+1)});
window.fixture.scale=v=>flushSync(()=>setScale(v));
return <MantineProvider forceColorScheme="dark" theme={{scale}}><main style={{display:'flex',flexDirection:'column',height:'100vh',padding:12,boxSizing:'border-box'}}><TacticalEndgameResult key={epoch} scan={scan} input={input} onPreviewChange={value=>{window.fixture.last=value;window.fixture.updates++}}/></main></MantineProvider>}
createRoot(document.getElementById('root')).render(<App/>);`,
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
  plugins: [react()],
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
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let mode = "ok",
    calls = 0,
    held = [];
  const reply = async (route) => {
    const fen = new URL(route.request().url()).searchParams.get("fen");
    const record = records.find((r) => r.fen === fen);
    assert(record, "Unexpected position sent by the component");
    await route.fulfill({
      status: mode === "error" ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(record.result),
    });
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    assert.equal(url.origin, "https://tablebase.lichess.org", "No unrelated external requests");
    calls++;
    if (mode === "hold") held.push(route);
    else await reply(route);
  });
  const open = async (width, scale) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(origin + relative("index.html"));
    await page.getByRole("button", { name: `Verify ${moveLabel} online`, exact: true }).waitFor();
    await page.evaluate((value) => window.fixture.scale(value), scale);
  };
  const fit = async () => {
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.width &&
            (r.left < -1 || r.right > innerWidth + 1 || e.scrollWidth > e.clientWidth + 2)
          );
        })
        .map((e) => e.textContent),
    );
    assert.deepEqual(bad, [], "Actions stay inside the viewport without clipped text");
  };
  for (const width of [1100, 760, 360])
    for (const scale of [1, 2]) {
      calls = 0;
      mode = "hold";
      held = [];
      await open(width, scale);
      await fit();
      assert.equal(calls, 0);
      await page.getByRole("button", { name: `Verify ${moveLabel} online`, exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Cancel verification", exact: true }).waitFor();
      await fit();
      await page.getByText("No tactical theme verified", { exact: true }).waitFor();
      await page.screenshot({ path: resolve(output, `loading-${width}-${scale}.png`) });
      // Wait for the actual request, not a timing guess.
      const deadline = Date.now() + 10000;
      while (!held.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert(held.length, "The explicit action must issue its bounded lookup");
      mode = "ok";
      await reply(held.shift());
      await page.getByText(headline, { exact: true }).waitFor();
      await page.getByText(verifiedText, { exact: true }).waitFor();
      assert.equal(calls, captureMode ? 1 : 2);
      await fit();
      const geometry = await page.evaluate(() => ({
        arrows: window.fixture.last.arrows.map((a) => [a.from, a.to]),
        labels: window.fixture.last.labels.map((l) => [l.text, l.square]),
      }));
      assert.deepEqual(
        geometry,
        captureMode
          ? { arrows: [["e4", "e5"]], labels: [["Drawing Capture", "e5"]] }
          : { arrows: [["g4", "f4"]], labels: [["Zugzwang", "f6"]] },
      );
      await page.screenshot({ path: resolve(output, `verified-${width}-${scale}.png`) });
      const scroll = await page
        .locator(".mantine-ScrollArea-viewport")
        .first()
        .evaluate((el) => {
          el.scrollTop = el.scrollHeight;
          return { max: el.scrollHeight - el.clientHeight, reached: el.scrollTop };
        });
      assert(
        Math.abs(scroll.max - scroll.reached) <= 2,
        "The full explanation remains scrollable at large text sizes",
      );
      await page.screenshot({ path: resolve(output, `verified-bottom-${width}-${scale}.png`) });
      checks.push({ width, scale, state: "offline/loading/verified", geometry });
    }
  await open(360, 2);
  mode = "error";
  await page.getByRole("button", { name: `Verify ${moveLabel} online`, exact: true }).click();
  await page.getByText("Online verification unavailable", { exact: true }).waitFor();
  await fit();
  await page.screenshot({ path: resolve(output, "error-360-2.png") });
  mode = "ok";
  await page.getByRole("button", { name: "Retry endgame check", exact: true }).click();
  await page.getByText(headline, { exact: true }).waitFor();
  checks.push({ state: "error/retry" });
  await open(360, 1);
  mode = "hold";
  held = [];
  await page.getByRole("button", { name: `Verify ${moveLabel} online`, exact: true }).click();
  await page.getByRole("button", { name: "Cancel verification", exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixture.updates), 0);
  await page.getByText("No tactical theme verified", { exact: true }).waitFor();
  checks.push({ state: "cancel/local-retention" });
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        scope:
          "Isolated actual React, lookup and browser worker with fixture HTTP; not native WebView or live-provider proof.",
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks: checks.length, errors, output }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
