/** Independent continuous-inference acceptance; never imports production numerical helpers.
 * Frozen references use SciPy integration/161 opponent nodes. Additional known-opponent
 * cases use direct likelihood evaluation and adaptive Simpson integration below.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const source = resolve(value('--source', 'src/shared/truePerformance.ts'));
const fixture = resolve(value('--reference', 'docs/benchmarks/performance-2026-10-02/numerical-reference.json'));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const sourcePaths = [source, resolve(dirname(source), 'performanceNumerics.ts')];
async function sourceHashes() {
  const hashes = {};
  for (const path of sourcePaths) {
    try { hashes[path.split(/[\\/]/).at(-1)] = createHash('sha256').update(await readFile(path)).digest('hex'); }
    catch (error) { if (path === source || error.code !== 'ENOENT') throw error; }
  }
  return hashes;
}
const initialHashes = await sourceHashes();
const bundle = await build({ entryPoints: [source], bundle: true, write: false, format: 'esm', platform: 'node' });
const modelModule = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const referenceBytes = await readFile(fixture), frozen = JSON.parse(referenceBytes);
const fields = ['mean', 'sd', 'low', 'high'];
const tolerance = 0.001;
const failures = [];

function gamesFor(spec) {
  const games = [];
  for (const block of spec.blocks) for (let repeat = 0; repeat < block.repeat; repeat++) for (const game of block.pattern) {
    const i = games.length;
    games.push({ ...game, id: String(i).padStart(6, '0'), pool: 'synthetic:blitz', at: 1700000000 + i,
      rating: spec.priorMean, opponent: 'Synthetic opponent', rated: true });
  }
  return games;
}
function compare(id, actual, expected) {
  const errors = Object.fromEntries(fields.map(key => [key, actual?.[key] - expected[key]]));
  for (const key of fields) if (!Number.isFinite(errors[key]) || Math.abs(errors[key]) > tolerance)
    failures.push(`${id}: ${key} error ${errors[key]} exceeds ${tolerance}`);
  return errors;
}
function simpson(fn, a, b, epsilon = 2e-11) {
  const midpoint = (a + b) / 2, fa = fn(a), fm = fn(midpoint), fb = fn(b);
  function split(left, right, fl, fc, fr, whole, eps, depth) {
    const center = (left + right) / 2, lq = (left + center) / 2, rq = (center + right) / 2;
    const f1 = fn(lq), f2 = fn(rq);
    const l = (center - left) * (fl + 4 * f1 + fc) / 6;
    const r = (right - center) * (fc + 4 * f2 + fr) / 6;
    const residual = l + r - whole;
    if (Math.abs(residual) < 15 * eps) return l + r + residual / 15;
    assert(depth > 0, 'Independent adaptive integration failed to converge');
    return split(left, center, fl, f1, fc, l, eps / 2, depth - 1)
      + split(center, right, fc, f2, fr, r, eps / 2, depth - 1);
  }
  return split(a, b, fa, fm, fb, (b - a) * (fa + 4 * fm + fb) / 6, epsilon, 35);
}

/** Known opponents only: exact log likelihood, no Hermite nodes or interpolation. */
function directReference(spec) {
  const m = spec.model, groups = [];
  for (const block of spec.blocks) for (const g of block.pattern) {
    assert.equal(g.opponentSd ?? m.opponentSd, 0, 'Direct reference requires known opponents');
    groups.push({ ...g, count: block.repeat });
  }
  function logDensity(r) {
    let log = -0.5 * ((r - spec.priorMean) / m.priorSd) ** 2;
    for (const g of groups) {
      const z = Math.LN10 * (r - g.opponentRating + (g.white ? 1 : -1) * m.whiteAdvantage) / m.divisor;
      const draw = m.logDraw + m.drawSlope * ((r + g.opponentRating) / 2 - 2200) / 400 + z / 2;
      const max = Math.max(0, z, draw), observed = g.score === 1 ? z : g.score === 0.5 ? draw : 0;
      log += g.count * (observed - max - Math.log(Math.exp(z - max) + Math.exp(draw - max) + Math.exp(-max)));
    }
    return log;
  }
  let left = -10000, right = 14000;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let c = right - ratio * (right - left), d = left + ratio * (right - left);
  for (let i = 0; i < 100; i++) {
    if (logDensity(c) > logDensity(d)) { right = d; d = c; c = right - ratio * (right - left); }
    else { left = c; c = d; d = left + ratio * (right - left); }
  }
  const mode = (left + right) / 2, peak = logDensity(mode);
  let scale = Math.min(m.priorSd, m.divisor) / Math.sqrt(groups.reduce((n, g) => n + g.count, 0));
  scale = Math.max(scale, 1e-5);
  const density = t => Math.exp(logDensity(mode + scale * t) - peak);
  let a = -1, b = 1;
  while (density(a) > Math.exp(-55)) a *= 2;
  while (density(b) > Math.exp(-55)) b *= 2;
  function integral(fn, end = b) {
    const breaks = [a, ...[-32, -16, -8, -4, -2, -1, 0, 1, 2, 4, 8, 16, 32].filter(x => x > a && x < end), end];
    return breaks.slice(0, -1).reduce((sum, x, i) => sum + simpson(fn, x, breaks[i + 1]), 0);
  }
  const mass = integral(density), meanT = integral(t => t * density(t)) / mass;
  const variance = integral(t => (t - meanT) ** 2 * density(t)) / mass;
  function quantile(q) {
    let lo = a, hi = b;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (integral(density, mid) < q * mass) lo = mid; else hi = mid;
    }
    return mode + scale * (lo + hi) / 2;
  }
  return { mean: mode + scale * meanT, sd: scale * Math.sqrt(variance), low: quantile(.025), high: quantile(.975) };
}

const cases = [];
for (const spec of frozen.cases) {
  const games = gamesFor(spec), start = performance.now();
  assert.equal(games.length, spec.gameCount);
  const actual = modelModule.periodPerformance(games, spec.model);
  const expected = spec.unboundedReference ?? spec.reference;
  cases.push({ id: spec.id, games: games.length, elapsedMs: performance.now() - start, actual, expected,
    errors: compare(spec.id, actual, expected), reference: spec.unboundedReference ? 'unboundedReference' : 'reference' });
}

// Translation invariance exposes sub-cell phase error without treating a finer grid as truth.
const subcellRef = frozen.cases.find(c => c.id === 'subcell-1812-no-opponent-uncertainty-5000').reference;
const subcell = [];
for (const center of [1800, 1800.125, 1801, 1802, 1803, 1804, 1805, 1806, 1807, 1808, 1809, 1809.875, 1810]) {
  const spec = { priorMean: center, model: { ...modelModule.ONLINE_MODEL, opponentSd: 0, driftSdYear: 0 },
    blocks: [{ repeat: 2500, pattern: [0, 1].map(score => ({ score, opponentRating: center, opponentSd: 0, white: true })) }] };
  const expected = { ...subcellRef, mean: center, low: subcellRef.low + center - 1812, high: subcellRef.high + center - 1812 };
  const actual = modelModule.periodPerformance(gamesFor(spec), spec.model);
  subcell.push({ center, actual, errors: compare(`subcell-${center}`, actual, expected) });
}

const sharpSpecs = [
  { id: 'sharp-symmetric', priorMean: 1803.375, model: { ...modelModule.ONLINE_MODEL, divisor: 2, priorSd: 150, opponentSd: 0, driftSdYear: 0 },
    scipyReference: { mean: 1803.375, sd: 0.1291390418171221, low: 1803.1218079560026, high: 1803.6281920439976 },
    blocks: [{ repeat: 100, pattern: [0, 1].map(score => ({ score, opponentRating: 1803.375, opponentSd: 0, white: true })) }] },
  { id: 'sharp-asymmetric', priorMean: 1799.625, model: { ...modelModule.ONLINE_MODEL, divisor: 3.14159, priorSd: 20, opponentSd: 0, driftSdYear: 0 },
    scipyReference: { mean: 1805.8986770427805, sd: 0.2975471248278918, low: 1805.3224027180465, high: 1806.48952055005 },
    blocks: [{ repeat: 25, pattern: [1, 1, .5, 0].map(score => ({ score, opponentRating: 1805.125, opponentSd: 0, white: false })) }] },
  { id: 'underflowing-start', priorMean: 0, model: { ...modelModule.ONLINE_MODEL, divisor: 1, priorSd: 50, opponentSd: 0, driftSdYear: 0 },
    scipyReference: { mean: 4000.857671212708, sd: 0.8288257610287292, low: 3999.5321129524227, high: 4002.8098042559386 },
    blocks: [{ repeat: 3, pattern: [{ score: 1, opponentRating: 4000, opponentSd: 0, white: true }] }] },
];
const sharp = sharpSpecs.map(spec => {
  const expected = directReference(spec), actual = modelModule.periodPerformance(gamesFor(spec), spec.model);
  // Frozen cross-check: SciPy quad/brentq on a direct logsumexp likelihood,
  // independent of both this Simpson implementation and the production solver.
  const oracleCrossCheck = Object.fromEntries(fields.map(key => [key, expected[key] - spec.scipyReference[key]]));
  assert(fields.every(key => Math.abs(oracleCrossCheck[key]) < 1e-7), `${spec.id}: independent oracles disagree`);
  return { id: spec.id, expected, actual, oracleCrossCheck, errors: compare(spec.id, actual, expected) };
});

const predictiveGames = gamesFor(sharpSpecs[0]);
predictiveGames.push({ ...predictiveGames[0], id: 'next-probe', at: 1700000200,
  opponentRating: 1803.575, score: 0 });
const predictiveExpected = [0.403039035233027, 0.09014366172295583, 0.5068173030440171];
const predictiveActual = modelModule.strengthHistory(predictiveGames, Infinity, sharpSpecs[0].model).points.at(-1).predictive;
const predictiveErrors = predictiveActual.map((p, k) => p - predictiveExpected[k]);
if (predictiveErrors.some(error => !Number.isFinite(error) || Math.abs(error) >= 1e-6))
  failures.push(`Resolved-posterior predictive errors ${JSON.stringify(predictiveErrors)} exceed 1e-6`);

// Future data must not choose an earlier integration domain or mesh.
const boundary = frozen.cases.find(c => c.id === 'upper-grid-boundary-5000');
const expansionGames = gamesFor(boundary);
const early = modelModule.strengthHistory(expansionGames.slice(0, 20), Infinity, boundary.model).points;
const expanded = modelModule.strengthHistory(expansionGames, Infinity, boundary.model).points;
assert.deepEqual(expanded.slice(0, early.length), early, 'Future results changed zero-drift prefix points');
const expansionFinalErrors = compare('expanded-history-headline', expanded.at(-1), cases.find(c => c.id === boundary.id).actual);
const reversalGames = expansionGames.slice(0, 2500).concat(expansionGames.slice(2500).map(g => ({ ...g, score: 0 })));
const reverseOrder = reversalGames.map(g => ({ ...g, score: 1 - g.score }));
const reversed = modelModule.periodPerformance(reversalGames, boundary.model);
const opposite = modelModule.periodPerformance(reverseOrder, boundary.model);
const reversalErrors = compare('domain-expansion-reversal', reversed, opposite);
if (Math.abs(reversed.mean - boundary.priorMean) > tolerance) failures.push('Balanced expansion/reversal did not return to the symmetric prior center');
const reversalHistory = modelModule.strengthHistory(reversalGames, Infinity, boundary.model).points;
const reversalHistoryErrors = compare('domain-expansion-reversal-history', reversalHistory.at(-1), reversed);
if (reversalHistory[2499].mean <= 5000) failures.push('Expansion/reversal history did not cross the old upper domain boundary');
for (const point of [...expanded, ...reversalHistory]) {
  if (Math.abs(point.predictive.reduce((a, b) => a + b, 0) - 1) > 1e-10) {
    failures.push('A predictive distribution lost probability mass after domain expansion'); break;
  }
}
const defaultGames = gamesFor(frozen.cases.find(c => c.id === 'mismatched-low-prior'));
const headline = modelModule.periodPerformance(defaultGames), graph = modelModule.periodPerformanceHistory(defaultGames);
const graphErrors = compare('period-graph-headline', graph.at(-1), headline);

assert.deepEqual(await sourceHashes(), initialHashes, 'Source changed during verification; run again on a stable snapshot');
const receipt = { scope: 'Continuous constant-period and zero-drift numerical inference, conditional on the unchanged model; not dynamic-diffusion or empirical accuracy acceptance.',
  version: modelModule.TRUE_PERFORMANCE_VERSION, node: process.version, toleranceRatingPoints: tolerance,
  sourceHashes: initialHashes, referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'),
  passedContinuousGates: failures.length === 0, failures, cases, subcell, sharp,
  predictive: { expected: predictiveExpected, actual: predictiveActual, errors: predictiveErrors, toleranceProbability: 1e-6 },
  chronology: { exactPrefixEquality: true, expansionFinalErrors, reversalErrors, reversalHistoryErrors,
    reversalTurningMean: reversalHistory[2499].mean, graphErrors } };
const output = value('--output', null);
if (output) await writeFile(resolve(output), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ passedContinuousGates: receipt.passedContinuousGates, version: receipt.version,
  cases: cases.length, subcellCases: subcell.length, sharpCases: sharp.length,
  failureCount: failures.length, firstFailures: failures.slice(0, 12), output }, null, 2));
assert.equal(failures.length, 0, 'Continuous numerical acceptance failed; see the reported failures or full receipt.');
