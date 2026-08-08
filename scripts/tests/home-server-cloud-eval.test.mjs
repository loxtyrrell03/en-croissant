import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const homeServerScript = join(repoRoot, "scripts", "home-server.mjs");
const STORED_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MISSING_FEN = "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1";
const FNV_PRIME = 0x00000100000001b3n;
const FNV_OFFSET_HI = 0xcbf29ce484222325n;
const FNV_OFFSET_LO = 0x84222325cbf29ce4n;
const U64_MASK = 0xffffffffffffffffn;

test("saved cloud evaluations are served locally and misses fall through to the backend", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "en-croissant-home-cloud-eval-"));
  const storeRoot = join(temporaryRoot, "lichess-cloud-evals");
  await writeLocalEvalStore(storeRoot);

  await withHomeServer(temporaryRoot, storeRoot, async ({ baseUrl, upstreamPaths }) => {
    const hit = await fetch(`${baseUrl}/v1/cloud-eval?fen=${encodeURIComponent(STORED_FEN)}&multipv=3`);
    assert.equal(hit.status, 200);
    const evaluation = await hit.json();
    assert.equal(evaluation.depth, 65);
    assert.equal(evaluation.knodes, 1234);
    assert.deepEqual(evaluation.pvs, [{ moves: "e2e4", cp: 19 }]);
    assert.deepEqual(upstreamPaths, [], "a stored hit must not reach the Stockfish backend");

    const miss = await fetch(`${baseUrl}/v1/cloud-eval?fen=${encodeURIComponent(MISSING_FEN)}`);
    assert.equal(miss.status, 200);
    assert.deepEqual(await miss.json(), { ok: true });
    assert.deepEqual(upstreamPaths, [
      `/v1/cloud-eval?fen=${encodeURIComponent(MISSING_FEN)}`,
    ]);
  });

  await rm(temporaryRoot, { recursive: true, force: true });
});

test("a partly built store is skipped instead of failing the home server", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "en-croissant-home-cloud-eval-partial-"));
  // Only a shard, no manifest: exactly what an interrupted build leaves behind.
  const storeRoot = join(temporaryRoot, "lichess-cloud-evals");
  await mkdir(join(storeRoot, "shards"), { recursive: true });
  await writeFile(join(storeRoot, "shards", "0033.bin.zst"), Buffer.from("not a shard"));

  await withHomeServer(temporaryRoot, storeRoot, async ({ baseUrl, upstreamPaths }) => {
    const response = await fetch(`${baseUrl}/v1/cloud-eval?fen=${encodeURIComponent(STORED_FEN)}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(upstreamPaths.length, 1, "the request must be proxied to the Stockfish backend");

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    await health.body.cancel();
  });

  await rm(temporaryRoot, { recursive: true, force: true });
});

async function withHomeServer(temporaryRoot, storeRoot, run) {
  const serverRoot = join(temporaryRoot, "server");
  const siteRoot = join(serverRoot, "site");
  const upstreamPaths = [];
  let child;

  await mkdir(siteRoot, { recursive: true });
  const upstream = createServer((request, response) => {
    upstreamPaths.push(request.url);
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}\n');
  });

  try {
    const upstreamPort = await listenOnRandomPort(upstream);
    const homePort = await reservePort();
    child = spawn(process.execPath, [homeServerScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        EN_CROISSANT_HOME_SERVER_PORT: String(homePort),
        EN_CROISSANT_HOME_SERVER_ROOT: serverRoot,
        EN_CROISSANT_HOME_SERVER_SITE: siteRoot,
        EN_CROISSANT_STOCKFISH_BACKEND_URL: `http://127.0.0.1:${upstreamPort}`,
        EN_CROISSANT_LOCAL_EVAL_PATH: storeRoot,
        EN_CROISSANT_REPO_ROOT: repoRoot,
        LOCALAPPDATA: join(temporaryRoot, "local"),
        APPDATA: join(temporaryRoot, "roaming"),
        USERPROFILE: join(temporaryRoot, "profile"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let childOutput = "";
    child.stdout.on("data", (chunk) => (childOutput += chunk));
    child.stderr.on("data", (chunk) => (childOutput += chunk));
    const baseUrl = `http://127.0.0.1:${homePort}`;
    await waitForServer(baseUrl, child, () => childOutput);
    upstreamPaths.length = 0;

    await run({ baseUrl, upstreamPaths });
  } finally {
    child?.kill();
    upstream.close();
  }
}

async function writeLocalEvalStore(storeRoot) {
  await mkdir(join(storeRoot, "shards"), { recursive: true });
  await writeFile(
    join(storeRoot, "manifest.json"),
    JSON.stringify({
      format: "en-croissant-lichess-eval-compact",
      version: 2,
      complete: true,
      positions: 1,
      shardCount: 1,
      maxPvs: 5,
      builtAt: new Date().toISOString(),
      source: "home-server cloud-eval test",
    }),
  );
  await writeFile(join(storeRoot, "shards", "0000.bin.zst"), zstdCompressSync(buildShard()));
}

function buildShard() {
  // One record: [length][hash hi][hash lo][depth][pv count][pad][knodes][pvs...],
  // followed by the u32 offset index, the record count, and the "LEI2" magic.
  const [hashHi, hashLo] = hashFen(STORED_FEN.split(/\s+/).slice(0, 4).join(" "));
  const record = Buffer.alloc(32);
  record.writeUInt16LE(record.length, 0);
  record.writeBigUInt64LE(hashHi, 2);
  record.writeBigUInt64LE(hashLo, 10);
  record.writeUInt16LE(65, 18);
  record.writeUInt8(1, 20);
  record.writeUInt32LE(1234, 22);
  record.writeInt16LE(19, 26);
  record.writeUInt8(0, 28);
  record.writeUInt8(1, 29);
  record.writeUInt16LE(encodeUciMove("e2e4"), 30);

  const index = Buffer.alloc(4);
  index.writeUInt32LE(0, 0);
  const footer = Buffer.alloc(8);
  footer.writeUInt32LE(1, 0);
  footer.write("LEI2", 4, "ascii");
  return Buffer.concat([record, index, footer]);
}

function encodeUciMove(uci) {
  const square = (text) => (Number(text[1]) - 1) * 8 + (text.charCodeAt(0) - 97);
  return square(uci.slice(0, 2)) | (square(uci.slice(2, 4)) << 6);
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

async function listenOnRandomPort(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  return server.address().port;
}

async function reservePort() {
  const server = createServer();
  const port = await listenOnRandomPort(server);
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitForServer(baseUrl, child, readOutput) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Home server exited with ${child.exitCode}: ${readOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/health`);
      await response.body.cancel();
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  throw new Error(`Timed out waiting for HomeServer: ${readOutput()}`);
}
