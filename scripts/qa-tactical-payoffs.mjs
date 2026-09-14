// Isolated actual React result and browser-worker path on public fixtures.
// Does not touch an owner app, engine, saved game, or network chess service.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { makeSan } from "chessops/san";
import { directMaterialPayoffCases } from "../src/utils/tests/fixtures/directMaterialPayoff.ts";
import { castlingAliasCases } from "../src/utils/tests/fixtures/castlingRelevance.ts";
import {
  matingInterferenceCases,
  reflectMatingInterference,
} from "../src/utils/tests/fixtures/matingInterference.ts";

const require = createRequire(process.env.TACTICAL_QA_DEPENDENCIES || import.meta.url);
const { chromium } = require("playwright");
const castlingMode = process.argv.includes("--castling");
const interferenceMode = process.argv.includes("--interference");
const root = process.cwd(),
  output = resolve(
    root,
    interferenceMode
      ? "tmp/tactical-interference-adapter103"
      : castlingMode
        ? "tmp/tactical-castling-adapter102"
        : "tmp/tactical-payoffs-adapter101",
  );
await mkdir(output, { recursive: true });
const contexts = JSON.parse(
  await readFile("benchmarks/tactical-relevance/black-context-stockfish-18.json", "utf8"),
);
const quiet = contexts.cases.filter((row) =>
  ["context:BNbGN5Pe:ply15", "context:zcEVXTW1:ply89"].includes(row.id),
);
const cases = (
  interferenceMode
    ? matingInterferenceCases
        .filter((row) => row.id !== "already-blocked-defence")
        .flatMap((row) => [row, { ...reflectMatingInterference(row), id: `${row.id}:black` }])
        .map((row) => ({ ...row, pvUci: [row.move] }))
    : castlingMode
      ? castlingAliasCases
      : [
          ...directMaterialPayoffCases,
          ...quiet.map((row) => ({
            id: row.id,
            fen: row.fen,
            pvUci: row.engineLines[0].pvUci,
            previousFen: row.previousFen,
            previousMoveUci: row.previousMoveUci,
          })),
        ]
).map((row) => {
  const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  const pvSan = row.pvUci.map((uci) => {
    const move = parseUci(uci);
    assert(move && pos.isLegal(move));
    const san = makeSan(pos, move);
    pos.play(move);
    return san;
  });
  return { ...row, pvSan };
});
const relative = (file) =>
  "/" +
  resolve(output, file)
    .slice(root.length + 1)
    .replaceAll("\\", "/");
await writeFile(
  resolve(output, "entry.tsx"),
  `
import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{MantineProvider}from'@mantine/core';import'@mantine/core/styles.css';
import{TacticalScanResult}from'@/components/panels/tactics/TacticalScanResult';
import{classifyLiveTacticsInWorker}from'@/utils/tacticalMotifs/liveTacticsWorker';
const cases=${JSON.stringify(cases)};window.fixture={last:null,scan:null};
function App(){const[index,setIndex]=useState(0),[scale,setScale]=useState(1),[scan,setScan]=useState(null),[error,setError]=useState('');
window.fixture.select=(i,s)=>flushSync(()=>{window.fixture.last=null;window.fixture.scan=null;setScan(null);setError('');setIndex(i);setScale(s)});
useEffect(()=>{const controller=new AbortController();classifyLiveTacticsInWorker({...cases[index],depth:16,engineName:'Public fixture'},controller.signal).then(value=>{if(!controller.signal.aborted){window.fixture.scan=value;setScan(value)}}).catch(e=>{if(!controller.signal.aborted)setError(String(e))});return()=>controller.abort()},[index,scale]);
return <MantineProvider forceColorScheme="dark" theme={{scale}}><main style={{display:'flex',flexDirection:'column',height:'100vh',padding:12,boxSizing:'border-box'}}>{error?<p role="alert">{error}</p>:scan?<TacticalScanResult scan={scan} lastMoveSan={null} onPreviewChange={value=>window.fixture.last=value}/>:<p>Loading fixture</p>}</main></MantineProvider>}
createRoot(document.getElementById('root')).render(<App/>);`,
);
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
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
  const errors = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    assert.equal(new URL(route.request().url()).origin, origin, "No external requests");
    return route.continue();
  });
  for (const width of [1100, 760, 360])
    for (const scale of [1, 2]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(origin + relative("index.html"));
      for (const [index, row] of cases.entries()) {
        await page.evaluate(({ index, scale }) => window.fixture.select(index, scale), {
          index,
          scale,
        });
        if (interferenceMode && row.expected) {
          const button = page.getByRole("button", { name: /^Show .* on board$/ });
          await button.waitFor();
          await button.focus();
          await page.keyboard.press("Enter");
          const preview = await page.evaluate(() => ({
            main: window.fixture.last?.motifs[0]?.id,
            arrows: window.fixture.last?.arrows.map((arrow) => [arrow.from, arrow.to]),
            square: window.fixture.last?.labels[0]?.square,
          }));
          assert.equal(preview.main, "interference");
          assert.equal(preview.square, row.move.slice(2, 4));
          assert.deepEqual(
            preview.arrows,
            row.id.endsWith(":black")
              ? [
                  ["e3", "e2"],
                  ["b2", "h2"],
                  ["g4", "h5"],
                ]
              : [
                  ["e6", "e7"],
                  ["b7", "h7"],
                  ["g5", "h4"],
                ],
          );
          assert.equal(await page.locator("[data-tactical-candidate]").count(), 1);
          await page.locator("summary").focus();
          await page.keyboard.press("Enter");
          assert((await page.locator("main").innerText()).includes("Mating Interference"));
          if (width === 360 && scale === 2) {
            await page.screenshot({
              path: resolve(output, `${row.id.replaceAll(":", "-")}.png`),
              fullPage: true,
            });
            await page.locator(".mantine-ScrollArea-viewport").evaluate((element) => {
              element.scrollTop = 0;
            });
            await page.screenshot({
              path: resolve(output, `${row.id.replaceAll(":", "-")}-root.png`),
              fullPage: true,
            });
          }
        } else if (row.mate) {
          const button = page.getByRole("button", { name: /^Show .* on board$/ });
          await button.waitFor();
          await button.focus();
          await page.keyboard.press("Enter");
          const preview = await page.evaluate(() => ({
            main: window.fixture.last?.motifs[0]?.id,
            arrows: window.fixture.last?.arrows.map((arrow) => [arrow.from, arrow.to]),
            square: window.fixture.last?.labels[0]?.square,
          }));
          assert.equal(preview.main, "mateIn1");
          assert.deepEqual(preview.arrows, [
            [row.pvUci[0].slice(0, 2), row.kingTo],
            [row.rookFrom, row.rookTo],
          ]);
          assert.equal(preview.square, row.kingTo);
          if (width === 360 && scale === 2)
            await page.screenshot({
              path: resolve(output, row.id.replaceAll(":", "-") + ".png"),
              fullPage: true,
            });
        } else if (row.label) {
          const button = page.getByRole("button", { name: /^Show .* on board$/ });
          await button.waitFor();
          assert.equal(await page.locator("details[open]").count(), 0);
          await button.click();
          const preview = await page.evaluate(() => ({
            main: window.fixture.last?.motifs[0]?.id,
            arrows: window.fixture.last?.arrows,
            labels: window.fixture.last?.labels,
          }));
          assert.equal(preview.main, row.theme);
          assert(preview.arrows.every((arrow) => arrow.ply === 1));
          assert(!preview.labels.some((label) => label.text.includes("Payoff")));
          // The actual keyboard path opens the collapsed per-ply detail.
          await page.locator("summary").focus();
          await page.keyboard.press("Enter");
          await page.getByText(row.label, { exact: true }).waitFor();
          const payoffText = await page.locator('[data-tactical-ply="3"]').innerText();
          assert(
            payoffText.toLowerCase().includes(row.label.toLowerCase()),
            `${row.id}: ${payoffText}`,
          );
          assert(
            !(await page.locator('[data-tactical-ply="1"]').innerText())
              .toLowerCase()
              .includes("payoff"),
          );
          assert(!(await page.locator("main").innerText()).toLowerCase().includes("hanging piece"));
          await page.locator('[data-tactical-ply="3"]').scrollIntoViewIfNeeded();
          const expandedOverflow = await page
            .locator("[data-tactical-ply]")
            .evaluateAll((elements) =>
              elements
                .filter((element) => {
                  const rect = element.getBoundingClientRect();
                  return (
                    rect.width &&
                    (rect.left < -1 ||
                      rect.right > innerWidth + 1 ||
                      element.scrollWidth > element.clientWidth + 2)
                  );
                })
                .map((element) => element.textContent),
            );
          assert.deepEqual(expandedOverflow, [], "Expanded move labels and explanations fit");
          if (width === 360 && scale === 2)
            await page.screenshot({ path: resolve(output, `${row.id}-360-2.png`), fullPage: true });
          await page.locator("summary").focus();
          await page.keyboard.press("Enter");
          assert.equal(await page.locator("details[open]").count(), 0);
        } else {
          await page.getByText("No tactical theme verified", { exact: true }).waitFor();
          assert.equal(await page.locator("[data-tactical-candidate]").count(), 0);
        }
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll("button, summary, [data-tactical-ply]")]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return (
                rect.width &&
                (rect.left < -1 ||
                  rect.right > innerWidth + 1 ||
                  element.scrollWidth > element.clientWidth + 2)
              );
            })
            .map((element) => element.textContent),
        );
        assert.deepEqual(overflow, [], "Visible controls and per-ply text fit the viewport");
        checks.push({ id: row.id, width, scale, passed: true });
      }
    }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        scope:
          "Actual React component and browser verifier, public synthetic/frozen engine inputs. Keyboard details, board-preview callback and 1100/760/360px at 100/200% text. Not an owner app or physical board test.",
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${checks.length} real-component/browser-worker layout and interaction groups passed.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
