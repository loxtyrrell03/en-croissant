// Performance-rating engine and game fetchers for the phone Stats feature.
// The rating math is an EXACT port of EloGuard's lib/smart-bracket.js
// (Surprise-Weighted Bayesian performance rating): every constant, clamp,
// rounding and iteration count is preserved so both apps report identical
// numbers for identical inputs.

export type StatsSource = "chesscom" | "lichess";
export type StatsTimeClass = "bullet" | "blitz" | "rapid" | "classical" | "daily";
export type StatsRatedFilter = "rated" | "casual" | "both";
export type StatsGameResult = "win" | "draw" | "loss";
export type StatsTermination = "checkmate" | "resign" | "timeout" | "draw" | "abandon" | "other";

export type StatsGame = {
    source: StatsSource;
    id: string;
    url: string | null;
    end: number;
    start: number | null;
    rating: number;
    result: StatsGameResult;
    termination: StatsTermination;
    opp: number | null;
    oppName: string | null;
    rated: boolean;
    color: "w" | "b";
    timeClass: StatsTimeClass;
    timeControl: { base: number; inc: number } | null;
    eco: string | null;
    openingName: string | null;
    pgn: string | null;
    providerQuality?: StatsProviderQuality;
    opponentProviderQuality?: StatsProviderQuality;
    division?: { middlegamePly: number | null; endgamePly: number | null };
};

export type StatsProviderQuality = {
    provider: "chesscom" | "lichess";
    accuracy: number | null;
    acpl: number | null;
    inaccuracies: number | null;
    mistakes: number | null;
    blunders: number | null;
};

export type StatsPerformance = {
    perf: number;
    sd: number;
    ci68: [number, number];
    ci95: [number, number];
    ess: number;
    gamesWithOpp: number;
    windowStartRating: number;
    probAboveCurrent: number | null;
    sessionSurprise: number | null;
};

export type StatsPerformancePoint = { end: number; perf: number; sd: number };

export type StatsFormSummary = {
    slopePerWeek: number;
    streak: { type: StatsGameResult; len: number } | null;
    sessions: number;
    net10: number;
    tilt: boolean;
    avgLossPts: number;
    avgWinPts: number;
    latestSessionNet: number;
    latestSessionGames: number;
};

type StatsRatingGame = Pick<StatsGame, "end" | "start" | "rating" | "result" | "opp">;

// Constants from smart-bracket.js — values must never drift from the original.
const PERFORMANCE_WINDOW_DAYS = 7;
const PERFORMANCE_MIN_GAMES = 3;
const SESSION_GAP_SECONDS = 3600;
const RECENT_SESSION_SECONDS = 12 * 3600;

const DRAW_RESULTS = new Set([
    "agreed",
    "repetition",
    "stalemate",
    "insufficient",
    "50move",
    "timevsinsufficient",
]);

function clamp(x: number, lo: number, hi: number) {
    return Math.min(Math.max(x, lo), hi);
}

function mean(values: number[]) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Abramowitz & Stegun 7.1.26 error-function approximation (closed form, deterministic).
function erf(x: number) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const poly =
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
            0.254829592) *
        t;
    return sign * (1 - poly * Math.exp(-ax * ax));
}

function normalCdf(z: number) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
}

function hasFiniteOpp<T extends { opp: number | null }>(game: T): game is T & { opp: number } {
    return typeof game.opp === "number" && Number.isFinite(game.opp);
}

// Build the recency-weighted valid-opponent sample (21-day half-life) for the MAP. Games
// without a finite opponent rating are dropped. Returns the weighted rows and the ess sum.
function weightValidGames(games: StatsRatingGame[], nowSec: number) {
    const valid: { opp: number; w: number; s: number }[] = [];
    let ess = 0;
    for (const game of games) {
        if (!hasFiniteOpp(game)) continue;
        const w = Math.pow(0.5, (nowSec - game.end) / (21 * 86400));
        const s = game.result === "win" ? 1 : game.result === "draw" ? 0.5 : 0;
        valid.push({ opp: game.opp, w, s });
        ess += w;
    }
    return { valid, ess };
}

// MAP Bradley-Terry estimate via Newton, Gaussian prior anchored at R0 (sigma0 200).
// Pure and deterministic; H < 0 always (prior term guards it). Returns { R, sd } (Laplace).
function mapEstimate(valid: { opp: number; w: number; s: number }[], R0: number) {
    const k = Math.LN10 / 400;
    const sigma0 = 200;
    const priorVar = sigma0 * sigma0;

    function gradients(R: number) {
        let g = -(R - R0) / priorVar;
        let H = -1 / priorVar;
        for (const v of valid) {
            const E = 1 / (1 + Math.pow(10, (v.opp - R) / 400));
            g += k * v.w * (v.s - E);
            H += -(k * k) * v.w * E * (1 - E);
        }
        return { g, H };
    }

    let R = R0;
    for (let iter = 0; iter < 50; iter += 1) {
        const point = gradients(R);
        const step = point.g / point.H; // finite: H < 0
        R = clamp(R - step, R0 - 800, R0 + 800);
        if (Math.abs(step) < 0.005) break;
    }

    const sd = Math.sqrt(-1 / gradients(R).H); // Laplace approximation
    return { R, sd };
}

export function groupSessions<T extends { start?: number | null; end: number }>(games: T[]): T[][] {
    if (!games.length) return [];
    const sessions: T[][] = [[games[0]]];
    for (let i = 1; i < games.length; i += 1) {
        const previous = games[i - 1];
        const game = games[i];
        const gap =
            game.start !== null && game.start !== undefined
                ? game.start - previous.end
                : game.end - previous.end;
        if (gap <= SESSION_GAP_SECONDS) sessions[sessions.length - 1].push(game);
        else sessions.push([game]);
    }
    return sessions;
}

export function trendPerWeek(games: { end: number; rating: number }[]): number {
    if (games.length < 5) return 0;
    const xs = games.map((game) => game.end / 86400);
    const ys = games.map((game) => game.rating);
    const meanX = mean(xs);
    const meanY = mean(ys);
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < games.length; i += 1) {
        numerator += (xs[i] - meanX) * (ys[i] - meanY);
        denominator += (xs[i] - meanX) * (xs[i] - meanX);
    }
    if (denominator === 0) return 0;
    return Math.round((numerator / denominator) * 7 * 10) / 10;
}

export function recentStreak<T extends { result: StatsGameResult }>(
    games: T[],
): { type: StatsGameResult; len: number } | null {
    if (!games.length) return null;
    const type = games[games.length - 1].result;
    let len = 1;
    for (let i = games.length - 2; i >= 0 && games[i].result === type; i -= 1) len += 1;
    return { type, len };
}

// Surprise-Weighted Bayesian performance rating: MAP Bradley-Terry with a Gaussian prior
// anchored on the window-start rating. Pure and deterministic. Returns null when the
// opponent-tagged sample has fewer than three games.
export function computePerformance(
    games: StatsRatingGame[],
    opts: { currentRating?: number | null; nowSec: number },
): StatsPerformance | null {
    const currentRating =
        typeof opts.currentRating === "number" && Number.isFinite(opts.currentRating)
            ? opts.currentRating
            : null;
    const nowSec = opts.nowSec;

    const { valid, ess } = weightValidGames(games, nowSec);
    const gamesWithOpp = valid.length;
    if (gamesWithOpp < PERFORMANCE_MIN_GAMES) return null;

    const R0 = games[0].rating;
    const { R, sd } = mapEstimate(valid, R0);
    const perf = Math.round(R);

    // Recent-session surprise vs the CURRENT rating (drives the tilt refinement).
    const sessions = groupSessions(games);
    let sessionSurprise: number | null = null;
    if (currentRating !== null && sessions.length) {
        const latest = sessions[sessions.length - 1].filter(hasFiniteOpp);
        if (latest.length >= 3) {
            sessionSurprise = 0;
            for (const game of latest) {
                const E = 1 / (1 + Math.pow(10, (game.opp - currentRating) / 400));
                const s = game.result === "win" ? 1 : game.result === "draw" ? 0.5 : 0;
                sessionSurprise += s - E;
            }
        }
    }

    const probAboveCurrent =
        currentRating !== null ? Math.round(normalCdf((R - currentRating) / sd) * 100) / 100 : null;

    return {
        perf,
        sd,
        ci68: [perf - Math.round(sd), perf + Math.round(sd)],
        ci95: [perf - Math.round(2 * sd), perf + Math.round(2 * sd)],
        ess: Math.round(ess * 10) / 10,
        gamesWithOpp,
        windowStartRating: R0,
        probAboveCurrent,
        sessionSurprise,
    };
}

// Headline/report performance for an explicitly selected time period. Keep this
// separate from computePerformanceSeries: the latter is a rolling chart and its
// final point covers only the latest rolling window, not the full selected period.
export function computePeriodPerformance(
    games: StatsRatingGame[],
    opts: {
        currentRating?: number | null;
        nowSec: number;
        windowStart: number;
        windowEnd: number;
    },
): StatsPerformance | null {
    const periodGames = games
        .filter(
            (game) =>
                Number.isFinite(game.end) &&
                game.end >= opts.windowStart &&
                game.end <= opts.windowEnd,
        )
        .sort((a, b) => a.end - b.end);

    return computePerformance(periodGames, {
        currentRating: opts.currentRating,
        nowSec: Math.min(opts.nowSec, opts.windowEnd),
    });
}

// Rolling SWB-TPR series for the stats chart. For each game index i, the window is the
// up-to-windowSize games ending at i, with per-window nowSec = games[i].end (recency
// relative to the window's end) and R0 = window's first game rating. A point is emitted
// only once the window carries at least PERFORMANCE_MIN_GAMES opponent-tagged games.
export function computePerformanceSeries(
    games: StatsRatingGame[],
    opts?: { windowSize?: number },
): StatsPerformancePoint[] {
    const windowSize = opts?.windowSize === undefined ? 20 : opts.windowSize;
    const series: StatsPerformancePoint[] = [];
    for (let i = 0; i < games.length; i += 1) {
        const window = games.slice(Math.max(0, i - windowSize + 1), i + 1);
        const nowSec = games[i].end;
        const R0 = window[0].rating;
        const { valid } = weightValidGames(window, nowSec);
        if (valid.length < PERFORMANCE_MIN_GAMES) continue;
        const { R, sd } = mapEstimate(valid, R0);
        series.push({ end: games[i].end, perf: Math.round(R), sd });
    }
    return series;
}

// Form summary distilled from computeSmartBracket's internals (smart-bracket.js:361-647):
// trend, streak, sessions, net over the last 10 games, avgLoss/WinPts with the fallback-8
// rule, and the tilt signal including the surprise-weighted refinement (suppression when
// ss > -0.8 on a pure loss streak; enhancement when ss <= -1.5 with >= 4 valid opponents
// in a recent session). The performance layer feeding the refinement uses the same rolling
// 7-day window as the original bracket.
export function computeFormSummary(
    games: StatsRatingGame[],
    opts: { currentRating?: number | null; nowSec: number },
): StatsFormSummary {
    const nowSec = opts.nowSec;

    const deltas = games.map((game, index) =>
        index === 0 ? null : game.rating - games[index - 1].rating,
    );
    const lossSamples: number[] = [];
    const winSamples: number[] = [];
    for (let i = 1; i < games.length; i += 1) {
        const delta = deltas[i];
        if (delta === null) continue;
        if (games[i].result === "loss" && delta < 0) lossSamples.push(Math.abs(delta));
        if (games[i].result === "win" && delta > 0) winSamples.push(delta);
    }
    const avgLossPts = lossSamples.length >= 5 ? mean(lossSamples) : 8;
    const avgWinPts = winSamples.length >= 5 ? mean(winSamples) : 8;

    const grouped = groupSessions(games);
    const slopePerWeek = trendPerWeek(games);

    const last10Start = Math.max(0, games.length - 10);
    let net10 = 0;
    for (let i = last10Start; i < games.length; i += 1) {
        const delta = deltas[i];
        if (delta !== null) net10 += delta;
    }
    const streak = recentStreak(games);

    const latestSession = grouped.length ? grouped[grouped.length - 1] : [];
    const latestSessionStreak = recentStreak(latestSession);
    const latestSessionNet = latestSession.length
        ? latestSession[latestSession.length - 1].rating - latestSession[0].rating
        : 0;
    const latestIsRecent = latestSession.length
        ? nowSec - latestSession[latestSession.length - 1].end <= RECENT_SESSION_SECONDS
        : false;
    const tiltFromStreak =
        latestIsRecent &&
        latestSessionStreak !== null &&
        latestSessionStreak.type === "loss" &&
        latestSessionStreak.len >= 3;
    const tiltFromNet = latestIsRecent && latestSessionNet <= -2.5 * avgLossPts;

    // Performance layer over the rolling 7-day window (like computeSmartBracket when no
    // separate performanceGames are supplied).
    const performanceCutoff = nowSec - PERFORMANCE_WINDOW_DAYS * 86400;
    const performanceGames = games.filter(
        (game) => Number.isFinite(game.end) && game.end >= performanceCutoff && game.end <= nowSec,
    );
    const performance = computePerformance(performanceGames, {
        currentRating: opts.currentRating,
        nowSec,
    });
    const performanceSessions = groupSessions(performanceGames);
    const latestPerformanceSession = performanceSessions.length
        ? performanceSessions[performanceSessions.length - 1]
        : [];
    const validLatestOppCount = latestPerformanceSession.filter(hasFiniteOpp).length;
    const latestPerformanceIsRecent = latestPerformanceSession.length
        ? nowSec - latestPerformanceSession[latestPerformanceSession.length - 1].end <=
          RECENT_SESSION_SECONDS
        : false;

    // Surprise-weighted tilt refinement (only when the performance layer is non-null).
    let effTiltFromStreak = tiltFromStreak;
    const effTiltFromNet = tiltFromNet;
    let surpriseTilt = false;
    if (performance) {
        const ss = performance.sessionSurprise;
        // (a) Suppression: a pure loss streak against much stronger opponents is not tilt.
        if (effTiltFromStreak && !effTiltFromNet && ss !== null && ss > -0.8) {
            effTiltFromStreak = false;
        }
        // (b) Enhancement: quietly losing games you would usually win fires tilt.
        if (
            !effTiltFromStreak &&
            !effTiltFromNet &&
            latestPerformanceIsRecent &&
            validLatestOppCount >= 4 &&
            ss !== null &&
            ss <= -1.5
        ) {
            surpriseTilt = true;
        }
    }
    const tilt = effTiltFromStreak || effTiltFromNet || surpriseTilt;

    return {
        slopePerWeek,
        streak,
        sessions: grouped.length,
        net10,
        tilt,
        avgLossPts,
        avgWinPts,
        latestSessionNet,
        latestSessionGames: latestSession.length,
    };
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

const CHESSCOM_API_URL = "https://api.chess.com/pub/player";
const LICHESS_API_URL = "https://lichess.org/api";

export async function fetchStatsGames(opts: {
    source: StatsSource;
    username: string;
    timeClass: StatsTimeClass;
    ratedFilter: StatsRatedFilter;
    maxGames: number;
    maxDays: number;
    monthsCap?: number;
    lichessToken?: string | null;
    signal?: AbortSignal;
}): Promise<StatsGame[]> {
    const username = opts.username.trim();
    if (!username || opts.maxGames <= 0) return [];
    return opts.source === "chesscom"
        ? fetchChessComStatsGames({ ...opts, username })
        : fetchLichessStatsGames({ ...opts, username });
}

export async function fetchCurrentRating(opts: {
    source: StatsSource;
    username: string;
    timeClass: StatsTimeClass;
    signal?: AbortSignal;
}): Promise<number | null> {
    const username = opts.username.trim();
    if (!username) return null;

    if (opts.source === "chesscom") {
        const key = getChessComStatsKey(opts.timeClass);
        if (!key) return null;
        const response = await fetch(
            `${CHESSCOM_API_URL}/${encodeURIComponent(username)}/stats`,
            opts.signal ? { signal: opts.signal } : undefined,
        );
        if (!response.ok) return null;
        const data = (await response.json()) as Record<
            string,
            { last?: { rating?: number } } | undefined
        >;
        const rating = data?.[key]?.last?.rating;
        return typeof rating === "number" && Number.isFinite(rating) ? rating : null;
    }

    const perfKey = opts.timeClass === "daily" ? "correspondence" : opts.timeClass;
    const response = await fetch(
        `${LICHESS_API_URL}/user/${encodeURIComponent(username)}`,
        opts.signal ? { signal: opts.signal } : undefined,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
        perfs?: Record<string, { rating?: number } | undefined>;
    };
    const rating = data.perfs?.[perfKey]?.rating;
    return typeof rating === "number" && Number.isFinite(rating) ? rating : null;
}

function getChessComStatsKey(timeClass: StatsTimeClass) {
    if (timeClass === "bullet") return "chess_bullet";
    if (timeClass === "blitz") return "chess_blitz";
    if (timeClass === "rapid") return "chess_rapid";
    if (timeClass === "daily") return "chess_daily";
    return null;
}

// -- chess.com ---------------------------------------------------------------

type ChessComArchivePlayer = { username?: string; rating?: number; result?: string };
type ChessComArchiveGame = {
    url?: string;
    pgn?: string;
    end_time?: number;
    time_class?: string;
    time_control?: string;
    rules?: string;
    rated?: boolean;
    white?: ChessComArchivePlayer;
    black?: ChessComArchivePlayer;
    accuracies?: { white?: number; black?: number };
};

// Mirrors fetchRecentGames (smart-bracket.js:101-144): walk the monthly archives
// newest-first, stop once enough games are collected or a month reaches past the
// cutoff, return oldest-to-newest capped at maxGames.
async function fetchChessComStatsGames(opts: {
    username: string;
    timeClass: StatsTimeClass;
    ratedFilter: StatsRatedFilter;
    maxGames: number;
    maxDays: number;
    monthsCap?: number;
    signal?: AbortSignal;
}): Promise<StatsGame[]> {
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - opts.maxDays * 86400;
    const monthsCap = opts.monthsCap ?? Math.ceil(opts.maxDays / 28) + 1;

    const archiveIndex = (await getChessComJson(
        `${CHESSCOM_API_URL}/${encodeURIComponent(opts.username)}/games/archives`,
        opts.signal,
    )) as { archives?: string[] };
    const archives = Array.isArray(archiveIndex.archives) ? archiveIndex.archives : [];
    const collected: StatsGame[] = [];
    let monthsFetched = 0;

    for (let i = archives.length - 1; i >= 0 && monthsFetched < monthsCap; i -= 1) {
        const archive = (await getChessComJson(archives[i], opts.signal)) as {
            games?: ChessComArchiveGame[];
        };
        monthsFetched += 1;
        const monthGames = normalizeChessComArchiveGames(
            archive.games,
            opts.username,
            opts.timeClass,
            opts.ratedFilter,
        );
        const hasOlderGames = monthGames.some((game) => game.end < cutoff);
        for (const game of monthGames) {
            if (game.end >= cutoff) collected.push(game);
        }
        if (collected.length >= opts.maxGames || hasOlderGames) break;
    }

    collected.sort((a, b) => a.end - b.end);
    return collected.slice(-opts.maxGames);
}

async function getChessComJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(url, signal ? { signal } : undefined);
    if (!response.ok) {
        throw new Error(`Chess.com request failed (${response.status}): ${url}`);
    }
    return response.json();
}

function normalizeChessComArchiveGames(
    archiveGames: ChessComArchiveGame[] | undefined,
    username: string,
    timeClass: StatsTimeClass,
    ratedFilter: StatsRatedFilter,
): StatsGame[] {
    const wantedUser = username.toLowerCase();
    const normalized: StatsGame[] = [];

    for (const game of Array.isArray(archiveGames) ? archiveGames : []) {
        if (!game || game.rules !== "chess" || game.time_class !== timeClass) continue;
        const isRated = game.rated === true;
        if (ratedFilter === "rated" && !isRated) continue;
        if (ratedFilter === "casual" && isRated) continue;

        const whiteName =
            game.white && typeof game.white.username === "string"
                ? game.white.username.toLowerCase()
                : "";
        const blackName =
            game.black && typeof game.black.username === "string"
                ? game.black.username.toLowerCase()
                : "";
        const mine =
            whiteName === wantedUser ? game.white : blackName === wantedUser ? game.black : null;
        if (!mine || typeof mine.rating !== "number" || typeof game.end_time !== "number") continue;

        const opponent = mine === game.white ? game.black : game.white;
        const oppRating =
            opponent && typeof opponent.rating === "number" && Number.isFinite(opponent.rating)
                ? opponent.rating
                : null;
        const pgn = typeof game.pgn === "string" ? game.pgn : null;
        const url = typeof game.url === "string" && game.url ? game.url : null;

        const color = mine === game.white ? "w" : "b";
        const myAccuracy = color === "w" ? game.accuracies?.white : game.accuracies?.black;
        const opponentAccuracy = color === "w" ? game.accuracies?.black : game.accuracies?.white;
        normalized.push({
            source: "chesscom",
            id: url ?? `chesscom-${game.end_time}-${wantedUser}`,
            url,
            end: game.end_time,
            start: parsePgnStart(pgn),
            rating: mine.rating,
            result: normalizeChessComResult(mine.result),
            termination: getChessComTermination(mine.result, opponent?.result),
            opp: oppRating,
            oppName: opponent && typeof opponent.username === "string" ? opponent.username : null,
            rated: isRated,
            color,
            timeClass: game.time_class as StatsTimeClass,
            timeControl: parseChessComTimeControl(game.time_control),
            eco: getPgnHeader(pgn, "ECO"),
            openingName: getChessComOpeningName(pgn),
            pgn,
            ...(typeof myAccuracy === "number" && Number.isFinite(myAccuracy)
                ? {
                      providerQuality: {
                          provider: "chesscom" as const,
                          accuracy: myAccuracy,
                          acpl: null,
                          inaccuracies: null,
                          mistakes: null,
                          blunders: null,
                      },
                  }
                : {}),
            ...(typeof opponentAccuracy === "number" && Number.isFinite(opponentAccuracy)
                ? {
                      opponentProviderQuality: {
                          provider: "chesscom" as const,
                          accuracy: opponentAccuracy,
                          acpl: null,
                          inaccuracies: null,
                          mistakes: null,
                          blunders: null,
                      },
                  }
                : {}),
        });
    }

    normalized.sort((a, b) => a.end - b.end);
    return normalized;
}

function normalizeChessComResult(result: string | undefined): StatsGameResult {
    if (result === "win") return "win";
    if (result !== undefined && DRAW_RESULTS.has(result)) return "draw";
    return "loss";
}

// Termination from MY perspective: a win derives the "how" from the opponent's
// result code (they got checkmated / resigned / timed out / abandoned).
function getChessComTermination(
    myResult: string | undefined,
    oppResult: string | undefined,
): StatsTermination {
    if (myResult === "win") return getChessComEndCode(oppResult);
    if (myResult !== undefined && DRAW_RESULTS.has(myResult)) return "draw";
    return getChessComEndCode(myResult);
}

function getChessComEndCode(code: string | undefined): StatsTermination {
    if (code === "checkmated") return "checkmate";
    if (code === "resigned") return "resign";
    if (code === "timeout") return "timeout";
    if (code === "abandoned") return "abandon";
    if (code !== undefined && DRAW_RESULTS.has(code)) return "draw";
    return "other";
}

// chess.com time_control strings: "180", "600+5", or "1/86400" for daily.
function parseChessComTimeControl(value: string | undefined): { base: number; inc: number } | null {
    if (typeof value !== "string" || !value) return null;
    const daily = value.match(/^\d+\/(\d+)$/);
    if (daily) return { base: Number(daily[1]), inc: 0 };
    const live = value.match(/^(\d+)(?:\+(\d+))?$/);
    if (!live) return null;
    return { base: Number(live[1]), inc: live[2] ? Number(live[2]) : 0 };
}

function getChessComOpeningName(pgn: string | null): string | null {
    const explicit = getPgnHeader(pgn, "Opening");
    if (explicit) return explicit;
    const ecoUrl = getPgnHeader(pgn, "ECOUrl");
    if (!ecoUrl) return null;
    const slug = ecoUrl.split("/").filter(Boolean).pop();
    if (!slug) return null;
    try {
        // ECOUrl slugs append the concrete move list after the opening name
        // ("Queens-Gambit-Declined...6.Bb2-Bd6-7.Bd3"); cut at the first move
        // token so families group cleanly.
        const decoded = decodeURIComponent(slug).replace(/-/g, " ");
        const name = decoded.split(/\.{3}|\s\d+\.|^\d+\./)[0]?.trim() ?? "";
        if (!name || /^undefined$/i.test(name)) return null;
        return name;
    } catch {
        return null;
    }
}

// Port of parsePgnStart (smart-bracket.js:35-49).
function parsePgnStart(pgn: string | null): number | null {
    if (typeof pgn !== "string") return null;
    const date = pgn.match(/\[UTCDate\s+"(\d{4})\.(\d{2})\.(\d{2})"\]/);
    const time = pgn.match(/\[UTCTime\s+"(\d{2}):(\d{2}):(\d{2})"\]/);
    if (!date || !time) return null;
    const value = Date.UTC(
        Number(date[1]),
        Number(date[2]) - 1,
        Number(date[3]),
        Number(time[1]),
        Number(time[2]),
        Number(time[3]),
    );
    return Number.isNaN(value) ? null : value / 1000;
}

function getPgnHeader(pgn: string | null, name: string): string | null {
    if (typeof pgn !== "string") return null;
    const match = pgn.match(new RegExp(`^\\[${name}\\s+"([^"]*)"\\]`, "m"));
    return match?.[1] ?? null;
}

// -- Lichess -----------------------------------------------------------------

type LichessGamePlayer = {
    user?: { name?: string };
    rating?: number;
    ratingDiff?: number;
    analysis?: {
        inaccuracy?: number;
        mistake?: number;
        blunder?: number;
        acpl?: number;
        accuracy?: number;
    };
};
type LichessNdjsonGame = {
    id?: string;
    rated?: boolean;
    variant?: string;
    speed?: string;
    createdAt?: number;
    lastMoveAt?: number;
    status?: string;
    winner?: "white" | "black";
    players?: { white?: LichessGamePlayer; black?: LichessGamePlayer };
    opening?: { eco?: string; name?: string };
    clock?: { initial?: number; increment?: number };
    pgn?: string;
    division?: { middle?: number; end?: number };
};

async function fetchLichessStatsGames(opts: {
    username: string;
    timeClass: StatsTimeClass;
    ratedFilter: StatsRatedFilter;
    maxGames: number;
    maxDays: number;
    lichessToken?: string | null;
    signal?: AbortSignal;
}): Promise<StatsGame[]> {
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - opts.maxDays * 86400;

    const url = new URL(`${LICHESS_API_URL}/games/user/${encodeURIComponent(opts.username)}`);
    url.searchParams.set("max", String(opts.maxGames));
    url.searchParams.set(
        "perfType",
        opts.timeClass === "daily" ? "correspondence" : opts.timeClass,
    );
    url.searchParams.set("sort", "dateDesc");
    url.searchParams.set("since", String(cutoff * 1000));
    url.searchParams.set("pgnInJson", "true");
    url.searchParams.set("clocks", "true");
    url.searchParams.set("evals", "true");
    url.searchParams.set("accuracy", "true");
    url.searchParams.set("division", "true");
    url.searchParams.set("opening", "true");
    if (opts.ratedFilter === "rated") url.searchParams.set("rated", "true");

    const headers: Record<string, string> = { Accept: "application/x-ndjson" };
    if (opts.lichessToken) headers.Authorization = `Bearer ${opts.lichessToken}`;

    const response = await fetch(url.toString(), {
        headers,
        ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!response.ok) {
        throw new Error(`Lichess request failed (${response.status}) for ${opts.username}.`);
    }

    const games: StatsGame[] = [];
    for (const line of (await response.text()).split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let raw: LichessNdjsonGame;
        try {
            raw = JSON.parse(trimmed) as LichessNdjsonGame;
        } catch {
            continue;
        }
        const game = normalizeLichessGame(raw, opts.username, opts.timeClass);
        if (!game) continue;
        // "casual" is filtered client-side; "rated" was already requested server-side.
        if (opts.ratedFilter === "casual" && game.rated) continue;
        if (opts.ratedFilter === "rated" && !game.rated) continue;
        if (game.end < cutoff) continue;
        games.push(game);
    }

    games.sort((a, b) => a.end - b.end);
    return games.slice(-opts.maxGames);
}

function normalizeLichessGame(
    game: LichessNdjsonGame,
    username: string,
    requestedTimeClass: StatsTimeClass,
): StatsGame | null {
    if (!game || typeof game.id !== "string" || !game.id) return null;
    if (game.variant !== undefined && game.variant !== "standard") return null;

    const wantedUser = username.toLowerCase();
    const white = game.players?.white;
    const black = game.players?.black;
    const whiteName = typeof white?.user?.name === "string" ? white.user.name.toLowerCase() : "";
    const blackName = typeof black?.user?.name === "string" ? black.user.name.toLowerCase() : "";
    const color = whiteName === wantedUser ? "w" : blackName === wantedUser ? "b" : null;
    if (!color) return null;

    const mine = color === "w" ? white : black;
    const opponent = color === "w" ? black : white;
    if (!mine || typeof mine.rating !== "number" || !Number.isFinite(mine.rating)) return null;
    const endMs = typeof game.lastMoveAt === "number" ? game.lastMoveAt : game.createdAt;
    if (typeof endMs !== "number" || !Number.isFinite(endMs)) return null;

    const result: StatsGameResult =
        game.winner === undefined
            ? "draw"
            : game.winner === (color === "w" ? "white" : "black")
              ? "win"
              : "loss";

    const providerQuality = normalizeLichessProviderQuality(mine.analysis);
    const opponentProviderQuality = normalizeLichessProviderQuality(opponent?.analysis);
    return {
        source: "lichess",
        id: game.id,
        url: `https://lichess.org/${game.id}`,
        end: Math.floor(endMs / 1000),
        start: typeof game.createdAt === "number" ? Math.floor(game.createdAt / 1000) : null,
        rating: mine.rating + (typeof mine.ratingDiff === "number" ? mine.ratingDiff : 0),
        result,
        termination: getLichessTermination(game.status),
        opp:
            opponent && typeof opponent.rating === "number" && Number.isFinite(opponent.rating)
                ? opponent.rating
                : null,
        oppName: opponent && typeof opponent.user?.name === "string" ? opponent.user.name : null,
        rated: game.rated === true,
        color,
        timeClass: getLichessTimeClass(game.speed, requestedTimeClass),
        timeControl:
            typeof game.clock?.initial === "number"
                ? { base: game.clock.initial, inc: game.clock.increment ?? 0 }
                : null,
        eco: typeof game.opening?.eco === "string" ? game.opening.eco : null,
        openingName: typeof game.opening?.name === "string" ? game.opening.name : null,
        pgn: typeof game.pgn === "string" ? game.pgn : null,
        ...(providerQuality ? { providerQuality } : {}),
        ...(opponentProviderQuality ? { opponentProviderQuality } : {}),
        ...(game.division
            ? {
                  division: {
                      middlegamePly: finiteOptionalNumber(game.division.middle),
                      endgamePly: finiteOptionalNumber(game.division.end),
                  },
              }
            : {}),
    };
}

function normalizeLichessProviderQuality(
    value: LichessGamePlayer["analysis"] | undefined,
): StatsProviderQuality | null {
    if (!value) return null;
    const accuracy = finiteOptionalNumber(value.accuracy);
    const acpl = finiteOptionalNumber(value.acpl);
    const inaccuracies = finiteOptionalNumber(value.inaccuracy);
    const mistakes = finiteOptionalNumber(value.mistake);
    const blunders = finiteOptionalNumber(value.blunder);
    if (
        accuracy === null &&
        acpl === null &&
        inaccuracies === null &&
        mistakes === null &&
        blunders === null
    ) {
        return null;
    }
    return {
        provider: "lichess",
        accuracy,
        acpl,
        inaccuracies,
        mistakes,
        blunders,
    };
}

function finiteOptionalNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getLichessTermination(status: string | undefined): StatsTermination {
    if (status === "mate") return "checkmate";
    if (status === "resign") return "resign";
    if (status === "outoftime" || status === "timeout") return "timeout";
    if (status === "draw" || status === "stalemate") return "draw";
    if (status === "aborted") return "abandon";
    return "other";
}

function getLichessTimeClass(
    speed: string | undefined,
    requestedTimeClass: StatsTimeClass,
): StatsTimeClass {
    if (speed === "ultraBullet" || speed === "bullet") return "bullet";
    if (speed === "blitz") return "blitz";
    if (speed === "rapid") return "rapid";
    if (speed === "classical") return "classical";
    if (speed === "correspondence") return "daily";
    return requestedTimeClass;
}
