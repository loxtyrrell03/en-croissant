import { INITIAL_FEN } from "chessops/fen";
import {
    getPrepMoveStrengthMap,
    normalizePrepBuilderSettings,
    type PrepBuilderSettings,
    type PrepBuilderEngineMove,
    type PrepMoveStrength,
} from "@/utils/opponentPrep";
import type { Opening } from "@/utils/db";
import type {
    WebColor,
    WebGame,
    WebLocalGameFilters,
    WebPrepLineMove,
    WebPrepWorkspace,
    WebResult,
} from "./model";
import type { WebHostedPositionMove } from "./hostedDatabaseIndex";
import {
    getFenColor,
    getResultScore,
    getWebGameIndexedMoves,
    normalizeWebFen,
    oppositeWebColor,
} from "./pgn";

export type WebPrepMoveStat = Opening & {
    key: string;
    uci: string | null;
    total: number;
    share: number;
    scoreForUser: number;
    sourceLabel: string;
    examples: WebGame[];
    strength: PrepMoveStrength | null;
};

export type WebPrepBranchStatus = "new" | "started" | "prepared" | "skipped";

export type WebPrepBranchCoverageStats = {
    score: number;
    label: "No line" | "Thin" | "Needs work" | "Solid" | "Good";
    depthPly: number;
    opponentPositions: number;
    commonReplies: number;
    preparedReplies: number;
    startedReplies: number;
    replyCoverage: number;
    missingImportantMoves: string[];
};

export type WebPrepBranchMove = {
    ply: number;
    move: WebPrepLineMove;
    key: string;
};

export type WebPrepBranchStart = {
    branchPly: number;
    activeBranch: WebPrepBranchMove | null;
};

export type WebDatabasePerspective = {
    playerName: string;
    color: WebColor;
};

export type WebDatabaseMoveFilters = WebLocalGameFilters & {
    perspective?: WebDatabasePerspective | null;
};

export type WebDatabasePositionGame = {
    game: WebGame;
    ply: number;
    nextMove: string | null;
};

export type WebDatabaseStatsSort =
    | "games"
    | "gamesLow"
    | "strengthHigh"
    | "strengthLow"
    | "engineHigh"
    | "engineLow"
    | "wdlHigh"
    | "wdlLow"
    | "recent"
    | "oldest"
    | "scoreHigh"
    | "scoreLow"
    | "move"
    | "moveDesc";

export type WebPrepMoveStatsPrep = Pick<
    WebPrepWorkspace,
    "mode" | "opponent" | "userColor" | "sourceIds" | "builder" | "startDate" | "endDate" | "result"
> | null;

export function collectGamesForSources(
    gamesByDatabase: Record<string, WebGame[]>,
    sourceIds: string[],
) {
    const selected = sourceIds.length > 0 ? sourceIds : Object.keys(gamesByDatabase);
    return selected.flatMap((id) => gamesByDatabase[id] ?? []);
}

export function getGamesForWebPrepSource({
    gamesByDatabase,
    prep,
}: {
    gamesByDatabase: Record<string, WebGame[]>;
    prep: Pick<WebPrepWorkspace, "source" | "sourceIds" | "temporarySource"> | null;
}) {
    if (!prep) return [];
    if (prep.source === "temporary") return prep.temporarySource?.games ?? [];
    if (prep.source === "local" || !prep.source) {
        return prep.sourceIds.length > 0
            ? collectGamesForSources(gamesByDatabase, prep.sourceIds)
            : [];
    }
    return [];
}

export function getFirstOpenPrepStat<T extends { key: string }>(
    stats: T[],
    preparedMoves: Record<string, number>,
) {
    return stats.find((stat) => !preparedMoves[stat.key]) ?? stats[0] ?? null;
}

export function getNextOpenPrepStat<T extends { key: string }>(
    stats: T[],
    preparedMoves: Record<string, number>,
    currentKey: string | null,
) {
    if (stats.length === 0) return null;
    const startIndex = currentKey ? stats.findIndex((stat) => stat.key === currentKey) : -1;
    const ordered =
        startIndex >= 0 ? [...stats.slice(startIndex + 1), ...stats.slice(0, startIndex)] : stats;
    return ordered.find((stat) => !preparedMoves[stat.key]) ?? null;
}

export function getWebPrepMoveKey(fen: string, move: string) {
    return `${normalizeWebFen(fen)}:${move}`;
}

export function getWebPrepStrengthSideForFen(fen: string, userColor: WebColor): WebColor {
    const opponentColor = oppositeWebColor(userColor);
    return getFenColor(fen || INITIAL_FEN) === opponentColor ? opponentColor : userColor;
}

export function findWebPrepBranchStart({
    line,
    rootPly,
    rootFen,
    userColor,
    currentPly = rootPly,
}: {
    line: WebPrepLineMove[];
    rootPly: number;
    rootFen: string;
    userColor: WebColor;
    currentPly?: number;
}): WebPrepBranchStart | null {
    const safeRootPly = Math.max(0, Math.min(rootPly, line.length));
    const safeCurrentPly = Math.max(0, Math.min(currentPly, line.length));
    if (safeCurrentPly < safeRootPly) return null;

    const opponentColor = oppositeWebColor(userColor);

    if (getFenColor(rootFen) === opponentColor) {
        return {
            branchPly: safeRootPly,
            activeBranch: null,
        };
    }

    const activeBranch = findLastWebPrepOpponentBranch(line, safeCurrentPly, userColor);
    if (!activeBranch) {
        const currentFen =
            safeCurrentPly > 0 ? (line[safeCurrentPly - 1]?.fenAfter ?? rootFen) : rootFen;
        if (getFenColor(currentFen) === opponentColor) {
            return {
                branchPly: safeCurrentPly,
                activeBranch: null,
            };
        }
        return null;
    }

    return {
        branchPly: activeBranch.ply,
        activeBranch,
    };
}

export function findFirstWebPrepOpponentBranch(
    line: WebPrepLineMove[],
    fromPly: number,
    userColor: WebColor,
): WebPrepBranchMove | null {
    const opponentColor = oppositeWebColor(userColor);
    const start = Math.max(0, Math.min(fromPly, line.length));
    for (let index = start; index < line.length; index += 1) {
        const move = line[index];
        if (getFenColor(move.fenBefore) !== opponentColor) continue;
        return {
            ply: index,
            move,
            key: getWebPrepMoveKey(move.fenBefore, move.san),
        };
    }
    return null;
}

function findLastWebPrepOpponentBranch(
    line: WebPrepLineMove[],
    toPly: number,
    userColor: WebColor,
): WebPrepBranchMove | null {
    const opponentColor = oppositeWebColor(userColor);
    const end = Math.max(0, Math.min(toPly, line.length));
    for (let index = end - 1; index >= 0; index -= 1) {
        const move = line[index];
        if (getFenColor(move.fenBefore) !== opponentColor) continue;
        return {
            ply: index,
            move,
            key: getWebPrepMoveKey(move.fenBefore, move.san),
        };
    }
    return null;
}

export function getWebPrepMoveStats({
    games,
    prep,
    fen,
    engineMoves,
    maxExamples = 4,
}: {
    games: WebGame[];
    prep: WebPrepMoveStatsPrep;
    fen: string;
    engineMoves?: PrepBuilderEngineMove[];
    maxExamples?: number;
}): WebPrepMoveStat[] {
    const key = normalizeWebFen(fen || INITIAL_FEN);
    const userColor = prep?.userColor ?? getFenColor(fen || INITIAL_FEN);
    const opponentColor = oppositeWebColor(userColor);
    const strengthSide = getWebPrepStrengthSideForFen(fen || INITIAL_FEN, userColor);
    const prepMode = prep?.mode ?? "player";
    const opponent = prep?.opponent.trim().toLowerCase() ?? "";
    const bucket = new Map<string, MoveBucket>();
    let totalOccurrences = 0;

    for (const game of games) {
        if (!gameMatchesLocalFilters(game, prep)) continue;
        if (prepMode === "player" && !gameMatchesOpponent(game, opponent, opponentColor)) continue;

        for (const move of getWebGameIndexedMoves(game)) {
            if (normalizeWebFen(move.fenBefore) !== key) continue;

            const entry = bucket.get(move.san) ?? createMoveBucket(move.san);
            entry.uci ??= move.uci;
            entry.total += 1;
            entry.white += scoreResultCount(game.result, "white");
            entry.draw += scoreDrawCount(game.result);
            entry.black += scoreResultCount(game.result, "black");
            entry.scoreForUser += getResultScore(game.result, userColor);
            entry.lastPlayed = pickLatest(entry.lastPlayed, game.date);
            if (entry.examples.length < maxExamples) {
                entry.examples.push(game);
            }
            bucket.set(move.san, entry);
            totalOccurrences += 1;
        }
    }

    const openings: Opening[] = Array.from(bucket.values()).map((entry) => ({
        move: entry.move,
        white: entry.white,
        draw: entry.draw,
        black: entry.black,
        lastPlayed: entry.lastPlayed,
    }));
    const strengthMap = getPrepMoveStrengthMap({
        openings,
        engineMoves,
        side: strengthSide,
        settings: getWebPrepStrengthSettings(prep?.builder),
    });

    return Array.from(bucket.values())
        .map<WebPrepMoveStat>((entry) => ({
            move: entry.move,
            white: entry.white,
            draw: entry.draw,
            black: entry.black,
            lastPlayed: entry.lastPlayed,
            key: `${key}:${entry.move}`,
            uci: entry.uci,
            total: entry.total,
            share: totalOccurrences > 0 ? entry.total / totalOccurrences : 0,
            scoreForUser: entry.total > 0 ? entry.scoreForUser / entry.total : 0.5,
            sourceLabel: getFenColor(fen) === opponentColor ? "opponent move" : "reply faced",
            examples: entry.examples,
            strength: strengthMap.get(normalizeSan(entry.move)) ?? null,
        }))
        .sort(
            (a, b) =>
                b.total - a.total ||
                b.scoreForUser - a.scoreForUser ||
                a.move.localeCompare(b.move, undefined, { sensitivity: "base" }),
        );
}

export function getWebPrepBranchCoverageStats({
    line,
    branchPly,
    row,
    games,
    prep,
    minGames,
    moveLimit,
    preparedMoves = {},
    skippedMoves = {},
    startedMoveKeys = new Set<string>(),
    maxPly = 8,
    maxOpponentPositions = 24,
}: {
    line: WebPrepLineMove[];
    branchPly: number;
    row: Pick<WebPrepMoveStat, "key">;
    games: WebGame[];
    prep: WebPrepMoveStatsPrep;
    minGames: number;
    moveLimit: number;
    preparedMoves?: Record<string, number>;
    skippedMoves?: Record<string, number>;
    startedMoveKeys?: Set<string>;
    maxPly?: number;
    maxOpponentPositions?: number;
}): WebPrepBranchCoverageStats {
    const safeBranchPly = Math.max(0, Math.min(Math.round(branchPly || 0), line.length));
    const rowStatus = getWebPrepStatStatus(row.key, preparedMoves, skippedMoves, startedMoveKeys);
    const branchMove = line[safeBranchPly] ?? null;
    const hasMatchingBranch =
        branchMove && getWebPrepMoveKey(branchMove.fenBefore, branchMove.san) === row.key;
    const hasUserResponse = hasMatchingBranch && line[safeBranchPly + 1]?.actor === "user";
    const branchResponseScore = hasUserResponse ? 1 : rowStatus === "started" ? 0.25 : 0;

    if (!hasMatchingBranch || !hasUserResponse) {
        return createWebPrepBranchCoverageStats({
            branchResponseScore,
            depthPly: 0,
            opponentPositions: 0,
            commonReplies: 0,
            preparedReplies: 0,
            startedReplies: 0,
            replyCoverage: 0,
            missingImportantMoves: [],
        });
    }

    const userColor = prep?.userColor ?? getFenColor(branchMove.fenBefore);
    const opponentColor = oppositeWebColor(userColor);
    const maxPositionPly = Math.min(line.length, safeBranchPly + Math.max(1, maxPly));
    let coverageWeight = 0;
    let weightedCoverage = 0;
    let commonReplies = 0;
    let preparedReplies = 0;
    let startedReplies = 0;
    let opponentPositions = 0;
    const missingImportantMoves: string[] = [];

    for (let ply = safeBranchPly + 1; ply <= maxPositionPly; ply += 1) {
        const fen = line[ply - 1]?.fenAfter ?? "";
        if (!fen || getFenColor(fen) !== opponentColor) continue;
        if (opponentPositions >= maxOpponentPositions) break;

        const rows = getWebPrepMoveStats({ games, prep, fen })
            .filter((stat) => stat.total >= minGames)
            .slice(0, moveLimit);
        const total = rows.reduce((sum, stat) => sum + stat.total, 0);
        if (rows.length === 0 || total <= 0) continue;

        const replyCoverage =
            rows.reduce(
                (sum, stat) =>
                    sum +
                    stat.total *
                        getWebPrepReplyCredit(
                            getWebPrepStatStatus(
                                stat.key,
                                preparedMoves,
                                skippedMoves,
                                startedMoveKeys,
                            ),
                        ),
                0,
            ) / total;
        const depthWeight = 1 / (1 + Math.max(0, ply - safeBranchPly - 1) * 0.2);
        coverageWeight += depthWeight;
        weightedCoverage += replyCoverage * depthWeight;
        commonReplies += rows.length;
        preparedReplies += rows.filter(
            (stat) =>
                getWebPrepStatStatus(stat.key, preparedMoves, skippedMoves, startedMoveKeys) ===
                "prepared",
        ).length;
        startedReplies += rows.filter(
            (stat) =>
                getWebPrepStatStatus(stat.key, preparedMoves, skippedMoves, startedMoveKeys) ===
                "started",
        ).length;
        for (const stat of rows) {
            if (stat.total / total < 0.2) continue;
            const status = getWebPrepStatStatus(
                stat.key,
                preparedMoves,
                skippedMoves,
                startedMoveKeys,
            );
            if (status === "prepared") continue;
            if (!missingImportantMoves.includes(stat.move)) missingImportantMoves.push(stat.move);
        }
        opponentPositions += 1;
    }

    return createWebPrepBranchCoverageStats({
        branchResponseScore,
        depthPly: Math.min(maxPly, Math.max(0, line.length - safeBranchPly)),
        opponentPositions,
        commonReplies,
        preparedReplies,
        startedReplies,
        replyCoverage: coverageWeight > 0 ? weightedCoverage / coverageWeight : 0,
        missingImportantMoves,
    });
}

export function getWebDatabaseMoveStats({
    games,
    fen,
    perspective = null,
    filters,
    strengthSettings,
    engineMoves,
    maxExamples = 4,
}: {
    games: WebGame[];
    fen: string;
    perspective?: WebDatabasePerspective | null;
    filters?: WebLocalGameFilters | null;
    strengthSettings?: Partial<PrepBuilderSettings> | null;
    engineMoves?: PrepBuilderEngineMove[];
    maxExamples?: number;
}): WebPrepMoveStat[] {
    const key = normalizeWebFen(fen || INITIAL_FEN);
    const resultPerspective = perspective?.color ?? getFenColor(fen || INITIAL_FEN);
    const playerName = perspective?.playerName.trim() ?? "";
    const bucket = new Map<string, MoveBucket>();
    let totalOccurrences = 0;

    for (const game of games) {
        if (!gameMatchesLocalFilters(game, filters)) continue;
        if (playerName && !gameMatchesPlayerColor(game, playerName, resultPerspective)) continue;

        for (const move of getWebGameIndexedMoves(game)) {
            if (normalizeWebFen(move.fenBefore) !== key) continue;

            const entry = bucket.get(move.san) ?? createMoveBucket(move.san);
            entry.uci ??= move.uci;
            entry.total += 1;
            entry.white += scoreResultCount(game.result, "white");
            entry.draw += scoreDrawCount(game.result);
            entry.black += scoreResultCount(game.result, "black");
            entry.scoreForUser += getResultScore(game.result, resultPerspective);
            entry.lastPlayed = pickLatest(entry.lastPlayed, game.date);
            if (entry.examples.length < maxExamples) {
                entry.examples.push(game);
            }
            bucket.set(move.san, entry);
            totalOccurrences += 1;
        }
    }

    const sourceLabel = playerName ? `${playerName} as ${resultPerspective}` : "database move";
    const openings: Opening[] = Array.from(bucket.values()).map((entry) => ({
        move: entry.move,
        white: entry.white,
        draw: entry.draw,
        black: entry.black,
        lastPlayed: entry.lastPlayed,
    }));
    const strengthMap = getPrepMoveStrengthMap({
        openings,
        engineMoves,
        side: resultPerspective,
        settings: getWebPrepStrengthSettings(strengthSettings),
    });

    return Array.from(bucket.values())
        .map<WebPrepMoveStat>((entry) => ({
            move: entry.move,
            white: entry.white,
            draw: entry.draw,
            black: entry.black,
            lastPlayed: entry.lastPlayed,
            key: `${key}:${entry.move}`,
            uci: entry.uci,
            total: entry.total,
            share: totalOccurrences > 0 ? entry.total / totalOccurrences : 0,
            scoreForUser: entry.total > 0 ? entry.scoreForUser / entry.total : 0.5,
            sourceLabel,
            examples: entry.examples,
            strength: strengthMap.get(normalizeSan(entry.move)) ?? null,
        }))
        .sort(
            (a, b) =>
                b.total - a.total ||
                b.scoreForUser - a.scoreForUser ||
                a.move.localeCompare(b.move, undefined, { sensitivity: "base" }),
        );
}

export function getWebHostedPositionMoveStats({
    moves,
    fen,
    side,
    sourceLabel = "database move",
    strengthSide = side,
    strengthSettings,
    engineMoves,
}: {
    moves: WebHostedPositionMove[];
    fen: string;
    side: WebColor;
    sourceLabel?: string;
    strengthSide?: WebColor;
    strengthSettings?: Partial<PrepBuilderSettings> | null;
    engineMoves?: PrepBuilderEngineMove[];
}): WebPrepMoveStat[] {
    const key = normalizeWebFen(fen || INITIAL_FEN);
    const totalOccurrences = moves.reduce((sum, move) => sum + getHostedPositionMoveTotal(move), 0);
    const openings: Opening[] = moves.map((move) => ({
        move: move.move,
        white: move.white,
        draw: move.draw,
        black: move.black,
        lastPlayed: move.lastPlayed ?? null,
    }));
    const strengthMap = getPrepMoveStrengthMap({
        openings,
        engineMoves,
        side: strengthSide,
        settings: getWebPrepStrengthSettings(strengthSettings),
    });

    return moves
        .map<WebPrepMoveStat>((move) => {
            const total = getHostedPositionMoveTotal(move);
            return {
                move: move.move,
                white: move.white,
                draw: move.draw,
                black: move.black,
                lastPlayed: move.lastPlayed ?? null,
                key: getWebPrepMoveKey(key, move.move),
                uci: move.uci ?? null,
                total,
                share: totalOccurrences > 0 ? total / totalOccurrences : 0,
                scoreForUser: total > 0 ? getHostedPositionMoveScore(move, side) : 0.5,
                sourceLabel,
                examples: [],
                strength: strengthMap.get(normalizeSan(move.move)) ?? null,
            };
        })
        .sort(compareWebDatabaseStatsDefault);
}

export function getWebDatabaseGamesForPosition({
    games,
    fen,
    perspective = null,
    filters,
    limit = 80,
}: {
    games: WebGame[];
    fen: string;
    perspective?: WebDatabasePerspective | null;
    filters?: WebLocalGameFilters | null;
    limit?: number;
}): WebDatabasePositionGame[] {
    const key = normalizeWebFen(fen || INITIAL_FEN);
    const resultPerspective = perspective?.color ?? getFenColor(fen || INITIAL_FEN);
    const playerName = perspective?.playerName.trim() ?? "";
    const matches: WebDatabasePositionGame[] = [];

    for (const game of games) {
        if (!gameMatchesLocalFilters(game, filters)) continue;
        if (playerName && !gameMatchesPlayerColor(game, playerName, resultPerspective)) continue;

        const matchingMove = getWebGameIndexedMoves(game).find(
            (move) => normalizeWebFen(move.fenBefore) === key,
        );
        if (matchingMove) {
            matches.push({
                game,
                ply: matchingMove.ply - 1,
                nextMove: matchingMove.san,
            });
            continue;
        }

        if (key === normalizeWebFen(INITIAL_FEN) && game.moves.length === 0) {
            matches.push({
                game,
                ply: 0,
                nextMove: null,
            });
        }
    }

    return matches
        .sort(
            (a, b) =>
                sortableDate(b.game.date) - sortableDate(a.game.date) ||
                b.game.importedAt - a.game.importedAt ||
                a.game.index - b.game.index,
        )
        .slice(0, Math.max(1, Math.round(limit || 80)));
}

export function sortWebDatabaseMoveStats(stats: WebPrepMoveStat[], sort: WebDatabaseStatsSort) {
    return [...stats].sort((a, b) => {
        switch (sort) {
            case "gamesLow":
                return a.total - b.total || compareWebDatabaseStatsDefault(a, b);
            case "strengthHigh":
                return (
                    getWebDatabaseStrengthSortScore(b) - getWebDatabaseStrengthSortScore(a) ||
                    compareWebDatabaseStatsDefault(a, b)
                );
            case "strengthLow":
                return (
                    getWebDatabaseStrengthSortScore(a) - getWebDatabaseStrengthSortScore(b) ||
                    compareWebDatabaseStatsDefault(a, b)
                );
            case "engineHigh":
                return (
                    getWebDatabaseEngineSortScore(b) - getWebDatabaseEngineSortScore(a) ||
                    compareWebDatabaseStatsDefault(a, b)
                );
            case "engineLow":
                return (
                    getWebDatabaseEngineSortScore(a) - getWebDatabaseEngineSortScore(b) ||
                    compareWebDatabaseStatsDefault(a, b)
                );
            case "wdlHigh":
                return (
                    getWebDatabaseWdlSortScore(b) - getWebDatabaseWdlSortScore(a) ||
                    compareWebDatabaseStatsDefault(a, b)
                );
            case "wdlLow":
                return (
                    getWebDatabaseWdlSortScore(a) - getWebDatabaseWdlSortScore(b) ||
                    compareWebDatabaseStatsDefault(a, b)
                );
            case "recent":
                return (
                    sortableDate(b.lastPlayed ?? "") - sortableDate(a.lastPlayed ?? "") ||
                    compareWebDatabaseStatsDefault(a, b)
                );
            case "oldest":
                return (
                    sortableDate(a.lastPlayed ?? "") - sortableDate(b.lastPlayed ?? "") ||
                    compareWebDatabaseStatsDefault(a, b)
                );
            case "scoreHigh":
                return b.scoreForUser - a.scoreForUser || compareWebDatabaseStatsDefault(a, b);
            case "scoreLow":
                return a.scoreForUser - b.scoreForUser || compareWebDatabaseStatsDefault(a, b);
            case "move":
                return a.move.localeCompare(b.move, undefined, { sensitivity: "base" });
            case "moveDesc":
                return b.move.localeCompare(a.move, undefined, { sensitivity: "base" });
            case "games":
            default:
                return compareWebDatabaseStatsDefault(a, b);
        }
    });
}

export function filterWebGamesByLocalFilters(
    games: WebGame[],
    filters?: WebLocalGameFilters | null,
) {
    return games.filter((game) => gameMatchesLocalFilters(game, filters));
}

function getWebPrepStrengthSettings(settings?: Partial<PrepBuilderSettings> | null) {
    return normalizePrepBuilderSettings({
        ...settings,
        mode: settings?.mode ?? "practical",
        useCloudEngine: true,
        useLichessAll: false,
    });
}

function getWebDatabaseStrengthSortScore(stat: WebPrepMoveStat) {
    return stat.strength?.score ?? Number.NEGATIVE_INFINITY;
}

function getWebDatabaseEngineSortScore(stat: WebPrepMoveStat) {
    if (!stat.strength || stat.strength.engineCpLoss === null) return Number.NEGATIVE_INFINITY;
    return -stat.strength.engineCpLoss;
}

function getWebDatabaseWdlSortScore(stat: WebPrepMoveStat) {
    return stat.strength?.databaseScore ?? Number.NEGATIVE_INFINITY;
}

function getHostedPositionMoveTotal(move: WebHostedPositionMove) {
    return move.white + move.draw + move.black;
}

function getHostedPositionMoveScore(move: WebHostedPositionMove, side: WebColor) {
    const total = getHostedPositionMoveTotal(move);
    if (total <= 0) return 0.5;
    const score = side === "white" ? move.white + move.draw * 0.5 : move.black + move.draw * 0.5;
    return score / total;
}

export function getKnownPlayers(gamesByDatabase: Record<string, WebGame[]>) {
    const players = new Map<string, number>();
    for (const games of Object.values(gamesByDatabase)) {
        for (const game of games) {
            countPlayer(players, game.white);
            countPlayer(players, game.black);
        }
    }
    return Array.from(players.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
        .map(([player]) => player);
}

export function getDatabasePlayerCounts(games: WebGame[]) {
    const players = new Map<string, { name: string; games: number; score: number }>();
    for (const game of games) {
        addPlayerResult(players, game.white, "white", game.result);
        addPlayerResult(players, game.black, "black", game.result);
    }
    return Array.from(players.values()).sort(
        (a, b) =>
            b.games - a.games || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

export function getWebDatabaseTitlePlayerName(
    databaseLabel: string | null | undefined,
    playerName: string,
) {
    const label = databaseLabel?.trim();
    if (!label || !playerName.trim()) return null;

    const candidate = getWebDatabaseLabelPlayerCandidate(label);
    if (!candidate || normalizedPlayerName(candidate) !== normalizedPlayerName(playerName)) {
        return null;
    }

    return candidate;
}

type MoveBucket = {
    move: string;
    uci: string | null;
    total: number;
    white: number;
    draw: number;
    black: number;
    scoreForUser: number;
    lastPlayed: string | null;
    examples: WebGame[];
};

function createMoveBucket(move: string): MoveBucket {
    return {
        move,
        uci: null,
        total: 0,
        white: 0,
        draw: 0,
        black: 0,
        scoreForUser: 0,
        lastPlayed: null,
        examples: [],
    };
}

function gameMatchesOpponent(game: WebGame, opponent: string, opponentColor: WebColor) {
    if (!opponent) return true;
    const player = opponentColor === "white" ? game.white : game.black;
    return player.toLowerCase() === opponent || player.toLowerCase().includes(opponent);
}

function gameMatchesPlayerColor(game: WebGame, playerName: string, color: WebColor) {
    const player = color === "white" ? game.white : game.black;
    return normalizedPlayerName(player).includes(normalizedPlayerName(playerName));
}

function gameMatchesLocalFilters(game: WebGame, filters?: WebLocalGameFilters | null) {
    if (!filters) return true;

    const result = filters.result ?? "any";
    if (result !== "any") {
        if (result === "whitewon" && game.result !== "1-0") return false;
        if (result === "blackwon" && game.result !== "0-1") return false;
        if (result === "draw" && game.result !== "1/2-1/2") return false;
    }

    const gameDate = sortableDate(game.date);
    const startDate = sortableDate(filters.startDate ?? "");
    const endDate = sortableDate(filters.endDate ?? "");
    if (startDate && (!gameDate || gameDate < startDate)) return false;
    if (endDate && (!gameDate || gameDate > endDate)) return false;

    return true;
}

function normalizedPlayerName(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function getWebDatabaseLabelPlayerCandidate(databaseLabel: string) {
    let candidate = databaseLabel
        .replace(/\.db3$/i, "")
        .replace(/\.pgn$/i, "")
        .trim();
    const suffixes = [
        "_lichess",
        " lichess",
        "_chesscom",
        " chesscom",
        "_chess.com",
        " chess.com",
        " recent",
        " games",
    ];

    let changed = true;
    while (changed) {
        changed = false;
        for (const suffix of suffixes) {
            const next = candidate.replace(new RegExp(`${escapeRegExp(suffix)}$`, "i"), "").trim();
            if (next !== candidate) {
                candidate = next;
                changed = true;
            }
        }
    }

    return candidate || null;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreResultCount(result: WebResult, side: WebColor) {
    if (result === "*") return 0;
    if (result === "1-0" && side === "white") return 1;
    if (result === "0-1" && side === "black") return 1;
    return 0;
}

function scoreDrawCount(result: WebResult) {
    return result === "1/2-1/2" || result === "*" ? 1 : 0;
}

function addPlayerResult(
    players: Map<string, { name: string; games: number; score: number }>,
    name: string,
    side: WebColor,
    result: WebResult,
) {
    if (!name || name === "?") return;
    const current = players.get(name) ?? { name, games: 0, score: 0 };
    current.games += 1;
    current.score += getResultScore(result, side);
    players.set(name, current);
}

function countPlayer(players: Map<string, number>, name: string) {
    if (!name || name === "?") return;
    players.set(name, (players.get(name) ?? 0) + 1);
}

function compareWebDatabaseStatsDefault(a: WebPrepMoveStat, b: WebPrepMoveStat) {
    return (
        b.total - a.total ||
        b.scoreForUser - a.scoreForUser ||
        a.move.localeCompare(b.move, undefined, { sensitivity: "base" })
    );
}

function pickLatest(current: string | null, candidate: string) {
    const candidateKey = sortableDate(candidate);
    if (!candidateKey) return current;
    const currentKey = sortableDate(current ?? "");
    return !currentKey || candidateKey > currentKey ? candidate : current;
}

function createWebPrepBranchCoverageStats({
    branchResponseScore,
    depthPly,
    opponentPositions,
    commonReplies,
    preparedReplies,
    startedReplies,
    replyCoverage,
    missingImportantMoves,
}: {
    branchResponseScore: number;
    depthPly: number;
    opponentPositions: number;
    commonReplies: number;
    preparedReplies: number;
    startedReplies: number;
    replyCoverage: number;
    missingImportantMoves: string[];
}): WebPrepBranchCoverageStats {
    const depthScore = Math.min(1, depthPly / 8);
    const breadthScore = Math.min(1, opponentPositions / 3);
    const score = Math.round(
        100 *
            (0.2 * branchResponseScore +
                0.45 * replyCoverage +
                0.3 * depthScore +
                0.05 * breadthScore),
    );

    return {
        score,
        label: getWebPrepBranchCoverageLabel(score, depthPly),
        depthPly,
        opponentPositions,
        commonReplies,
        preparedReplies,
        startedReplies,
        replyCoverage,
        missingImportantMoves: missingImportantMoves.slice(0, 3),
    };
}

function getWebPrepBranchCoverageLabel(
    score: number,
    depthPly: number,
): WebPrepBranchCoverageStats["label"] {
    if (depthPly === 0) return "No line";
    if (score >= 80) return "Good";
    if (score >= 60) return "Solid";
    if (score >= 35) return "Needs work";
    return "Thin";
}

function getWebPrepStatStatus(
    key: string,
    preparedMoves: Record<string, number>,
    skippedMoves: Record<string, number>,
    startedMoveKeys: Set<string>,
): WebPrepBranchStatus {
    if (preparedMoves[key]) return "prepared";
    if (skippedMoves[key]) return "skipped";
    if (startedMoveKeys.has(key)) return "started";
    return "new";
}

function getWebPrepReplyCredit(status: WebPrepBranchStatus) {
    if (status === "prepared") return 1;
    if (status === "started") return 0.35;
    return 0;
}

function sortableDate(value: string) {
    const digits = value.replace(/\D/g, "");
    return digits.length > 0 ? Number(digits.padEnd(8, "0")) : 0;
}

function normalizeSan(value: string) {
    return value
        .trim()
        .replace(/^0-0-0/, "O-O-O")
        .replace(/^0-0/, "O-O")
        .replace(/[+#?!]+$/g, "");
}
