import type { Color } from "@lichess-org/chessground/types";
import { notifications } from "@mantine/notifications";
import { IconX } from "@tabler/icons-react";
import { resolve } from "@tauri-apps/api/path";
import { fetch } from "@tauri-apps/plugin-http";
import { error } from "@tauri-apps/plugin-log";
import { parseUci } from "chessops";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { match, P } from "ts-pattern";
import {
  type BestMoves,
  commands,
  type EngineOptions,
  type GoMode,
  type NormalizedGame,
} from "@/bindings";
import { parsePGN, uciNormalize } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { apiHeaders } from "@/utils/http";
import {
  getLichessGamesQueryParams,
  getMasterGamesQueryParams,
  type LichessGamesOptions,
  type MasterGamesOptions,
} from "@/utils/lichess/explorer";
import { countMainPly } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";
import { BoundedMap, BoundedSet } from "../boundedCache";
import { getDatabasesDir } from "../directories";

const baseURL = "https://lichess.org/api";
const explorerURL = "https://explorer.lichess.org";
const tablebaseURL = "https://tablebase.lichess.org";
const LICHESS_EXPLORER_TIMEOUT_MS = 20_000;
const LICHESS_GAME_EXPORT_TIMEOUT_MS = 15_000;
const LICHESS_CLOUD_MAX_MULTIPV = 5;

export const MIN_DATE = new Date(1952, 0, 1);

export type LichessCloudFailureReason =
  | "missing"
  | "rate-limited"
  | "timeout"
  | "network"
  | "http"
  | "invalid-response";

export class LichessCloudEvaluationError extends Error {
  readonly reason: LichessCloudFailureReason;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    reason: LichessCloudFailureReason,
    message: string,
    options?: { status?: number; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message);
    this.name = "LichessCloudEvaluationError";
    this.reason = reason;
    this.status = options?.status;
    this.retryAfterMs = options?.retryAfterMs;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export type LichessCloudFailure = {
  reason: LichessCloudFailureReason;
  message: string;
  detail?: string;
};

export function getLichessCloudFailure(error: unknown): LichessCloudFailure {
  const cloudError = normalizeLichessCloudError(error);
  return {
    reason: cloudError.reason,
    message: cloudError.message,
    detail:
      cloudError.reason === "rate-limited" && cloudError.retryAfterMs
        ? `Retry after about ${formatDuration(cloudError.retryAfterMs)}.`
        : cloudError.status
          ? `HTTP ${cloudError.status}`
          : undefined,
  };
}

export type TablebaseCategory =
  | "win"
  | "unknown"
  | "maybe-win"
  | "cursed-win"
  | "draw"
  | "blessed-loss"
  | "maybe-loss"
  | "loss";

type TablebaseData = {
  checkmate: boolean;
  stalemate: boolean;
  variant_win: boolean;
  variant_loss: boolean;
  insufficient_material: boolean;
  dtz: number;
  precise_dtz: number;
  dtm: number;
  category: TablebaseCategory;
  moves: TablebaseMove[];
};

export type TablebaseMove = {
  uci: string;
  san: string;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
  variant_win: boolean;
  variant_loss: boolean;
  insufficient_material: boolean;
  dtz: number;
  precise_dtz: number;
  dtm: number;
  category: TablebaseCategory;
};

type LichessPerf = {
  games: number;
  rating: number;
  rd: number;
  prog: number;
  prov: boolean;
};

async function fetchWithTimeout(
  url: string,
  init: Parameters<typeof fetch>[1] | undefined,
  timeoutMs: number,
  timeoutMessage: string,
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...(init ?? {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export type LichessAccount = {
  id: string;
  username: string;
  perfs?: {
    chess960?: LichessPerf;
    atomic?: LichessPerf;
    racingKings?: LichessPerf;
    ultraBullet?: LichessPerf;
    blitz?: LichessPerf;
    kingOfTheHill?: LichessPerf;
    bullet?: LichessPerf;
    correspondence?: LichessPerf;
    horde?: LichessPerf;
    puzzle?: LichessPerf;
    classical?: LichessPerf;
    rapid?: LichessPerf;
    storm?: {
      runs: number;
      score: number;
    };
  };
  createdAt: number;
  disabled: boolean;
  tosViolation: boolean;
  profile: {
    country: string;
    location: string;
    bio: string;
    firstName: string;
    lastName: string;
    fideRating: number;
    uscfRating: number;
    ecfRating: number;
    links: string;
  };
  seenAt: number;
  patron: boolean;
  verified: boolean;
  playTime: {
    total: number;
    tv: number;
  };
  title: string;
  url: string;
  playing: string;
  completionRate: number;
  count: {
    all: number;
    rated: number;
    ai: number;
    draw: number;
    drawH: number;
    loss: number;
    lossH: number;
    win: number;
    winH: number;
    bookmark: number;
    playing: number;
    import: number;
    me: number;
  };
  streaming: boolean;
  followable: boolean;
  following: boolean;
  blocking: boolean;
  followsYou: boolean;
};

export function getLichessDownloadGameCount(account: LichessAccount) {
  return (
    (account.perfs?.ultraBullet?.games ?? 0) +
    (account.perfs?.bullet?.games ?? 0) +
    (account.perfs?.blitz?.games ?? 0) +
    (account.perfs?.rapid?.games ?? 0) +
    (account.perfs?.classical?.games ?? 0) +
    (account.perfs?.correspondence?.games ?? 0)
  );
}

type PositionGames = {
  uci: string;
  id: string;
  winner: string | null;
  speed: string;
  mode: string;
  black: {
    name: string;
    rating: number;
  };
  white: {
    name: string;
    rating: number;
  };
  year: number;
  month: string;
}[];

export async function convertToNormalized(data: PositionGames): Promise<NormalizedGame[]> {
  const results = await Promise.allSettled(
    data.map(async (game, i) => {
      const pgn = await getLichessGame(game.id);
      const { headers, root } = await parsePGN(pgn);
      const normalized: NormalizedGame = {
        ...headers,
        id: i,
        white_id: 0,
        black_id: 0,
        event_id: 0,
        site_id: 0,
        moves: pgn,
        ply_count: countMainPly(root),
        // ply_count: root,
      };
      return normalized;
    }),
  );
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => (r as PromiseFulfilledResult<NormalizedGame>).value);
}

export type PositionData = {
  white: number;
  black: number;
  draws: number;
  moves: {
    uci: string;
    san: string;
    averageRating: number;
    white: number;
    black: number;
    draws: number;
  }[];
  recentGames?: PositionGames;
  topGames?: PositionGames;
};

export type LichessLatestGame = {
  source: "lichess";
  username: string;
  pgn: string;
  playedAt: number;
  url: string;
};

type LichessLatestGameJson = {
  id?: string;
  pgn?: string;
  createdAt?: number;
  lastMoveAt?: number;
};

export async function getLichessAccount({
  token,
  username,
  silent = false,
}: {
  token?: string;
  username?: string;
  silent?: boolean;
}): Promise<LichessAccount | null> {
  let response: Response;
  if (token) {
    response = await fetch(`${baseURL}/account`, {
      method: "GET",
      headers: apiHeaders({ Authorization: `Bearer ${token}` }),
    });
  } else {
    const url = `${baseURL}/user/${username}`;
    response = await fetch(url, { headers: apiHeaders() });
  }
  if (!response.ok) {
    error(`Failed to fetch Lichess account: ${response.status} ${response.url}`);
    if (!silent) {
      notifications.show({
        title: "Failed to fetch Lichess account",
        message: `Could not find account "${username}" on lichess.org`,
        color: "red",
        icon: <IconX />,
      });
    }
    return null;
  }
  return response.json();
}

export async function getBestMoves(
  _tab: string,
  _goMode: GoMode,
  options: EngineOptions,
): Promise<[number, BestMoves[]] | null> {
  const [pos] = positionFromFen(options.fen);
  if (!pos) {
    return null;
  }
  for (const uci of options.moves) {
    const m = parseUci(uci);
    if (!m) {
      return null;
    }
    pos.play(m);
  }
  const data = await getCloudEvaluation(
    makeFen(pos.toSetup()),
    Number.parseInt(options.extraOptions.find((o) => o.name === "MultiPV")?.value ?? "1"),
  );
  if (!data.pvs?.length) {
    throw new LichessCloudEvaluationError(
      "invalid-response",
      "Local Lichess eval returned no principal variations for this position.",
    );
  }

  const bestMoves = data.pvs
    .map<(BestMoves & { cloudLinePartial?: boolean }) | null>((m, i) => {
      const uciMoves = m.moves.trim().split(/\s+/).filter(Boolean);
      const posCopy = pos.clone();
      const normalizedUciMoves: string[] = [];
      const sanMoves: string[] = [];

      for (const uci of uciMoves) {
        const move = parseUci(uci);
        if (!move || !posCopy.isLegal(move)) break;
        sanMoves.push(makeSan(posCopy, move));
        normalizedUciMoves.push(uciNormalize(posCopy, move));
        posCopy.play(move);
      }

      if (sanMoves.length === 0) {
        return null;
      }

      const bestMove: BestMoves & { cloudLinePartial?: boolean } = {
        score: {
          value:
            "cp" in m
              ? { type: "cp" as const, value: m.cp }
              : { type: "mate" as const, value: m.mate },
          wdl: null,
        },
        source: "lichess" as const,
        nodes: data.knodes * 1000,
        depth: data.depth,
        multipv: i + 1,
        nps: 0,
        sanMoves,
        uciMoves: normalizedUciMoves,
      };

      if (data.source === "local-lichess" && normalizedUciMoves.length <= 1) {
        bestMove.cloudLinePartial = true;
      }

      return bestMove;
    })
    .filter((move): move is BestMoves => move !== null);

  if (bestMoves.length === 0) {
    throw new LichessCloudEvaluationError(
      "invalid-response",
      "Local Lichess eval returned no playable analysis line for this position.",
    );
  }

  return [100, bestMoves];
}

const cache = new BoundedMap<string, LichessCloudData>(500);
const missingCache = new BoundedSet<string>(2000);

export type LichessCloudSource = "local-lichess" | "lichess";

type LichessCloudData = {
  fen: string;
  knodes: number;
  depth: number;
  pvs: (LichessCp | LichessMate)[];
  source: LichessCloudSource;
};

type LichessCp = {
  cp: number;
  moves: string;
};

type LichessMate = {
  mate: number;
  moves: string;
};

export type LichessCloudMove = {
  uci: string;
  san: string;
  scoreCpForWhite: number;
  depth: number;
  mate: number | null;
  source: LichessCloudSource;
};

async function getCloudEvaluation(fen: string, multipv: number): Promise<LichessCloudData> {
  const safeMultipv = normalizeCloudMultipv(multipv);
  const cacheKey = `${fen}-${safeMultipv}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const localData = await getLocalCloudEvaluation(fen, safeMultipv);
  if (localData?.pvs?.length) {
    cache.set(cacheKey, localData);
    missingCache.delete(cacheKey);
    return localData;
  }

  missingCache.add(cacheKey);
  throw new LichessCloudEvaluationError(
    "missing",
    "No local Lichess eval is cached for this exact position.",
  );
}

async function getLocalCloudEvaluation(
  fen: string,
  multipv: number,
): Promise<LichessCloudData | null> {
  try {
    const local = unwrap(await commands.lookupLocalLichessCloudEval(fen, multipv));
    if (!local?.pvs?.length) return null;

    const pvs = local.pvs
      .map((pv) => {
        if (pv.mate !== null && pv.mate !== undefined) {
          return { mate: pv.mate, moves: pv.moves };
        }
        if (pv.cp !== null && pv.cp !== undefined) {
          return { cp: pv.cp, moves: pv.moves };
        }
        return null;
      })
      .filter((pv): pv is LichessCp | LichessMate => pv !== null);

    if (pvs.length === 0) return null;

    return {
      fen: local.fen,
      knodes: local.knodes,
      depth: local.depth,
      pvs,
      source: "local-lichess",
    };
  } catch (error) {
    console.warn("Local Lichess eval lookup failed.", error);
    return null;
  }
}

function normalizeCloudMultipv(multipv: number) {
  return Math.max(1, Math.min(LICHESS_CLOUD_MAX_MULTIPV, Math.round(multipv) || 1));
}

function normalizeLichessCloudError(error: unknown): LichessCloudEvaluationError {
  if (error instanceof LichessCloudEvaluationError) {
    return error;
  }
  if (error instanceof Error && error.message.includes("timed out")) {
    return new LichessCloudEvaluationError(
      "timeout",
      "Local Lichess eval lookup did not answer before the timeout.",
      { cause: error },
    );
  }
  if (error instanceof Error && error.message.includes("No Lichess cloud evaluation")) {
    return new LichessCloudEvaluationError(
      "missing",
      "No local Lichess eval is cached for this exact position.",
      { cause: error },
    );
  }
  return new LichessCloudEvaluationError(
    "network",
    error instanceof Error
      ? `Could not read local Lichess evals: ${error.message}`
      : "Could not read local Lichess evals.",
    { cause: error },
  );
}

function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}

export async function queryLichessCloudMoves(
  fen: string,
  multipv: number,
): Promise<LichessCloudMove[] | null> {
  const [pos] = positionFromFen(fen);
  if (!pos) return null;

  let data: LichessCloudData;
  try {
    data = await getCloudEvaluation(fen, multipv);
  } catch (error) {
    if (getLichessCloudFailure(error).reason === "missing") {
      return null;
    }
    throw error;
  }

  if (!data.pvs?.length) return null;

  const moves: LichessCloudMove[] = [];
  for (const pv of data.pvs) {
    const [firstMove] = pv.moves.trim().split(/\s+/);
    if (!firstMove) continue;

    const move = parseUci(firstMove);
    if (!move || !pos.isLegal(move)) continue;

    const posCopy = pos.clone();
    const san = makeSan(posCopy, move);
    const scoreCpForWhite = "cp" in pv ? pv.cp : mateToCloudCp(pv.mate);
    moves.push({
      uci: uciNormalize(posCopy, move),
      san,
      scoreCpForWhite,
      depth: data.depth,
      mate: "mate" in pv ? pv.mate : null,
      source: data.source,
    });
  }

  return moves.length > 0 ? moves : null;
}

function mateToCloudCp(mate: number) {
  const sign = mate >= 0 ? 1 : -1;
  return sign * (100000 - Math.min(Math.abs(mate), 100) * 1000);
}

export async function getLichessGames(
  fen: string,
  options: LichessGamesOptions,
  token?: string,
  play: string[] = [],
): Promise<PositionData> {
  const url = match(options.player)
    .with(
      P.union(undefined, ""),
      () => `${explorerURL}/lichess?${getLichessGamesQueryParams(fen, options, play)}`,
    )
    .otherwise(() => `${explorerURL}/player?${getLichessGamesQueryParams(fen, options, play)}`);
  const res = await fetchWithTimeout(
    url,
    {
      headers: apiHeaders(
        token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : undefined,
      ),
    },
    LICHESS_EXPLORER_TIMEOUT_MS,
    "Lichess All search timed out. Try again in a moment.",
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Lichess games: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

export async function getMasterGames(
  fen: string,
  options: MasterGamesOptions,
  token?: string,
  play: string[] = [],
): Promise<PositionData> {
  const url = `${explorerURL}/masters?${getMasterGamesQueryParams(fen, options, play)}`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: apiHeaders(
        token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : undefined,
      ),
    },
    LICHESS_EXPLORER_TIMEOUT_MS,
    "Lichess Masters search timed out. Try again in a moment.",
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch master games: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

export async function getPlayerGames(fen: string, player: string, color: Color, token?: string) {
  const res = await fetchWithTimeout(
    `${explorerURL}/player?fen=${fen}&player=${player}&color=${color}`,
    {
      headers: apiHeaders(
        token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : undefined,
      ),
    },
    LICHESS_EXPLORER_TIMEOUT_MS,
    "Lichess player search timed out. Try again in a moment.",
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch player games: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

export async function downloadLichess(
  player: string,
  timestamp: number | null,
  games: number,
  setProgress: (progress: number) => void,
  token?: string,
) {
  let url = `${baseURL}/games/user/${player}?perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&sort=dateAsc`;
  url += "&clocks=true";
  url += "&evals=true&accuracy=true&opening=true&division=true";
  if (timestamp) {
    url += `&since=${timestamp}`;
  }
  const path = await resolve(await getDatabasesDir(), `${player}_lichess.pgn`);

  unwrap(
    await commands.downloadFile(
      `lichess_${player}`,
      url,
      path,
      token ?? null,
      null,
      games > 0 ? games * 900 : null, // approx. size of a game
    ),
  );
}

export async function getLichessGame(gameId: string): Promise<string> {
  const response = await fetchWithTimeout(
    `https://lichess.org/game/export/${gameId.slice(0, 8)}`,
    undefined,
    LICHESS_GAME_EXPORT_TIMEOUT_MS,
    `Lichess game ${gameId.slice(0, 8)} download timed out.`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load lichess game ${gameId} - ${response.statusText}`);
  }
  return await response.text();
}

export async function getLatestLichessGame(
  player: string,
  token?: string,
): Promise<LichessLatestGame | null> {
  return (await getRecentLichessGames(player, 1, token))[0] ?? null;
}

export async function getRecentLichessGames(
  player: string,
  limit = 10,
  token?: string,
  before?: number | null,
): Promise<LichessLatestGame[]> {
  const boundedLimit = Math.min(30, Math.max(1, Math.round(limit)));
  const url = new URL(`${baseURL}/games/user/${encodeURIComponent(player)}`);
  url.searchParams.set("max", String(boundedLimit));
  url.searchParams.set("sort", "dateDesc");
  url.searchParams.set("pgnInJson", "true");
  url.searchParams.set("clocks", "true");
  url.searchParams.set("evals", "true");
  url.searchParams.set("accuracy", "true");
  url.searchParams.set("perfType", "ultraBullet,bullet,blitz,rapid,classical,correspondence");
  if (typeof before === "number" && Number.isFinite(before)) {
    url.searchParams.set("until", String(Math.max(0, Math.floor(before) - 1)));
  }

  const response = await fetch(url.toString(), {
    headers: apiHeaders({
      Accept: "application/x-ndjson",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
  });
  if (!response.ok) {
    error(`Failed to fetch latest Lichess game: ${response.status} ${response.url}`);
    throw new Error(`Failed to fetch latest Lichess game for ${player}`);
  }

  const body = await response.text();
  const games = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LichessLatestGameJson;
      } catch {
        return null;
      }
    })
    .filter(
      (game): game is LichessLatestGameJson & { pgn: string } =>
        typeof game?.pgn === "string" && game.pgn.trim().length > 0,
    );

  return games
    .sort((a, b) => (b.lastMoveAt ?? b.createdAt ?? 0) - (a.lastMoveAt ?? a.createdAt ?? 0))
    .slice(0, boundedLimit)
    .map((game) => {
      const id = game.id?.slice(0, 8) ?? "";
      return {
        source: "lichess",
        username: player,
        pgn: game.pgn,
        playedAt: game.lastMoveAt ?? game.createdAt ?? 0,
        url: id ? `https://lichess.org/${id}` : `https://lichess.org/@/${player}`,
      };
    });
}

export async function getTablebaseInfo(fen: string): Promise<TablebaseData> {
  const res = await fetch(`${tablebaseURL}/standard?fen=${fen}`, {
    headers: apiHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load tablebase info for ${fen}.`);
  }
  return res.json();
}

export async function getFidePlayer(query: string) {
  if (!Number.isNaN(Number(query))) {
    const res = await fetch(`${baseURL}/fide/player/${query}`, {
      headers: apiHeaders({
        Accept: "application/json",
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } else {
    const res = await fetch(`${baseURL}/fide/player?q=${query}`, {
      headers: apiHeaders({
        Accept: "application/json",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data[0];
    }
  }
  throw new Error("Player not found");
}
