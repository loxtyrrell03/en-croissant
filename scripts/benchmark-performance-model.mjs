/** Deterministic synthetic same-process benchmark. No profiles or accounts. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { cpus } from 'node:os';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const value = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const repetitions = Number(value('--repetitions', 20));
assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 100);
const output = resolve(value('--output', 'tmp/performance-model-benchmark.json'));
const baselinePath = value('--baseline', null);
assert(baselinePath, 'Provide the frozen v2 --baseline source path.');
const candidatePath = resolve(value('--source', 'src/shared/truePerformance.ts'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function load(path) {
  path = resolve(path);
  const bundle = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node', metafile: true, absWorkingDir: dirname(path) });
  const files = Object.keys(bundle.metafile.inputs).map(p => resolve(dirname(path), p));
  const hashes = Object.fromEntries(await Promise.all(files.map(async p => [p, hash(await readFile(p))])));
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  return { module, hashes };
}
const baseline = await load(baselinePath), candidate = await load(candidatePath);
const games = Array.from({ length: 5000 }, (_, i) => ({ id: String(i).padStart(5, '0'), pool: 'synthetic:blitz',
  at: 1700000000 + i, rating: 1500, opponentRating: 1550 + (i * 137) % 500, opponentSd: 60,
  score: [1, .5, 0, 1, 0][i % 5], white: i % 2 === 0, opponent: 'Synthetic opponent', rated: true }));
function measure(subject, duplicateHeadline) {
  const start = performance.now();
  const history = subject.module.strengthHistory(games);
  const afterHistory = performance.now();
  const graph = subject.module.periodPerformanceHistory(games);
  const afterGraph = performance.now();
  const headline = duplicateHeadline ? subject.module.periodPerformance(games) : graph.at(-1);
  const end = performance.now();
  assert(history.points.length === games.length && graph.length === games.length);
  assert(Math.abs(headline.mean - graph.at(-1).mean) < 1e-7);
  return { historyMs: afterHistory - start, periodGraphMs: afterGraph - afterHistory,
    separateHeadlineMs: end - afterGraph, panelComputationMs: end - start,
    strength: history.points.at(-1).mean, performance: headline.mean };
}
// v2 panel computed headline separately; the v3 panel reuses its last graph point.
for (let warmup = 0; warmup < 2; warmup++) { measure(baseline, true); measure(candidate, false); }
const samples = { baseline: [], candidate: [] };
for (let i = 0; i < repetitions; i++) {
  const order = i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
  for (const name of order) samples[name].push(measure(name === 'baseline' ? baseline : candidate, name === 'baseline'));
  console.log(`Measured paired repetition ${i + 1}/${repetitions}`);
}
const fields = ['historyMs', 'periodGraphMs', 'separateHeadlineMs', 'panelComputationMs'];
const stats = Object.fromEntries(Object.entries(samples).map(([name, rows]) => [name,
  Object.fromEntries(fields.map(field => {
    const sorted = rows.map(row => row[field]).sort((a, b) => a - b);
    return [field, { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(.95 * sorted.length) - 1], min: sorted[0], max: sorted.at(-1) }];
  }))]));
for (const subject of [baseline, candidate]) for (const [path, expected] of Object.entries(subject.hashes))
  assert.equal(hash(await readFile(path)), expected, 'Source changed during benchmarking');
const receipt = { scope: 'Synthetic 5000-game model computation, excluding rendering/network. Same process, two warmups and alternating order. Baseline panel has three passes; candidate panel reuses its period graph for the headline. Numerical correction benchmark, not empirical predictive acceptance.',
  node: process.version, cpu: cpus()[0].model, logicalCpuCount: cpus().length, repetitions, fixtureHash: hash(JSON.stringify(games)),
  baseline: { version: baseline.module.TRUE_PERFORMANCE_VERSION, hashes: baseline.hashes },
  candidate: { version: candidate.module.TRUE_PERFORMANCE_VERSION, hashes: candidate.hashes }, samples, stats,
  panelP95Ratio: stats.candidate.panelComputationMs.p95 / stats.baseline.panelComputationMs.p95,
  heapUsedBytesAtEnd: process.memoryUsage().heapUsed };
await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ output, stats, panelP95Ratio: receipt.panelP95Ratio }, null, 2));
