import type { WebPrepMoveStat } from "./prepIndex";
import {
  getPrepMoveStrengthMap,
  normalizePrepBuilderSettings,
  type PrepBuilderSettings,
} from "@/utils/opponentPrep";
import { getFenColor } from "./pgn";
import type { WebColor } from "./model";
import type { Opening } from "@/utils/db";

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

  const response = await fetchWithTimeout(
    buildWebExplorerUrl({ source, fen, options }),
    {
      headers: {
        Authorization: `Bearer ${trimmedToken}`,
      },
      signal,
    },
    EXPLORER_TIMEOUT_MS,
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error("Lichess token missing or expired.");
  }
  if (!response.ok) {
    throw new Error(`Lichess explorer failed: ${response.status}`);
  }

  return explorerMovesToStats(await response.json(), source, fen, strengthSettings);
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
        key: `${source}:${fen}:${move.uci || move.san}`,
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
    useCloudEngine: false,
    useLichessAll: false,
  });
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
