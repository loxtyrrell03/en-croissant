import { parseUci } from "chessops";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
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
const MAX_CHILD_EVAL_MOVES = 20;

const cloudCache = new BoundedMap<string, WebLichessCloudData>(500);
const missingCloudCache = new BoundedSet<string>(2000);
const inFlightCloudCache = new Map<string, Promise<WebLichessCloudData>>();
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
  const requestedMultipv = Math.max(1, Math.min(12, Math.round((multipv ?? uniqueMoves.length) || 1)));
  const rootMoves = await queryRootCloudMoves({ fen, side, multipv: requestedMultipv, signal });
  const bySan = new Map(rootMoves.map((move) => [normalizeSan(move.san), move]));
  const missingMoves = uniqueMoves.filter((move) => !bySan.has(move)).slice(0, MAX_CHILD_EVAL_MOVES);

  const childMoves = await Promise.all(
    missingMoves.map(async (san) => {
      const childFen = applySanToFen(fen, san);
      if (!childFen) return null;
      const childData = await getCloudEvaluation(childFen, 1, signal).catch(() => null);
      const firstPv = childData?.pvs?.[0] ?? null;
      if (!firstPv) return null;
      const scoreCpForWhite = cloudPvToCp(firstPv);
      return {
        san,
        scoreCpForSide: side === "black" ? -scoreCpForWhite : scoreCpForWhite,
        rank: null,
        source: "lichess" as const,
      };
    }),
  );

  for (const move of childMoves) {
    if (move) bySan.set(normalizeSan(move.san), move);
  }

  return Array.from(bySan.values()).sort(
    (a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.san.localeCompare(b.san),
  );
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

export function webLichessCloudDataToLines(
  fen: string,
  data: WebLichessCloudData,
): WebEngineLine[] {
  return (data.pvs ?? [])
    .map((pv, index) => {
      const uciMoves = pv.moves.trim().split(/\s+/).filter(Boolean);
      const sanMoves = makeSanLineFromUci(fen, uciMoves);
      return {
        source: "lichess-cloud" as const,
        multipv: index + 1,
        depth: data.depth ?? 0,
        nodes: data.knodes ? data.knodes * 1000 : null,
        nps: null,
        score:
          "cp" in pv
            ? ({ type: "cp", value: pv.cp } as const)
            : ({ type: "mate", value: pv.mate } as const),
        uciMoves,
        sanMoves,
      };
    })
    .filter((line) => line.uciMoves.length > 0);
}

async function queryRootCloudMoves({
  fen,
  side,
  multipv,
  signal,
}: {
  fen: string;
  side: WebColor;
  multipv: number;
  signal?: AbortSignal;
}) {
  const [position] = positionFromFen(fen);
  if (!position) return [];

  const data = await getCloudEvaluation(fen, multipv, signal).catch(() => null);
  if (!data?.pvs?.length) return [];

  const moves: PrepBuilderEngineMove[] = [];
  for (const [index, pv] of data.pvs.entries()) {
    const [firstMove] = pv.moves.trim().split(/\s+/);
    if (!firstMove) continue;

    const move = parseUci(firstMove);
    if (!move || !position.isLegal(move)) continue;

    const positionCopy = position.clone();
    const san = makeSan(positionCopy, move);
    const scoreCpForWhite = cloudPvToCp(pv);
    moves.push({
      san,
      scoreCpForSide: side === "black" ? -scoreCpForWhite : scoreCpForWhite,
      rank: index + 1,
      source: "lichess",
    });
  }

  return moves;
}

async function getCloudEvaluation(
  fen: string,
  multipv: number,
  signal?: AbortSignal,
): Promise<WebLichessCloudData> {
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
  }).finally(() => {
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
): Promise<WebLichessCloudData> {
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

  const data = (await response.json()) as WebLichessCloudData;
  cloudCache.set(cacheKey, data);
  return data;
}

async function enqueueCloudEvaluationRequest<T>(run: () => Promise<T>): Promise<T> {
  const task = cloudRequestQueue.then(async () => {
    if (Date.now() < cloudRateLimitedUntil) {
      throw new Error("Lichess cloud evaluation is rate-limited.");
    }

    const waitMs = nextCloudRequestAt - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

function applySanToFen(fen: string, san: string) {
  const [position] = positionFromFen(fen);
  if (!position) return null;
  const move = parseSan(position, san);
  if (!move) return null;
  position.play(move);
  return makeFen(position.toSetup());
}

function cloudPvToCp(pv: WebLichessCloudPv) {
  return "cp" in pv ? pv.cp : mateToCloudCp(pv.mate);
}

function makeSanLineFromUci(fen: string, uciMoves: string[]) {
  const [position] = positionFromFen(fen);
  if (!position) return [];

  const sans: string[] = [];
  for (const uci of uciMoves) {
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) break;

    const normalized = normalizeMove(position, move);
    sans.push(makeSan(position, normalized));
    position.play(normalized);
  }

  return sans;
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
