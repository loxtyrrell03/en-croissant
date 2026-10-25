import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
export const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MASK = (1n << 64n) - 1n;
const hash = (offset) => {
  for (const byte of Buffer.from(FEN.split(/\s+/).slice(0, 4).join(" ")))
    offset = ((offset ^ BigInt(byte)) * 0x100000001b3n) & MASK;
  return offset;
};
const HI = hash(0xcbf29ce484222325n),
  LO = hash(0x84222325cbf29ce4n);
const BUCKET = Number((HI ^ LO) % 16n);
export function writeEvaluationStore(path, score = 24, version = 2) {
  mkdirSync(join(path, "shards"), { recursive: true });
  writeFileSync(
    join(path, "manifest.json"),
    JSON.stringify({
      format: "en-croissant-lichess-eval-compact",
      version,
      complete: true,
      recordSize: version === 1 ? 54 : 0,
      positions: 1,
      shardCount: 16,
      maxPvs: 5,
    }),
  );
  const record = Buffer.alloc(version === 1 ? 54 : 32);
  if (version === 2) record.writeUInt16LE(record.length, 0);
  record.writeBigUInt64LE(HI, version === 1 ? 0 : 2);
  record.writeBigUInt64LE(LO, version === 1 ? 8 : 10);
  record.writeUInt16LE(30, version === 1 ? 16 : 18);
  record[version === 1 ? 18 : 20] = 1;
  const move = 12 | (28 << 6);
  if (version === 1) {
    record.writeUInt16LE(move, 24);
    record.writeInt16LE(score, 26);
  } else {
    record.writeInt16LE(score, 26);
    record[29] = 1;
    record.writeUInt16LE(move, 30);
  }
  const footer = Buffer.alloc(12);
  footer.writeUInt32LE(1, 4);
  footer.write("LEI2", 8);
  const sample = version === 1 ? record : Buffer.concat([record, footer]);
  const shard = join(path, "shards", `${String(BUCKET).padStart(4, "0")}.bin.zst`);
  writeFileSync(shard, zstdCompressSync(sample));
  return { path, shard };
}
