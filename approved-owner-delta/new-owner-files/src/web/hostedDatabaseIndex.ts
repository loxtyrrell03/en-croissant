import { getHostedLibraryFileUrl } from "./hostedFiles";
import { normalizeWebFen } from "./pgn";

export type WebHostedPositionMove = {
  move: string;
  uci?: string | null;
  white: number;
  draw: number;
  black: number;
  lastPlayed?: string | null;
};

export type WebHostedPositionIndexManifest = {
  version: 1;
  maxPly: number;
  gameCount: number;
  positionCount: number;
  latestDate?: string | null;
  shards: string[];
};

type WebHostedPositionIndexShard = {
  version: 1;
  positions: Record<string, Record<string, WebHostedPositionMove>>;
};

export async function getHostedDatabasePositionIndexManifest(
  hostedPath: string,
  signal?: AbortSignal,
): Promise<WebHostedPositionIndexManifest | null> {
  const response = await fetch(getHostedPositionIndexManifestUrl(hostedPath), { signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Hosted database index request failed: ${response.status}`);
  }

  const data = await response.json().catch(() => null);
  return normalizeHostedPositionIndexManifest(data);
}

export async function fetchHostedDatabasePositionMoves({
  hostedPath,
  fen,
  signal,
}: {
  hostedPath: string;
  fen: string;
  signal?: AbortSignal;
}): Promise<WebHostedPositionMove[]> {
  const key = normalizeWebFen(fen);
  const response = await fetch(getHostedPositionIndexShardUrl(hostedPath, key), { signal });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Hosted database position request failed: ${response.status}`);
  }

  const shard = normalizeHostedPositionIndexShard(await response.json().catch(() => null));
  const moves = shard.positions[key] ?? {};
  return Object.values(moves).sort(
    (a, b) =>
      getHostedMoveTotal(b) - getHostedMoveTotal(a) ||
      a.move.localeCompare(b.move, undefined, { sensitivity: "base" }),
  );
}

function getHostedPositionIndexManifestUrl(hostedPath: string) {
  return getHostedLibraryFileUrl(`${hostedPath}/position-index/index.json`);
}

function getHostedPositionIndexShardUrl(hostedPath: string, fen: string) {
  return getHostedLibraryFileUrl(
    `${hostedPath}/position-index/shards/${getHostedPositionShardForFen(fen)}.json`,
  );
}

export function getHostedPositionShardForFen(fen: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < fen.length; index += 1) {
    hash ^= fen.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash & 0xff).toString(16).padStart(2, "0");
}

function normalizeHostedPositionIndexManifest(
  data: unknown,
): WebHostedPositionIndexManifest | null {
  const manifest = data as Partial<WebHostedPositionIndexManifest> | null;
  if (
    manifest?.version !== 1 ||
    !Number.isFinite(manifest.maxPly) ||
    !Number.isFinite(manifest.gameCount) ||
    !Number.isFinite(manifest.positionCount) ||
    !Array.isArray(manifest.shards)
  ) {
    return null;
  }

  return {
    version: 1,
    maxPly: Math.max(1, Math.round(Number(manifest.maxPly))),
    gameCount: Math.max(0, Math.round(Number(manifest.gameCount))),
    positionCount: Math.max(0, Math.round(Number(manifest.positionCount))),
    latestDate: typeof manifest.latestDate === "string" ? manifest.latestDate : null,
    shards: manifest.shards.filter((shard): shard is string => typeof shard === "string"),
  };
}

function normalizeHostedPositionIndexShard(data: unknown): WebHostedPositionIndexShard {
  const shard = data as Partial<WebHostedPositionIndexShard> | null;
  const positions: WebHostedPositionIndexShard["positions"] = {};
  if (shard?.version !== 1 || typeof shard.positions !== "object" || !shard.positions) {
    return { version: 1, positions };
  }

  for (const [fen, moves] of Object.entries(shard.positions)) {
    if (typeof moves !== "object" || !moves) continue;
    const normalizedMoves: Record<string, WebHostedPositionMove> = {};
    for (const [move, rawMove] of Object.entries(moves)) {
      const normalizedMove = normalizeHostedPositionMove(move, rawMove);
      if (normalizedMove) normalizedMoves[normalizedMove.move] = normalizedMove;
    }
    positions[normalizeWebFen(fen)] = normalizedMoves;
  }

  return { version: 1, positions };
}

function normalizeHostedPositionMove(
  fallbackMove: string,
  value: unknown,
): WebHostedPositionMove | null {
  const move = value as Partial<WebHostedPositionMove> | null;
  const san = typeof move?.move === "string" && move.move.trim() ? move.move : fallbackMove;
  if (!san.trim()) return null;

  return {
    move: san,
    uci: typeof move?.uci === "string" && move.uci.trim() ? move.uci : null,
    white: normalizeHostedCount(move?.white),
    draw: normalizeHostedCount(move?.draw),
    black: normalizeHostedCount(move?.black),
    lastPlayed: typeof move?.lastPlayed === "string" && move.lastPlayed.trim()
      ? move.lastPlayed
      : null,
  };
}

function normalizeHostedCount(value: unknown) {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : 0;
}

function getHostedMoveTotal(move: WebHostedPositionMove) {
  return move.white + move.draw + move.black;
}
