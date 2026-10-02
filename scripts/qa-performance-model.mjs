/** Isolated actual-panel check; synthetic games, no account/profile/network writes. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = resolve(process.argv[2] ?? '.');
const out = resolve(root, 'tmp/performance-model-qa');
async function sourceHashes() {
  const hashes = {};
  for (const name of ['truePerformance.ts','performanceNumerics.ts','performanceDynamics.ts','TruePerformancePanel.tsx','truePerformanceProtocol.ts','truePerformance.worker.ts','truePerformanceClient.ts','usePerformanceCalculation.ts','performanceDynamics.LICENSE.txt']) {
    try { hashes[name] = createHash('sha256').update(await readFile(resolve(root,'src/shared',name))).digest('hex'); }
    catch (error) { if (name !== 'performanceDynamics.ts' || error.code !== 'ENOENT') throw error; }
  }
  return hashes;
}
const initialHashes = await sourceHashes();
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'entry.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TruePerformancePanel} from '/src/shared/TruePerformancePanel';
import {periodPerformance} from '/src/shared/truePerformance';
const n=Number(new URLSearchParams(location.search).get('n')??200);
const varied=new URLSearchParams(location.search).has('varied');
const games=Array.from({length:n},(_,i)=>({id:String(i).padStart(5,'0'),pool:'synthetic:blitz',at:1700000000+i,rating:1500,opponentRating:varied?1550+(i*137)%500:1800,opponentSd:varied?60:0,score:varied?[1,0.5,0,1,0][i%5]:i<n/2?0:1,white:i%2===0,opponent:'Synthetic opponent',rated:true}));
window.expected=periodPerformance(games);
createRoot(document.getElementById('root')).render(<TruePerformancePanel games={games} poolLabel="Synthetic test pool" period="all" asOf={1700010000}/>);
`);
await writeFile(resolve(out, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#141416;color:#e8e8ea;font-family:Segoe UI,sans-serif"><main id="root" style="padding:16px;box-sizing:border-box;max-width:1100px;margin:auto"></main><script type="module" src="/tmp/performance-model-qa/entry.tsx"></script></body></html>');
await build({ root, configFile: false, plugins: [react()], logLevel: 'warn', build: { outDir: resolve(out, 'bundle'), emptyOutDir: false, copyPublicDir: false, rollupOptions: { input: resolve(out, 'index.html') } } });
const server = await preview({ root, configFile: false, build: { outDir: resolve(out, 'bundle') }, preview: { port: 0, host: '127.0.0.1' } });
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [], external = [], cases = [], consoleErrors = [];
page.setDefaultTimeout(120000);
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
try {
  for (const {n,width,varied} of [{n:200,width:1100},{n:200,width:390},{n:1000,width:1100},{n:1000,width:390},{n:5000,width:1100,varied:true}]) {
    await page.setViewportSize({ width, height: 1000 });
    const start = performance.now();
    await page.goto(`${origin}/tmp/performance-model-qa/index.html?n=${n}${varied?'&varied=1':''}`);
    const hero = page.locator('[class*="heroRating"]');
    await page.waitForFunction(() => /^\d/.test(document.querySelector('[class*="heroRating"]')?.textContent ?? ''));
    const loadMs = performance.now() - start;
    const expected = await page.evaluate(() => Math.round(window.expected.mean).toLocaleString());
    assert.equal(await hero.innerText(), expected);
    const slider = page.getByLabel('Explore rating history');
    await slider.fill(await slider.getAttribute('max'));
    assert.equal(await page.locator('[class*="chartReadout"] strong').innerText(), expected);
    await page.getByRole('button', { name: 'Compare ratings', exact: true }).click();
    await page.getByRole('button', { name: 'Close comparison', exact: true }).waitFor();
    await page.getByLabel('Rating graph').selectOption('history');
    await page.getByRole('img', { name: 'Estimated playing strength over selected games', exact: true }).waitFor();
    await page.getByText(`${n} games of history`, { exact: true }).waitFor();
    assert(/^\d/.test(await page.locator('[class*="chartReadout"] strong').innerText()), 'History graph never resolved');
    const historyReadyMs = performance.now() - start;
    await page.getByLabel('Rating graph').selectOption('performance');
    await page.getByRole('img', { name: 'Performance rating over selected games', exact: true }).waitFor();
    assert.equal(await page.locator('[class*="chartReadout"] strong').innerText(), expected);
    assert((await page.locator('svg circle title').last().textContent()).includes(expected));
    const endpoint = await page.locator('svg polyline').evaluate(line => line.getAttribute('points').trim().split(/\s+/).at(-1).split(',').map(Number));
    const finalCircle = await page.locator('svg circle').last().evaluate(circle => ['cx','cy'].map(name => Number(circle.getAttribute(name))));
    assert.deepEqual(endpoint, finalCircle, 'Drawn graph endpoint differs from its final estimate');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
    await page.screenshot({ path: resolve(out, `n${n}-${width}.png`), fullPage: true });
    await page.getByText('About the estimates', { exact: true }).click();
    const licenceHref = await page.getByRole('link', { name: 'Third-party licence', exact: true }).getAttribute('href');
    const licenceUrl = new URL(licenceHref, origin);
    assert.equal(licenceUrl.origin, origin, 'Licence must be a distributed asset');
    const licence = await page.request.get(licenceUrl.href);
    const licenceText = await licence.text();
    assert(licence.ok() && licenceText.includes('Redistribution and use') && licenceText.includes('Moshier'));
    assert((await page.locator('body').innerText()).includes('same session can make the estimated ranges too narrow'));
    cases.push({ n, width, varied:!!varied, rating: expected, graphMatches: true, historyResolved: true, licenceAsset: licenceUrl.pathname, loadMs, historyReadyMs });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(external, []);
  const hashes = await sourceHashes();
  assert.deepEqual(hashes, initialHashes, 'Panel/model source changed during browser verification');
  const receipt = { passed: true, scope: 'Actual shared panel with synthetic inputs; loadMs includes fixture-only reference calculation and is not app-only latency. No installed or physical-device verification.', hashes, cases, errors, consoleErrors, external };
  await writeFile(resolve(out, 'result.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
