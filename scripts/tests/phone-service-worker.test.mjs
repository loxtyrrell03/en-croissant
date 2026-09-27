import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../../public/web-sw.js', import.meta.url), 'utf8');
const origin = 'https://phone.example';
function worker(network) {
  const handlers = new Map();
  let cacheReads = 0, cacheWrites = 0;
  runInNewContext(source, {
    self: { registration: { scope: `${origin}/` }, location: { origin }, addEventListener: (name, fn) => handlers.set(name, fn) },
    URL, Response,
    fetch: network,
    caches: {
      match: async () => { cacheReads++; return new Response('stale offline value'); },
      open: async () => ({ put: async () => { cacheWrites++; } }),
    },
  });
  return {
    fetch(path, options) {
      let response;
      handlers.get('fetch')({ request: new Request(`${origin}${path}`, options), respondWith: (value) => { response = value; } });
      return response;
    },
    counts: () => ({ cacheReads, cacheWrites }),
  };
}

test('service state, health, reviews and evaluations bypass stale offline cache', async () => {
  const client = worker(async () => new Response('current value'));
  for (const path of ['/api/pc-services', '/api/health', '/api/mistake-review', '/v1/health', '/v1/cloud-eval?fen=test', '/app-version.json']) {
    assert.equal(await (await client.fetch(path)).text(), 'current value', path);
  }
  assert.deepEqual(client.counts(), { cacheReads: 0, cacheWrites: 0 });
});

test('an unreachable service cannot be reported as cached ready or off', async () => {
  const client = worker(async () => { throw new TypeError('Network unavailable'); });
  await assert.rejects(client.fetch('/api/pc-services'), /Network unavailable/);
  assert.deepEqual(client.counts(), { cacheReads: 0, cacheWrites: 0 });
});

test('explicit no-store requests reach the server even outside an API route', async () => {
  const client = worker(async () => new Response('fresh'));
  assert.equal(await (await client.fetch('/status.json', { cache: 'no-store' })).text(), 'fresh');
  assert.equal(client.counts().cacheReads, 0);
});

test('hashed app assets retain the offline cache path', async () => {
  const client = worker(async () => new Response('asset'));
  assert.equal(await (await client.fetch('/assets/app-123.js')).text(), 'stale offline value');
  assert.equal(client.counts().cacheReads, 1);
});
