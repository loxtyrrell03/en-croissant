import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import type { Square } from "chessops/types";
import { verifiedTablebasePosition, type TablebaseEvidence } from "./tablebaseEvidence";
import {
    THEME_COLORS,
    THEME_DETECTOR_VERSION,
    THEME_LABELS,
    detectAllowedThemesDetailed,
    detectThemesDetailed,
    detectTacticsAtStep,
    walkPV,
} from "./siteClassifier/theme-detector.js";
import { ChessLite } from "./siteClassifier/analysis.js";
import { ChessPrimitives } from "./siteClassifier/chess-primitives.js";
import {
    auditTacticalMotifs,
    episodeEnd,
    compareBestLineTacticalDefence,
    compareImmediateTacticalDefence,
    filterCompensatedRootCaptures,
    forcingClearanceEpisodeLength,
    promotionClearanceEpisodeLength,
    normalizePromotionClearanceTimeline,
    hasTacticalStart,
    isCompensatedContinuationCapture,
    winningRecaptureEvidence,
    contextualCaptureObservation,
    tacticalCaptureGain,
    proveAlternativeCaptureCause,
    pawnOpportunityRemainsAfterReply,
    MIN_TACTICAL_CAPTURE_GAIN,
    normalizeMatingPayoffs,
    preservesVerifiedMate,
    normalizeContinuingTactics,
    replayTacticalLine,
    selfInterferenceEvidence,
    matingKingDeflectionEvidence,
    matingClearanceEvidence,
    kingInterferencePayoffEvidence,
    xRaySupportEvidence,
} from "./causalTactics";
import { qualifyComparableCaptureChoice } from "./captureChoice";
import { appendTacticalHistory, type TacticalGameHistory } from "./gameHistory";
import type {
    MistakeReviewMotifClassification,
    PositionTacticalMotifClassification,
    TacticalMotifEvidence,
    TacticalMotifSource,
    TacticalReplyCandidate,
} from "./types";

export type {
    MistakeReviewMotifClassification,
    PositionTacticalMotifClassification,
    TacticalMotifConfidence,
    TacticalMotifEvidence,
    TacticalMotifSource,
} from "./types";

export type MistakeReviewMotifInput = {
    /** Optional exact-position certificates supplied by the request owner. No network access occurs here. */
    tablebaseEvidence?: TablebaseEvidence | null;
    fen?: string | null;
    previousFen?: string | null;
    previousMoveUci?: string | null;
    tacticalHistory?: TacticalGameHistory | null;
    bestMoveSan?: string | null;
    bestMoveUci?: string | null;
    playedMoveSan?: string | null;
    playedMoveUci?: string | null;
    pvSan?: string[] | null;
    pvUci?: string[] | null;
    refutationSan?: string[] | null;
    refutationUci?: string[] | null;
    refutationCandidates?: TacticalReplyCandidate[] | null;
    bestCandidates?: TacticalReplyCandidate[] | null;
    cpLoss?: number | null;
    cpBefore?: number | null;
    cpAfter?: number | null;
    winProbabilityDrop?: number | null;
    reachedDepth?: number | null;
};

export type PositionTacticalMotifInput = {
    tablebaseEvidence?: TablebaseEvidence | null;
    fen?: string | null;
    pvUci?: string[] | null;
    pvSan?: string[] | null;
    previousFen?: string | null;
    previousMoveUci?: string | null;
    tacticalHistory?: TacticalGameHistory | null;
    /** Engine evaluation from this position's side to move. */
    rootCp?: number | null;
};

type SiteThemeStep = {
    uci?: string | null;
    fenBefore?: string | null;
    fenAfter?: string | null;
    movedPiece?: string | null;
    capturedPiece?: string | null;
    materialDelta?: number | null;
    cumulativeDelta?: number | null;
    side?: "w" | "b" | null;
};

type SiteThemeDetail = {
    themes?: unknown;
    steps?: SiteThemeStep[] | null;
    themeStepIndex?: number | null;
    themeStepIndexByTheme?: Record<string, number> | null;
    isMate?: boolean | null;
};

const detectStepThemes = detectTacticsAtStep as unknown as (
    step: SiteThemeStep,
    side: "w" | "b",
    options: { steps: SiteThemeStep[] },
) => unknown;

type SiteAllowedThemeOptions = {
    deltaCp: number | null;
    previousFen: string;
    playedMove: string;
    cpBefore: number | null;
    _sacrificeIntentCp: number | null;
    analysisMode?: "engine-pv";
};

const detectAllowedThemesDetailedWithOptions = detectAllowedThemesDetailed as unknown as (
    startFen: string,
    bestLine: string[],
    playerSide: "w" | "b",
    options: SiteAllowedThemeOptions,
) => SiteThemeDetail;

const TACTICAL_MOTIF_ADAPTER_VERSION = 131;
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
    const moves: string[] = [];
    for (const value of Array.isArray(values) ? values : []) {
        const move = cleanUci(value);
        if (!move) break;
        moves.push(move);
    }
    return moves;
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

    // Use the same legal replay as the evidence audit. In particular, both
    // standard king-destination and king-to-rook castling UCI reach the same
    // position; a second parser must not turn one into a missed move.
    const step = replayTacticalLine(fen, [move])[0];
    return step ? makeFen(step.after.toSetup()) : null;
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

const PIECE_NAMES: Record<string, string> = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king",
};

type BoardTargetFact = {
    square: string;
    piece: string;
    value: number;
};

function pieceName(piece?: string | null) {
    return PIECE_NAMES[String(piece ?? "").toLowerCase()] ?? "piece";
}

function numberWord(value: number) {
    if (value === 0) return "no times";
    if (value === 1) return "once";
    if (value === 2) return "twice";
    return `${value} times`;
}

function joinTargetFacts(targets: BoardTargetFact[]) {
    const labels = targets.map((target) => `${target.piece} on ${target.square}`);
    if (labels.length <= 1) return labels[0] ?? "two targets";
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function stepBoard(step: SiteThemeStep | undefined, after: boolean) {
    const fen = String(after ? (step?.fenAfter ?? "") : (step?.fenBefore ?? "")).trim();
    if (!fen) return null;
    try {
        return ChessPrimitives(fen);
    } catch {
        return null;
    }
}

function forkTargets(step: SiteThemeStep | undefined): BoardTargetFact[] {
    const move = cleanUci(step?.uci);
    const board = stepBoard(step, true);
    const side = step?.side === "b" ? "b" : "w";
    if (!move || !board) return [];

    const targetSquare = move.slice(2, 4);
    const attackerIndex = board.sqToIdx(targetSquare);
    const attacker = board.pieceAt(attackerIndex);
    if (!attacker || board.colorOf(attacker) !== side) return [];
    const opponent = side === "w" ? "b" : "w";
    const attackerValue = board.pieceValue(attacker);

    return (board.attacks(attackerIndex) as number[])
        .map((index) => {
            const target = board.pieceAt(index);
            if (!target || board.colorOf(target) !== opponent) return null;
            const type = String(target).toUpperCase();
            if (type === "P") return null;
            const value = type === "K" ? 100 : board.pieceValue(target);
            if (type !== "K" && value <= attackerValue && !board.isHanging(index)) return null;
            return {
                square: board.idxToSq(index),
                piece: pieceName(target),
                value,
            } satisfies BoardTargetFact;
        })
        .filter((target): target is BoardTargetFact => Boolean(target))
        .sort((left, right) => right.value - left.value || left.square.localeCompare(right.square));
}

function findEvidenceStepIndex(detail: SiteThemeDetail, motifId: string, fallbackIndex: number) {
    const steps = Array.isArray(detail.steps) ? detail.steps : [];
    if (motifId === "fork") {
        const forkIndex = steps.findIndex((step) => forkTargets(step).length >= 2);
        if (forkIndex >= 0) return forkIndex;
    }
    if (motifId === "attackingF2F7") {
        const weakSquareIndex = steps.findIndex((step) => {
            const destination = cleanUci(step?.uci)?.slice(2, 4);
            return destination === "f2" || destination === "f7";
        });
        if (weakSquareIndex >= 0) return weakSquareIndex;
    }
    return fallbackIndex;
}

function moveDisplay(moveUci: string | null, sanLine: string[], stepIndex: number) {
    const san = String(sanLine[stepIndex] ?? "").trim();
    return san || moveUci || "The tactical move";
}

function protectedFromKingCaptureFact(step: SiteThemeStep | undefined) {
    const move = cleanUci(step?.uci);
    const board = stepBoard(step, true);
    const side = step?.side === "b" ? "b" : "w";
    if (!move || !board) return null;
    const targetSquare = move.slice(2, 4);
    const targetIndex = board.sqToIdx(targetSquare);
    const opponent = side === "w" ? "b" : "w";
    const kingAttacksTarget = (board.attackers(opponent, targetIndex) as number[]).some(
        (index) => String(board.pieceAt(index) ?? "").toUpperCase() === "K",
    );
    if (!kingAttacksTarget) return null;
    const supporterIndex = (board.attackers(side, targetIndex) as number[]).find((index) => {
        const supporter = board.pieceAt(index);
        return supporter && board.colorOf(supporter) === side;
    });
    if (!Number.isInteger(supporterIndex)) return null;
    const supporter = board.pieceAt(supporterIndex);
    return {
        supporter: pieceName(supporter),
        supporterSquare: board.idxToSq(supporterIndex),
        movedPiece: pieceName(step?.movedPiece),
        targetSquare,
    };
}

function forkEvidence(detail: SiteThemeDetail, stepIndex: number, sanLine: string[]) {
    const steps = Array.isArray(detail.steps) ? detail.steps : [];
    const step = steps[stepIndex];
    const moveUci = cleanUci(step?.uci);
    const targets = forkTargets(step);
    if (!moveUci || targets.length < 2) return null;

    const display = moveDisplay(moveUci, sanLine, stepIndex);
    let evidence = `${display} forks the ${joinTargetFacts(targets.slice(0, 3))}.`;
    const protection = protectedFromKingCaptureFact(step);
    if (protection) {
        evidence += ` The ${protection.supporter} on ${protection.supporterSquare} protects ${protection.targetSquare}, so the king cannot capture the ${protection.movedPiece}.`;
    }

    let attackerSquare = moveUci.slice(2, 4);
    let payoffIndex = -1;
    for (let index = stepIndex + 1; index < steps.length; index += 1) {
        const candidate = steps[index];
        const candidateMove = cleanUci(candidate?.uci);
        if (!candidateMove) continue;
        if (candidate.side !== step?.side) {
            if (candidateMove.slice(2, 4) === attackerSquare && candidate.capturedPiece) break;
            continue;
        }
        if (candidateMove.slice(0, 2) !== attackerSquare) continue;
        attackerSquare = candidateMove.slice(2, 4);
        if (candidate.capturedPiece) {
            payoffIndex = index;
            break;
        }
    }
    if (payoffIndex >= 0) {
        const payoff = steps[payoffIndex];
        const payoffMove = cleanUci(payoff.uci);
        evidence += ` The line continues with ${moveDisplay(payoffMove, sanLine, payoffIndex)}, winning the ${pieceName(payoff.capturedPiece)}.`;
    }
    return evidence;
}

function weakF2F7Evidence(detail: SiteThemeDetail, stepIndex: number, sanLine: string[]) {
    const step = detail.steps?.[stepIndex];
    const moveUci = cleanUci(step?.uci);
    const boardBefore = stepBoard(step, false);
    const boardAfter = stepBoard(step, true);
    const side = step?.side === "b" ? "b" : "w";
    if (!moveUci || !boardBefore || !boardAfter) return null;
    const square = moveUci.slice(2, 4);
    if (square !== "f2" && square !== "f7") return null;
    const squareIndex = boardBefore.sqToIdx(square);
    const opponent = side === "w" ? "b" : "w";
    const attackerCount = (boardBefore.attackers(side, squareIndex) as number[]).length;
    const defenderCount = (boardBefore.attackers(opponent, squareIndex) as number[]).length;
    const display = moveDisplay(moveUci, sanLine, stepIndex);
    let givesCheck = false;
    try {
        const chess = ChessLite();
        chess.loadFEN(String(step?.fenAfter ?? ""));
        givesCheck = Boolean(chess.inCheck(opponent));
    } catch {
        givesCheck = false;
    }

    let evidence = `${display} exploits ${square}, which is attacked ${numberWord(attackerCount)} and defended ${numberWord(defenderCount)}`;
    evidence += givesCheck ? ", and gives check." : ".";
    const protection = protectedFromKingCaptureFact(step);
    if (protection) {
        evidence += ` The ${protection.supporter} on ${protection.supporterSquare} protects the ${protection.movedPiece}, so the king cannot recapture.`;
    }
    return evidence;
}

function loosePieceEvidence(detail: SiteThemeDetail, stepIndex: number, sanLine: string[]) {
    const steps = Array.isArray(detail.steps) ? detail.steps : [];
    const capture = steps[stepIndex];
    if (!capture?.capturedPiece) return null;
    const actualIndex = steps.indexOf(capture);
    const moveUci = cleanUci(capture.uci);
    if (!moveUci) return null;
    return `${moveDisplay(moveUci, sanLine, actualIndex)} wins the loose ${pieceName(capture.capturedPiece)} on ${moveUci.slice(2, 4)}.`;
}

type RayTacticFact = {
    pinner: string;
    pinnerSquare: string;
    front: string;
    frontSquare: string;
    rear: string;
    rearSquare: string;
};

function rayTacticFact(step: SiteThemeStep | undefined, kind: "pin" | "skewer") {
    const board = stepBoard(step, true);
    const side = step?.side === "b" ? "b" : "w";
    if (!board) return null;
    const opponent = side === "w" ? "b" : "w";
    const moveTarget = cleanUci(step?.uci)?.slice(2, 4);
    const candidateIndices = Array.from({ length: 64 }, (_, index) => index).sort((a, b) => {
        if (!moveTarget) return a - b;
        const targetIndex = board.sqToIdx(moveTarget);
        return Number(b === targetIndex) - Number(a === targetIndex) || a - b;
    });

    for (const pinnerIndex of candidateIndices) {
        const pinner = board.pieceAt(pinnerIndex);
        if (!pinner || board.colorOf(pinner) !== side) continue;
        const pinnerType = String(pinner).toUpperCase();
        if (!/[BRQ]/.test(pinnerType)) continue;
        const directions = [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
        ].filter(
            ([row, column]) =>
                pinnerType === "Q" ||
                (pinnerType === "R" ? row === 0 || column === 0 : row !== 0 && column !== 0),
        );
        const row = Math.floor(pinnerIndex / 8);
        const column = pinnerIndex % 8;
        for (const [rowStep, columnStep] of directions) {
            const blockers: number[] = [];
            let nextRow = row + rowStep;
            let nextColumn = column + columnStep;
            while (nextRow >= 0 && nextRow < 8 && nextColumn >= 0 && nextColumn < 8) {
                const index = nextRow * 8 + nextColumn;
                if (board.pieceAt(index)) {
                    blockers.push(index);
                    if (blockers.length === 2) break;
                }
                nextRow += rowStep;
                nextColumn += columnStep;
            }
            if (blockers.length < 2) continue;
            const front = board.pieceAt(blockers[0]);
            const rear = board.pieceAt(blockers[1]);
            if (
                !front ||
                !rear ||
                board.colorOf(front) !== opponent ||
                board.colorOf(rear) !== opponent
            ) {
                continue;
            }
            const frontValue = String(front).toUpperCase() === "K" ? 100 : board.pieceValue(front);
            const rearValue = String(rear).toUpperCase() === "K" ? 100 : board.pieceValue(rear);
            const matches = kind === "pin" ? rearValue > frontValue : frontValue > rearValue;
            if (!matches) continue;
            return {
                pinner: pieceName(pinner),
                pinnerSquare: board.idxToSq(pinnerIndex),
                front: pieceName(front),
                frontSquare: board.idxToSq(blockers[0]),
                rear: pieceName(rear),
                rearSquare: board.idxToSq(blockers[1]),
            } satisfies RayTacticFact;
        }
    }
    return null;
}

function rayTacticEvidence(
    detail: SiteThemeDetail,
    stepIndex: number,
    sanLine: string[],
    kind: "pin" | "skewer",
) {
    const step = detail.steps?.[stepIndex];
    const fact = rayTacticFact(step, kind);
    const moveUci = cleanUci(step?.uci);
    if (!fact || !moveUci) return null;
    const display = moveDisplay(moveUci, sanLine, stepIndex);
    return kind === "pin"
        ? `${display} lets the ${fact.pinner} on ${fact.pinnerSquare} pin the ${fact.front} on ${fact.frontSquare} to the ${fact.rear} on ${fact.rearSquare}.`
        : `${display} lets the ${fact.pinner} on ${fact.pinnerSquare} skewer the ${fact.front} on ${fact.frontSquare}, exposing the ${fact.rear} on ${fact.rearSquare}.`;
}

function motifEvidence(
    detail: SiteThemeDetail,
    motifId: string,
    stepIndex: number,
    source: TacticalMotifSource,
    sanLine: string[],
) {
    if (motifId === "fork") {
        const evidence = forkEvidence(detail, stepIndex, sanLine);
        if (evidence) return evidence;
    }
    if (motifId === "attackingF2F7") {
        const evidence = weakF2F7Evidence(detail, stepIndex, sanLine);
        if (evidence) return evidence;
    }
    if (motifId === "hangingPiece" || motifId === "attacking_undefended_piece") {
        const evidence = loosePieceEvidence(detail, stepIndex, sanLine);
        if (evidence) return evidence;
    }
    if (motifId === "pin" || motifId === "skewer") {
        const evidence = rayTacticEvidence(detail, stepIndex, sanLine, motifId);
        if (evidence) return evidence;
    }

    const moveUci = stepIndex >= 0 ? cleanUci(detail.steps?.[stepIndex]?.uci) : null;
    const label = tacticalMotifLabel(motifId);
    const lineLabel =
        source === "allowed"
            ? "opponent refutation"
            : source === "available"
              ? "current best line"
              : "missed best line";
    return moveUci
        ? `${label} appears on ${moveDisplay(moveUci, sanLine, stepIndex)} at ply ${stepIndex + 1} of the ${lineLabel}.`
        : `${label} is detected in the verified ${lineLabel}.`;
}

function toMotifEvidence(
    detailInput: SiteThemeDetail | null | undefined,
    source: TacticalMotifSource,
    sanLineInput?: string[] | null,
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
    const sanLine = Array.isArray(sanLineInput) ? sanLineInput : [];

    return normalizeThemeIds(detail.themes).map<TacticalMotifEvidence>((id) => {
        const mappedIndex = themeStepIndexByTheme[id];
        const stepIndex = findEvidenceStepIndex(
            detail,
            id,
            Number.isInteger(mappedIndex) ? mappedIndex : fallbackIndex,
        );
        const moveUci = stepIndex >= 0 ? cleanUci(steps[stepIndex]?.uci) : null;
        const weakSquare = id === "attackingF2F7" ? moveUci?.slice(2, 4) : null;
        const label =
            weakSquare === "f2" || weakSquare === "f7"
                ? `Weak ${weakSquare}`
                : tacticalMotifLabel(id);
        const evidence = motifEvidence(detail, id, stepIndex, source, sanLine);

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

const IMPORTANT_TACTICAL_THEME_IDS = new Set([
    "perpetualCheck",
    "drawingCapture",
    "promotionCombination",
    "forcingAttack",
    "forkPreparation",
    "doubleThreat",
    "tacticalPreparation",
    "fork",
    "pin",
    "skewer",
    "discoveredAttack",
    "discoveredCheck",
    "doubleCheck",
    "hangingPiece",
    "trappedPiece",
    "sacrifice",
    "backRank",
    "backRankMate",
    "promotion",
    "underPromotion",
    "mateThreat",
    "deflection",
    "attraction",
    "interference",
    "selfInterference",
    "intermezzo",
    "clearance",
    "xRayAttack",
    "zugzwang",
    "capturingDefender",
    "attacking_undefended_piece",
    "attackingF2F7",
]);

const MOTIF_IMPORTANCE: Record<string, number> = {
    perpetualCheck: 39,
    drawingCapture: 40,
    backRankMate: 1,
    doubleCheck: 5,
    fork: 10,
    skewer: 11,
    pin: 12,
    deflection: 14,
    interference: 15,
    selfInterference: 16,
    attraction: 17,
    capturingDefender: 18,
    discoveredCheck: 19,
    discoveredAttack: 20,
    hangingPiece: 22,
    attacking_undefended_piece: 23,
    attackingF2F7: 25,
    intermezzo: 27,
    sacrifice: 29,
    trappedPiece: 31,
    xRayAttack: 32,
    mateThreat: 34,
    backRank: 35,
    promotion: 36,
    underPromotion: 37,
    zugzwang: 38,
    clearance: 45,
};

function motifImportance(id: string) {
    if (id !== "backRankMate" && /Mate$/.test(id)) return 0;
    if (/^mateIn\d+$/.test(id)) return 2;
    if (id === "mate") return 3;
    return MOTIF_IMPORTANCE[id] ?? 100;
}

function isImportantTacticalTheme(id: string) {
    return IMPORTANT_TACTICAL_THEME_IDS.has(id) || MATE_MOTIF_PATTERN.test(id);
}

export function selectImportantTacticalMotifs(motifs: TacticalMotifEvidence[], limit = 3) {
    const unique = new Map<string, TacticalMotifEvidence>();
    for (const motif of motifs) {
        if (!isImportantTacticalTheme(motif.id) || unique.has(motif.id)) continue;
        unique.set(motif.id, motif);
    }

    const fork = unique.get("fork");
    if (fork) {
        for (const redundantId of ["clearance", "trappedPiece"]) {
            const redundant = unique.get(redundantId);
            if (redundant && redundant.moveUci === fork.moveUci) unique.delete(redundantId);
        }
    }
    const hasNamedMate = [...unique.keys()].some((id) => id !== "backRankMate" && /Mate$/.test(id));
    const hasMateDistance = [...unique.keys()].some((id) => /^mateIn\d+$/.test(id));
    if (hasNamedMate || hasMateDistance) unique.delete("mate");
    if (unique.has("backRankMate")) unique.delete("backRank");

    return [...unique.values()]
        .sort(
            (left, right) =>
                (left.relevance === "primary" ? -1 : right.relevance === "primary" ? 1 : 0) ||
                (left.relevance && right.relevance ? (left.ply ?? 100) - (right.ply ?? 100) : 0) ||
                motifImportance(left.id) - motifImportance(right.id) ||
                (left.ply ?? Number.MAX_SAFE_INTEGER) - (right.ply ?? Number.MAX_SAFE_INTEGER) ||
                left.label.localeCompare(right.label),
        )
        .slice(0, Math.max(0, limit));
}

export type MistakeReviewTacticalExplanation = {
    title: string;
    text: string;
    source: "allowed" | "missed" | "mixed";
    primary: TacticalMotifEvidence;
    /** At most one independently supported lesson from the other side's line. */
    secondary?: TacticalMotifEvidence;
};

function isConditionalMaterial(motif: TacticalMotifEvidence | undefined) {
    return Boolean(motif && (motif.ply ?? 0) > 1 && !MATE_MOTIF_PATTERN.test(motif.id));
}

function isAlternativeCapture(motif: TacticalMotifEvidence | undefined) {
    return motif?.source === "missed" && motif.id === "hangingPiece" &&
        motif.ply === 1 && motif.alternativeCapture === true;
}

/** A post-move tactic is not automatically a newly caused one. */
export function tacticalMotifPerspective(motif: TacticalMotifEvidence) {
    if (motif.source === "missed")
        return isAlternativeCapture(motif) ? "Capture choice" :
            isConditionalMaterial(motif) ? "Continuation idea" : "Missed opportunity";
    if (motif.source === "available") return "Available tactic";
    if (motif.comparison === "persists") return "Existing danger";
    if (motif.comparison === "reduced") return "More costly";
    return motif.comparison === "prevented" ? "Overlooked threat" : "Opponent tactic";
}

export function isImmediateTacticalLesson(motif: TacticalMotifEvidence | undefined) {
    return Boolean(
        motif &&
        !isAlternativeCapture(motif) &&
        motif.ply === 1 &&
        motif.confidence !== "low" &&
        ((motif.value ?? 0) >= 100 ||
            (motif.id === "hangingPiece" && motif.label === "Material Gain" &&
                motif.confidence === "high" && (motif.value ?? 0) >= MIN_TACTICAL_CAPTURE_GAIN) ||
            motif.id === "perpetualCheck" ||
            (motif.id === "drawingCapture" && motif.confidence === "high") ||
            (motif.verifiedCombination === true &&
                motif.confidence === "high" &&
                (motif.value ?? 0) > 0 &&
                ["fork", "forkPreparation"].includes(motif.id))),
    );
}

export function buildMistakeReviewTacticalExplanation(input: {
    allowedMotifs: TacticalMotifEvidence[];
    missedMotifs: TacticalMotifEvidence[];
}): MistakeReviewTacticalExplanation | null {
    const explanation = chooseMistakeReviewTacticalExplanation(input);
    if (!explanation) return null;
    // Preserve the main lesson's ownership/ranking. Do not turn conditional
    // continuation motifs or existing/uncompared danger into another cause.
    if (!isImmediateTacticalLesson(explanation.primary)) return explanation;
    const primaryMissed = explanation.primary.source === "missed";
    const other = primaryMissed ? input.allowedMotifs : input.missedMotifs;
    const secondary = selectImportantTacticalMotifs(
        other.filter(
            (motif) =>
                isImmediateTacticalLesson(motif) &&
                (!primaryMissed ||
                    motif.comparison === "prevented" ||
                    motif.comparison === "reduced"),
        ),
        1,
    )[0];
    if (!secondary) return explanation;
    const introduction = primaryMissed
        ? secondary.comparison === "reduced"
            ? `Your move also made an existing opponent tactic more costly (${secondary.label})`
            : `Your move also allowed an opponent tactic (${secondary.label})`
        : `You also missed a tactical opportunity (${secondary.label})`;
    return {
        ...explanation,
        secondary,
        text: `${explanation.text} ${introduction}: ${secondary.evidence}${primaryMissed && secondary.comparisonEvidence ? ` ${secondary.comparisonEvidence}` : ""}`,
    };
}

function chooseMistakeReviewTacticalExplanation({
    allowedMotifs,
    missedMotifs,
}: {
    allowedMotifs: TacticalMotifEvidence[];
    missedMotifs: TacticalMotifEvidence[];
}): MistakeReviewTacticalExplanation | null {
    const allowed = selectImportantTacticalMotifs(allowedMotifs, 1)[0];
    const missed = selectImportantTacticalMotifs(missedMotifs, 1)[0];
    if (!allowed && !missed) return null;
    // A proved root lesson must not lose to a motif that only appears after
    // several conditional PV replies. Preserve verified mating consequences.
    const allowedRootOverConditional = allowed?.ply === 1 &&
        (isConditionalMaterial(missed) || isAlternativeCapture(missed) ||
            (missed?.alternativeLine && isImmediateTacticalLesson(allowed) &&
                (allowed.comparison === "prevented" || allowed.comparison === "reduced")));

    if (
        missed &&
        !allowedRootOverConditional &&
        (!allowed ||
            (!allowed.comparison && isImmediateTacticalLesson(missed)) ||
            allowed.comparison === "persists" ||
            (missed.ply === 1 && isConditionalMaterial(allowed)) ||
            (missed.value ?? 0) > Math.max(100, (allowed.value ?? 0) * 1.5))
    ) {
        if (isAlternativeCapture(missed)) {
            return {
                title: "Capture in the better line",
                text: missed.comparisonEvidence ?? "Both moves have comparable immediate captures. The capture alone is not a verified explanation of why the move was worse.",
                source: "missed",
                primary: missed,
            };
        }
        if (isConditionalMaterial(missed)) {
            return {
                title: "Tactic in the better line",
                text: `In the displayed continuation after the better move, ${missed.evidence} This later idea depends on the replies shown; it is not a verified explanation of what the first move missed.`,
                source: "missed",
                primary: missed,
            };
        }
        return {
            title: `${missed.alternativeLine ? "Missed alternative" : "What you missed"}: ${missed.label}`,
            text: `${missed.alternativeLine ? "Another stronger move had this tactic" : "The better move had this tactic"}: ${missed.evidence}`,
            source: "missed",
            primary: missed,
        };
    }
    if (allowed) {
        if (isConditionalMaterial(allowed)) {
            return {
                title: "Tactic in the continuation",
                text: `In the displayed continuation, ${allowed.evidence} This later tactic depends on the preceding replies; it is not an immediate refutation.`,
                source: "allowed",
                primary: allowed,
            };
        }
        if (!allowed.comparison) {
            return {
                title: "Tactic after the move",
                text: `The opponent has this tactic in the analysed position: ${allowed.evidence} The comparison has not established whether the better move prevents or reduces it, so this tactic alone is not a verified explanation of the mistake.`,
                source: "allowed",
                primary: allowed,
            };
        }
        return {
            title:
                allowed.comparison === "persists"
                    ? "Tactical danger in the position"
                    : "Why the move was tactically bad",
            text:
                allowed.comparison === "persists"
                    ? `${allowed.evidence} ${allowed.comparisonEvidence} This threat alone does not explain the difference between the two moves.`
                    : allowed.comparison === "reduced"
                      ? `Your move made an existing tactic more costly: ${allowed.evidence} ${allowed.comparisonEvidence}`
                      : `Your move allowed this tactic: ${allowed.evidence}${allowed.comparisonEvidence ? ` ${allowed.comparisonEvidence}` : ""}`,
            source: "allowed",
            primary: allowed,
        };
    }
    return {
        title: "What you missed",
        text: `The better move had this tactic: ${missed?.evidence ?? ""}`,
        source: "missed",
        primary: missed!,
    };
}

export function classifyPositionTacticalMotifs(
    input: PositionTacticalMotifInput,
): PositionTacticalMotifClassification {
    const fen = String(input.fen ?? "").trim();
    const bestLine = cleanUciLine(input.pvUci);
    const bestMoveUci = bestLine[0] ?? null;
    let detail: SiteThemeDetail | null = null;

    if (fen && bestMoveUci && hasTacticalStart(fen, bestLine)) {
        try {
            detail = detectThemesDetailed({
                fen,
                side: fenSide(fen),
                best: bestMoveUci,
                bestLine,
                _analysisMode: "engine-pv",
                _prevFen: String(input.previousFen ?? "").trim() || null,
                _prevPlayedMove: cleanUci(input.previousMoveUci),
            }) as SiteThemeDetail;
        } catch {
            detail = null;
        }
    }

    const motifs = filterCompensatedRootCaptures(
        fen,
        bestLine,
        auditTacticalMotifs(
            fen,
            bestLine,
            toMotifEvidence(detail, "available", input.pvSan),
            input.rootCp,
            { previousFen: input.previousFen, previousMoveUci: cleanUci(input.previousMoveUci), tablebaseEvidence: input.tablebaseEvidence, tacticalHistory: input.tacticalHistory },
        ),
        input.previousFen,
        cleanUci(input.previousMoveUci),
    );
    // A missing root certificate must not erase independently checked later
    // events. The timeline retains its quiet/terminal relevance boundaries;
    // none of its rows are promoted into a root lesson here.
    const timeline = selectContinuationLessons(
        filterCompensatedRootCaptures(
            fen,
            bestLine,
            buildTacticalTimeline(fen, bestLine, "available", motifs, input.pvSan, input.tablebaseEvidence),
            input.previousFen,
            cleanUci(input.previousMoveUci),
        ),
        motifs,
    );
    return {
        motifs: selectRootConnectedLessons(fen, bestLine, motifs, timeline),
        ...(motifs.length || timeline.length ? { timeline } : {}),
        motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    };
}

/** A PV can switch initiative without two quiet plies: a counterattack may
 * consist entirely of checks, evasions and captures. A later local gain then
 * explains that reached board, not the initial move. Keep it in the timeline,
 * but do not let it donate a root headline or board annotation. This is a
 * relevance boundary, not a refutation of the later tactical certificate.
 * A check alone is insufficient: require an independently verified opposing
 * mechanism, initiated outside a forced check evasion. */
function selectRootConnectedLessons(
    fen: string,
    line: string[],
    motifs: TacticalMotifEvidence[],
    timeline: TacticalMotifEvidence[],
) {
    if (!motifs.some((motif) => (motif.ply ?? 1) > 1)) return motifs;
    // These root proofs already connect their forcing ending independently
    // of the supplied PV, including counterchecks during the combination.
    if (
        motifs.some(
            (motif) => motif.ply === 1 &&
                (motif.value === 10000 || motif.id === "promotionCombination"),
        )
    ) return motifs;
    const replay = replayTacticalLine(fen, line);
    const actor = replay[0]?.before.turn;
    const mechanisms = new Set([
        "fork", "forkPreparation", "doubleThreat", "skewer", "pin", "interference",
        "deflection", "attraction", "capturingDefender", "discoveredCheck",
        "doubleCheck", "forcingAttack", "trappedPiece",
    ]);
    const counterplay = timeline.filter((motif) => {
        const step = replay[(motif.ply ?? 0) - 1];
        return (
            step && step.before.turn !== actor && motif.confidence === "high" &&
            (motif.value ?? 0) > 0 &&
            (mechanisms.has(motif.id) || motif.value === 10000) &&
            !step.before.isCheck() && step.after.isCheck()
        );
    });
    const boundary = Math.min(...counterplay.map((motif) => motif.ply!));
    return motifs.filter((motif) => (motif.ply ?? 1) <= boundary);
}

/** Without a certified root lesson, a capture in a speculative line may be
 * acceptance of an offer rather than a separate material mistake. Keep its
 * SAN move, but do not add a generic gain badge before a checked mechanism
 * for that side. Independently checked forks, pins and mates remain at their
 * actual ply, as do their subsequent capture payoffs. */
function selectContinuationLessons(
    timeline: TacticalMotifEvidence[],
    rootMotifs: TacticalMotifEvidence[],
) {
    if (rootMotifs.some((motif) => motif.ply === 1)) return timeline;
    return timeline.filter(
        (motif) =>
            motif.id !== "hangingPiece" ||
            // A substantial, independently checked recapture is useful at
            // its actual ply even when the opening attack is not proved.
            // It stays in the bounded conditional timeline, never supplies
            // a missing root cause, and does not admit routine pawn trades.
            (motif.label === "Winning Recapture" && (motif.value ?? 0) >= 320) ||
            timeline.some(
                (prior) =>
                    prior.id !== "hangingPiece" &&
                    prior.actor === motif.actor &&
                    prior.ply !== null &&
                    motif.ply !== null &&
                    prior.ply <= motif.ply,
            ),
    );
}

/** Each row is assessed in its own legal position. Root causes stay separate
 * so later repetitions and opponent counterplay cannot replace the lesson. */
export function buildTacticalTimeline(
    fen: string,
    line: string[],
    source: TacticalMotifSource,
    rootMotifs: TacticalMotifEvidence[],
    sanLine?: string[] | null,
    tablebaseEvidence?: TablebaseEvidence | null,
) {
    const fullReplay = replayTacticalLine(fen, line);
    // Winning a newly exposed pawn proves that capture, not every later
    // combination in an engine continuation. Keep its lesson at the root;
    // later boards can be scanned independently when actually reached.
    if (rootMotifs.length && rootMotifs.every(motif => motif.ply === 1 &&
        motif.id === "hangingPiece" && motif.label === "Hanging Pawn")) {
        return rootMotifs.map(motif => ({ ...motif, actor: fullReplay[0]?.before.turn }));
    }
    const provedPromotionOffer = rootMotifs.some(
        (motif) => motif.id === "promotionCombination" && motif.ply === 1,
    );
    const promotionEpisode =
        provedPromotionOffer &&
        fullReplay
            .slice(0, 17)
            .some((step) => step.before.turn === fullReplay[0].before.turn && step.move.promotion);
    const terminal = fullReplay.findIndex(
        (step) =>
            step.after.isEnd() ||
            (promotionEpisode &&
                step.before.turn === fullReplay[0].before.turn &&
                step.move.promotion),
    );
    // Some engine PVs continue shuffling after a dead-material draw. Those
    // legal but outcome-irrelevant moves must not manufacture new lessons.
    const terminalReplay = terminal < 0 ? fullReplay : fullReplay.slice(0, terminal + 1);
    const episodeReplay = rootMotifs.length
        ? terminalReplay
        : terminalReplay.slice(0, episodeEnd(terminalReplay));
    // The pawn-race proof searches at most eight further attacking moves.
    // A later promotion cannot join an unrelated engine continuation to it.
    const clearanceEpisode =
        rootMotifs[0]?.id === "clearance"
            ? rootMotifs[0].label === "Promotion Clearance"
                ? promotionClearanceEpisodeLength(episodeReplay)
                : forcingClearanceEpisodeLength(episodeReplay)
            : null;
    const replay =
        clearanceEpisode !== null
            ? episodeReplay.slice(0, clearanceEpisode)
            : promotionEpisode
              ? episodeReplay.slice(0, 17)
              : episodeReplay;
    const legalLine = replay.map((step) => step.uci);
    const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
    const unprovedPositions = new Set([positionKey(fen)]);
    const rawSteps = walkPV(fen, legalLine, fenSide(fen)) as SiteThemeStep[];
    const evidence = new Map<string, TacticalMotifEvidence>();
    for (const motif of rootMotifs) {
        const step = replay[(motif.ply ?? 0) - 1];
        const contextual = step
            ? winningRecaptureEvidence(replay, (motif.ply ?? 0) - 1, motif)
            : null;
        if (step && contextual)
            evidence.set(`${motif.ply}:${motif.id}`, { ...contextual, actor: step.before.turn });
    }
    let quietPlies = 0;
    let connectedPlies = replay.length;
    const provedForcingEpisode =
        clearanceEpisode !== null ||
        rootMotifs.some(
            (motif) =>
                motif.ply === 1 &&
                ((motif.label === "Forcing Mate" && motif.value === 10000) ||
                    (motif.id === "promotionCombination" && promotionEpisode)),
        );
    for (let index = 0; index < replay.length; index++) {
        const step = replay[index];
        if (!rootMotifs.length) {
            const key = positionKey(makeFen(step.after.toSetup()));
            // A reversible cycle without a root certificate does not connect
            // a subsequent gift to the opening check. Independently proved
            // perpetuals and other root lessons keep their existing handling.
            if (unprovedPositions.has(key)) {
                connectedPlies = index + 1;
                break;
            }
            unprovedPositions.add(key);
        }
        const suffix = legalLine.slice(index);
        const tacticalStart = hasTacticalStart(
            rawSteps[index]?.fenBefore ?? "",
            suffix,
            index === 0 && rootMotifs.some((motif) => motif.id === "tacticalPreparation"),
            tablebaseEvidence,
        );
        // A forced king evasion is not a quiet pause. Nor is a locally
        // verified quiet mating preparation. Two genuinely quiet plies mark
        // a relevance boundary, not a claim that later tactics cannot exist.
        // An all-defences mate or pawn-race proof connects its quiet moves
        // within the proof horizon; a PV alone cannot extend this window.
        quietPlies = tacticalStart || step.before.isCheck() ? 0 : quietPlies + 1;
        if (quietPlies >= 2 && !provedForcingEpisode) {
            connectedPlies = index;
            break;
        }
        // A checked defender's quiet evasion can explain why material is
        // conceded. It is an observed secondary mechanism, never a new
        // offensive root lesson for the side making that blocking move.
        if (index > 0) {
            const selfInterference = selfInterferenceEvidence(step, source);
            if (selfInterference)
                evidence.set(`${index + 1}:selfInterference`, {
                    ...selfInterference,
                    ply: index + 1,
                    actor: step.before.turn,
                    relevance: "secondary",
                });
        }
        const xRaySupport = xRaySupportEvidence(step, source);
        if (xRaySupport && xRaySupport.value === undefined)
            evidence.set(`${index + 1}:xRayAttack`, {
                ...xRaySupport,
                ply: index + 1,
                actor: step.before.turn,
                relevance: "secondary",
            });
        const matingDeflection = matingKingDeflectionEvidence(step, source);
        if (matingDeflection && !evidence.has(`${index + 1}:deflection`))
            evidence.set(`${index + 1}:deflection`, {
                ...matingDeflection,
                ply: index + 1,
                actor: step.before.turn,
                relevance: "secondary",
            });
        const matingClearance = matingClearanceEvidence(replay.slice(index), source);
        if (matingClearance && !evidence.has(`${index + 1}:${matingClearance.id}`))
            evidence.set(`${index + 1}:${matingClearance.id}`, {
                ...matingClearance,
                ply: index + 1,
                actor: step.before.turn,
                relevance: "secondary",
            });
        const interferencePayoff = kingInterferencePayoffEvidence(replay, index, source);
        if (interferencePayoff)
            evidence.set(`${index + 1}:hangingPiece`, {
                ...interferencePayoff,
                actor: step.before.turn,
                relevance: "secondary",
            });
        const captureKey = `${index + 1}:hangingPiece`;
        if (!evidence.has(captureKey) && step.capture && (tacticalCaptureGain(step) ?? 0) < 100) {
            const observed = contextualCaptureObservation(replay, index, [...evidence.values()], source);
            if (observed) evidence.set(captureKey, observed);
        }
        if (!tacticalStart) continue;
        // These are observed legal actions, not certificates explaining the
        // root move. Record them at their actual ply even when a promoted
        // piece is subsequently sacrificed; do not invent a material value
        // or claim that underpromotion was necessary.
        const promotion = step.move.promotion;
        const enPassant =
            step.before.board.get(step.move.from)?.role === "pawn" &&
            step.move.to === step.before.epSquare &&
            !step.before.board.get(step.move.to) &&
            step.capture === 100;
        if (promotion || enPassant) {
            const id = promotion
                ? promotion === "queen"
                    ? "promotion"
                    : "underPromotion"
                : "enPassant";
            const victim = step.move.to + (step.before.turn === "white" ? -8 : 8);
            const key = `${index + 1}:${id}`;
            if (!evidence.has(key))
                evidence.set(key, {
                    id,
                    label: tacticalMotifLabel(id),
                    source,
                    confidence: "high",
                    ply: index + 1,
                    moveUci: step.uci,
                    actor: step.before.turn,
                    relevance: "secondary",
                    evidence: promotion
                        ? `${step.san} promotes the pawn to a ${promotion}.`
                        : `${step.san} captures the pawn on ${makeSquare(victim as Square)} en passant, moving from ${makeSquare(step.move.from)} to ${makeSquare(step.move.to)}.`,
                });
        }
        const side = step.before.turn === "white" ? "w" : "b";
        const themes = detectStepThemes(rawSteps[index], side, { steps: rawSteps });
        const detail: SiteThemeDetail = {
            themes,
            steps: rawSteps.slice(index),
            themeStepIndex: 0,
            themeStepIndexByTheme: Object.fromEntries(
                normalizeThemeIds(themes).map((id) => [id, 0]),
            ),
        };
        const candidates = auditTacticalMotifs(
            rawSteps[index]?.fenBefore ?? "",
            suffix,
            toMotifEvidence(detail, source, sanLine?.slice(index)),
            undefined,
            {
                tablebaseEvidence,
                ...(index > 0 ? {
                      previousFen: rawSteps[index - 1]?.fenBefore,
                      previousMoveUci: replay[index - 1].uci,
                  } : {}),
            },
        );
        for (const motif of candidates.filter((m) => m.ply === 1)) {
            // Small generic gains are useful on the board being analysed,
            // not as incidental badges collected along a hypothetical PV.
            // Independently connected interference/pin/etc. payoffs above
            // remain, including contextual captures without an invented gain.
            if (index > 0 && motif.id === "hangingPiece" &&
                (motif.label === "Hanging Pawn" || (motif.value ?? Infinity) < 100)) continue;
            if (
                motif.id === "perpetualCheck" &&
                [...evidence.values()].some(
                    (previous) =>
                        previous.id === "perpetualCheck" &&
                        previous.actor === step.before.turn &&
                        (previous.ply ?? Infinity) < index + 1 &&
                        replay
                            .slice(previous.ply!, index + 1)
                            .every(
                                (entry) =>
                                    entry.before.turn !== step.before.turn || entry.after.isCheck(),
                            ),
                )
            )
                continue;
            if (
                motif.id === "forcingAttack" &&
                [...evidence.values()].some(
                    (previous) =>
                        previous.id === "forcingAttack" &&
                        previous.actor === step.before.turn &&
                        (previous.ply ?? Infinity) < index + 1,
                )
            )
                continue;
            // Recounting the same side's already-proved checking mate after
            // each reply is progress, not another tactical theme. Keep the
            // actual mating payoff and any new concrete mechanisms below.
            if (
                motif.label === "Forcing Mate" &&
                [...evidence.values()].some(
                    (previous) =>
                        previous.actor === step.before.turn &&
                        (previous.ply ?? Infinity) < index + 1 &&
                        /^mateIn\d+$/.test(previous.id) &&
                        previous.value === 10000 &&
                        !replay[(previous.ply ?? 0) - 1]?.after.isCheckmate(),
                )
            )
                continue;
            if (
                motif.id === "hangingPiece" &&
                index > 0 &&
                step.move.to === replay[index - 1].move.to &&
                (!replay[index - 1].capture || replay[index - 1].move.promotion ||
                    // The independent root proof already accounts for losing
                    // the offered piece. Acceptance is not a separate win for
                    // the defender, even when the supplied PV is truncated.
                    (provedPromotionOffer && index === 1))
            )
                continue;
            const key = `${index + 1}:${motif.id}`;
            if (evidence.has(key)) continue;
            const contextual = winningRecaptureEvidence(replay, index, motif);
            if (!contextual) continue;
            evidence.set(key, {
                ...contextual,
                source,
                ply: index + 1,
                actor: step.before.turn,
                relevance: "secondary",
            });
        }
    }
    return normalizeContinuingTactics(
        replay,
        normalizeMatingPayoffs(replay, rootMotifs[0]?.label === "Promotion Clearance"
            ? normalizePromotionClearanceTimeline(replay, [...evidence.values()])
            : [...evidence.values()]),
    )
        .filter(
            (motif) =>
                !(
                    motif.label === "Forcing Mate" &&
                    motif.relevance !== "primary" &&
                    [...evidence.values()].some(
                        (other) =>
                            other.ply === motif.ply &&
                            other.actor === motif.actor &&
                            other.verifiedCombination &&
                            other.value === 10000 &&
                            ["clearance", "discoveredCheck", "doubleCheck"].includes(other.id),
                    ) &&
                    [...evidence.values()].some(
                        (other) =>
                            other.ply === motif.ply &&
                            other.actor === motif.actor &&
                            other.relevance === "primary" &&
                            other.value === 10000 &&
                            other.label !== "Forcing Mate",
                    )
                ),
        )
        .filter(
            (motif) =>
                (motif.ply ?? 0) <= connectedPlies &&
                !(
                    motif.id === "hangingPiece" &&
                    isCompensatedContinuationCapture(replay, (motif.ply ?? 0) - 1)
                ),
        )
        .filter(
            (motif) =>
                motif.id !== "mate" ||
                ![...evidence.values()].some(
                    (other) =>
                        other.ply === motif.ply &&
                        (/Mate$/.test(other.id) || /^mateIn\d+$/.test(other.id)),
                ),
        )
        .sort((a, b) => (a.ply ?? 0) - (b.ply ?? 0));
}

function cacheKey(input: MistakeReviewMotifInput) {
    return JSON.stringify([
        MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        input.fen ?? "",
        input.bestMoveUci ?? input.bestMoveSan ?? "",
        input.playedMoveUci ?? input.playedMoveSan ?? "",
        cleanUciLine(input.pvUci).join(" "),
        (input.pvSan ?? []).map((move) => String(move).trim()).join(" "),
        cleanUciLine(input.refutationUci).join(" "),
        (input.refutationSan ?? []).map((move) => String(move).trim()).join(" "),
        input.cpLoss ?? null,
        input.cpBefore ?? null,
        input.cpAfter ?? null,
        input.refutationCandidates ?? null,
        input.bestCandidates ?? null,
        input.previousFen ?? null,
        input.previousMoveUci ?? null,
        input.tacticalHistory ?? null,
    ]);
}

/** Same-board engine nominations, not tactical certificates. A full legal PV
 * and comparable search depth are required even though only its root is taught. */
function nominatedAlternatives(
    fen: string, principalMove: string | undefined,
    candidates: TacticalReplyCandidate[] | null | undefined, maxGap: number,
) {
    const key = (value: string) => value.trim().split(/\s+/).slice(0, 4).join(" ");
    const valid = (candidates ?? []).slice(0, 3).filter(candidate =>
        Number.isInteger(candidate.depth) && candidate.depth >= 14 &&
        candidate.cp !== null && Number.isFinite(candidate.cp) &&
        key(candidate.fen) === key(fen) && candidate.pvUci.length > 0 &&
        candidate.pvUci.length <= 128 &&
        replayTacticalLine(candidate.fen, candidate.pvUci).length === candidate.pvUci.length);
    const principal = valid.find(candidate => candidate.pvUci[0] === principalMove);
    if (!principal || maxGap < 0) return [];
    return valid.filter((candidate, index) =>
        valid.findIndex(other => other.pvUci[0] === candidate.pvUci[0]) === index &&
        candidate.pvUci[0] !== principalMove && candidate.depth >= principal.depth &&
        candidate.cp! <= principal.cp! && principal.cp! - candidate.cp! <= maxGap,
    ).sort((a, b) => b.cp! - a.cp!);
}

export function classifyMistakeReviewMotifs(
    input: MistakeReviewMotifInput,
): MistakeReviewMotifClassification {
    const key = cacheKey(input);
    // Optional evidence can arrive after an earlier unknown result. Avoid
    // caching caller-owned responses or reusing an evidence-free judgement.
    const cached = input.tablebaseEvidence ? undefined : motifCache.get(key);
    if (cached) return cached;

    const fen = String(input.fen ?? "").trim();
    const bestMoveUci = cleanUci(input.bestMoveUci) ?? cleanUci(input.pvUci?.[0]);
    const playedMoveUci = cleanUci(input.playedMoveUci);
    const bestLine = normalizeLine(bestMoveUci, input.pvUci);
    const refutationLine = cleanUciLine(input.refutationUci);
    const fenAfterPlayedMove = deriveFenAfterMove(fen, playedMoveUci);
    const playedTheBestMove = Boolean(
        fenAfterPlayedMove && fenAfterPlayedMove === deriveFenAfterMove(fen, bestMoveUci),
    );

    let missedDetail: SiteThemeDetail | null = null;
    let allowedDetail: SiteThemeDetail | null = null;

    if (
        !playedTheBestMove &&
        fen &&
        bestMoveUci &&
        bestLine.length &&
        hasTacticalStart(fen, bestLine)
    ) {
        try {
            missedDetail = detectThemesDetailed({
                fen,
                side: fenSide(fen),
                best: bestMoveUci,
                bestLine,
                _analysisMode: "engine-pv",
                deltaCp: typeof input.cpLoss === "number" ? input.cpLoss : null,
                cpBefore: typeof input.cpBefore === "number" ? input.cpBefore : null,
                cpAfter: typeof input.cpAfter === "number" ? input.cpAfter : null,
            }) as SiteThemeDetail;
        } catch {
            missedDetail = null;
        }
    }

    if (
        fenAfterPlayedMove &&
        playedMoveUci &&
        refutationLine.length &&
        hasTacticalStart(fenAfterPlayedMove, refutationLine)
    ) {
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
                    analysisMode: "engine-pv",
                },
            ) as SiteThemeDetail;
        } catch {
            allowedDetail = null;
        }
    }

    const classification: MistakeReviewMotifClassification = {
        allowedMotifs: filterCompensatedRootCaptures(
            fenAfterPlayedMove ?? "",
            refutationLine,
            auditTacticalMotifs(
                fenAfterPlayedMove ?? "",
                refutationLine,
                toMotifEvidence(allowedDetail, "allowed", input.refutationSan),
                typeof input.cpAfter === "number"
                    ? input.cpAfter * (fenSide(fenAfterPlayedMove ?? "") === "w" ? 1 : -1)
                    : undefined,
                { previousFen: fen, previousMoveUci: playedMoveUci, tablebaseEvidence: input.tablebaseEvidence,
                    tacticalHistory: appendTacticalHistory(input.tacticalHistory, playedMoveUci) },
            ),
            fen,
            playedMoveUci,
        ).map((m) => ({ ...m, source: "allowed" as const })),
        missedMotifs: playedTheBestMove
            ? []
            : auditTacticalMotifs(
                  fen,
                  bestLine,
                  toMotifEvidence(missedDetail, "missed", input.pvSan),
                  typeof input.cpBefore === "number"
                      ? input.cpBefore * (fenSide(fen) === "w" ? 1 : -1)
                      : undefined,
                  { previousFen: input.previousFen, previousMoveUci: cleanUci(input.previousMoveUci), tablebaseEvidence: input.tablebaseEvidence, tacticalHistory: input.tacticalHistory },
              ).map((m) => ({ ...m, source: "missed" as const })),
        motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    } satisfies MistakeReviewMotifClassification;

    classification.missedMotifs = classification.missedMotifs.filter(motif =>
        !(motif.id === "hangingPiece" && motif.label === "Hanging Pawn" && motif.ply === 1 &&
            bestMoveUci && playedMoveUci && refutationLine[0] &&
            pawnOpportunityRemainsAfterReply(fen, bestMoveUci, playedMoveUci, refutationLine[0])));
    classification.missedMotifs = qualifyComparableCaptureChoice(
        fen, bestMoveUci, playedMoveUci, classification.missedMotifs,
    );
    // The nominated drawing capture is not missed if the played move also
    // holds the same exact draw (including an equivalent capture). A score
    // supplied by the caller cannot contradict the complete WDL evidence.
    const playedEndgameOutcome = verifiedTablebasePosition(fen, input.tablebaseEvidence)
        ?.moves.find(move => move.uci === playedMoveUci)?.outcome;
    classification.missedMotifs = classification.missedMotifs.filter(m =>
        m.id !== "drawingCapture" || playedEndgameOutcome === 1);
    const allowedMotifs = compareBestLineTacticalDefence(
        fen,
        playedMoveUci,
        refutationLine,
        bestLine,
        compareImmediateTacticalDefence(
            fen,
            bestMoveUci,
            playedMoveUci,
            refutationLine[0],
            classification.allowedMotifs,
            input.tablebaseEvidence,
        ),
    );
    const compared: MistakeReviewMotifClassification = {
        ...classification,
        allowedMotifs,
        ...(refutationLine.length && fenAfterPlayedMove
            ? {
                  allowedTimeline: selectContinuationLessons(
                      filterCompensatedRootCaptures(
                          fenAfterPlayedMove ?? "",
                          refutationLine,
                          buildTacticalTimeline(
                              fenAfterPlayedMove ?? "",
                              refutationLine,
                              "allowed",
                              allowedMotifs,
                              input.refutationSan,
                              input.tablebaseEvidence,
                          ),
                          fen,
                          playedMoveUci,
                      ),
                      allowedMotifs,
                  ),
              }
            : {}),
        ...(!playedTheBestMove && bestLine.length
            ? {
                  missedTimeline: selectContinuationLessons(
                      buildTacticalTimeline(
                          fen,
                          bestLine,
                          "missed",
                          classification.missedMotifs,
                          input.pvSan,
                          input.tablebaseEvidence,
                      ),
                      classification.missedMotifs,
                  ),
              }
            : {}),
    };

    compared.allowedMotifs = selectRootConnectedLessons(
        fenAfterPlayedMove ?? "", refutationLine, compared.allowedMotifs,
        compared.allowedTimeline ?? [],
    );
    if (compared.missedTimeline) compared.missedTimeline = compared.missedTimeline.filter(m =>
        m.id !== "drawingCapture" || m.ply !== 1 || playedEndgameOutcome === 1);
    compared.missedMotifs = selectRootConnectedLessons(
        fen, bestLine, compared.missedMotifs, compared.missedTimeline ?? [],
    );
    // A good alternative is a missed OPTION, not the principal PV or a proof
    // that it explains the entire evaluation loss. Require at least a half-pawn
    // engine improvement over the played move and proximity to the principal;
    // then independently certify its immediate mechanism. Later PV motifs and
    // comparable capture choices cannot fill a missing root explanation.
    const genericPawn = (motif: TacticalMotifEvidence) =>
        motif.id === "hangingPiece" && motif.label === "Hanging Pawn";
    const missedRoots = compared.missedMotifs.filter(isImmediateTacticalLesson);
    if (!playedTheBestMove && fenAfterPlayedMove && playedMoveUci && bestMoveUci &&
        typeof input.cpLoss === "number" && Number.isFinite(input.cpLoss) &&
        missedRoots.every(genericPawn)) {
        for (const candidate of nominatedAlternatives(fen, bestMoveUci,
            input.bestCandidates, Math.min(100, input.cpLoss - 50))) {
            const move = candidate.pvUci[0];
            if (move === playedMoveUci || deriveFenAfterMove(fen, move) === fenAfterPlayedMove) continue;
            const result = classifyPositionTacticalMotifs({
                fen, pvUci: candidate.pvUci, rootCp: candidate.cp,
                previousFen: input.previousFen, previousMoveUci: input.previousMoveUci,
                tacticalHistory: input.tacticalHistory,
                tablebaseEvidence: input.tablebaseEvidence,
            });
            const motifs = qualifyComparableCaptureChoice(fen, move, playedMoveUci,
                result.motifs.map(motif => ({ ...motif, source: "missed" as const })));
            const primary = selectImportantTacticalMotifs(motifs.filter(motif =>
                motif.moveUci === move && motif.confidence === "high" && isImmediateTacticalLesson(motif) &&
                (motif.id !== "drawingCapture" || playedEndgameOutcome === 1)), 1)[0];
            if (!primary) continue;
            if (genericPawn(primary) && refutationLine[0] &&
                pawnOpportunityRemainsAfterReply(fen, move, playedMoveUci, refutationLine[0])) continue;
            if (missedRoots.length && (primary.value ?? 0) <= Math.max(...missedRoots.map(m => m.value ?? 0))) continue;
            const step = replayTacticalLine(fen, [move])[0];
            if (!step) continue;
            compared.missedMotifs = [{ ...primary, relevance: "primary",
                alternativeLine: { fen, uci: [move], san: [step.san] } },
                ...compared.missedMotifs.map(motif => ({ ...motif, relevance: "secondary" as const }))];
            break;
        }
    }
    // An engine's preferred reply can be a harder combination than the simple
    // piece loss that explains the move. Keep a verified alternate reply OUT
    // of the preferred line's timeline, with its own board/move provenance.
    const allowedRoots = compared.allowedMotifs.filter(m => isImmediateTacticalLesson(m) &&
        (m.comparison === "prevented" || m.comparison === "reduced"));
    if (!playedTheBestMove && playedMoveUci && bestMoveUci &&
        typeof input.cpLoss === "number" && Number.isFinite(input.cpLoss) && input.cpLoss > 20 &&
        allowedRoots.every(genericPawn)) {
        // Do not turn arbitrary legal captures into causes. Keep only engine
        // alternatives preserving at least half the measured mistake swing,
        // and within one pawn of the preferred reply. No score proves a motif.
        const nominated = nominatedAlternatives(fenAfterPlayedMove ?? "", refutationLine[0],
            input.refutationCandidates, Math.min(100, input.cpLoss / 2)).map(candidate => candidate.pvUci[0]);
        const alternative = nominated.length
            ? proveAlternativeCaptureCause(fen, playedMoveUci, bestMoveUci, nominated, refutationLine[0])
            : null;
        if (alternative && (!allowedRoots.length || (alternative.value ?? 0) > Math.max(...allowedRoots.map(m => m.value ?? 0)))) compared.allowedMotifs = [alternative,
            ...compared.allowedMotifs.map(m => ({ ...m, relevance: "secondary" as const }))];
    }
    if (playedMoveUci && compared.missedMotifs.some(m => m.ply === 1 &&
        (/^mateIn\d+$/.test(m.id) || m.id === "mateThreat")) &&
        preservesVerifiedMate(replayTacticalLine(fen, [playedMoveUci, ...refutationLine]))) {
        // Winning by a different forced mate is not missing the win, even
        // if the preferred engine route is shorter. Do not replace this
        // evidence with a score threshold or leave a subordinate missed
        // fork from that same mating line to manufacture an accusation.
        compared.missedMotifs = [];
        compared.missedTimeline = [];
        // Material counterplay can remain an observed secondary event, but
        // cannot explain a lost win when this move still forces checkmate.
        compared.allowedMotifs = [];
        compared.allowedTimeline = compared.allowedTimeline?.map(m => ({ ...m, relevance: "secondary" }));
    }
    if (!input.tablebaseEvidence) motifCache.set(key, compared);
    if (motifCache.size > MOTIF_CACHE_LIMIT) {
        const oldestKey = motifCache.keys().next().value;
        if (oldestKey) motifCache.delete(oldestKey);
    }
    return compared;
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
