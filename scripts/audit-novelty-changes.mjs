/** Read-only history/source inventory. A matching name/hash is not behavior or delivery proof. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing ${name}`);
  return args[index + 1];
};
const enRoot = resolve(option('--en-root', process.cwd()));
const git = (root, ...parameters) => execFileSync('git', ['-C', root, ...parameters], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const commonDirectory = git(enRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim();
const canonicalEn = dirname(commonDirectory);
const noveltyRoot = resolve(option('--novelty-root', join(dirname(canonicalEn), 'outpost-chess')));
const since = option('--since', '2026-07-24');
const destination = resolve(option('--out', join(enRoot, 'tmp/novelty-sync-20261024/history-inventory.json')));
const areas = [
  ['performance', /src\/shared\//],
  ['tournaments', /src\/features\/tournaments\//],
  ['otb-and-downloads', /src-tauri\/.*(?:otb|tournament|data_pack)|src\/.*(?:Otb|otb|PlayerGameImport)/],
  ['game-analysis', /src\/features\/gameAnalysis\/|src\/.*(?:gameAnalysis|GameAnalysis|score\.ts)/],
  ['engine-management', /src\/features\/engines?\/|src\/components\/engines\/|src\/utils\/(?:engines|pcEngine|enginePerformance|engineSettingsOptions)\.ts|src-tauri\/src\/(?:engine|engines|uci)|(?:stockfish|lc0)/i],
  ['engine-plans', /src\/features\/enginePlans\/|src\/.*(?:enginePlan|EnginePlan)/],
  ['plans', /src\/features\/plans\/|src\/.*(?:planExplorer|PlanExplorer)/],
  ['prep-and-database', /src\/features\/(?:prep|database)\/|src\/components\/panels\/(?:prep|database)\//],
  ['files-and-library', /src\/features\/(?:files|library)\/|src\/components\/files\//],
  ['board-and-annotations', /src\/features\/board\/|src\/components\/boards\/|src\/chess\//],
  ['reviews-and-training', /src\/features\/(?:review|training)\/|src\/.*(?:Review|review|puzzle|Puzzle)/],
  ['accounts-and-home', /src\/features\/(?:accounts|home)\/|src\/components\/(?:home|databases)\//],
  ['app-and-controls', /src\/(?:app|components|design)\//],
  ['phone', /src\/web\/|public\/web-|scripts\/(?:home-server|publish-home|phone-)/],
  ['commercial-and-release', /^(?:website|server)\/|(?:licens|stripe|release|updat|publish|marketing|promo)/i],
];

function history(root) {
  const text = git(root, 'log', '--all', `--since=${since}`, '--date=short', '--no-merges', '--format=%H%x09%ad%x09%s', '--name-only', '--', 'src', 'src-tauri/src', 'src-tauri/tournament-core/src', 'scripts');
  const commits = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (/^[a-f0-9]{40}\t/.test(line)) {
      const [commit, date, ...subject] = line.split('\t');
      current = { commit, date, subject: subject.join('\t'), files: [], areas: [] };
      commits.push(current);
    } else if (line && current) current.files.push(line);
  }
  for (const commit of commits) commit.areas = areas.filter(([, pattern]) => commit.files.some(path => pattern.test(path))).map(([area]) => area);
  return commits;
}
function sourceFiles(root, directory = join(root, 'src')) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(root, path) : /\.(?:tsx?|css|rs|json)$/.test(entry.name) ? [path] : [];
  });
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const enFiles = sourceFiles(enRoot);
const byName = new Map();
for (const path of enFiles) {
  const name = path.split(/[\\/]/).at(-1);
  byName.set(name, [...byName.get(name) ?? [], path]);
}
const comparisons = sourceFiles(noveltyRoot).flatMap(path => {
  const matches = byName.get(path.split(/[\\/]/).at(-1)) ?? [];
  if (!matches.length) return [];
  const noveltyHash = hash(path);
  return [{ novelty: relative(noveltyRoot, path).replaceAll('\\', '/'), noveltySha256: noveltyHash,
    en: matches.map(match => ({ path: relative(enRoot, match).replaceAll('\\', '/'), sha256: hash(match), identical: noveltyHash === hash(match) })) }];
});
const result = {
  schema: 1, since, scope: 'All local and fetched branches; source/native-source/script changes. Includes repeated integrations, research and release support.',
  limitation: 'Candidate inventory only. File names and byte parity do not establish feature coverage, correct wiring, installed desktop delivery, hosted phone delivery or physical-device behavior.',
  novelty: { head: git(noveltyRoot, 'rev-parse', 'HEAD').trim(), commits: history(noveltyRoot) },
  en: { head: git(enRoot, 'rev-parse', 'HEAD').trim(), commits: history(enRoot) }, comparisons,
};
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ destination, bytes: statSync(destination).size, noveltyCommits: result.novelty.commits.length,
  enCommits: result.en.commits.length, matchingNames: comparisons.length, identicalNames: comparisons.filter(row => row.en.some(match => match.identical)).length }));
