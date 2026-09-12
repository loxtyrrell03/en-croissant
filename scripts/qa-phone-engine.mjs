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
const output = resolve('tmp/phone-address-recovery');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
await context.addInitScript(() => localStorage.setItem('en-croissant-web-engine-panel-settings', JSON.stringify({ enabled: false, depth: 10, multipv: 1, stockfishPreset: 'eco', infinite: false })));
const page = await context.newPage();
const errors = [], responses = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (/\/api\/engine\/start|\/v1\/analyze/.test(response.url())) responses.push({ url: response.url(), status: response.status() });
});
await page.route('**/*', route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (request.method() !== 'GET' && (path.startsWith('/api/') || path.startsWith('/v1/')) && !['/api/engine/start', '/v1/analyze', '/v1/engine/release'].includes(path)) return route.fulfill({ json: { ok: true } });
  return route.continue();
});
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('switch', { name: 'Toggle Stockfish 18 analysis' }).waitFor();
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
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('textbox', { name: 'Or paste PGN' }).fill('[Event "Connection check (sample)"]\n[White "Sample White"]\n[Black "Sample Black"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *');
  await page.getByRole('button', { name: 'Import pasted games', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Toggle Stockfish 18 analysis' });
  await toggle.waitFor();
  if (!await toggle.isChecked()) await toggle.locator('..').click();
  await page.getByText(/d10 \|/).waitFor({ timeout: 35_000 });
  assert.ok(responses.some(response => response.url === `${base}/api/engine/start` && response.status === 200));
  assert.ok(responses.some(response => response.url === `${base}/v1/analyze` && response.status === 200));
  assert.deepEqual(errors, []);
  assert.equal(await page.getByText(/Gaming PC Stockfish is unavailable/).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: resolve(output, 'phone-engine.png'), fullPage: true });
  await writeFile(resolve(output, 'phone-engine.json'), JSON.stringify({ base, errors, responses, serviceWorkerActive: true, staleServiceCacheIgnored: true, displayedDepth: 10 }, null, 2));
  console.log(JSON.stringify({ base, displayedDepth: 10, staleServiceCacheIgnored: true, errors }));
  // Release only this test's interactive search via the same analysis switch.
  await toggle.locator('..').click();
} catch (error) {
  await page.screenshot({ path: resolve(output, 'phone-engine-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
