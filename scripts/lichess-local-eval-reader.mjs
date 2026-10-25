import {
  closeSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { zstdDecompress, zstdDecompressSync } from "node:zlib";

const EXPECTED_FORMAT = "en-croissant-lichess-eval-compact";
const ROOT_ONLY_FORMAT_VERSION = 1;
const CURRENT_FORMAT_VERSION = 2;
const ROOT_ONLY_RECORD_SIZE = 54;
const V2_SHARD_MAGIC = Buffer.from("LEI2");
const MAX_STORED_PVS = 5;
const DEFAULT_CACHE_BYTES = 512 * 1024 * 1024;
const MANIFEST_REFRESH_MS = 30_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const FNV_PRIME = 0x00000100000001b3n;
const FNV_OFFSET_HI = 0xcbf29ce484222325n;
const FNV_OFFSET_LO = 0x84222325cbf29ce4n;
const U64_MASK = 0xffffffffffffffffn;
const decompressZstd = promisify(zstdDecompress);

export function createLocalLichessEvalStore(storeDir, options = {}) {
  const root = resolve(storeDir);
  const maxCacheBytes = positiveInteger(options.maxCacheBytes, DEFAULT_CACHE_BYTES);
  const cache = new Map();
  const pendingLoads = new Map();
  let cacheBytes = 0;
  let manifest = null;
  let manifestMtimeMs = null;
  let manifestError = null;
  let nextManifestRefreshAt = 0;

  refreshManifest(true);

  return {
    get status() {
      refreshManifest();
      return {
        available: Boolean(manifest),
        path: root,
        positions: manifest?.positions ?? 0,
        shardCount: manifest?.shardCount ?? 0,
        maxPvs: manifest?.maxPvs ?? 0,
        builtAt: manifest?.builtAt ?? null,
        source: manifest?.source ?? null,
        error: manifestError,
        cachedShards: cache.size,
        cacheBytes,
      };
    },

    async lookup(fen, requestedMultipv = MAX_STORED_PVS) {
      refreshManifest();
      if (manifestError) throw new Error(manifestError);
      if (!manifest) return null;

      const fenKey = normalizeFenKey(fen);
      if (!fenKey) return null;
      const [hashHi, hashLo] = hashFen(fenKey);
      const shard = Number((hashHi ^ hashLo) % BigInt(manifest.shardCount));
      const shardsDir = join(root, "shards");
      if (!directoryPresent(shardsDir)) return null;
      const shardPath = join(shardsDir, `${String(shard).padStart(4, "0")}.bin.zst`);
      const shardMetadata = metadataIfPresent(shardPath);
      if (!shardMetadata) return null;
      if (!shardMetadata.isFile())
        throw new Error(`A local Lichess eval shard is not a file: ${shardPath}`);

      const bytes = await loadShard(shardPath);
      const record =
        manifest.version === ROOT_ONLY_FORMAT_VERSION
          ? findRootOnlyRecord(bytes, hashHi, hashLo)
          : findCurrentRecord(bytes, hashHi, hashLo);
      if (!record) return null;

      const pvLimit = Math.min(
        positiveInteger(requestedMultipv, 1),
        manifest.maxPvs,
        record.pvs.length,
      );
      const pvs = record.pvs.slice(0, pvLimit).map(decodePv).filter(Boolean);
      if (pvs.length === 0) return null;

      return {
        fen: fenKey,
        knodes: record.knodes,
        depth: record.depth,
        pvs,
      };
    },
  };

  function refreshManifest(force = false) {
    if (!force && Date.now() < nextManifestRefreshAt) return;
    nextManifestRefreshAt = Date.now() + MANIFEST_REFRESH_MS;
    const path = join(root, "manifest.json");

    try {
      const metadata = directoryPresent(root) ? metadataIfPresent(path) : null;
      if (!metadata) {
        manifest = null;
        manifestMtimeMs = null;
        manifestError = null;
        clearCache();
        return;
      }

      const mtimeMs = metadata.mtimeMs;
      if (!force && manifest && manifestMtimeMs === mtimeMs) return;
      const nextManifest = JSON.parse(
        readBoundedFile(path, MAX_MANIFEST_BYTES)
          .toString("utf8")
          .replace(/^\uFEFF/, ""),
      );
      validateManifest(nextManifest);
      if (manifestMtimeMs !== mtimeMs) clearCache();
      manifest = nextManifest;
      manifestMtimeMs = mtimeMs;
      manifestError = null;
    } catch (error) {
      manifest = null;
      manifestMtimeMs = null;
      manifestError = error instanceof Error ? error.message : String(error);
      clearCache();
    }
  }

  async function loadShard(path) {
    const cached = cache.get(path);
    if (cached) {
      cache.delete(path);
      cache.set(path, cached);
      return cached;
    }

    const pending = pendingLoads.get(path);
    if (pending) return await pending;

    const load = (async () => {
      const compressed = await readFile(path);
      const bytes = await decompressZstd(compressed);
      if (bytes.length <= maxCacheBytes) {
        cache.set(path, bytes);
        cacheBytes += bytes.length;
        while (cacheBytes > maxCacheBytes && cache.size > 1) {
          const oldestPath = cache.keys().next().value;
          const oldest = cache.get(oldestPath);
          cache.delete(oldestPath);
          cacheBytes -= oldest?.length ?? 0;
        }
      }
      return bytes;
    })().finally(() => pendingLoads.delete(path));
    pendingLoads.set(path, load);
    return await load;
  }

  function clearCache() {
    cache.clear();
    cacheBytes = 0;
  }
}

function metadataIfPresent(path) {
  try {
    return statSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function directoryPresent(path) {
  const metadata = metadataIfPresent(path);
  if (!metadata) return false;
  if (!metadata.isDirectory())
    throw new Error(`The local Lichess eval path is not a directory: ${path}`);
  return true;
}

function validateManifest(manifest) {
  if (manifest?.format !== EXPECTED_FORMAT || manifest?.complete !== true) {
    throw new Error("The local Lichess eval manifest is incomplete or has an unknown format.");
  }
  if (![ROOT_ONLY_FORMAT_VERSION, CURRENT_FORMAT_VERSION].includes(manifest.version)) {
    throw new Error(`Unsupported local Lichess eval format version: ${manifest.version}`);
  }
  if (!Number.isInteger(manifest.shardCount) || manifest.shardCount < 1) {
    throw new Error("The local Lichess eval manifest has an invalid shard count.");
  }
  if (
    !Number.isInteger(manifest.maxPvs) ||
    manifest.maxPvs < 1 ||
    manifest.maxPvs > MAX_STORED_PVS
  ) {
    throw new Error("The local Lichess eval manifest has an invalid MultiPV count.");
  }
}

function normalizeFenKey(fen) {
  const parts = String(fen || "")
    .trim()
    .split(/\s+/);
  return parts.length >= 4 ? parts.slice(0, 4).join(" ") : null;
}

function hashFen(fen) {
  const bytes = Buffer.from(fen, "utf8");
  return [fnv1a(bytes, FNV_OFFSET_HI), fnv1a(bytes, FNV_OFFSET_LO)];
}

function fnv1a(bytes, offset) {
  let hash = offset;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return hash;
}

function findCurrentRecord(bytes, hashHi, hashLo) {
  if (bytes.length < 8 || !bytes.subarray(bytes.length - 4).equals(V2_SHARD_MAGIC)) {
    throw new Error("A local Lichess eval shard is missing its index.");
  }
  const count = bytes.readUInt32LE(bytes.length - 8);
  const indexStart = bytes.length - 8 - count * 4;
  if (indexStart < 0) throw new Error("A local Lichess eval shard has an invalid index.");

  let low = 0;
  let high = count;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const offset = bytes.readUInt32LE(indexStart + mid * 4);
    const record = recordAt(bytes, indexStart, offset);
    const comparison = compareHash(
      record.readBigUInt64LE(2),
      record.readBigUInt64LE(10),
      hashHi,
      hashLo,
    );
    if (comparison < 0) low = mid + 1;
    else if (comparison > 0) high = mid;
    else return unpackCurrentRecord(record);
  }
  return null;
}

function recordAt(bytes, recordsEnd, offset) {
  if (offset + 2 > recordsEnd) throw new Error("A local Lichess eval record offset is invalid.");
  const length = bytes.readUInt16LE(offset);
  if (length < 26 || offset + length > recordsEnd) {
    throw new Error("A local Lichess eval record has an invalid length.");
  }
  return bytes.subarray(offset, offset + length);
}

function unpackCurrentRecord(record) {
  const expectedLength = record.readUInt16LE(0);
  if (expectedLength !== record.length)
    throw new Error("A local Lichess eval record is truncated.");
  const pvCount = Math.min(record[20], MAX_STORED_PVS);
  const pvs = [];
  let offset = 26;

  for (let index = 0; index < pvCount; index += 1) {
    if (offset + 4 > record.length) throw new Error("A local Lichess eval PV header is truncated.");
    const score = record.readInt16LE(offset);
    const scoreKind = record[offset + 2];
    const moveCount = record[offset + 3];
    offset += 4;
    if (offset + moveCount * 2 > record.length) {
      throw new Error("A local Lichess eval PV is truncated.");
    }
    const moves = [];
    for (let move = 0; move < moveCount; move += 1) {
      moves.push(record.readUInt16LE(offset + move * 2));
    }
    offset += moveCount * 2;
    pvs.push({ score, scoreKind, moves });
  }

  if (offset !== record.length) throw new Error("A local Lichess eval record has trailing bytes.");
  return {
    depth: record.readUInt16LE(18),
    knodes: record.readUInt32LE(22),
    pvs,
  };
}

function findRootOnlyRecord(bytes, hashHi, hashLo) {
  if (bytes.length % ROOT_ONLY_RECORD_SIZE !== 0) {
    throw new Error("A root-only local Lichess eval shard has an invalid length.");
  }
  let low = 0;
  let high = bytes.length / ROOT_ONLY_RECORD_SIZE;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const offset = mid * ROOT_ONLY_RECORD_SIZE;
    const comparison = compareHash(
      bytes.readBigUInt64LE(offset),
      bytes.readBigUInt64LE(offset + 8),
      hashHi,
      hashLo,
    );
    if (comparison < 0) low = mid + 1;
    else if (comparison > 0) high = mid;
    else return unpackRootOnlyRecord(bytes.subarray(offset, offset + ROOT_ONLY_RECORD_SIZE));
  }
  return null;
}

function unpackRootOnlyRecord(record) {
  const pvCount = Math.min(record[18], MAX_STORED_PVS);
  const pvs = [];
  for (let index = 0; index < pvCount; index += 1) {
    const offset = 24 + index * 6;
    pvs.push({
      moves: [record.readUInt16LE(offset)],
      score: record.readInt16LE(offset + 2),
      scoreKind: record[offset + 4],
    });
  }
  return {
    depth: record.readUInt16LE(16),
    knodes: record.readUInt32LE(20),
    pvs,
  };
}

function compareHash(leftHi, leftLo, rightHi, rightLo) {
  if (leftHi < rightHi) return -1;
  if (leftHi > rightHi) return 1;
  if (leftLo < rightLo) return -1;
  if (leftLo > rightLo) return 1;
  return 0;
}

function decodePv(pv) {
  const moves = pv.moves.map(decodeUciMove);
  if (moves.some((move) => !move)) return null;
  if (pv.scoreKind === 0) return { moves: moves.join(" "), cp: pv.score };
  if (pv.scoreKind === 1) return { moves: moves.join(" "), mate: pv.score };
  return null;
}

function decodeUciMove(code) {
  const from = code & 0x3f;
  const to = (code >> 6) & 0x3f;
  const promotion = (code >> 12) & 0x7;
  const suffix = promotion === 0 ? "" : [null, "n", "b", "r", "q"][promotion];
  if (suffix === undefined) return null;
  return `${decodeSquare(from)}${decodeSquare(to)}${suffix}`;
}

function decodeSquare(square) {
  if (square < 0 || square >= 64) return null;
  return `${String.fromCharCode(97 + (square % 8))}${1 + Math.floor(square / 8)}`;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedFile(path, limit) {
  const descriptor = openSync(path, "r");
  try {
    const chunks = [];
    let size = 0;
    while (size <= limit) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - size));
      const count = readSync(descriptor, buffer);
      if (!count) return Buffer.concat(chunks, size);
      chunks.push(buffer.subarray(0, count));
      size += count;
    }
    throw new Error(`The evaluation data file exceeds its ${limit} byte read bound.`);
  } finally {
    closeSync(descriptor);
  }
}

export function sharedLocalEvaluationPath(base, platform = process.platform) {
  if (!["win32", "darwin", "linux"].includes(platform)) return null;
  return join(base, platform === "linux" ? "chess-data" : "ChessData", "lichess", "evaluations");
}

function emptyDefaultDirectory(path) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  if (!statSync(path).isDirectory())
    throw new Error("The evaluation folder path is occupied by another kind of file.");
  const directory = opendirSync(path);
  try {
    return directory.readSync() === null;
  } finally {
    directory.closeSync();
  }
}

function plainDiscoveryEntry(path, directory) {
  const metadata = lstatSync(path, { bigint: true });
  if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile())) {
    throw new Error("The evaluation store contains a linked or unexpected data entry.");
  }
  return metadata;
}

function discoveryIdentity(path) {
  const root = realpathSync.native(path);
  const digest = createHash("sha256").update(root);
  for (const [relative, directory] of [
    ["", true],
    ["manifest.json", false],
    ["shards", true],
  ]) {
    const metadata = plainDiscoveryEntry(join(root, relative), directory);
    digest.update(
      `${relative}:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}:${metadata.birthtimeNs}`,
    );
  }
  const manifestBytes = readBoundedFile(join(root, "manifest.json"), MAX_MANIFEST_BYTES);
  digest.update(manifestBytes);
  return { root, stamp: digest.digest("hex"), manifestBytes };
}

function inspectDiscoveredStore(identity) {
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(identity.manifestBytes),
  );
  validateManifest(manifest);
  if (
    !Number.isInteger(manifest.shardCount) ||
    manifest.shardCount < 16 ||
    manifest.shardCount > 8192 ||
    !Number.isSafeInteger(manifest.positions) ||
    manifest.positions <= 0 ||
    manifest.recordSize !== (manifest.version === 1 ? ROOT_ONLY_RECORD_SIZE : 0)
  ) {
    throw new Error("The discovered evaluation store has incompatible or empty metadata.");
  }
  if (
    ["builtAt", "skipped"].some(
      (key) =>
        manifest[key] !== undefined && (!Number.isSafeInteger(manifest[key]) || manifest[key] < 0),
    ) ||
    (manifest.source !== undefined && typeof manifest.source !== "string")
  ) {
    throw new Error("The discovered evaluation store has incompatible source metadata.");
  }
  const directory = opendirSync(join(identity.root, "shards"));
  const files = [];
  try {
    for (let item; (item = directory.readSync()) !== null; ) {
      const match = /^(\d{4})\.bin\.zst$/.exec(item.name);
      if (!match || Number(match[1]) >= manifest.shardCount)
        throw new Error("The shard folder contains unrecognized or incomplete files.");
      const path = join(identity.root, "shards", item.name);
      const metadata = plainDiscoveryEntry(path, false);
      if (!metadata.size) throw new Error("The shard folder contains an empty data file.");
      files.push({
        path,
        number: Number(match[1]),
        facts: `${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`,
      });
      if (files.length > manifest.shardCount)
        throw new Error("The evaluation store contains too many data shards.");
    }
  } finally {
    directory.closeSync();
  }
  files.sort((a, b) => a.number - b.number);
  if (!files.length) throw new Error("The evaluation store has no data shards.");
  const sample = zstdDecompressSync(readBoundedFile(files[0].path, 80 * 1024 * 1024), {
    maxOutputLength: 64 * 1024 * 1024,
  });
  inspectDiscoverySample(sample, manifest, files[0].number);
  if (discoveryIdentity(identity.root).stamp !== identity.stamp)
    throw new Error("The evaluation store changed while it was recognized. Retry the check.");
  const fingerprint = createHash("sha256").update(identity.stamp).update(sample);
  for (const file of files) {
    const metadata = plainDiscoveryEntry(file.path, false);
    const facts = `${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`;
    if (facts !== file.facts)
      throw new Error("The evaluation shards changed while they were checked. Retry the check.");
    fingerprint.update(`${file.number}:${file.facts}`);
  }
  return fingerprint.digest("hex");
}

function inspectDiscoverySample(bytes, manifest, bucket) {
  let previous = null;
  const check = (raw, current) => {
    const hi = raw.readBigUInt64LE(current ? 2 : 0),
      lo = raw.readBigUInt64LE(current ? 10 : 8);
    if (
      Number((hi ^ lo) % BigInt(manifest.shardCount)) !== bucket ||
      (previous && compareHash(previous[0], previous[1], hi, lo) > 0)
    ) {
      throw new Error("The sample shard is unsorted or belongs to another bucket.");
    }
    previous = [hi, lo];
    const count = raw[current ? 20 : 18];
    if (!count || count > manifest.maxPvs)
      throw new Error("The sample shard has an invalid variation count.");
    // Validate the same encoded fields as the lookup decoders without creating
    // every PV/move string during a potentially multi-megabyte compatibility scan.
    let offset = current ? 26 : 24;
    for (let index = 0; index < count; index++) {
      if (offset + (current ? 4 : 6) > raw.length)
        throw new Error("The sample shard contains a truncated variation.");
      const kind = raw[offset + (current ? 2 : 4)];
      const moves = current ? raw[offset + 3] : 1;
      if (kind > 1) throw new Error("The sample shard contains an invalid score.");
      const start = current ? offset + 4 : offset;
      if (start + moves * 2 > raw.length)
        throw new Error("The sample shard contains truncated moves.");
      for (let move = 0; move < moves; move++) {
        if (((raw.readUInt16LE(start + move * 2) >> 12) & 7) > 4)
          throw new Error("The sample shard contains an invalid move.");
      }
      offset = current ? start + moves * 2 : offset + 6;
    }
    if (current && offset !== raw.length)
      throw new Error("The sample shard contains trailing variation data.");
  };
  if (manifest.version === ROOT_ONLY_FORMAT_VERSION) {
    if (!bytes.length || bytes.length % ROOT_ONLY_RECORD_SIZE)
      throw new Error("The root-only sample shard has an invalid length.");
    for (let at = 0; at < bytes.length; at += ROOT_ONLY_RECORD_SIZE)
      check(bytes.subarray(at, at + ROOT_ONLY_RECORD_SIZE), false);
  } else {
    if (bytes.length < 8 || !bytes.subarray(-4).equals(V2_SHARD_MAGIC))
      throw new Error("The sample shard is missing its index.");
    const count = bytes.readUInt32LE(bytes.length - 8),
      end = bytes.length - 8 - count * 4;
    if (!count || end < 0 || count > Math.floor(end / 26))
      throw new Error("The sample shard has an invalid index.");
    let offset = 0;
    for (let index = 0; index < count; index++) {
      if (bytes.readUInt32LE(end + index * 4) !== offset)
        throw new Error("The sample shard has an inconsistent record index.");
      const raw = recordAt(bytes, end, offset);
      check(raw, true);
      offset += raw.length;
    }
    if (offset !== end) throw new Error("The sample shard has unindexed data.");
  }
}

// Configured paths are authoritative, including a deliberately empty/missing
// store. Only an unconfigured default may discover shared immutable data.
export function createDefaultLocalLichessEvalStore({
  explicitPath,
  legacyPath,
  sharedPath,
  now = () => performance.now(),
}) {
  const explicit = explicitPath ? resolve(explicitPath) : null;
  const legacy = resolve(legacyPath),
    shared = sharedPath ? resolve(sharedPath) : null;
  let validation = null,
    active = null;
  function current() {
    let path = explicit ?? legacy,
      signature = `explicit:${path}`,
      error = null;
    if (!explicit && shared) {
      try {
        if (emptyDefaultDirectory(legacy)) path = shared;
        if (emptyDefaultDirectory(path)) {
          path = legacy;
          signature = `empty:${legacy}`;
        } else {
          const identity = discoveryIdentity(path);
          path = identity.root;
          if (
            !validation ||
            validation.error ||
            validation.stamp !== identity.stamp ||
            now() - validation.at >= MANIFEST_REFRESH_MS
          ) {
            try {
              validation = {
                stamp: identity.stamp,
                fingerprint: inspectDiscoveredStore(identity),
                at: now(),
                error: null,
              };
            } catch (failure) {
              validation = { stamp: identity.stamp, at: now(), error: failure.message };
            }
          }
          error = validation.error;
          signature = `${identity.stamp}:${validation.fingerprint ?? error}`;
        }
      } catch (failure) {
        error = failure.message;
        signature = `failed:${path}:${error}`;
      }
    }
    if (!active || active.signature !== signature) {
      active = { signature, path, error, store: error ? null : createLocalLichessEvalStore(path) };
    }
    return active;
  }
  return {
    get status() {
      const state = current();
      return (
        state.store?.status ?? {
          available: false,
          path: state.path,
          error: state.error,
          positions: 0,
          shardCount: 0,
          maxPvs: 0,
          builtAt: null,
          source: null,
          cachedShards: 0,
          cacheBytes: 0,
        }
      );
    },
    async lookup(fen, multipv) {
      const before = current();
      if (before.error) throw new Error(before.error);
      const result = await before.store.lookup(fen, multipv);
      if (current() !== before)
        throw new Error("The evaluation source changed during this lookup. Try again.");
      return result;
    },
  };
}
