import { getWebPrepMoveKey, type WebPrepMoveStat } from "./prepIndex";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import {
  getPrepMoveStrengthMap,
  normalizePrepBuilderSettings,
  type PrepBuilderEngineMove,
  type PrepBuilderSettings,
} from "@/utils/opponentPrep";
import { getFenColor } from "./pgn";
import type { WebColor } from "./model";
import type { Opening } from "@/utils/db";
import { queryWebLichessCloudEngineMoves } from "./lichessCloud";
import { positionFromFen } from "@/utils/chessops";

export type WebDatabaseExplorerSource = "lichess-all" | "lichess-masters";
export type WebLichessExplorerSpeed =
  | "ultraBullet"
  | "bullet"
  | "blitz"
  | "rapid"
  | "classical"
  | "correspondence";
export type WebLichessExplorerRating = 0 | 1000 | 1200 | 1400 | 1600 | 1800 | 2000 | 2200 | 2500;

export type WebLichessExplorerOptions = {
  speeds: WebLichessExplorerSpeed[];
  ratings: WebLichessExplorerRating[];
  since?: string;
  until?: string;
  player?: string;
  color: WebColor;
  moves: number;
};

export type WebMastersExplorerOptions = {
  since?: string;
  until?: string;
  moves: number;
};

export type WebExplorerOptions = {
  lichess: WebLichessExplorerOptions;
  masters: WebMastersExplorerOptions;
};

type ExplorerMove = {
  uci: string;
  san: string;
  averageRating?: number;
  white: number;
  black: number;
  draws: number;
};

type ExplorerResponse = {
  white: number;
  black: number;
  draws: number;
  moves: ExplorerMove[];
};

const EXPLORER_BASE_URL = "https://explorer.lichess.org";
const EXPLORER_TIMEOUT_MS = 20_000;
const EXPLORER_PC_TIMEOUT_MS = 8_000;
const EXPLORER_PREFETCH_MOVES = 3;
const PC_STRENGTH_GRACE_MS = 75;
const configuredPrivateServerUrl = String(
  import.meta.env.VITE_EN_CROISSANT_SERVER_URL ?? window.location.origin,
).trim();
const PRIVATE_SERVER_URL = configuredPrivateServerUrl.replace(/\/+$/, "");
const explorerRequests = new Map<string, Promise<ExplorerResponse>>();
export const WEB_LICHESS_EXPLORER_SPEEDS: WebLichessExplorerSpeed[] = [
  "ultraBullet",
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence",
];
export const WEB_LICHESS_EXPLORER_RATINGS: WebLichessExplorerRating[] = [
  0,
  1000,
  1200,
  1400,
  1600,
  1800,
  2000,
  2200,
  2500,
];
export const DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS: WebLichessExplorerOptions = {
  speeds: ["bullet", "blitz", "rapid", "classical", "correspondence"],
  ratings: [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500],
  color: "white",
  moves: 12,
};
export const DEFAULT_WEB_MASTERS_EXPLORER_OPTIONS: WebMastersExplorerOptions = {
  moves: 12,
};

export async function fetchWebExplorerMoveStats({
  source,
  fen,
  token,
  options,
  strengthSettings,
  signal,
}: {
  source: WebDatabaseExplorerSource;
  fen: string;
  token: string;
  options?: Partial<WebExplorerOptions>;
  strengthSettings?: Partial<PrepBuilderSettings> | null;
  signal?: AbortSignal;
}): Promise<WebPrepMoveStat[]> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new Error("Lichess token required.");
  }

  const engineMovesRequest = queryWebLichessCloudEngineMoves({
    fen,
    side: getFenColor(fen),
    multipv: normalizeExplorerMovesForSource(source, options),
    signal,
  }).catch(() => []);
  const data = await getWebExplorerData({ source, fen, token: trimmedToken, options, signal });
  const engineMoves = await waitForPcStrength(engineMovesRequest);

  void prefetchWebExplorerChildren({ source, fen, options, data });

  return explorerMovesToStats(data, source, fen, strengthSettings, engineMoves);
}

async function getWebExplorerData({
  source,
  fen,
  token,
  options,
  signal,
}: {
  source: WebDatabaseExplorerSource;
  fen: string;
  token: string;
  options?: Partial<WebExplorerOptions>;
  signal?: AbortSignal;
}) {
  const directUrl = buildWebExplorerUrl({ source, fen, options });
  const requestKey = directUrl;
  const pending = explorerRequests.get(requestKey);
  if (pending) return await waitForExplorerRequest(pending, signal);

  const request = fetchWebExplorerDataFromPc({ source, fen, options })
    .catch(async (error) => {
      if (isAbortError(error) || signal?.aborted) throw error;
      return await fetchWebExplorerDataDirect(directUrl, token);
    })
    .finally(() => explorerRequests.delete(requestKey));
  explorerRequests.set(requestKey, request);
  return await waitForExplorerRequest(request, signal);
}

async function fetchWebExplorerDataFromPc({
  source,
  fen,
  options,
}: {
  source: WebDatabaseExplorerSource;
  fen: string;
  options?: Partial<WebExplorerOptions>;
}) {
  const response = await fetchWithTimeout(
    buildWebExplorerProxyUrl({ source, fen, options }),
    { headers: { accept: "application/json" } },
    EXPLORER_PC_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`Gaming PC explorer returned HTTP ${response.status}.`);
  return normalizeExplorerResponse(await response.json());
}

async function fetchWebExplorerDataDirect(url: string, token: string) {
  const response = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    EXPLORER_TIMEOUT_MS,
  );
  if (response.status === 401 || response.status === 403) {
    throw new Error("Lichess token missing or expired.");
  }
  if (!response.ok) throw new Error(`Lichess explorer failed: ${response.status}`);

  // The /player explorer endpoint streams ndjson progress lines while Lichess
  // indexes the player's games; the final line holds the complete result.
  const body = await response.text();
  const lastLine = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastLine) throw new Error("Lichess explorer returned an empty response.");
  return normalizeExplorerResponse(JSON.parse(lastLine));
}

export function buildWebExplorerUrl({
  source,
  fen,
  options,
}: {
  source: WebDatabaseExplorerSource;
  fen: string;
  options?: Partial<WebExplorerOptions>;
}) {
  const params = new URLSearchParams({
    fen,
  });

  if (source === "lichess-all") {
    const lichessOptions = normalizeWebLichessExplorerOptions(options?.lichess);
    const player = lichessOptions.player?.trim();
    params.set("moves", String(clampExplorerMoves(lichessOptions.moves)));
    params.set("variant", "standard");
    if (player) {
      params.set("player", player);
      params.set("color", lichessOptions.color);
    }
    if (lichessOptions.speeds.length > 0) params.set("speeds", lichessOptions.speeds.join(","));
    if (lichessOptions.ratings.length > 0) {
      params.set("ratings", lichessOptions.ratings.join(","));
    }
    appendMonthParam(params, "since", lichessOptions.since);
    appendMonthParam(params, "until", lichessOptions.until);
    return `${EXPLORER_BASE_URL}/${player ? "player" : "lichess"}?${params.toString()}`;
  }

  const masterOptions = normalizeWebMastersExplorerOptions(options?.masters);
  params.set("moves", String(clampExplorerMoves(masterOptions.moves)));
  appendYearParam(params, "since", masterOptions.since);
  appendYearParam(params, "until", masterOptions.until);
  return `${EXPLORER_BASE_URL}/masters?${params.toString()}`;
}

export function buildWebExplorerProxyUrl({
  source,
  fen,
  options,
}: {
  source: WebDatabaseExplorerSource;
  fen: string;
  options?: Partial<WebExplorerOptions>;
}) {
  const directUrl = new URL(buildWebExplorerUrl({ source, fen, options }));
  const proxyUrl = new URL(`${PRIVATE_SERVER_URL}/api/lichess-explorer`);
  proxyUrl.searchParams.set("source", source);
  for (const [key, value] of directUrl.searchParams) proxyUrl.searchParams.set(key, value);
  return proxyUrl.toString();
}

export function normalizeWebLichessExplorerOptions(
  options?: Partial<WebLichessExplorerOptions> | null,
): WebLichessExplorerOptions {
  const speeds =
    options?.speeds?.filter((speed): speed is WebLichessExplorerSpeed =>
      WEB_LICHESS_EXPLORER_SPEEDS.includes(speed as WebLichessExplorerSpeed),
    ) ?? DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS.speeds;
  const ratings =
    options?.ratings?.filter((rating): rating is WebLichessExplorerRating =>
      WEB_LICHESS_EXPLORER_RATINGS.includes(rating as WebLichessExplorerRating),
    ) ?? DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS.ratings;
  return {
    speeds: speeds.length > 0 ? Array.from(new Set(speeds)) : DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS.speeds,
    ratings:
      ratings.length > 0
        ? Array.from(new Set(ratings)).sort((a, b) => a - b)
        : DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS.ratings,
    since: normalizeMonthString(options?.since),
    until: normalizeMonthString(options?.until),
    player: options?.player?.trim() || undefined,
    color: options?.color === "black" ? "black" : "white",
    moves: clampExplorerMoves(options?.moves),
  };
}

export function normalizeWebMastersExplorerOptions(
  options?: Partial<WebMastersExplorerOptions> | null,
): WebMastersExplorerOptions {
  return {
    since: normalizeYearString(options?.since),
    until: normalizeYearString(options?.until),
    moves: clampExplorerMoves(options?.moves),
  };
}

function explorerMovesToStats(
  data: ExplorerResponse,
  source: WebDatabaseExplorerSource,
  fen: string,
  strengthSettings?: Partial<PrepBuilderSettings> | null,
  engineMoves?: PrepBuilderEngineMove[],
): WebPrepMoveStat[] {
  const sourceLabel = source === "lichess-all" ? "Lichess All" : "Lichess Masters";
  const userColor = getFenColor(fen);
  const grandTotal = data.moves.reduce((sum, move) => sum + move.white + move.draws + move.black, 0);
  const openings: Opening[] = data.moves.map((move) => ({
    move: move.san,
    white: move.white,
    draw: move.draws,
    black: move.black,
    lastPlayed: null,
  }));
  const strengthMap = getPrepMoveStrengthMap({
    openings,
    engineMoves,
    side: userColor,
    settings: normalizeWebExplorerStrengthSettings(strengthSettings),
  });

  return data.moves
    .map<WebPrepMoveStat>((move) => {
      const total = move.white + move.draws + move.black;
      const scoreForUser =
        total > 0
          ? ((userColor === "white" ? move.white : move.black) + move.draws * 0.5) / total
          : 0.5;

      return {
        move: move.san,
        white: move.white,
        draw: move.draws,
        black: move.black,
        lastPlayed: null,
        key: getWebPrepMoveKey(fen, move.san),
        uci: move.uci || null,
        total,
        share: grandTotal > 0 ? total / grandTotal : 0,
        scoreForUser,
        sourceLabel,
        examples: [],
        strength: strengthMap.get(normalizeSan(move.san)) ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.scoreForUser - a.scoreForUser ||
        a.move.localeCompare(b.move, undefined, { sensitivity: "base" }),
    );
}

function normalizeWebExplorerStrengthSettings(settings?: Partial<PrepBuilderSettings> | null) {
  return normalizePrepBuilderSettings({
    ...settings,
    mode: settings?.mode ?? "practical",
    useCloudEngine: true,
    useLichessAll: false,
  });
}

function normalizeExplorerResponse(value: unknown): ExplorerResponse {
  const response = value as Partial<ExplorerResponse> | null;
  if (!response || !Array.isArray(response.moves)) {
    throw new Error("Lichess explorer returned an invalid response.");
  }
  return {
    white: normalizeExplorerCount(response.white),
    black: normalizeExplorerCount(response.black),
    draws: normalizeExplorerCount(response.draws),
    moves: response.moves
      .map((move) => normalizeExplorerMove(move))
      .filter((move): move is ExplorerMove => Boolean(move)),
  };
}

function normalizeExplorerMove(value: unknown): ExplorerMove | null {
  const move = value as Partial<ExplorerMove> | null;
  const san = typeof move?.san === "string" ? move.san.trim() : "";
  if (!san) return null;
  return {
    uci: typeof move?.uci === "string" ? move.uci : "",
    san,
    averageRating: Number.isFinite(move?.averageRating)
      ? Number(move?.averageRating)
      : undefined,
    white: normalizeExplorerCount(move?.white),
    black: normalizeExplorerCount(move?.black),
    draws: normalizeExplorerCount(move?.draws),
  };
}

function normalizeExplorerCount(value: unknown) {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : 0;
}

function normalizeExplorerMovesForSource(
  source: WebDatabaseExplorerSource,
  options?: Partial<WebExplorerOptions>,
) {
  return source === "lichess-all"
    ? normalizeWebLichessExplorerOptions(options?.lichess).moves
    : normalizeWebMastersExplorerOptions(options?.masters).moves;
}

async function prefetchWebExplorerChildren({
  source,
  fen,
  options,
  data,
}: {
  source: WebDatabaseExplorerSource;
  fen: string;
  options?: Partial<WebExplorerOptions>;
  data: ExplorerResponse;
}) {
  const childFens = data.moves
    .slice(0, EXPLORER_PREFETCH_MOVES)
    .map((move) => applyExplorerSanToFen(fen, move.san))
    .filter((childFen): childFen is string => Boolean(childFen));
  for (const childFen of childFens) {
    try {
      await fetchWebExplorerDataFromPc({ source, fen: childFen, options });
    } catch {
      break;
    }
  }
}

function applyExplorerSanToFen(fen: string, san: string) {
  const [position] = positionFromFen(fen);
  if (!position) return null;
  const move = parseSan(position, san);
  if (!move) return null;
  position.play(move);
  return makeFen(position.toSetup());
}

function waitForExplorerRequest(request: Promise<ExplorerResponse>, signal?: AbortSignal) {
  if (!signal) return request;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Lichess explorer request was cancelled.", "AbortError"));
  }

  return new Promise<ExplorerResponse>((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("Lichess explorer request was cancelled.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function waitForPcStrength(request: Promise<PrepBuilderEngineMove[]>) {
  let timeoutId = 0;
  try {
    return await Promise.race([
      request,
      new Promise<PrepBuilderEngineMove[]>((resolve) => {
        timeoutId = window.setTimeout(() => resolve([]), PC_STRENGTH_GRACE_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeSan(value: string) {
  return value
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .replace(/[+#?!]+$/g, "");
}

function clampExplorerMoves(value: unknown) {
  const numberValue = typeof value === "number" ? value : DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS.moves;
  return Math.max(1, Math.min(30, Math.round(numberValue || 12)));
}

function normalizeMonthString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || year < 1952 || month < 1 || month > 12) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function normalizeYearString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const year = Number(value.trim());
  if (!Number.isInteger(year) || year < 1952 || year > new Date().getFullYear()) return undefined;
  return String(year);
}

function appendMonthParam(params: URLSearchParams, key: string, value: string | undefined) {
  const normalized = normalizeMonthString(value);
  if (normalized) params.set(key, normalized);
}

function appendYearParam(params: URLSearchParams, key: string, value: string | undefined) {
  const normalized = normalizeYearString(value);
  if (normalized) params.set(key, normalized);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const externalSignal = init.signal;
  const onAbort = () => timeoutController.abort();

  try {
    if (externalSignal) {
      if (externalSignal.aborted) timeoutController.abort();
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }

    return await fetch(url, {
      ...init,
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Lichess explorer timed out.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
