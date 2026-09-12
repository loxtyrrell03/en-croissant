// Exercise the real served app and engine at the user's exact phone address.
// Browser storage is disposable; unrelated API writes never reach the PC.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium, devices } = await import('playwright').catch(() => import(pathToFileURL(resolve(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'))));
const address = process.argv[process.argv.indexOf('--url') + 1];
assert.ok(process.argv.includes('--url') && address?.startsWith('https://'), 'Pass --url with the exact address used on the phone.');
const base = new URL(address).origin;
const previewMode = process.argv.includes('--preview');
const previewServer = previewMode ? await (await import('vite')).preview({ preview: { host: '127.0.0.1', port: 4389, strictPort: true } }) : null;
const appBase = previewMode ? 'http://127.0.0.1:4389' : base;
const output = resolve('tmp/phone-moves-engine', previewMode ? 'preview' : 'live');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined, serviceWorkers: previewMode ? 'block' : 'allow' });
await context.addInitScript(() => localStorage.setItem('en-croissant-web-engine-panel-settings', JSON.stringify({ enabled: false, depth: 10, multipv: 3, stockfishPreset: 'eco', infinite: false })));
const page = await context.newPage();
const errors = [], responses = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (/\/api\/engine\/start|\/v1\/analyze/.test(response.url())) responses.push({ url: response.url(), status: response.status() });
});
await page.route('**/*', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (request.method() !== 'GET' && (path.startsWith('/api/') || path.startsWith('/v1/')) && !['/api/engine/start', '/v1/analyze', '/v1/engine/release'].includes(path)) return route.fulfill({ json: { ok: true } });
  if (previewMode && (path.startsWith('/api/') || path.startsWith('/v1/'))) {
    const url = new URL(request.url());
    const response = await route.fetch({ url: `${base}${path}${url.search}`, headers: { ...request.headers(), origin: base, host: new URL(base).host } });
    return route.fulfill({ response });
  }
  return route.continue();
});
try {
  await page.goto(appBase, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Stockfish 18', exact: true }).waitFor();
  if (!previewMode) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  // Simulate an installed PWA carrying yesterday's Off response. It must be
  // ignored even when it is in the current app cache, not merely deleted on update.
  const status = await page.evaluate(async () => {
    const key = (await caches.keys()).find(key => key.startsWith('en-croissant-web-'));
    const cache = await caches.open(key);
    await cache.put(new Request(`${location.origin}/api/pc-services`), new Response(JSON.stringify({ enabled: false, home: false, engine: false }), { headers: { 'content-type': 'application/json' } }));
    return await (await fetch('/api/pc-services', { cache: 'no-store' })).json();
  });
  assert.equal(status.enabled && status.home && status.engine, true, 'Service state must come from the network.');
  }
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('textbox', { name: 'Or paste PGN' }).fill('[Event "Connection check (sample)"]\n[White "Sample White"]\n[Black "Sample Black"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *');
  await page.getByRole('button', { name: 'Import pasted games', exact: true }).click();
  await page.getByRole('button', { name: 'Start Stockfish 18', exact: true }).click();
  const depth = page.locator('[class*="enginePanelMetric"]').filter({ hasText: 'Depth' }).getByText('10', { exact: true });
  await depth.waitFor({ timeout: 35_000 });
  for (let line = 1; line <= 3; line++) await page.getByRole('button', { name: `Play engine line ${line}`, exact: true }).waitFor();
  assert.ok(responses.some(response => response.url === `${appBase}/api/engine/start` && response.status === 200));
  assert.ok(responses.some(response => response.url === `${appBase}/v1/analyze` && response.status === 200));
  const starts = responses.filter(response => response.url.endsWith('/v1/analyze')).length;
  await page.getByRole('tab', { name: 'Engine', exact: true }).click();
  await page.getByRole('tab', { name: 'Moves', exact: true }).click();
  await depth.waitFor();
  assert.equal(responses.filter(response => response.url.endsWith('/v1/analyze')).length, starts, 'Switching tabs must retain the same analysis.');
  await page.getByRole('button', { name: 'Engine settings', exact: true }).click();
  await page.getByLabel('Performance', { exact: true }).and(page.locator('input')).waitFor();
  await page.getByRole('button', { name: 'Engine settings', exact: true }).click();
  assert.deepEqual(errors, []);
  assert.equal(await page.getByText(/Gaming PC Stockfish is unavailable/).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByText('PGN imported', { exact: true }).waitFor({ state: 'hidden', timeout: 15_000 });
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[class*="underBoardPanel"]').evaluate(element => { element.scrollTop = 0; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
    await page.screenshot({ path: resolve(output, `phone-engine-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Play engine line 1', exact: true }).click();
  await page.getByText('5 / 5', { exact: true }).waitFor();
  await depth.waitFor({ timeout: 35_000 });
  await writeFile(resolve(output, 'phone-engine.json'), JSON.stringify({ base, previewMode, errors, responses, serviceWorkerActive: !previewMode, staleServiceCacheIgnored: !previewMode, displayedDepth: 10, fullLines: 3, widths: [390, 320, 768], playedEngineMove: true }, null, 2));
  console.log(JSON.stringify({ base, previewMode, displayedDepth: 10, fullLines: 3, widths: [390, 320, 768], playedEngineMove: true, errors }));
  // Release only this test's interactive search via the same analysis switch.
  await page.getByRole('button', { name: 'Pause Stockfish 18', exact: true }).click();
  await page.getByText('Inactive engine', { exact: true }).waitFor();
} catch (error) {
  await page.screenshot({ path: resolve(output, 'phone-engine-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  previewServer?.httpServer.closeAllConnections();
  await new Promise(done => previewServer ? previewServer.httpServer.close(done) : done());
}
