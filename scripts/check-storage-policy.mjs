import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function storageViolation(name, bytes) {
  const file = name.replaceAll('\\', '/');
  if (/(^|\/)node_modules(?:\.[^/]+)?\//.test(file)) return 'dependency archives belong outside Git';
  if (/(^|\/)target\/(?:debug|release|incremental)\//.test(file)) return 'compiler outputs belong outside Git';
  if (/^[^/]+\.(?:webm|mp4\.part)$/.test(file)) return 'downloaded root-level videos must not be replicated in worktrees';
  if (/(?:^|\/)lichess_db_[^/]+\.(?:zst|pgn)$/.test(file)) return 'downloaded public datasets belong in the shared data store';
  if (/^docs\/benchmarks\//.test(file) && /\/(?:jobs(?:-v2)?|arms|source-jobs|synthetic-jobs|replay-jobs|profile-jobs|comparison-jobs)\//.test(file)) return 'restored benchmark receipts belong outside Git';
  if (/^docs\/benchmarks\//.test(file) && /\/(?:[^/]*part-\d+\.tar\.gz|measured-source\.tar\.gz|permutation-proof\.json(?:\.gz)?|source-graphs[^/]*\.jsonl(?:\.gz)?)$/.test(file) && bytes > 1024 * 1024) return 'large research archives belong in external artifact storage, not every checkout';
  if (/(?:^|\/)(?:tmp|cache|shards)\//.test(file) && /\.(?:sqlite3?|pgn|zst|part)$/.test(file) && bytes > 1024 * 1024) return 'generated test data must not enter Git history';
  if (bytes > 50 * 1024 * 1024) return 'files over 50 MiB require external asset storage';
  return null;
}

function git(args, input) {
  const result = spawnSync('git', args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' } });
  if (result.status !== 0) throw Error(result.stderr || 'Storage-policy Git read failed');
  return result.stdout;
}

export function checkStaged() {
  const files = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).split('\0').filter(Boolean);
  const violations = [];
  for (const file of files) {
    // Read the staged object, not a concurrently edited working copy.
    const bytes = Number(git(['cat-file', '-s', ':' + file]).trim());
    if (!Number.isFinite(bytes)) throw Error('Cannot measure staged file: ' + file);
    const reason = storageViolation(file, bytes);
    if (reason) violations.push(`${file}: ${reason}`);
  }
  if (violations.length) throw Error('Storage policy rejected generated/oversized files:\n' + violations.join('\n'));
  console.log(`Storage policy: ${files.length} staged files checked.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkStaged(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
