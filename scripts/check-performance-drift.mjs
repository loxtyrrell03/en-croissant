/** Compare actual chronological forecasts against the independent heat-equation oracle. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const args = process.argv.slice(2);
const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const source = resolve(value('--source', 'src/shared/truePerformance.ts'));
const referencePath = resolve(value('--reference', 'docs/benchmarks/performance-2026-10-02/drift-reference.json'));
const referenceBytes = await readFile(referencePath);
const reference = JSON.parse(referenceBytes);
const bundled = await build({ entryPoints: [source], bundle: true, write: false, platform: 'node', format: 'esm', metafile: true });
const model = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const sourceHashes = {};
for (const path of Object.keys(bundled.metafile.inputs)) sourceHashes[path] = createHash('sha256').update(await readFile(resolve(path))).digest('hex');
const rows = [];
for (const spec of reference.cases) {
  let at = 1700000000;
  const games = spec.games.map((g, i) => ({ ...g, id: String(i).padStart(6, '0'), pool: 'synthetic:blitz', at: at += g.gapSeconds,
    rating: spec.priorMean, opponent: 'Synthetic opponent', rated: true }));
  const start = performance.now();
  const actual = model.strengthHistory(games, Infinity, spec.model).points;
  const elapsedMs = performance.now() - start;
  assert.equal(actual.length, spec.points.length);
  const errors = {};
  for (const field of ['mean', 'sd', 'low', 'high', 'before']) errors[field] = Math.max(...actual.map((point, i) => Math.abs(point[field] - spec.points[i][field])));
  errors.predictive = Math.max(...actual.flatMap((point, i) => point.predictive.map((p, k) => Math.abs(p - spec.points[i].predictive[k]))));
  for (const point of actual) {
    assert(Math.abs(point.predictive.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert(point.predictive.every(p => Number.isFinite(p) && p >= 0 && p <= 1));
  }
  rows.push({ id: spec.id, games: games.length, elapsedMs, maximumErrors: errors, finalActual: actual.at(-1), finalReference: spec.points.at(-1) });
}
const continuousGatesPass = rows.every(row => ['mean', 'sd', 'low', 'high', 'before'].every(key => row.maximumErrors[key] < .001) && row.maximumErrors.predictive < 1e-6);
const receipt = { scope: 'Ordinary chronological numerical fixtures; no empirical calibration or rare-tail-support claim.', version: model.TRUE_PERFORMANCE_VERSION,
  sourceHashes, referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'), continuousGatesPass, cases: rows };
const output = value('--output', null);
if (output) await writeFile(resolve(output), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ version: receipt.version, continuousGatesPass, cases: rows.map(row => ({ id: row.id, errors: row.maximumErrors })) }, null, 2));
if (args.includes('--require-continuous')) assert(continuousGatesPass, 'Chronological continuous-inference gates failed');
