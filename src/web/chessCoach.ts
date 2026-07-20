import type { WebColor, WebEngineLine, WebGame, WebMove, WebPrepLineMove } from "./model";
import { getFenColor } from "./pgn";
import { getWebServerUrl } from "./serverUrl";

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
    playerColor: WebColor;
    criticalMoments: WebCoachCriticalMoment[];
    bookPassages: WebCoachBookPassage[];
    storedEvaluationsUsed: number;
    analysisCoverage: WebCoachAnalysisCoverage;
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

export async function askWebChessCoach({
    question,
    pgn,
    playerColor,
    scope,
    currentFen,
    moves,
    currentLines,
    requestId,
    signal,
}: {
    question: string;
    pgn: string;
    playerColor: WebColor;
    scope: "position" | "whole-game";
    currentFen: string;
    moves: ReturnType<typeof getWebCoachMoves>;
    currentLines: WebEngineLine[];
    requestId: string;
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
    sourceGame: Pick<WebGame, "id"> | null,
    line: WebPrepLineMove[],
    currentFen: string,
) {
    const rootFen = line[0]?.fenBefore || currentFen;
    return JSON.stringify([
        sourceGame?.id ?? "analysis-board",
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

export function getDefaultWebCoachScope(
    sourceGame: Pick<WebGame, "id"> | null,
    line: WebPrepLineMove[],
): "position" | "whole-game" {
    return sourceGame || line.length > 4 ? "whole-game" : "position";
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

    return {
        ...(answer ? { answer } : {}),
        overview,
        categories,
        model: cleanString(record.model) || "gpt-5.6-sol",
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

function formatCoachEngineScore(line: WebEngineLine) {
    if (line.score.type === "mate") {
        return `${line.score.value >= 0 ? "+" : "-"}M${Math.abs(line.score.value)}`;
    }
    const pawns = line.score.value / 100;
    return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}
