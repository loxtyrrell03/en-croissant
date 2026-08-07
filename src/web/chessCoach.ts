import type {
    WebCoachReviewRecord,
    WebColor,
    WebCompanionState,
    WebEngineLine,
    WebGame,
    WebMove,
    WebPrepLineMove,
} from "./model";
import { getFenColor } from "./pgn";
import { getWebServerUrl } from "./serverUrl";
import { getDefaultAiCoachScope } from "@/utils/aiCoachParity";
import {
    getCoachModelDefinition,
    type CoachModelId,
    type CoachProvider,
    type CoachReasoningEffort,
} from "@/utils/coachModels";

export type WebCoachOpeningLineMove = {
    moveIndex: number;
    ply: number;
    san: string;
    uci: string;
    fenBefore: string;
    fenAfter: string;
    sourcePdfPage: number;
    sourcePrintedPage: number | null;
    sourceChunkId: string | null;
    confidence: number;
};

export type WebCoachOpeningLine = {
    lineId: string;
    lineKind: string;
    pgn: string;
    citation: string;
    matchedGamePly: number;
    matchedBookMoveIndex: number;
    matchedBookPly: number;
    playedSan: string;
    playedUci: string;
    bookMoveSan: string;
    bookMoveUci: string;
    playedMoveMatched: boolean;
    sharedPlies: number;
    moves: WebCoachOpeningLineMove[];
};

export type WebCoachBookPassage = {
    chunkId: string;
    bookId: string;
    title: string;
    author: string;
    shelf: string;
    chapterTitle: string;
    citation: string;
    pdfPageStart: number;
    pdfPageEnd: number;
    printedPageStart: number | null;
    printedPageEnd: number | null;
    excerpt: string;
    sourceUrl: string;
    openingLines: WebCoachOpeningLine[];
};

export type WebCoachCriticalMoment = {
    ply: number;
    san: string;
    color: WebColor;
    beforeCp: number;
    afterCp: number;
    lossCp: number;
    depth: number | null;
    bestLineUci: string[];
    replyLineUci: string[];
};

export type WebCoachPosition = {
    ply: number;
    san: string;
    title: string;
    explanation: string;
    engineEvidence: string;
    betterPlan?: string;
};

export type WebCoachBookReference = {
    chunkId: string;
    whyItMatters: string;
    positionPly: number | null;
};

export type WebCoachCategory = {
    id: string;
    label: string;
    summary: string;
    explanation: string;
    positions: WebCoachPosition[];
    bookReferences: WebCoachBookReference[];
};

export type WebCoachAnalysisCoverage = {
    totalPositions: number;
    uniquePositions: number;
    cloudHits: number;
    liveAnalyses: number;
    failed: number;
};

export type WebChessCoachHealth = {
    ok: boolean;
    corpusAvailable: boolean;
    modelInstalled: boolean;
    modelAvailable: boolean;
    modelStatus?: "authenticated" | "signed-out" | "unavailable" | "unknown";
    modelAvailability?: "available" | "unavailable" | "usage-limited";
    modelMessage?: string;
    model: string;
    bookCount: number;
    chunkCount: number;
    providers?: Partial<Record<CoachProvider, WebCoachProviderHealth>>;
};

export type WebCoachProviderHealth = {
    installed: boolean;
    available: boolean;
    status: "authenticated" | "signed-out" | "unavailable" | "unknown";
    availability: "available" | "unavailable" | "usage-limited";
    message?: string;
};

export type WebChessCoachProgress = {
    requestId: string;
    phase:
        | "queued"
        | "cloud-evaluations"
        | "live-evaluations"
        | "library-planning"
        | "passage-retrieval"
        | "answer-writing"
        | "complete"
        | "error";
    label: string;
    completed: number;
    total: number;
};

export type WebChessCoachResponse = {
    answer?: string;
    overview: string;
    categories: WebCoachCategory[];
    model: string;
    reasoningEffort: string;
    playerColor: WebColor;
    criticalMoments: WebCoachCriticalMoment[];
    bookPassages: WebCoachBookPassage[];
    storedEvaluationsUsed: number;
    analysisCoverage: WebCoachAnalysisCoverage;
};

export type RestoredWebCoachReview = Omit<WebCoachReviewRecord, "response"> & {
    response: WebChessCoachResponse;
};

export type SavedWebCoachReviewStatus = {
    review: WebCoachReviewRecord | null;
    pending: boolean;
    requestId: string | null;
    progress: WebChessCoachProgress | null;
};

export async function getWebChessCoachHealth(signal?: AbortSignal) {
    const response = await fetch(getWebServerUrl("api/chess-coach/health"), {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
    });
    const payload = (await response.json().catch(() => null)) as WebChessCoachHealth | null;
    if (!response.ok || !payload) throw new Error("The PC chess coach is unreachable.");
    return payload;
}

export async function getWebChessCoachProgress(requestId: string, signal?: AbortSignal) {
    const response = await fetch(
        getWebServerUrl(`api/chess-coach/progress?requestId=${encodeURIComponent(requestId)}`),
        {
            cache: "no-store",
            headers: { accept: "application/json" },
            signal,
        },
    );
    const payload: unknown = await response.json().catch(() => null);
    const progress = normalizeWebChessCoachProgress(payload);
    if (!response.ok || !progress) throw new Error("Coach progress is not available yet.");
    return progress;
}

export async function loadSavedWebCoachReview(
    storageKey: string,
    signal?: AbortSignal,
): Promise<WebCoachReviewRecord | null> {
    return (await getSavedWebCoachReviewStatus(storageKey, signal)).review;
}

export async function getSavedWebCoachReviewStatus(
    storageKey: string,
    signal?: AbortSignal,
): Promise<SavedWebCoachReviewStatus> {
    const response = await fetch(getWebServerUrl("api/chess-coach/review"), {
        method: "POST",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ action: "read", storageKey }),
        signal,
    });
    if (response.status === 404) {
        return { review: null, pending: false, requestId: null, progress: null };
    }
    const payload = (await response.json().catch(() => null)) as {
        review?: unknown;
        pending?: unknown;
        requestId?: unknown;
        progress?: unknown;
    } | null;
    if (!response.ok) throw new Error("The saved coach review could not be loaded from the PC.");
    return {
        review: (payload?.review ?? null) as WebCoachReviewRecord | null,
        pending: payload?.pending === true,
        requestId: typeof payload?.requestId === "string" ? payload.requestId : null,
        progress: normalizeWebChessCoachProgress(payload?.progress) ?? null,
    };
}

export async function saveWebCoachReview(
    review: WebCoachReviewRecord,
    storageKey: string,
    signal?: AbortSignal,
): Promise<void> {
    const response = await fetch(getWebServerUrl("api/chess-coach/review"), {
        method: "POST",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
            action: "write",
            storageKey,
            review,
        }),
        signal,
    });
    if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "The PC could not save the coach review.");
    }
}

export async function askWebChessCoach({
    question,
    pgn,
    playerColor,
    scope,
    currentFen,
    moves,
    currentLines,
    model,
    reasoningEffort,
    requestId,
    persistence,
    signal,
}: {
    question: string;
    pgn: string;
    playerColor: WebColor;
    scope: "position" | "whole-game";
    currentFen: string;
    moves: ReturnType<typeof getWebCoachMoves>;
    currentLines: WebEngineLine[];
    model: CoachModelId;
    reasoningEffort: CoachReasoningEffort;
    requestId: string;
    persistence: {
        storageKey: string;
        contextKey: string;
        lineContextKey: string;
    };
    signal?: AbortSignal;
}) {
    const response = await fetch(getWebServerUrl("api/chess-coach"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            question,
            requestId,
            pgn,
            playerColor,
            scope,
            currentFen,
            moves,
            model,
            reasoningEffort,
            persistence,
            currentLines: currentLines.map((line) => ({
                depth: line.depth,
                score: line.score,
                eval: formatCoachEngineScore(line),
                sanMoves: line.sanMoves,
                uciMoves: line.uciMoves,
            })),
        }),
        signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const error = asRecord(payload)?.error;
        throw new Error(typeof error === "string" && error ? error : "The PC coach failed.");
    }
    const normalized = normalizeWebChessCoachResponse(payload);
    if (!normalized) throw new Error("The PC coach returned an unreadable review.");
    return normalized;
}

export function getWebCoachMoves(sourceMoves: WebMove[] | null, line: WebPrepLineMove[]) {
    if (sourceMoves?.length) {
        return sourceMoves.map((move) => ({
            ply: move.ply,
            color: move.color,
            san: move.san,
            uci: move.uci,
            fenBefore: move.fenBefore,
            fenAfter: move.fenAfter,
            annotations: move.annotations ?? [],
        }));
    }
    return line.map((move, index) => ({
        ply: index + 1,
        color: getFenColor(move.fenBefore),
        san: move.san,
        uci: move.uci,
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter,
        annotations: move.annotations ?? [],
    }));
}

export function getWebCoachLineContextKey(
    sourceGame:
        | (Pick<WebGame, "id"> &
              Partial<
                  Pick<WebGame, "index" | "event" | "site" | "date" | "white" | "black" | "result">
              >)
        | null,
    line: WebPrepLineMove[],
    currentFen: string,
    fallbackSourceIdentity: string | null = null,
) {
    const rootFen = line[0]?.fenBefore || currentFen;
    return JSON.stringify([
        "web-coach-line-v2",
        getStableWebCoachSourceIdentity(sourceGame, fallbackSourceIdentity),
        normalizeCoachContextFen(rootFen),
        ...line.map((move, index) => [
            index + 1,
            move.uci ?? "",
            move.san,
            normalizeCoachContextFen(move.fenBefore),
            normalizeCoachContextFen(move.fenAfter),
            ...(move.annotations ?? []),
        ]),
    ]);
}

export function getWebCoachContextKey(
    lineContextKey: string,
    scope: "position" | "whole-game",
    playerColor: WebColor,
    currentFen: string,
) {
    return JSON.stringify([
        "web-coach-review-v1",
        lineContextKey,
        scope,
        playerColor,
        scope === "position" ? normalizeCoachContextFen(currentFen) : "whole-game",
    ]);
}

export function getWebCoachStorageKey(lineContextKey: string) {
    try {
        const parsed = JSON.parse(lineContextKey) as unknown;
        if (!Array.isArray(parsed) || parsed[0] !== "web-coach-line-v2") return lineContextKey;
        const identity = parsed[1];
        if (
            Array.isArray(identity) &&
            ["analysis-board", "analysis-line", "board-source", "source-game-id"].includes(
                String(identity[0] || ""),
            )
        ) {
            return JSON.stringify([parsed[0], ["line-content"], ...parsed.slice(2)]);
        }
        return lineContextKey;
    } catch {
        return lineContextKey;
    }
}

export function rebaseWebCoachReviewLineContext(
    review: WebCoachReviewRecord,
    lineContextKey: string,
): WebCoachReviewRecord {
    try {
        const parsed = JSON.parse(review.contextKey) as unknown;
        if (
            Array.isArray(parsed) &&
            parsed[0] === "web-coach-review-v1" &&
            parsed[2] === review.scope &&
            parsed[3] === review.playerColor
        ) {
            return {
                ...review,
                lineContextKey,
                contextKey: JSON.stringify([parsed[0], lineContextKey, ...parsed.slice(2)]),
            };
        }
    } catch {
        // Invalid persisted context is rejected by restoreWebCoachReview below.
    }
    return review;
}

export function createWebCoachReviewRecord({
    contextKey,
    lineContextKey,
    scope,
    playerColor,
    question,
    response,
    savedAt = Date.now(),
}: {
    contextKey: string;
    lineContextKey: string;
    scope: "position" | "whole-game";
    playerColor: WebColor;
    question: string;
    response: WebChessCoachResponse;
    savedAt?: number;
}): WebCoachReviewRecord {
    return {
        version: 1,
        contextKey,
        lineContextKey,
        scope,
        playerColor,
        question: question.trim(),
        response,
        savedAt,
    };
}

export function restoreWebCoachReview(
    value: unknown,
    {
        lineContextKey,
        currentFen,
    }: {
        lineContextKey: string;
        currentFen: string;
    },
): RestoredWebCoachReview | null {
    const review = asRecord(value);
    if (!review || review.version !== 1) return null;

    const storedLineContextKey = cleanString(review.lineContextKey);
    const storedContextKey = cleanString(review.contextKey);
    const scope =
        review.scope === "position"
            ? "position"
            : review.scope === "whole-game"
              ? "whole-game"
              : null;
    const playerColor =
        review.playerColor === "white" ? "white" : review.playerColor === "black" ? "black" : null;
    const question = cleanString(review.question);
    const savedAt = finiteNumber(review.savedAt);
    if (
        !scope ||
        !playerColor ||
        !question ||
        savedAt <= 0 ||
        storedLineContextKey !== lineContextKey ||
        storedContextKey !==
            getWebCoachContextKey(storedLineContextKey, scope, playerColor, currentFen)
    ) {
        return null;
    }

    const response = normalizeWebChessCoachResponse(review.response);
    if (!response) return null;
    return {
        version: 1,
        contextKey: storedContextKey,
        lineContextKey: storedLineContextKey,
        scope,
        playerColor,
        question,
        response,
        savedAt,
    };
}

export function persistWebCoachReviewInState(
    state: WebCompanionState,
    {
        sourceDatabaseId,
        sourceGameId,
    }: {
        sourceDatabaseId: string | null;
        sourceGameId: string | null;
    },
    review: WebCoachReviewRecord,
): WebCompanionState {
    if (sourceDatabaseId && sourceGameId) {
        const games = state.gamesByDatabase[sourceDatabaseId];
        if (games?.some((game) => game.id === sourceGameId)) {
            return {
                ...state,
                gamesByDatabase: {
                    ...state.gamesByDatabase,
                    [sourceDatabaseId]: games.map((game) =>
                        game.id === sourceGameId ? { ...game, coachReview: review } : game,
                    ),
                },
            };
        }
    }

    return {
        ...state,
        board: {
            ...state.board,
            coachReview: review,
        },
    };
}

export function getDefaultWebCoachScope(
    sourceGame: Pick<WebGame, "id"> | null,
    line: WebPrepLineMove[],
): "position" | "whole-game" {
    return getDefaultAiCoachScope(Boolean(sourceGame), line.length);
}

export function webCoachLineMatchesSourceGame(
    sourceGame: Pick<WebGame, "moves"> | null,
    line: WebPrepLineMove[],
) {
    if (!sourceGame || sourceGame.moves.length !== line.length) return false;
    return sourceGame.moves.every((move, index) => {
        const lineMove = line[index];
        return (
            Boolean(lineMove) &&
            (move.uci ?? "") === (lineMove.uci ?? "") &&
            move.san === lineMove.san &&
            normalizeCoachContextFen(move.fenBefore) ===
                normalizeCoachContextFen(lineMove.fenBefore) &&
            normalizeCoachContextFen(move.fenAfter) === normalizeCoachContextFen(lineMove.fenAfter)
        );
    });
}

export function makeWebCoachMovetext(line: Pick<WebPrepLineMove, "san">[]) {
    if (line.length === 0) return "*";
    return line
        .map((move, index) => {
            const moveNumber = Math.floor(index / 2) + 1;
            return index % 2 === 0 ? `${moveNumber}. ${move.san}` : move.san;
        })
        .join(" ");
}

export function getWebCoachBookPdfUrl(passage: WebCoachBookPassage) {
    return `${getWebServerUrl(passage.sourceUrl)}#page=${Math.max(1, passage.pdfPageStart)}`;
}

export function getWebCoachBookHeading(
    passage: Pick<WebCoachBookPassage, "title" | "chapterTitle">,
) {
    return passage.chapterTitle ? `${passage.title} — ${passage.chapterTitle}` : passage.title;
}

export function normalizeWebChessCoachResponse(payload: unknown): WebChessCoachResponse | null {
    const record = asRecord(payload);
    if (!record) return null;

    const answer = cleanString(record.answer);
    const overview = cleanString(record.overview) || answer;
    const bookPassages = normalizeBookPassages(record.bookPassages);
    const knownChunkIds = new Set(bookPassages.map((passage) => passage.chunkId));
    const categories = normalizeCategories(record.categories, knownChunkIds);
    if (!overview && categories.length === 0) return null;
    const model = cleanString(record.model) || "gpt-5.6-sol";
    const modelDefinition = getCoachModelDefinition(model);

    return {
        ...(answer ? { answer } : {}),
        overview,
        categories,
        model,
        reasoningEffort:
            cleanString(record.reasoningEffort) || modelDefinition.defaultReasoningEffort,
        playerColor: record.playerColor === "black" ? "black" : "white",
        criticalMoments: normalizeCriticalMoments(record.criticalMoments),
        bookPassages,
        storedEvaluationsUsed: nonNegativeInteger(record.storedEvaluationsUsed),
        analysisCoverage: normalizeAnalysisCoverage(record.analysisCoverage),
    };
}

function normalizeWebChessCoachProgress(payload: unknown): WebChessCoachProgress | null {
    const progress = asRecord(payload);
    if (!progress) return null;
    const requestId = cleanString(progress.requestId);
    const phase = cleanString(progress.phase);
    const validPhases: WebChessCoachProgress["phase"][] = [
        "queued",
        "cloud-evaluations",
        "live-evaluations",
        "library-planning",
        "passage-retrieval",
        "answer-writing",
        "complete",
        "error",
    ];
    if (!requestId || !validPhases.includes(phase as WebChessCoachProgress["phase"])) return null;
    return {
        requestId,
        phase: phase as WebChessCoachProgress["phase"],
        label: cleanString(progress.label),
        completed: nonNegativeInteger(progress.completed),
        total: nonNegativeInteger(progress.total),
    };
}

function normalizeCategories(value: unknown, knownChunkIds: Set<string>) {
    if (!Array.isArray(value)) return [];
    const usedIds = new Set<string>();
    return value.slice(0, 6).flatMap((item, index): WebCoachCategory[] => {
        const category = asRecord(item);
        if (!category) return [];
        const label = cleanString(category.label);
        const explanation = cleanString(category.explanation);
        const summary = cleanString(category.summary);
        if (!label || (!explanation && !summary)) return [];
        const id = uniqueCategoryId(
            cleanString(category.id) || label || `topic-${index + 1}`,
            usedIds,
        );
        const seenReferences = new Set<string>();
        const bookReferences = Array.isArray(category.bookReferences)
            ? category.bookReferences.flatMap((item): WebCoachBookReference[] => {
                  const reference = asRecord(item);
                  if (!reference) return [];
                  const chunkId = cleanString(reference.chunkId);
                  if (!knownChunkIds.has(chunkId) || seenReferences.has(chunkId)) return [];
                  seenReferences.add(chunkId);
                  const positionPly = positiveIntegerOrNull(reference.positionPly);
                  return [
                      {
                          chunkId,
                          whyItMatters: cleanString(reference.whyItMatters),
                          positionPly,
                      },
                  ];
              })
            : [];

        const positions = Array.isArray(category.positions)
            ? category.positions.flatMap((item): WebCoachPosition[] => {
                  const position = asRecord(item);
                  if (!position) return [];
                  const ply = positiveIntegerOrNull(position.ply);
                  const positionExplanation = cleanString(position.explanation);
                  if (ply === null || !positionExplanation) return [];
                  const betterPlan = cleanString(position.betterPlan);
                  return [
                      {
                          ply,
                          san: cleanString(position.san),
                          title: cleanString(position.title) || `Move ${Math.ceil(ply / 2)}`,
                          explanation: positionExplanation,
                          engineEvidence: cleanString(position.engineEvidence),
                          ...(betterPlan ? { betterPlan } : {}),
                      },
                  ];
              })
            : [];

        return [
            {
                id,
                label,
                summary,
                explanation,
                positions,
                bookReferences,
            },
        ];
    });
}

function normalizeBookPassages(value: unknown) {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.flatMap((item): WebCoachBookPassage[] => {
        const passage = asRecord(item);
        if (!passage) return [];
        const chunkId = cleanString(passage.chunkId);
        const title = cleanString(passage.title);
        if (!chunkId || !title || seen.has(chunkId)) return [];
        seen.add(chunkId);
        return [
            {
                chunkId,
                bookId: cleanString(passage.bookId),
                title,
                author: cleanString(passage.author),
                shelf: cleanString(passage.shelf),
                chapterTitle: cleanString(passage.chapterTitle),
                citation: cleanString(passage.citation),
                pdfPageStart: Math.max(1, nonNegativeInteger(passage.pdfPageStart)),
                pdfPageEnd: Math.max(1, nonNegativeInteger(passage.pdfPageEnd)),
                printedPageStart: positiveIntegerOrNull(passage.printedPageStart),
                printedPageEnd: positiveIntegerOrNull(passage.printedPageEnd),
                excerpt: cleanString(passage.excerpt),
                sourceUrl: cleanString(passage.sourceUrl),
                openingLines: normalizeOpeningLines(passage.openingLines),
            },
        ];
    });
}

function normalizeOpeningLines(value: unknown): WebCoachOpeningLine[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.slice(0, 3).flatMap((item): WebCoachOpeningLine[] => {
        const line = asRecord(item);
        if (!line) return [];
        const lineId = cleanString(line.lineId);
        if (!lineId || seen.has(lineId)) return [];
        const moves = Array.isArray(line.moves)
            ? line.moves.slice(0, 160).flatMap((item): WebCoachOpeningLineMove[] => {
                  const move = asRecord(item);
                  if (!move) return [];
                  const uci = cleanString(move.uci).toLowerCase();
                  const fenBefore = cleanString(move.fenBefore);
                  const fenAfter = cleanString(move.fenAfter);
                  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) || !fenBefore || !fenAfter) {
                      return [];
                  }
                  return [
                      {
                          moveIndex: nonNegativeInteger(move.moveIndex),
                          ply: nonNegativeInteger(move.ply),
                          san: cleanString(move.san),
                          uci,
                          fenBefore,
                          fenAfter,
                          sourcePdfPage: positiveIntegerOrNull(move.sourcePdfPage) ?? 1,
                          sourcePrintedPage: positiveIntegerOrNull(move.sourcePrintedPage),
                          sourceChunkId: cleanString(move.sourceChunkId) || null,
                          confidence: finiteNumber(move.confidence),
                      },
                  ];
              })
            : [];
        if (moves.length === 0) return [];
        seen.add(lineId);
        return [
            {
                lineId,
                lineKind: cleanString(line.lineKind),
                pgn: cleanString(line.pgn),
                citation: cleanString(line.citation),
                matchedGamePly: nonNegativeInteger(line.matchedGamePly),
                matchedBookMoveIndex: nonNegativeInteger(line.matchedBookMoveIndex),
                matchedBookPly: nonNegativeInteger(line.matchedBookPly),
                playedSan: cleanString(line.playedSan),
                playedUci: cleanString(line.playedUci),
                bookMoveSan: cleanString(line.bookMoveSan),
                bookMoveUci: cleanString(line.bookMoveUci),
                playedMoveMatched: line.playedMoveMatched === true,
                sharedPlies: nonNegativeInteger(line.sharedPlies),
                moves,
            },
        ];
    });
}

function normalizeCriticalMoments(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): WebCoachCriticalMoment[] => {
        const moment = asRecord(item);
        if (!moment) return [];
        const ply = positiveIntegerOrNull(moment.ply);
        if (ply === null) return [];
        return [
            {
                ply,
                san: cleanString(moment.san),
                color: moment.color === "black" ? "black" : "white",
                beforeCp: finiteNumber(moment.beforeCp),
                afterCp: finiteNumber(moment.afterCp),
                lossCp: Math.max(0, finiteNumber(moment.lossCp)),
                depth: positiveIntegerOrNull(moment.depth),
                bestLineUci: stringArray(moment.bestLineUci),
                replyLineUci: stringArray(moment.replyLineUci),
            },
        ];
    });
}

function normalizeAnalysisCoverage(value: unknown): WebCoachAnalysisCoverage {
    const coverage = asRecord(value);
    return {
        totalPositions: nonNegativeInteger(coverage?.totalPositions),
        uniquePositions: nonNegativeInteger(coverage?.uniquePositions),
        cloudHits: nonNegativeInteger(coverage?.cloudHits),
        liveAnalyses: nonNegativeInteger(coverage?.liveAnalyses),
        failed: nonNegativeInteger(coverage?.failed),
    };
}

function uniqueCategoryId(value: string, usedIds: Set<string>) {
    const stem =
        value
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "topic";
    let id = stem;
    let suffix = 2;
    while (usedIds.has(id)) {
        id = `${stem}-${suffix}`;
        suffix += 1;
    }
    usedIds.add(id);
    return id;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function cleanString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function finiteNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonNegativeInteger(value: unknown) {
    return Math.max(0, Math.trunc(finiteNumber(value)));
}

function positiveIntegerOrNull(value: unknown) {
    const integer = Math.trunc(finiteNumber(value));
    return integer > 0 ? integer : null;
}

function normalizeCoachContextFen(fen: string) {
    return String(fen || "")
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(" ");
}

function getStableWebCoachSourceIdentity(
    sourceGame:
        | (Pick<WebGame, "id"> &
              Partial<
                  Pick<WebGame, "index" | "event" | "site" | "date" | "white" | "black" | "result">
              >)
        | null,
    fallbackSourceIdentity: string | null,
) {
    if (!sourceGame) {
        return fallbackSourceIdentity
            ? ["board-source", fallbackSourceIdentity]
            : ["analysis-board"];
    }
    const stableDetails = [
        Number.isInteger(sourceGame.index) ? sourceGame.index : null,
        cleanString(sourceGame.event),
        cleanString(sourceGame.site),
        cleanString(sourceGame.date),
        cleanString(sourceGame.white),
        cleanString(sourceGame.black),
        cleanString(sourceGame.result),
    ];
    return stableDetails.some((value) => value !== null && value !== "")
        ? ["source-game", ...stableDetails]
        : ["source-game-id", sourceGame.id];
}

function formatCoachEngineScore(line: WebEngineLine) {
    if (line.score.type === "mate") {
        return `${line.score.value >= 0 ? "+" : "-"}M${Math.abs(line.score.value)}`;
    }
    const pawns = line.score.value / 100;
    return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}
