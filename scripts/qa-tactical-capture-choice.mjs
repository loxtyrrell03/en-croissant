// Real existing game-info panel, exported only in this isolated QA build.
// No owner workspace, Tauri operation, running service or external request.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(process.env.TACTICAL_QA_DEPENDENCIES || import.meta.url);
const { chromium } = require("playwright");
const natureMode = process.argv.includes("--nature");
const discoveryMode = process.argv.includes("--discovery");
const alternativeMode = process.argv.includes("--alternative");
const root = process.cwd(),
  output = resolve(
    root,
    alternativeMode ? "tmp/mistake-alternative-adapter113" : discoveryMode ? "tmp/mistake-discovery-adapter107" : natureMode ? "tmp/mistake-nature-v4" : "tmp/tactical-capture-choice-adapter105",
  );
await mkdir(output, { recursive: true });
const relative = (name) =>
  "/" +
  resolve(output, name)
    .slice(root.length + 1)
    .replaceAll("\\", "/");
await writeFile(
  resolve(output, "entry.tsx"),
  `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{MantineProvider}from'@mantine/core';import'@mantine/core/styles.css';
import{TacticalAuditGameInfoPanel}from'@/components/review/OpeningReviewWorkspace';
import{classifyMistakeReviewMotifs}from'@/utils/tacticalMotifs/mistakeReviewAdapter';
import{classifyMistakeReviewNature,migrateMistakeReviewDeckNatureClassifications,migrateMistakeReviewDeckMotifClassifications}from'@/utils/mistakeReview';
import{positionSchema}from'@/components/files/opening';
import{alternativeCaptureInput}from'@/utils/tests/fixtures/alternativeCapture';
const input={fen:'1rr3k1/5ppp/2B1b3/5p2/6N1/1P6/P1P2PPP/R3R1K1 b - - 0 21',bestMoveUci:'c8c6',playedMoveUci:'f5g4',pvUci:['c8c6','g4e5','c6c2'],pvSan:['Rxc6','Ne5','Rxc2'],refutationUci:['c6e4','c8c5','a2a4'],refutationSan:['Be4','Rc5','a4']};
const review={...input,...classifyMistakeReviewMotifs(input),playerColor:'black',playerName:'Public game example',opponent:'Opponent',severity:'mistake'};
const position={fen:input.fen,sideToMove:'black',answer:'Rxc6',answerUci:'c8c6',card:{},mistakeReview:review};
const samples={
alternative:alternativeCaptureInput,
discovery:{fen:'5rk1/Q1RR1pp1/4p2p/8/4KP2/3rP3/P1q3PP/8 b - - 1 30',bestMoveUci:'d3d7',bestMoveSan:'Rxd7+',playedMoveUci:'f7f5',playedMoveSan:'f5+',pvUci:['d3d7','c7c2','d7a7'],refutationUci:['e4f3'],cpLoss:521},
capture:{...input,cpLoss:269},
quiet:{fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',bestMoveUci:'g1f3',bestMoveSan:'Nf3',playedMoveUci:'h2h3',playedMoveSan:'h3',pvUci:['g1f3','g8f6','g2g3','g7g6'],refutationUci:['g8f6','g1f3','g7g6','g2g3'],cpLoss:60,reachedDepth:18},
fork:{fen:'4k3/8/8/8/1n6/8/8/R3K2R b KQ - 0 1',bestMoveUci:'b4c2',bestMoveSan:'Nc2+',playedMoveUci:'e8d7',playedMoveSan:'Kd7',pvUci:['b4c2'],cpLoss:300}
};
window.fixture={};function App(){const[scale,setScale]=useState(1),[reveal,setReveal]=useState(true),[epoch,setEpoch]=useState(0),[value,setValue]=useState(position);
window.fixture.select=async(s,r,restore,which='capture')=>{
const data=samples[which],nature=classifyMistakeReviewNature(data);
const value={...position,fen:data.fen,sideToMove:data.fen.split(' ')[1]==='w'?'white':'black',answer:data.bestMoveSan??'Rxc6',answerUci:data.bestMoveUci,mistakeReview:{...review,...data,playerColor:data.fen.split(' ')[1]==='w'?'white':'black',...classifyMistakeReviewMotifs(data),nature:nature.nature,natureConfidence:nature.confidence,natureReason:nature.reason,natureAspect:nature.aspect,allowedNature:nature.allowedNature,missedNature:nature.missedNature,tacticalSignals:nature.tacticalSignals,natureClassifierVersion:4}};
if(restore){value.mistakeReview=positionSchema.shape.mistakeReview.parse(JSON.parse(JSON.stringify({...value.mistakeReview,nature:'tactical',natureClassifierVersion:which==='discovery'?4:3,...(which==='discovery'||which==='alternative'?{motifClassifierVersion:'site-55.adapter-106',natureReason:'Old explanation'}:{})})));const migrated=which==='discovery'||which==='alternative'?await migrateMistakeReviewDeckMotifClassifications({positions:[value]}):await migrateMistakeReviewDeckNatureClassifications({positions:[value]});value.mistakeReview=migrated.deck.positions[0].mistakeReview;}
flushSync(()=>{setScale(s);setReveal(r);setEpoch(v=>v+1);setValue(value)});
};
return <MantineProvider forceColorScheme="dark" theme={{scale}}><main style={{padding:12,boxSizing:'border-box',width:'100%'}}><TacticalAuditGameInfoPanel key={epoch} position={value} revealAnswer={reveal}/></main></MantineProvider>}
createRoot(document.getElementById('root')).render(<App/>);`,
);
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="${relative("entry.tsx")}"></script></body></html>`,
);
await build({
  root,
  configFile: false,
  logLevel: "warn",
  plugins: [
    {
      name: "isolated-tactical-game-info",
      enforce: "pre",
      transform(code, id) {
        if (
          id.replaceAll("\\", "/") !==
          resolve(root, "src/components/review/OpeningReviewWorkspace.tsx").replaceAll("\\", "/")
        )
          return;
        assert(code.includes("function MistakeReviewGameInfoPanel("));
        return {
          code: code + "\nexport { MistakeReviewGameInfoPanel as TacticalAuditGameInfoPanel };",
          map: null,
        };
      },
    },
    react(),
  ],
  resolve: { alias: { "@": resolve(root, "src") } },
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
  const page = await browser.newPage(),
    errors = [],
    checks = [];
  await page.addInitScript(() => {
    window.__TAURI_OS_PLUGIN_INTERNALS__ = {
      platform: "windows",
      family: "windows",
      os_type: "windows",
      arch: "x86_64",
      eol: "\r\n",
      exe_extension: "exe",
      version: "QA",
    };
  });
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await page.goto(origin + relative("index.html"));
  try {
    await page.getByText("Capture in the better line", { exact: true }).waitFor({ timeout: 10000 });
  } catch (error) {
    console.error({ errors, body: await page.locator("body").innerText() });
    await page.screenshot({ path: resolve(output, "failed-render.png"), fullPage: true });
    throw error;
  }
  for (const which of alternativeMode ? ["alternative"] : discoveryMode ? ["discovery"] : natureMode ? ["capture", "quiet", "fork"] : ["capture"])
    for (const width of [1100, 760, 360])
      for (const scale of [1, 2])
        for (const restore of [false, true]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(
            ({ scale, restore, which }) => window.fixture.select(scale, true, restore, which),
            {
              scale,
              restore,
              which,
            },
          );
          const natureLabel =
            which === "capture"
              ? "Unclassified"
              : which === "quiet"
                ? "Likely positional"
                : "Tactical";
          await page.getByText(natureLabel, { exact: true }).waitFor();
          if (which === "capture") {
            await page.getByText("Capture in the better line", { exact: true }).waitFor();
            assert(!(await page.locator("main").innerText()).includes("What you missed"));
            await page.getByText("Better move, move by move", { exact: true }).click();
            const text = await page.locator("main").innerText();
            assert(text.includes("Rxc6 captures the bishop on c6; fxg4 captures the knight on g4"));
            assert.equal(await page.getByText("Capture choice", { exact: true }).count(), 2);
          } else if (which === "alternative") {
            assert((await page.locator("main").innerText()).includes("Bxa3 wins the loose knight on a3"));
            await page.getByText("Separate tactical reply", { exact: true }).click();
            const detail = page.locator("details").filter({has: page.getByText("Separate tactical reply", {exact:true})});
            assert((await detail.innerText()).includes("Bxa3"));
            assert(!(await detail.innerText()).includes("Qxc3"));
            assert.equal(await page.getByText("Opponent's refutation, move by move", {exact:true}).count(), 0);
          } else if (which === "discovery") {
            await page.getByText("What you missed: Discovered Check", { exact: true }).waitFor();
            assert((await page.locator("main").innerText()).includes("cannot recapture on d7"));
            assert(!(await page.locator("main").innerText()).includes("loose rook"));
          } else if (which === "fork") {
            await page.getByText("What you missed: Fork", { exact: true }).waitFor();
          } else {
            assert(!(await page.locator("main").innerText()).includes("What you missed"));
          }
          const clipped = await page.evaluate(() =>
            [
              ...document.querySelectorAll(
                "main button,main .mantine-Badge-root,main .mantine-Badge-label,main p,main summary",
              ),
            ]
              .filter((e) => {
                const r = e.getBoundingClientRect();
                return (
                  r.width &&
                  (r.left < -1 || r.right > innerWidth + 1 || e.scrollWidth > e.clientWidth + 2)
                );
              })
              .map((e) => e.textContent),
          );
          assert.deepEqual(clipped, [], "Visible text/actions must fit");
          await page.getByRole("button", { name: "Show game details", exact: true }).click();
          await page.getByRole("button", { name: "Hide game details", exact: true }).waitFor();
          await page.keyboard.press("Tab");
          await page.mouse.move(1, 1);
          await page.getByRole("tooltip").waitFor({ state: "hidden" });
          if (!restore)
            await page.screenshot({
              path: resolve(output, `${which}-${width}-${scale}.png`),
              fullPage: true,
            });
          await page.evaluate(
            ({ scale, restore, which }) => window.fixture.select(scale, false, restore, which),
            {
              scale,
              restore,
              which,
            },
          );
          assert(
            !(await page.locator("main").innerText()).includes("Capture choice"),
            "No answer leak before reveal",
          );
          assert(
            !(await page.locator("main").innerText()).includes("What you missed"),
            "No missed-theme answer before reveal",
          );
          assert(!(await page.locator("main").innerText()).includes("Separate tactical reply"), "No alternative reply before reveal");
          checks.push({ which, width, scale, restore, passed: true });
        }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        scope:
          "Actual existing React game-info panel; reveal, timeline, details, nature labels and v3-to-v4 persisted migration. Isolated Chrome, not owner/native runtime.",
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`${checks.length} game-info renderer groups passed.`);
} finally {
  await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
}
