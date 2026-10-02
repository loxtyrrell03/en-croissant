// Shared desktop/phone components with invented data and isolated APIs. Does
// not start the app, connect to a profile, or operate the installed phone site.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const args = process.argv.slice(2), value = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const toolsRoot = value('--tools-root');
assert(toolsRoot, 'Pass --tools-root to an existing checkout containing Playwright; no installation is performed.');
const { webkit } = createRequire(path.resolve(toolsRoot, 'package.json'))('playwright');
const out = path.resolve('tmp/pairing-probability-qa'); await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'index.html'), '<html><body style="margin:0"><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
await fs.writeFile(path.join(out, 'fixture.tsx'), `
import React from 'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import'@mantine/core/styles.css';
import{TournamentTrackerView}from'/src/features/tournaments/TournamentTrackerView';import{TournamentPrepRow}from'/src/features/tournaments/TournamentPrepStrip';
import{trackerFixture}from'/src/features/tournaments/tests/trackerFixture';import{calculatePairingForecast}from'/src/features/tournaments/pairingForecast';
import styles from'/src/features/tournaments/TournamentSurface.module.css';
const root=createRoot(document.getElementById('root'));let epoch=0;window.fx={actions:0};
fx.show=(mode='tracker',state='opening')=>{const f=trackerFixture(),s=f.record.snapshot;fx.actions=0;
if(state==='opening')Object.assign(s,{phase:'registration',completedRound:0,publishedRound:0,liveRound:null,nextRound:1,pairings:[],roundStandings:[]});
if(state==='incomplete')s.incompletePairingRounds=[2];
if(state==='published'){s.incompletePairingRounds=[2];s.pairings.push({round:5,board:1,whiteStartNumber:1,blackStartNumber:2,whitePoints:0,blackPoints:0,result:null,decided:false});}
f.forecast=calculatePairingForecast(s,1);fx.forecast=f.forecast;
const action=()=>{fx.actions++};root.render(<MantineProvider forceColorScheme="dark"><div className={styles.surface} data-mode={mode} data-state={state} style={{padding:12,containerType:'inline-size',boxSizing:'border-box'}}>{mode==='home'?<TournamentPrepRow key={++epoch} record={f.record} syncing={false} removing={false} stopDisabled={false} onOpen={action} onRemove={action}/>:<TournamentTrackerView key={++epoch} {...f} calculating={false} running={false} prepBusy={null} removeBusy={false} settingBusy={false} syncEvent={null} error={null} projectedSideFor={()=>'white'} onOpponent={action} onOpenDatabase={action} onToggleUpdate={action} onCheck={action} onStop={action} onRemove={action}/>}</div></MantineProvider>);};fx.show();
`);
const server = await createServer({ root: process.cwd(), configFile: false,
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@mantine/core', '@mantine/notifications'] },
  cacheDir: path.join(out, 'cache'), resolve: { alias: { '@': path.resolve('src') } },
  plugins: [react(), { name: 'isolated-pairing-probability-fixture', enforce: 'pre', async load(id) {
    const normalized = id.replaceAll('\\', '/');
    if (normalized.endsWith('/features/tournaments/platform.ts')) return 'export const isNativeDesktop=()=>false;export const isDesktop=()=>false;export const desktopApi=new Proxy({},{get:()=>async()=>null});';
    if (normalized.endsWith('/usePairingForecast.ts')) return "import{calculatePairingForecast}from'/src/features/tournaments/pairingForecast';export function usePairingForecast(s,p){return{forecast:calculatePairingForecast(s,p),isCalculating:false}}";
    if (normalized.endsWith('/TournamentPrepStrip.tsx')) return (await fs.readFile(id, 'utf8')).replace('function TournamentPrepRow(', 'export function TournamentPrepRow(');
  } }], server: { watch: null, host: '127.0.0.1', port: 0, open: false } });
let browser; const errors = [], external = [], checks = [];
try {
  await server.listen(); browser = await webkit.launch({ headless: true });
  for (const width of [1280, 760, 390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width <= 390 });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    await page.goto(server.resolvedUrls.local[0] + 'tmp/pairing-probability-qa/index.html');
    for (const mode of ['tracker', 'home']) {
      for (const state of ['opening', 'incomplete', 'complete', 'incomplete', 'published']) {
        await page.evaluate(({ mode, state }) => fx.show(mode, state), { mode, state });
        await page.locator(`[data-mode="${mode}"][data-state="${state}"]`).waitFor();
        const text = await page.locator('body').innerText(), unknown = ['opening', 'incomplete'].includes(state);
        if (unknown) {
          assert(!/\d+%/.test(text), 'Unvalidated percentage shown'); assert(text.toLowerCase().includes('unknown'));
          assert.equal(await page.evaluate(() => fx.forecast.otherProbability), null);
          const triggers = page.getByRole('button', { name: mode === 'tracker' ? /^Help: Pairing chance/ : /^Help: Pairing for/ });
          let trigger; for (let i = 0; i < await triggers.count(); i++) if (await triggers.nth(i).isVisible()) { trigger = triggers.nth(i); break; }
          assert(trigger, 'Visible adjacent chance help missing'); await trigger.focus(); const tip = page.getByRole('tooltip'); await tip.waitFor();
          const help = await tip.innerText(); assert(help.includes(state === 'opening' ? 'Before round one' : 'earlier pairing rows are missing'));
          if (state === 'incomplete') assert(!help.includes('Before round one'));
          const box = await tip.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 1001);
          await page.screenshot({ path: path.join(out, `${mode}-${state}-${width}.png`) });
          await page.keyboard.press('Escape'); await tip.waitFor({ state: 'hidden' }); await trigger.click(); await tip.waitFor();
          await page.mouse.click(width - 2, 2); await tip.waitFor({ state: 'hidden' });
          const action = page.getByRole('button', { name: mode === 'home' ? 'Open tracker' : /^(Import & prep|Open Prep)$/ }).first();
          await action.click(); assert.equal(await page.evaluate(() => fx.actions), 1, 'Preparation action not wired');
        } else if (state === 'complete') assert(/\d+%/.test(text), 'Complete-history refresh lost numerical estimate');
        else { assert(text.includes('Published')); assert(!text.includes('~100%')); }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      checks.push(`${mode} ${width}px${width <= 390 ? ' touch' : ''}: opening/incomplete/complete/refreshed/published, labels, help focus/click/Escape/outside, tooltip bounds and wired actions`);
    }
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const proof = { checkout: process.cwd(), checks, errors, external,
    scope: 'Actual shared En Croissant Tracker and Prep row with Mantine theme in headless WebKit at desktop/phone widths. Native service and asynchronous worker boundaries isolated; no installed desktop or live/physical phone proof.' };
  await fs.writeFile(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n'); console.log(JSON.stringify(proof, null, 2));
} finally { await browser?.close(); await server.close(); }
