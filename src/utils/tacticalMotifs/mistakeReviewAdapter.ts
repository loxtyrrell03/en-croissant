import {
    THEME_COLORS,
    THEME_DETECTOR_VERSION,
    THEME_LABELS,
    detectAllowedThemesDetailed,
    detectThemesDetailed,
} from "./siteClassifier/theme-detector.js";
import { ChessLite } from "./siteClassifier/analysis.js";
import type {
    MistakeReviewMotifClassification,
    PositionTacticalMotifClassification,
    TacticalMotifEvidence,
    TacticalMotifSource,
} from "./types";

export type {
    MistakeReviewMotifClassification,
    PositionTacticalMotifClassification,
    TacticalMotifConfidence,
    TacticalMotifEvidence,
    TacticalMotifSource,
} from "./types";

export type MistakeReviewMotifInput = {
    fen?: string | null;
    bestMoveSan?: string | null;
    bestMoveUci?: string | null;
    playedMoveSan?: string | null;
    playedMoveUci?: string | null;
    pvSan?: string[] | null;
    pvUci?: string[] | null;
    refutationSan?: string[] | null;
    refutationUci?: string[] | null;
    cpLoss?: number | null;
    cpBefore?: number | null;
    cpAfter?: number | null;
    winProbabilityDrop?: number | null;
    reachedDepth?: number | null;
};

export type PositionTacticalMotifInput = {
    fen?: string | null;
    pvUci?: string[] | null;
    previousFen?: string | null;
    previousMoveUci?: string | null;
};

type SiteThemeStep = {
    uci?: string | null;
};

type SiteThemeDetail = {
    themes?: unknown;
    steps?: SiteThemeStep[] | null;
    themeStepIndex?: number | null;
    themeStepIndexByTheme?: Record<string, number> | null;
    isMate?: boolean | null;
};

type SiteAllowedThemeOptions = {
    deltaCp: number | null;
    previousFen: string;
    playedMove: string;
    cpBefore: number | null;
    _sacrificeIntentCp: number | null;
};

const detectAllowedThemesDetailedWithOptions = detectAllowedThemesDetailed as unknown as (
    startFen: string,
    bestLine: string[],
    playerSide: "w" | "b",
    options: SiteAllowedThemeOptions,
) => SiteThemeDetail;

const TACTICAL_MOTIF_ADAPTER_VERSION = 1;
const MOTIF_CACHE_LIMIT = 2500;
const motifCache = new Map<string, MistakeReviewMotifClassification>();

export const MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION = `site-${Number(
    THEME_DETECTOR_VERSION,
)}.adapter-${TACTICAL_MOTIF_ADAPTER_VERSION}`;

const MATE_MOTIF_PATTERN = /(?:^mate(?:In\d+|Threat)?$|Mate$)/;

function cleanUci(value?: string | null) {
    const move = String(value ?? "")
        .trim()
        .toLowerCase();
    return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? move : null;
}

function cleanUciLine(values?: string[] | null) {
    return (Array.isArray(values) ? values : [])
        .map((value) => cleanUci(value))
        .filter((value): value is string => Boolean(value));
}

function normalizeLine(firstMove: string | null, lineInput?: string[] | null) {
    const line = cleanUciLine(lineInput);
    if (!firstMove) return line;
    return line[0] === firstMove ? line : [firstMove, ...line];
}

function fenSide(fen?: string | null) {
    const side = String(fen ?? "")
        .trim()
        .split(/\s+/)[1];
    return side === "b" ? "b" : "w";
}

function deriveFenAfterMove(fen?: string | null, moveInput?: string | null) {
    const move = cleanUci(moveInput);
    if (!fen || !move) return null;

    try {
        const chess = ChessLite();
        chess.loadFEN(fen);
        const played = chess.moveUci(move);
        return played?.ok ? chess.fen() : null;
    } catch {
        return null;
    }
}

function normalizeThemeIds(value: unknown) {
    const labels = THEME_LABELS as Record<string, string>;
    const seen = new Set<string>();
    const themes: string[] = [];

    for (const candidate of Array.isArray(value) ? value : []) {
        const id = String(candidate ?? "").trim();
        if (!id || seen.has(id) || !labels[id]) continue;
        seen.add(id);
        themes.push(id);
    }

    return themes;
}

function motifConfidence(detail: SiteThemeDetail, motifId: string, stepIndex: number) {
    if (detail.isMate && MATE_MOTIF_PATTERN.test(motifId)) return "high" as const;
    if (stepIndex >= 0 && detail.steps?.[stepIndex]?.uci) return "high" as const;
    if (Array.isArray(detail.steps) && detail.steps.length > 0) return "medium" as const;
    return "low" as const;
}

function toMotifEvidence(
    detailInput: SiteThemeDetail | null | undefined,
    source: TacticalMotifSource,
) {
    const detail = detailInput && typeof detailInput === "object" ? detailInput : {};
    const steps = Array.isArray(detail.steps) ? detail.steps : [];
    const themeStepIndexByTheme =
        detail.themeStepIndexByTheme && typeof detail.themeStepIndexByTheme === "object"
            ? detail.themeStepIndexByTheme
            : {};
    const fallbackIndex = Number.isInteger(detail.themeStepIndex)
        ? Number(detail.themeStepIndex)
        : -1;

    return normalizeThemeIds(detail.themes).map<TacticalMotifEvidence>((id) => {
        const mappedIndex = themeStepIndexByTheme[id];
        const stepIndex = Number.isInteger(mappedIndex) ? mappedIndex : fallbackIndex;
        const moveUci = stepIndex >= 0 ? cleanUci(steps[stepIndex]?.uci) : null;
        const label = tacticalMotifLabel(id);
        const lineLabel =
            source === "allowed"
                ? "opponent refutation"
                : source === "available"
                  ? "current best line"
                  : "missed best line";
        const evidence = moveUci
            ? `${label} appears on ${moveUci} at ply ${stepIndex + 1} of the ${lineLabel}.`
            : `${label} is detected in the verified ${lineLabel}.`;

        return {
            id,
            label,
            confidence: motifConfidence(detail, id, stepIndex),
            evidence,
            source,
            ply: stepIndex >= 0 ? stepIndex + 1 : null,
            moveUci,
        };
    });
}

export function classifyPositionTacticalMotifs(
    input: PositionTacticalMotifInput,
): PositionTacticalMotifClassification {
    const fen = String(input.fen ?? "").trim();
    const bestLine = cleanUciLine(input.pvUci);
    const bestMoveUci = bestLine[0] ?? null;
    let detail: SiteThemeDetail | null = null;

    if (fen && bestMoveUci) {
        try {
            detail = detectThemesDetailed({
                fen,
                side: fenSide(fen),
                best: bestMoveUci,
                bestLine,
                _prevFen: String(input.previousFen ?? "").trim() || null,
                _prevPlayedMove: cleanUci(input.previousMoveUci),
            }) as SiteThemeDetail;
        } catch {
            detail = null;
        }
    }

    return {
        motifs: toMotifEvidence(detail, "available"),
        motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    };
}

function cacheKey(input: MistakeReviewMotifInput) {
    return JSON.stringify([
        MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        input.fen ?? "",
        input.bestMoveUci ?? input.bestMoveSan ?? "",
        input.playedMoveUci ?? input.playedMoveSan ?? "",
        cleanUciLine(input.pvUci).join(" "),
        cleanUciLine(input.refutationUci).join(" "),
        input.cpLoss ?? null,
        input.cpBefore ?? null,
        input.cpAfter ?? null,
    ]);
}

export function classifyMistakeReviewMotifs(
    input: MistakeReviewMotifInput,
): MistakeReviewMotifClassification {
    const key = cacheKey(input);
    const cached = motifCache.get(key);
    if (cached) return cached;

    const fen = String(input.fen ?? "").trim();
    const bestMoveUci = cleanUci(input.bestMoveUci) ?? cleanUci(input.pvUci?.[0]);
    const playedMoveUci = cleanUci(input.playedMoveUci);
    const bestLine = normalizeLine(bestMoveUci, input.pvUci);
    const refutationLine = cleanUciLine(input.refutationUci);
    const fenAfterPlayedMove = deriveFenAfterMove(fen, playedMoveUci);

    let missedDetail: SiteThemeDetail | null = null;
    let allowedDetail: SiteThemeDetail | null = null;

    if (fen && bestMoveUci && bestLine.length) {
        try {
            missedDetail = detectThemesDetailed({
                fen,
                side: fenSide(fen),
                best: bestMoveUci,
                bestLine,
                deltaCp: typeof input.cpLoss === "number" ? input.cpLoss : null,
                cpBefore: typeof input.cpBefore === "number" ? input.cpBefore : null,
                cpAfter: typeof input.cpAfter === "number" ? input.cpAfter : null,
            }) as SiteThemeDetail;
        } catch {
            missedDetail = null;
        }
    }

    if (fenAfterPlayedMove && playedMoveUci && refutationLine.length) {
        try {
            allowedDetail = detectAllowedThemesDetailedWithOptions(
                fenAfterPlayedMove,
                refutationLine,
                fenSide(fenAfterPlayedMove),
                {
                    deltaCp: typeof input.cpLoss === "number" ? input.cpLoss : null,
                    previousFen: fen,
                    playedMove: playedMoveUci,
                    cpBefore: typeof input.cpAfter === "number" ? input.cpAfter : null,
                    _sacrificeIntentCp: typeof input.cpAfter === "number" ? input.cpAfter : null,
                },
            ) as SiteThemeDetail;
        } catch {
            allowedDetail = null;
        }
    }

    const classification = {
        allowedMotifs: toMotifEvidence(allowedDetail, "allowed"),
        missedMotifs: toMotifEvidence(missedDetail, "missed"),
        motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    } satisfies MistakeReviewMotifClassification;

    motifCache.set(key, classification);
    if (motifCache.size > MOTIF_CACHE_LIMIT) {
        const oldestKey = motifCache.keys().next().value;
        if (oldestKey) motifCache.delete(oldestKey);
    }
    return classification;
}

export function tacticalMotifLabel(idInput?: string | null) {
    const id = String(idInput ?? "").trim();
    const label = (THEME_LABELS as Record<string, string>)[id];
    if (label) return label;
    return (
        id
            .replace(/[_-]+/g, " ")
            .replace(/([a-z\d])([A-Z])/g, "$1 $2")
            .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Tactical motif"
    );
}

export function tacticalMotifColor(idInput?: string | null) {
    const id = String(idInput ?? "").trim();
    return (THEME_COLORS as Record<string, string>)[id] ?? "orange";
}
