import { parseComment, parsePgn, type ChildNode, type PgnNodeData } from "chessops/pgn";
import { INITIAL_FEN } from "chessops/fen";
import { positionFromFen } from "@/utils/chessops";
import type { WebEngineLine } from "./model";
import { analyzeWithWebStockfish18 } from "./stockfishEngine";
import type { StatsGame } from "./statsRating";
import {
    buildGameQualityStats,
    replayGamePositions,
    type AnalyzedGameEntry,
    type EvalScore,
} from "./statsStrength";

const STATS_ANALYSIS_STORAGE_KEY = "en-croissant-web-stats-analysis";
const STATS_ANALYSIS_STORE_LIMIT = 400;
const DEFAULT_ANALYSIS_DEPTH = 12;
const DEFAULT_BATCH_MAX_GAMES = 30;
const ENGINE_PREFETCH_COUNT = 3;

// Conventional engine eval of the starting position, White POV.
const START_POSITION_EVAL: EvalScore = { cp: 15 };

export function extractPgnMoves(pgn: string): { sans: string[]; clocks: (number | null)[] } {
    const sans: string[] = [];
    const clocks: (number | null)[] = [];
    for (const node of mainlineNodes(pgn)) {
        sans.push(node.data.san);
        const clock = findLastCommentValue(
            node.data.comments,
            (comment) => parseComment(comment).clock,
        );
        clocks.push(typeof clock === "number" && Number.isFinite(clock) ? clock : null);
    }
    return { sans, clocks };
}

// [%eval] comments -> per-position evals, White POV (the lichess PGN convention).
// evals[i] is the eval of the position AFTER i plies, so the array is one longer
// than the move list; index 0 is the start position, fixed at { cp: 15 }. Moves
// without an eval comment (typically the final mating move) yield null entries.
// Returns null when the PGN carries no eval comments at all.
export function extractPgnEvals(pgn: string): (EvalScore | null)[] | null {
    let found = false;
    const perMove = mainlineNodes(pgn).map((node) => {
        const evaluation = findLastCommentValue(
            node.data.comments,
            (comment) => parseComment(comment).evaluation,
        );
        if (!evaluation) return null;
        if ("mate" in evaluation) {
            if (!Number.isFinite(evaluation.mate)) return null;
            found = true;
            return { mate: evaluation.mate };
        }
        if (!Number.isFinite(evaluation.pawns)) return null;
        found = true;
        return { cp: Math.round(evaluation.pawns * 100) };
    });
    if (!found) return null;
    return [START_POSITION_EVAL, ...perMove];
}

export function gameAnalysisKey(game: StatsGame): string {
    return `${game.source}|${game.id}`;
}

export function loadAnalyzedEntries(): AnalyzedGameEntry[] {
    const raw = readAnalysisStorage();
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isAnalyzedGameEntry);
    } catch {
        return [];
    }
}

export function saveAnalyzedEntries(entries: AnalyzedGameEntry[]): void {
    const byKey = new Map<string, AnalyzedGameEntry>();
    for (const entry of entries) {
        if (!isAnalyzedGameEntry(entry)) continue;
        const existing = byKey.get(entry.key);
        if (!existing || entry.ts >= existing.ts) byKey.set(entry.key, entry);
    }

    const kept = Array.from(byKey.values())
        .sort((a, b) => b.end - a.end)
        .slice(0, STATS_ANALYSIS_STORE_LIMIT);

    try {
        localStorage.setItem(STATS_ANALYSIS_STORAGE_KEY, JSON.stringify(kept));
    } catch {
        // Storage may be full or unavailable; analysis results are recomputable.
    }
}

// Analyzes one game into an AnalyzedGameEntry. PGNs that already carry [%eval]
// comments (lichess server analysis) are scored directly with analysisDepth
// null; otherwise every reached position is evaluated through the existing
// engine stack (stored cloud evals first, then the Gaming PC / local Stockfish
// via analyzeWithWebStockfish18), which reports scores already normalized to
// White POV. Returns null when the game cannot be analyzed (no pgn, illegal
// replay, or the engine is unreachable); rethrows on abort.
export async function analyzeStatsGame(
    game: StatsGame,
    opts?: {
        depth?: number;
        signal?: AbortSignal;
        onPositionProgress?: (done: number, total: number) => void;
    },
): Promise<AnalyzedGameEntry | null> {
    throwIfAborted(opts?.signal);
    if (!game.pgn) return null;

    const { sans, clocks } = extractPgnMoves(game.pgn);
    if (sans.length === 0) return null;

    let evals = extractPgnEvals(game.pgn);
    let bestMoves: (string | null)[] | undefined;
    let analysisDepth: number | null = null;

    if (!evals) {
        const engineEvals = await evaluatePositionsWithEngine(sans, opts);
        if (!engineEvals) return null;
        evals = engineEvals.evals;
        bestMoves = engineEvals.bestMoves;
        analysisDepth = engineEvals.analysisDepth;
    }

    const quality = await buildGameQualityStats({
        sans,
        evals,
        bestMoves,
        color: game.color,
        timeControl: game.timeControl,
        clocks,
        analysisDepth,
        result: game.result,
    });
    if (!quality) return null;
    const opponentQuality = await buildGameQualityStats({
        sans,
        evals,
        bestMoves,
        color: game.color === "w" ? "b" : "w",
        timeControl: game.timeControl,
        clocks,
        analysisDepth,
        result: game.result === "win" ? "loss" : game.result === "loss" ? "win" : "draw",
    });

    return {
        v: 2,
        ts: Date.now(),
        key: gameAnalysisKey(game),
        end: game.end,
        source: game.source,
        url: game.url,
        timeControl: game.timeControl,
        color: game.color,
        opponent: game.oppName,
        opp: game.opp,
        result: game.result,
        plies: quality.plies,
        eco: game.eco,
        openingName: game.openingName,
        stats: quality.stats,
        phases: quality.phases,
        counts: quality.counts,
        phaseBlunders: quality.phaseBlunders,
        advanced: quality.advanced,
        ...(opponentQuality
            ? {
                  opponentQuality: {
                      stats: opponentQuality.stats,
                      phases: opponentQuality.phases,
                      counts: opponentQuality.counts,
                      phaseBlunders: opponentQuality.phaseBlunders,
                      advanced: opponentQuality.advanced,
                  },
              }
            : {}),
    };
}

// Analyzes the newest games first, skipping keys already in the local store and
// persisting after every finished game so partial batches survive. Returns the
// entries for every requested game, pre-existing ones included; an abort stops
// the batch and returns what was collected so far.
export async function runStatsBatchAnalysis(
    games: StatsGame[],
    opts: {
        maxGames?: number;
        depth?: number;
        signal?: AbortSignal;
        onProgress?: (info: {
            gamesDone: number;
            gamesTotal: number;
            currentGame: StatsGame | null;
            positionsDone: number;
            positionsTotal: number;
        }) => void;
    },
): Promise<AnalyzedGameEntry[]> {
    const maxGames = Math.max(0, Math.round(opts.maxGames ?? DEFAULT_BATCH_MAX_GAMES));
    const candidates = games
        .slice()
        .sort((a, b) => b.end - a.end)
        .slice(0, maxGames);

    let stored = loadAnalyzedEntries();
    const byKey = new Map(stored.map((entry) => [entry.key, entry]));
    const results: AnalyzedGameEntry[] = [];
    const gamesTotal = candidates.length;
    let gamesDone = 0;

    for (const game of candidates) {
        if (opts.signal?.aborted) break;

        const key = gameAnalysisKey(game);
        const existing = byKey.get(key);
        if (existing?.advanced && existing.opponentQuality?.advanced) {
            results.push(existing);
            gamesDone += 1;
            opts.onProgress?.({
                gamesDone,
                gamesTotal,
                currentGame: null,
                positionsDone: 0,
                positionsTotal: 0,
            });
            continue;
        }

        let entry: AnalyzedGameEntry | null = null;
        try {
            entry = await analyzeStatsGame(game, {
                depth: opts.depth,
                signal: opts.signal,
                onPositionProgress: (positionsDone, positionsTotal) => {
                    opts.onProgress?.({
                        gamesDone,
                        gamesTotal,
                        currentGame: game,
                        positionsDone,
                        positionsTotal,
                    });
                },
            });
        } catch (error) {
            if (isAbortError(error)) break;
            throw error;
        }

        if (entry) {
            byKey.set(key, entry);
            stored = [entry, ...stored.filter((candidate) => candidate.key !== key)];
            saveAnalyzedEntries(stored);
            results.push(entry);
        }
        gamesDone += 1;
        opts.onProgress?.({
            gamesDone,
            gamesTotal,
            currentGame: null,
            positionsDone: 0,
            positionsTotal: 0,
        });
    }

    return results;
}

async function evaluatePositionsWithEngine(
    sans: string[],
    opts?: {
        depth?: number;
        signal?: AbortSignal;
        onPositionProgress?: (done: number, total: number) => void;
    },
): Promise<{
    evals: (EvalScore | null)[];
    bestMoves: (string | null)[];
    analysisDepth: number;
} | null> {
    const replay = replayGamePositions(sans);
    if (!replay) return null;

    const fens =
        replay.fens.length === sans.length + 1 ? replay.fens : [INITIAL_FEN, ...replay.fens];
    if (fens.length !== sans.length + 1) return null;

    const depth = Math.max(1, Math.round(opts?.depth ?? DEFAULT_ANALYSIS_DEPTH));
    const evals: (EvalScore | null)[] = new Array<EvalScore | null>(fens.length).fill(null);
    const bestMoves: (string | null)[] = new Array<string | null>(fens.length).fill(null);
    // The start position is scored with the conventional { cp: 15 } (mirroring the
    // PGN-eval path) instead of spending an engine call on it.
    evals[0] = START_POSITION_EVAL;
    let minDepth: number | null = null;

    const positionsTotal = sans.length;
    let positionsDone = 0;
    opts?.onPositionProgress?.(positionsDone, positionsTotal);

    for (let index = 1; index < fens.length; index += 1) {
        throwIfAborted(opts?.signal);

        // The final position can be terminal (mate/stalemate); the engine returns no
        // lines there, so score it directly instead.
        if (index === fens.length - 1) {
            const terminal = terminalPositionEval(fens[index]);
            if (terminal) {
                evals[index] = terminal;
                positionsDone += 1;
                opts?.onPositionProgress?.(positionsDone, positionsTotal);
                continue;
            }
        }

        let lines: WebEngineLine[];
        try {
            lines = await analyzeWithWebStockfish18({
                fen: fens[index],
                multipv: 1,
                depth,
                signal: opts?.signal,
                prefetchFens: fens.slice(index + 1, index + 1 + ENGINE_PREFETCH_COUNT),
            });
        } catch (error) {
            if (isAbortError(error)) throw error;
            return null;
        }

        const line = lines[0];
        if (!line) return null;
        // analyzeWithWebStockfish18 lines are already normalized to White POV (UCI
        // side-to-move scores are flipped in parseStockfishInfoLine; lichess-style
        // cloud evals are White POV natively).
        evals[index] =
            line.score.type === "mate" ? { mate: line.score.value } : { cp: line.score.value };
        bestMoves[index] = line.uciMoves[0] ?? null;
        minDepth = minDepth === null ? line.depth : Math.min(minDepth, line.depth);

        positionsDone += 1;
        opts?.onPositionProgress?.(positionsDone, positionsTotal);
    }

    return { evals, bestMoves, analysisDepth: minDepth ?? depth };
}

function terminalPositionEval(fen: string): EvalScore | null {
    const [position] = positionFromFen(fen);
    if (!position) return null;
    if (position.isCheckmate()) {
        // Mated side to move; the mate distance is spent, only the sign matters to
        // the win% mapping downstream.
        return { mate: position.turn === "white" ? -1 : 1 };
    }
    if (position.isEnd()) return { cp: 0 };
    return null;
}

function mainlineNodes(pgn: string): ChildNode<PgnNodeData>[] {
    let parsed;
    try {
        parsed = parsePgn(pgn)[0];
    } catch {
        return [];
    }
    if (!parsed) return [];

    // Following only the first child at every node walks the mainline; siblings
    // are variations and stay skipped.
    const nodes: ChildNode<PgnNodeData>[] = [];
    let node: ChildNode<PgnNodeData> | undefined = parsed.moves.children[0];
    while (node) {
        nodes.push(node);
        node = node.children[0];
    }
    return nodes;
}

function findLastCommentValue<T>(
    comments: readonly string[] | undefined,
    readValue: (comment: string) => T | undefined,
): T | undefined {
    for (let index = (comments?.length ?? 0) - 1; index >= 0; index -= 1) {
        const value = readValue(comments?.[index] ?? "");
        if (value !== undefined) return value;
    }
    return undefined;
}

function readAnalysisStorage(): string | null {
    try {
        return localStorage.getItem(STATS_ANALYSIS_STORAGE_KEY);
    } catch {
        return null;
    }
}

function isAnalyzedGameEntry(value: unknown): value is AnalyzedGameEntry {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Record<string, unknown>;
    return (
        entry.v === 2 &&
        isFiniteNumber(entry.ts) &&
        typeof entry.key === "string" &&
        entry.key.length > 0 &&
        isFiniteNumber(entry.end) &&
        typeof entry.source === "string" &&
        isStringOrNull(entry.url) &&
        isTimeControlOrNull(entry.timeControl) &&
        (entry.color === "w" || entry.color === "b") &&
        isStringOrNull(entry.opponent) &&
        isFiniteNumberOrNull(entry.opp) &&
        (entry.result === "win" || entry.result === "draw" || entry.result === "loss") &&
        isFiniteNumber(entry.plies) &&
        isStringOrNull(entry.eco) &&
        isStringOrNull(entry.openingName) &&
        isGameQualityStats(entry.stats) &&
        isPhaseStatsRecord(entry.phases) &&
        isMoveLabelCounts(entry.counts) &&
        isPhaseBlunders(entry.phaseBlunders) &&
        (!("advanced" in entry) || isAdvancedGameQualityStats(entry.advanced)) &&
        (!("opponentQuality" in entry) || isAnalyzedSideQuality(entry.opponentQuality))
    );
}

function isGameQualityStats(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const stats = value as Record<string, unknown>;
    return (
        isFiniteNumberOrNull(stats.accuracy) &&
        isFiniteNumberOrNull(stats.acpl) &&
        isFiniteNumber(stats.scoredCount) &&
        isFiniteNumberOrNull(stats.complexity) &&
        isFiniteNumberOrNull(stats.bookMoves) &&
        isFiniteNumberOrNull(stats.blunderRate) &&
        isFiniteNumberOrNull(stats.fastRate) &&
        isFiniteNumberOrNull(stats.scramble) &&
        isFiniteNumberOrNull(stats.analysisDepth)
    );
}

function isPhaseStatsRecord(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    return Object.entries(value as Record<string, unknown>).every(([phase, stats]) => {
        if (phase !== "opening" && phase !== "middlegame" && phase !== "endgame") return false;
        if (typeof stats !== "object" || stats === null) return false;
        const phaseStats = stats as Record<string, unknown>;
        return (
            isFiniteNumberOrNull(phaseStats.accuracy) &&
            isFiniteNumberOrNull(phaseStats.acpl) &&
            isFiniteNumber(phaseStats.scoredCount) &&
            isFiniteNumberOrNull(phaseStats.complexity)
        );
    });
}

function isMoveLabelCounts(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const counts = value as Record<string, unknown>;
    return (
        isFiniteNumber(counts.inaccuracy) &&
        isFiniteNumber(counts.mistake) &&
        isFiniteNumber(counts.blunder)
    );
}

function isPhaseBlunders(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        isFiniteNumber(record.opening) &&
        isFiniteNumber(record.middlegame) &&
        isFiniteNumber(record.endgame)
    );
}

function isAdvancedGameQualityStats(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        isDecisionBucketStats(record.advantage) &&
        isDecisionBucketStats(record.defence) &&
        isDecisionBucketStats(record.balanced) &&
        isDecisionBucketStats(record.critical) &&
        isDecisionBucketStats(record.fast) &&
        isDecisionBucketStats(record.longThink) &&
        isDecisionBucketStats(record.timeTrouble) &&
        typeof record.hadWinningPosition === "boolean" &&
        (record.convertedWinningPosition === null ||
            typeof record.convertedWinningPosition === "boolean") &&
        typeof record.hadLosingPosition === "boolean" &&
        (record.savedLosingPosition === null || typeof record.savedLosingPosition === "boolean") &&
        isFiniteNumberOrNull(record.openingExitWinPct) &&
        isFiniteNumberOrNull(record.move15EvalCp) &&
        isFiniteNumberOrNull(record.endgameEntryEvalCp)
    );
}

function isAnalyzedSideQuality(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        isGameQualityStats(record.stats) &&
        isPhaseStatsRecord(record.phases) &&
        isMoveLabelCounts(record.counts) &&
        isPhaseBlunders(record.phaseBlunders) &&
        isAdvancedGameQualityStats(record.advanced)
    );
}

function isDecisionBucketStats(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const bucket = value as Record<string, unknown>;
    return (
        isFiniteNumber(bucket.moves) &&
        isFiniteNumber(bucket.errors) &&
        isFiniteNumberOrNull(bucket.accuracy)
    );
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberOrNull(value: unknown): boolean {
    return value === null || isFiniteNumber(value);
}

function isStringOrNull(value: unknown): boolean {
    return value === null || typeof value === "string";
}

function isTimeControlOrNull(value: unknown): boolean {
    if (value === null) return true;
    if (typeof value !== "object") return false;
    const timeControl = value as Record<string, unknown>;
    return isFiniteNumber(timeControl.base) && isFiniteNumber(timeControl.inc);
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DOMException("Stats analysis was cancelled.", "AbortError");
    }
}

function isAbortError(error: unknown) {
    return (
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError")
    );
}
