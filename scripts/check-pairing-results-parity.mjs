/** Read-only cross-product replay; outputs only tiny bundled modules and receipt.
 * Reuses Novelty's visibility-audited replay builder, never runs worker solves. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--novelty', '--tools-root', '--baseline'].includes(args[i]) && args[i + 1], 'Use --novelty PATH --tools-root PATH [--baseline predictions.jsonl.gz]');
  options[args[i].slice(2)] = resolve(args[i + 1]);
}
assert(options.novelty && options['tools-root']);
const root = process.cwd(), feature = 'src/features/tournaments';
const requireTools = createRequire(resolve(options['tools-root'], 'package.json'));
let bundler;
try { bundler = requireTools('esbuild'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  const store = resolve(options['tools-root'], 'node_modules/.pnpm');
  const installed = readdirSync(store).filter(name => /^esbuild@/.test(name));
  assert.equal(installed.length, 1, 'Expected exactly one existing esbuild dependency');
  bundler = requireTools(resolve(store, installed[0], 'node_modules/esbuild'));
}
const { build, transform } = bundler;
const sha = value => createHash('sha256').update(value).digest('hex');
const temp = resolve(root, 'tmp/pairing-results-parity');
mkdirSync(temp, { recursive: true });
const forecasts = [];
for (const [name, repo] of [['en-croissant', root], ['novelty', options.novelty]]) {
  const outfile = resolve(temp, `${name}.mjs`);
  await build({ entryPoints: [resolve(repo, feature, 'pairingForecast.ts')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
  forecasts.push(await import(pathToFileURL(outfile)));
}
const { replay, jobsFor } = await import(pathToFileURL(resolve(options.novelty, 'scripts/pairing-20261002-replay-v2.mts')));
const fixturesPath = resolve(options.novelty, 'docs/benchmarks/pairing-2026-10-02/fixtures.json');
const fixturesBytes = readFileSync(fixturesPath), sources = JSON.parse(fixturesBytes);
const baseline = options.baseline ? gunzipSync(readFileSync(options.baseline)).toString().trim().split('\n').map(JSON.parse) : [];
const saved = new Map(baseline.map(row => [`${row.jobKey}/${row.player}`, row.arms.fallback]));
function pack(module, forecast) {
  return { kind: forecast.kind, round: forecast.round, confidence: forecast.confidence,
    candidates: forecast.candidates.map(c => ({ opponent: c.player.startNumber, p: c.probability,
      displayText: forecast.kind === 'estimated' ? module.formatForecastPercent(c.probability) : null, color: c.color })),
    other: forecast.otherProbability, otherDisplayText: forecast.kind === 'estimated' ? module.formatForecastPercent(forecast.otherProbability) : null };
}
const jobs = jobsFor(sources);
let states = 0, baselinePreserved = 0, intentionalAbstentions = 0;
for (const job of jobs) {
  const source = sources.find(s => String(s.tournamentId) === job.event);
  const { snapshot } = replay(source, job.round, job.checkpoint, job.order);
  for (const player of snapshot.players) {
    const result = forecasts.map(module => pack(module, module.calculatePairingForecast(snapshot, player.startNumber)));
    const key = `${job.key}/${player.startNumber}`;
    assert.deepEqual(result[0], result[1], `Cross-target mismatch: ${key}`);
    if (options.baseline) {
      const previous = saved.get(key);
      assert(previous, `Missing baseline: ${key}`);
      if (snapshot.format === 'swiss' && snapshot.incompletePairingRounds.length && result[0].kind === 'estimated') {
        assert.deepEqual(result[0].candidates.map(c => [c.opponent, c.color]), previous.candidates.map(c => [c.opponent, c.color]));
        assert(result[0].candidates.every(c => c.p === null) && result[0].other === null);
        intentionalAbstentions++;
      } else { assert.deepEqual(result[0], previous, `Unexpected baseline change: ${key}`); baselinePreserved++; }
    }
    states++;
  }
}
if (options.baseline) assert.equal(states, baseline.length);
const kernels = ['publishedPairingResult.ts', 'normalizeTournamentResults.ts', 'pairingHistoryReliability.ts', 'pairingCalibration.ts', 'pairingHistoryCalibration.ts', 'swissParticipation.ts', 'swissPairingSettings.ts', 'publishedNoOpponentScore.ts', 'exactSwissForecast.ts', 'sampledSwissForecast.ts'];
const weights = ['adaptiveSwissWeights.json', 'firstRoundCalibrationWeights.json', 'largeFallbackWeights.json', 'ownResultCalibrationWeights.json', 'pairingCalibrationWeights.json', 'swissAttendanceWeights.json'];
const dependencies = {};
for (const name of [...kernels, ...weights]) {
  const raw = [root, options.novelty].map(repo => readFileSync(resolve(repo, feature, name), 'utf8'));
  // Type aliases and TS suffixes differ between native product architectures;
  // removing only those and formatting must preserve executable algorithms.
  const canonical = name.endsWith('.ts') ? await Promise.all(raw.map(async source =>
    (await transform(source.replace(/\.ts(["'])/g, '$1'), { loader: 'ts', format: 'esm', minifyWhitespace: true })).code))
    : raw.map(source => JSON.stringify(JSON.parse(source)));
  assert.equal(canonical[0], canonical[1], `Kernel/weight differs: ${name}`);
  dependencies[name] = { canonicalSHA256: sha(canonical[0]), enSHA256: sha(raw[0]), noveltySHA256: sha(raw[1]) };
}
function tree(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? tree(resolve(path, entry.name)) : [resolve(path, entry.name)]);
}
for (const name of ['swiss', 'tournament']) {
  const manifests = [root, options.novelty].map(repo => {
    const direct = resolve(repo, `node_modules/@echecs/${name}`);
    const path = existsSync(direct) ? direct : resolve(dirname(realpathSync(resolve(repo, 'node_modules/@echecs/swiss'))), name);
    return Object.fromEntries(tree(path).sort().map(file => [relative(path, file).replaceAll('\\', '/'), sha(readFileSync(file))]));
  });
  assert.deepEqual(manifests[0], manifests[1], `Installed @echecs/${name} differs`);
  dependencies[`@echecs/${name}`] = { treeSHA256: sha(JSON.stringify(manifests[0])), files: Object.keys(manifests[0]).length };
}
const receipt = { fixturesSHA256: sha(fixturesBytes), replaySHA256: sha(readFileSync(resolve(options.novelty, 'scripts/pairing-20261002-replay-v2.mts'))),
  sourceSHA256: Object.fromEntries([root, options.novelty].map(repo => [repo, sha(readFileSync(resolve(repo, feature, 'pairingForecast.ts')))])),
  events: sources.length, snapshots: jobs.length, states, baselinePreserved, intentionalAbstentions, dependencies,
  scope: 'Pure fallback forecasts compared for ids, order, probabilities, colours, kind, round, confidence, Other and displayed labels; no worker runs or delivery. Branding/caveats excluded.' };
writeFileSync(resolve(temp, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
