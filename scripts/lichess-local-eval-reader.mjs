import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";

const EXPECTED_FORMAT = "en-croissant-lichess-eval-compact";
const ROOT_ONLY_FORMAT_VERSION = 1;
const CURRENT_FORMAT_VERSION = 2;
const ROOT_ONLY_RECORD_SIZE = 54;
const V2_SHARD_MAGIC = Buffer.from("LEI2");
const MAX_STORED_PVS = 5;
const DEFAULT_CACHE_BYTES = 512 * 1024 * 1024;
const MANIFEST_REFRESH_MS = 30_000;
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
      if (!manifest) return null;

      const fenKey = normalizeFenKey(fen);
      if (!fenKey) return null;
      const [hashHi, hashLo] = hashFen(fenKey);
      const shard = Number((hashHi ^ hashLo) % BigInt(manifest.shardCount));
      const shardPath = join(root, "shards", `${String(shard).padStart(4, "0")}.bin.zst`);
      if (!existsSync(shardPath)) return null;

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
      if (!existsSync(path)) {
        manifest = null;
        manifestMtimeMs = null;
        manifestError = null;
        clearCache();
        return;
      }

      const mtimeMs = statSync(path).mtimeMs;
      if (!force && manifest && manifestMtimeMs === mtimeMs) return;
      const nextManifest = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
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
