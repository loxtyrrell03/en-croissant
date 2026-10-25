import { parseUci } from "chessops";
import { resolvePrivateServiceUrl } from "./serverUrl";
import { normalizeMove } from "chessops/chess";
import { makeSan } from "chessops/san";
import { BoundedMap, BoundedSet } from "@/utils/boundedCache";
import { positionFromFen } from "@/utils/chessops";
import type { PrepBuilderEngineMove } from "@/utils/opponentPrep";
import type { WebColor, WebEngineLine } from "./model";

export type WebLichessCloudData = {
  fen: string;
  knodes?: number;
  depth?: number;
  pvs?: WebLichessCloudPv[];
};

type WebLichessCloudPv = {
  moves: string;
} & ({ cp: number } | { mate: number });

const LICHESS_CLOUD_URL = "https://lichess.org/api/cloud-eval";
const LICHESS_CLOUD_TIMEOUT_MS = 12_000;
const LICHESS_CLOUD_MAX_MULTIPV = 5;
const LICHESS_CLOUD_MIN_REQUEST_INTERVAL_MS = 1_000;
const LICHESS_CLOUD_RATE_LIMIT_COOLDOWN_MS = 60_000;
const PC_STORED_EVAL_TIMEOUT_MS = 2_000;
const configuredRemoteStockfishUrl = resolvePrivateServiceUrl(
  import.meta.env.VITE_EN_CROISSANT_STOCKFISH_URL ?? "https://lox-pc.tail89d19b.ts.net",
).trim();
const REMOTE_STOCKFISH_URL = configuredRemoteStockfishUrl.replace(/\/+$/, "");

const cloudCache = new BoundedMap<string, unknown>(500);
const missingCloudCache = new BoundedSet<string>(2000);
const inFlightCloudCache = new Map<string, Promise<unknown>>();
let cloudRequestQueue: Promise<void> = Promise.resolve();
let nextCloudRequestAt = 0;
let cloudRateLimitedUntil = 0;

export async function queryWebLichessCloudEngineMoves({
  fen,
  side,
  moves,
  multipv,
  signal,
}: {
  fen: string;
  side: WebColor;
  moves?: string[];
  multipv?: number;
  signal?: AbortSignal;
}): Promise<PrepBuilderEngineMove[]> {
  const uniqueMoves = Array.from(new Set((moves ?? []).map(normalizeSan).filter(Boolean)));
  const requestedMultipv = Math.max(
    1,
    Math.min(8, Math.round((multipv ?? uniqueMoves.length) || 1)),
  );
  const data = await getPcStoredEvaluation(fen, requestedMultipv, signal).catch(() => null);
  const rootMoves = cloudDataToPrepBuilderMoves({ fen, side, data });
  const allowedMoves = new Set(uniqueMoves);
  return rootMoves
    .filter((move) => allowedMoves.size === 0 || allowedMoves.has(normalizeSan(move.san)))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.san.localeCompare(b.san));
}

export async function queryWebLichessCloudLines({
  fen,
  multipv,
  signal,
}: {
  fen: string;
  multipv: number;
  signal?: AbortSignal;
}): Promise<WebEngineLine[]> {
  const [position] = positionFromFen(fen);
  if (!position) return [];

  const data = await getCloudEvaluation(fen, multipv, signal);
  return webLichessCloudDataToLines(fen, data);
}

export function webLichessCloudDataToLines(fen: string, data: unknown): WebEngineLine[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const raw = data as Record<string, unknown>;
  const positionKey = (value: string) => value.trim().split(/\s+/).slice(0, 4).join(" ");
  if (
    raw.fen !== undefined &&
    (typeof raw.fen !== "string" || positionKey(raw.fen) !== positionKey(fen))
  )
    return [];
  if (!Array.isArray(raw.pvs)) return [];
  const depth =
    typeof raw.depth === "number" && Number.isFinite(raw.depth) && raw.depth >= 0 ? raw.depth : 0;
  const nodes =
    typeof raw.knodes === "number" && raw.knodes >= 0 && Number.isFinite(raw.knodes * 1000)
      ? raw.knodes * 1000
      : null;
  return raw.pvs.flatMap((value: unknown, index): WebEngineLine[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const pv = value as Record<string, unknown>;
    const score: WebEngineLine["score"] | null =
      typeof pv.mate === "number" && Number.isFinite(pv.mate)
        ? { type: "mate", value: pv.mate }
        : typeof pv.cp === "number" && Number.isFinite(pv.cp)
          ? { type: "cp", value: pv.cp }
          : null;
    if (!score || typeof pv.moves !== "string") return [];
    const { uciMoves, sanMoves } = legalCloudLine(
      fen,
      pv.moves.trim().split(/\s+/).filter(Boolean),
    );
    if (!uciMoves.length) return [];
    return [
      {
        source: "lichess-cloud" as const,
        multipv: index + 1,
        depth,
        nodes,
        nps: null,
        score,
        uciMoves,
        sanMoves,
      },
    ];
  });
}

/** HTTP 200 with malformed evidence is a failed read, never a cacheable miss. */
export function requireWebLichessCloudLines(fen: string, data: unknown): WebEngineLine[] {
  const lines = webLichessCloudDataToLines(fen, data);
  if (!lines.length)
    throw new Error("Stored evaluation data is invalid for this position. Retry lookup.");
  return lines;
}

function cloudDataToPrepBuilderMoves({
  fen,
  side,
  data,
}: {
  fen: string;
  side: WebColor;
  data: unknown;
}) {
  const moves: PrepBuilderEngineMove[] = [];
  for (const line of webLichessCloudDataToLines(fen, data)) {
    const scoreCpForWhite =
      line.score.type === "cp" ? line.score.value : mateToCloudCp(line.score.value);
    moves.push({
      san: line.sanMoves[0],
      scoreCpForSide: side === "black" ? -scoreCpForWhite : scoreCpForWhite,
      rank: line.multipv,
      source: "lichess",
    });
  }

  return moves;
}

async function getPcStoredEvaluation(
  fen: string,
  multipv: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!REMOTE_STOCKFISH_URL) throw new Error("Gaming PC evaluation service is unavailable.");
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PC_STORED_EVAL_TIMEOUT_MS);
  const onAbort = () => controller.abort();

  try {
    if (signal) {
      if (signal.aborted) controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
    const url = new URL(`${REMOTE_STOCKFISH_URL}/v1/cloud-eval`);
    url.searchParams.set("fen", fen);
    url.searchParams.set("multipv", String(multipv));
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 404) return { fen, pvs: [] };
    if (!response.ok) {
      throw new Error(`Gaming PC stored evaluation returned HTTP ${response.status}.`);
    }
    const data: unknown = await response.json();
    requireWebLichessCloudLines(fen, data);
    return data;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function getCloudEvaluation(
  fen: string,
  multipv: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const safeMultipv = normalizeCloudMultipv(multipv);
  const cacheKey = `${fen}-${safeMultipv}`;
  if (cloudCache.has(cacheKey)) return cloudCache.get(cacheKey)!;
  if (missingCloudCache.has(cacheKey)) {
    throw new Error("No Lichess cloud evaluation available.");
  }
  if (Date.now() < cloudRateLimitedUntil) {
    throw new Error("Lichess cloud evaluation is rate-limited.");
  }

  const inFlight = inFlightCloudCache.get(cacheKey);
  if (inFlight) return inFlight;

  const request = enqueueCloudEvaluationRequest(async () => {
    return await fetchCloudEvaluation(fen, safeMultipv, cacheKey, signal);
  }, signal).finally(() => {
    inFlightCloudCache.delete(cacheKey);
  });
  inFlightCloudCache.set(cacheKey, request);
  return request;
}

async function fetchCloudEvaluation(
  fen: string,
  multipv: number,
  cacheKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = new URL(LICHESS_CLOUD_URL);
  url.searchParams.set("fen", fen);
  url.searchParams.set("multiPv", String(multipv));

  const response = await fetchWithTimeout(url.toString(), signal);
  if (response.status === 404) {
    missingCloudCache.add(cacheKey);
    throw new Error("No Lichess cloud evaluation available.");
  }
  if (response.status === 429) {
    const cooldownMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    cloudRateLimitedUntil = Date.now() + (cooldownMs ?? LICHESS_CLOUD_RATE_LIMIT_COOLDOWN_MS);
    nextCloudRequestAt = Math.max(nextCloudRequestAt, cloudRateLimitedUntil);
    throw new Error("Lichess cloud evaluation is rate-limited.");
  }
  if (!response.ok) {
    throw new Error(`Lichess cloud evaluation failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  requireWebLichessCloudLines(fen, data);
  cloudCache.set(cacheKey, data);
  return data;
}

async function enqueueCloudEvaluationRequest<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const task = cloudRequestQueue.then(async () => {
    // Bail out of stale queued requests (e.g. positions the user already
    // navigated away from) without consuming a rate-limit slot, so the
    // request for the current position isn't stuck behind them.
    throwIfCloudAborted(signal);
    if (Date.now() < cloudRateLimitedUntil) {
      throw new Error("Lichess cloud evaluation is rate-limited.");
    }

    const waitMs = nextCloudRequestAt - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs, signal);
    }
    throwIfCloudAborted(signal);

    try {
      return await run();
    } finally {
      nextCloudRequestAt = Math.max(
        nextCloudRequestAt,
        Date.now() + LICHESS_CLOUD_MIN_REQUEST_INTERVAL_MS,
      );
    }
  });

  cloudRequestQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function normalizeCloudMultipv(multipv: number) {
  return Math.max(1, Math.min(LICHESS_CLOUD_MAX_MULTIPV, Math.round(multipv) || 1));
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Lichess cloud evaluation was cancelled.", "AbortError"));
    };
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfCloudAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Lichess cloud evaluation was cancelled.", "AbortError");
  }
}

async function fetchWithTimeout(url: string, signal?: AbortSignal) {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), LICHESS_CLOUD_TIMEOUT_MS);
  const onAbort = () => timeoutController.abort();

  try {
    if (signal) {
      if (signal.aborted) timeoutController.abort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    return await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Lichess cloud evaluation timed out.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

function legalCloudLine(fen: string, moves: string[]) {
  const uciMoves: string[] = [],
    sanMoves: string[] = [];
  const [position] = positionFromFen(fen);
  if (!position) return { uciMoves, sanMoves };

  for (const uci of moves) {
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) break;

    const normalized = normalizeMove(position, move);
    sanMoves.push(makeSan(position, normalized));
    uciMoves.push(uci);
    position.play(normalized);
  }

  return { uciMoves, sanMoves };
}

function mateToCloudCp(mate: number) {
  const sign = mate >= 0 ? 1 : -1;
  return sign * (100000 - Math.min(Math.abs(mate), 100) * 1000);
}

function normalizeSan(value: string) {
  return value
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .replace(/[+#?!]+$/g, "");
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
