// Personal, opt-in file reconciliation. This module is never imported by an app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const absent = { kind: 'absent', hash: null };
export const same = (a, b) => (a ?? absent).kind === (b ?? absent).kind && (a ?? absent).hash === (b ?? absent).hash;
export const summary = item => item ? { kind: item.kind, hash: item.hash } : absent;

export function contained(root, relative) {
  if (!relative || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..' || /[:\x00-\x1f]/.test(p))) {
    throw Error(`Invalid sync-relative path: ${relative}`);
  }
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('Path escaped sync root');
  return target;
}

async function validateParents(root, relative) {
  const rootInfo = await fs.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Error('Sync root is missing, redirected or not a directory');
  const parts = relative.split('/');
  for (let i = 1; i < parts.length; i++) {
    const parent = contained(root, parts.slice(0, i).join('/'));
    const info = await fs.lstat(parent).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw Error(`Unsafe parent: ${parent}`);
  }
}

export async function readItem(root, relative) {
  await validateParents(root, relative);
  const file = contained(root, relative);
  const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return null;
  if (stat.isSymbolicLink()) throw Error(`Sync will not follow a link: ${file}`);
  if (stat.isDirectory()) return { kind: 'directory', hash: null };
  if (!stat.isFile()) throw Error(`Unsupported file type: ${file}`);
  const bytes = await fs.readFile(file);
  if(bytes.subarray(0,16).equals(Buffer.from('SQLite format 3\0')))throw Error(`SQLite files require the database adapter, not file copying: ${relative}`);
  const after = await fs.stat(file);
  if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ino !== after.ino) throw Error(`File changed during read: ${file}`);
  return { kind: 'file', hash: digest(bytes), bytes, size: bytes.length };
}

export async function scan(root) {
  await validateParents(root, 'probe');
  const result = new Map();
  const visit = async prefix => {
    for (const entry of await fs.readdir(prefix ? contained(root, prefix) : root, { withFileTypes: true })) {
      // Own staging files are not user content. Never ignore ordinary dotfiles.
      if (/^\.personal-sync-[a-f0-9-]+\.pending$/.test(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const item = await readItem(root, relative);
      if (!item) throw Error(`Directory changed during scan: ${relative}`);
      result.set(relative, item);
      if (item.kind === 'directory') await visit(relative);
    }
  };
  await visit('');
  const folded = new Set();
  for (const key of result.keys()) {
    const normalized = key.toLowerCase();
    if (folded.has(normalized)) throw Error(`Case-colliding sync paths: ${key}`);
    folded.add(normalized);
  }
  return result;
}

export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const staged = `${file}.${randomUUID()}.pending`;
  const handle = await fs.open(staged, 'wx');
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(staged, file);
}

async function restoreIndependentCopy(before,file){
  const staged=path.join(path.dirname(file),`.personal-sync-${randomUUID()}.pending`);
  await fs.copyFile(before,staged);
  try{
    const handle=await fs.open(staged,'r+');try{await handle.sync();}finally{await handle.close();}
    await fs.link(staged,file);
  }finally{await fs.unlink(staged).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}

// A replaced/deleted file is moved to durable recovery before publication. The
// second hash check catches edits during staging; exclusive publication cannot
// overwrite a save that arrives after the move. Keep recovery on the same disk.
export async function applyItem({ root, relative, expected, next, recovery, beforePublish }) {
  await validateParents(root, relative);
  const file = contained(root, relative);
  if (!same(await readItem(root, relative), expected)) throw Error(`Concurrent edit: ${relative}`);
  if (same(expected, next)) return;
  if (next?.kind === 'directory') {
    if (expected) throw Error(`File/directory conflict: ${relative}`);
    await fs.mkdir(file);
    return;
  }
  if (expected?.kind === 'directory') {
    if (next) throw Error(`File/directory conflict: ${relative}`);
    // rmdir deliberately refuses nonempty directories, including concurrent adds.
    await fs.rmdir(file);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const transaction = path.join(recovery, randomUUID());
  await fs.mkdir(transaction, { recursive: true });
  const record = { root, relative, expected: summary(expected), next: summary(next), phase: 'prepared', at: new Date().toISOString() };
  await atomicJson(path.join(transaction, 'receipt.json'), record);
  const staged = path.join(path.dirname(file), `.personal-sync-${randomUUID()}.pending`);
  if (next) {
    if (digest(next.bytes) !== next.hash) throw Error('Sync payload hash mismatch');
    const handle = await fs.open(staged, 'wx');
    try { await handle.writeFile(next.bytes); await handle.sync(); } finally { await handle.close(); }
  }
  try {
    if (!same(await readItem(root, relative), expected)) throw Error(`Concurrent edit: ${relative}`);
    if (expected) {
      const saved = path.join(transaction, 'before');
      await fs.rename(file, saved);
      if (digest(await fs.readFile(saved)) !== expected.hash) {
        // Restore only if nobody has created a newer target in the meantime.
        await restoreIndependentCopy(saved, file).catch(error => { if (error.code !== 'EEXIST') throw error; });
        throw Error(`Concurrent edit retained in recovery: ${relative}`);
      }
    }
    await beforePublish?.();
    if (next) {
      // Same-volume hard link is an atomic no-clobber publish of a NEW staging
      // file, immediately unlinked below; it never shares editable app stores.
      await fs.link(staged, file);
    } else if (await readItem(root, relative)) {
      throw Error(`Concurrent save after deletion: ${relative}`);
    }
    record.phase = 'completed';
    await atomicJson(path.join(transaction, 'receipt.json'), record);
  } finally {
    if (next) await fs.unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function decide(base, left, right, initialize = false) {
  if (same(left, right)) return 'equal';
  if (initialize) return 'left';
  // A partially completed operation converges on the next run because the
  // source and target fingerprints agree. A missing baseline is never a delete.
  const leftChanged = !same(left, base?.left);
  const rightChanged = !same(right, base?.right);
  if (leftChanged && rightChanged) return 'conflict';
  if (leftChanged) return 'left';
  if (rightChanged) return 'right';
  return 'conflict';
}

async function recoverInterrupted(recovery) {
  const transactions = await fs.readdir(recovery).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const transaction of transactions) {
    const receiptPath=path.join(recovery,transaction,'receipt.json');
    const record=JSON.parse(await fs.readFile(receiptPath,'utf8'));
    if(record.phase !== 'prepared') continue;
    const current=await readItem(record.root,record.relative);
    if(same(current,record.next)) record.phase='completed';
    else if(same(current,record.expected)) record.phase='rolled-back';
    else if(!current && record.expected.kind==='file') {
      const before=path.join(recovery,transaction,'before');
      if(digest(await fs.readFile(before))!==record.expected.hash) throw Error('Interrupted sync recovery content changed');
      await restoreIndependentCopy(before,contained(record.root,record.relative));
      record.phase='rolled-back';
    } else throw Error(`Interrupted sync needs conflict review: ${record.relative}`);
    await atomicJson(receiptPath,record);
  }
}

export async function syncFiles({ leftRoot, rightRoot, statePath, recovery, initialize = false, dryRun = false }) {
  const roots = await Promise.all([leftRoot, rightRoot].map(p => fs.realpath(p)));
  if (roots[0] === roots[1] || roots.some((r,i) => r.startsWith(roots[1-i] + path.sep))) throw Error('Sync roots must be separate, non-nested directories');
  const state = await fs.readFile(statePath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (state?.initialized && initialize) throw Error('Initial source selection has already been applied');
  if (!state && !initialize) throw Error('Initialize explicitly with Novelty Dev as source before continuous sync');
  if (state && JSON.stringify(state.roots) !== JSON.stringify(roots)) throw Error('Sync roots changed; refusing to reinterpret the baseline');
  if(!dryRun) await recoverInterrupted(recovery);
  const current = state ?? { version: 1, roots, entries: {}, initialized:false };
  const [left, right] = await Promise.all(roots.map(scan));
  const names = [...new Set([...left.keys(), ...right.keys(), ...Object.keys(current.entries)])];
  if(!current.initialized && !current.initial) {
    current.initial=Object.fromEntries(names.map(n=>[n,{left:summary(left.get(n)),right:summary(right.get(n))}]));
    if(!dryRun) await atomicJson(statePath,current);
  }
  const directions=new Map(names.map(n=>{
    const l=left.get(n),r=right.get(n), initial=current.initial?.[n];
    if(!current.initialized && !current.entries[n]) {
      const unchanged=initial && same(l,initial.left) && same(r,initial.right);
      return [n,same(l,r)?'equal':unchanged?'left':'conflict'];
    }
    return [n,decide(current.entries[n],l,r)];
  }));
  // Create parents first, remove children first. Files are handled before any
  // removals of their containing directories.
  names.sort((a,b) => {
    const deleting=n=>directions.get(n)==='left'?!left.has(n):directions.get(n)==='right'?!right.has(n):false;
    const aDelete = deleting(a) && (left.get(a)?.kind==='directory'||right.get(a)?.kind==='directory');
    const bDelete = deleting(b) && (left.get(b)?.kind==='directory'||right.get(b)?.kind==='directory');
    return Number(aDelete)-Number(bDelete) || (aDelete ? b.split('/').length-a.split('/').length : a.split('/').length-b.split('/').length) || a.localeCompare(b);
  });
  const report = { changed: [], conflicts: [], unchanged: 0, dryRun };
  for (const relative of names) {
    const l=left.get(relative), r=right.get(relative);
    const previous=current.entries[relative];
    const direction=directions.get(relative);
    if(direction === 'conflict') { report.conflicts.push(relative); continue; }
    if(direction !== 'equal') {
      const source=direction === 'left'?l:r, target=direction === 'left'?r:l;
      report.changed.push({ relative, from:direction, kind:source?.kind ?? 'delete' });
      if(!dryRun) {
        const sourceRoot=direction === 'left'?roots[0]:roots[1];
        if(!same(await readItem(sourceRoot,relative),source)) throw Error(`Source changed during sync: ${relative}`);
        await applyItem({root:direction === 'left'?roots[1]:roots[0],relative,expected:target,next:source,recovery});
      }
      current.entries[relative]={left:summary(source),right:summary(source)};
    } else {
      report.unchanged++;
      current.entries[relative]={left:summary(l),right:summary(r)};
    }
    // Checkpoints keep successful work durable even if a later file fails.
    if(!dryRun && (direction!=='equal' || !previous)) await atomicJson(statePath,current);
  }
  if(!report.conflicts.length) {current.initialized=true;delete current.initial;}
  if(!dryRun) await atomicJson(statePath,current);
  return report;
}
