import { makeFen } from "chessops/fen";
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
    compareBestLineTacticalDefence,
    compareImmediateTacticalDefence,
    filterCompensatedRootCaptures,
    forcingClearanceEpisodeLength,
    hasTacticalStart,
    isCompensatedContinuationCapture,
    winningRecaptureEvidence,
    normalizeMatingPayoffs,
    normalizeContinuingTactics,
    replayTacticalLine,
} from "./causalTactics";
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
    pvSan?: string[] | null;
    previousFen?: string | null;
    previousMoveUci?: string | null;
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

const TACTICAL_MOTIF_ADAPTER_VERSION = 51;
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

/** A post-move tactic is not automatically a newly caused one. */
export function tacticalMotifPerspective(motif: TacticalMotifEvidence) {
    if (motif.source === "missed") return "Missed opportunity";
    if (motif.source === "available") return "Available tactic";
    if (motif.comparison === "persists") return "Existing danger";
    if (motif.comparison === "reduced") return "More costly";
    return motif.comparison === "prevented" ? "Overlooked threat" : "Opponent tactic";
}

function isImmediateLesson(motif: TacticalMotifEvidence | undefined) {
    return Boolean(
        motif && motif.ply === 1 && motif.confidence !== "low" && (motif.value ?? 0) >= 100,
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
    if (!isImmediateLesson(explanation.primary)) return explanation;
    const primaryMissed = explanation.primary.source === "missed";
    const other = primaryMissed ? input.allowedMotifs : input.missedMotifs;
    const secondary = selectImportantTacticalMotifs(
        other.filter(
            (motif) =>
                isImmediateLesson(motif) &&
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
    const conditionalMaterial = (motif: TacticalMotifEvidence | undefined) =>
        Boolean(motif && (motif.ply ?? 0) > 1 && !MATE_MOTIF_PATTERN.test(motif.id));
    // A proved root lesson must not lose to a motif that only appears after
    // several conditional PV replies. Preserve verified mating consequences.
    const allowedRootOverConditional = allowed?.ply === 1 && conditionalMaterial(missed);

    if (
        missed &&
        !allowedRootOverConditional &&
        (!allowed ||
            (!allowed.comparison && isImmediateLesson(missed)) ||
            allowed.comparison === "persists" ||
            (missed.ply === 1 && conditionalMaterial(allowed)) ||
            (missed.value ?? 0) > Math.max(100, (allowed.value ?? 0) * 1.5))
    ) {
        return {
            title: `What you missed: ${missed.label}`,
            text: `The better move had this tactic: ${missed.evidence}`,
            source: "missed",
            primary: missed,
        };
    }
    if (allowed) {
        if (conditionalMaterial(allowed)) {
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
        ),
        input.previousFen,
        cleanUci(input.previousMoveUci),
    );
    return {
        motifs,
        ...(motifs.length
            ? {
                  timeline: filterCompensatedRootCaptures(
                      fen,
                      bestLine,
                      buildTacticalTimeline(fen, bestLine, "available", motifs, input.pvSan),
                      input.previousFen,
                      cleanUci(input.previousMoveUci),
                  ),
              }
            : {}),
        motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    };
}

/** Each row is assessed in its own legal position. Root causes stay separate
 * so later repetitions and opponent counterplay cannot replace the lesson. */
export function buildTacticalTimeline(
    fen: string,
    line: string[],
    source: TacticalMotifSource,
    rootMotifs: TacticalMotifEvidence[],
    sanLine?: string[] | null,
) {
    const fullReplay = replayTacticalLine(fen, line);
    const promotionEpisode =
        rootMotifs.some((motif) => motif.id === "promotionCombination" && motif.ply === 1) &&
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
    const episodeReplay = terminal < 0 ? fullReplay : fullReplay.slice(0, terminal + 1);
    // The pawn-race proof searches at most eight further attacking moves.
    // A later promotion cannot join an unrelated engine continuation to it.
    const clearanceEpisode =
        rootMotifs[0]?.id === "clearance" ? forcingClearanceEpisodeLength(episodeReplay) : null;
    const replay =
        clearanceEpisode !== null
            ? episodeReplay.slice(0, clearanceEpisode)
            : promotionEpisode
              ? episodeReplay.slice(0, 17)
              : episodeReplay;
    const legalLine = replay.map((step) => step.uci);
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
        const suffix = legalLine.slice(index);
        const tacticalStart = hasTacticalStart(
            rawSteps[index]?.fenBefore ?? "",
            suffix,
            index === 0 && rootMotifs.some((motif) => motif.id === "tacticalPreparation"),
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
        if (!tacticalStart) continue;
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
        );
        for (const motif of candidates.filter((m) => m.ply === 1)) {
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
                (!replay[index - 1].capture || replay[index - 1].move.promotion)
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
        normalizeMatingPayoffs(replay, [...evidence.values()]),
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

    const classification = {
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
              ).map((m) => ({ ...m, source: "missed" as const })),
        motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    } satisfies MistakeReviewMotifClassification;

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
        ),
    );
    const compared: MistakeReviewMotifClassification = {
        ...classification,
        allowedMotifs,
        ...(classification.allowedMotifs.length
            ? {
                  allowedTimeline: filterCompensatedRootCaptures(
                      fenAfterPlayedMove ?? "",
                      refutationLine,
                      buildTacticalTimeline(
                          fenAfterPlayedMove ?? "",
                          refutationLine,
                          "allowed",
                          allowedMotifs,
                          input.refutationSan,
                      ),
                      fen,
                      playedMoveUci,
                  ),
              }
            : {}),
        ...(classification.missedMotifs.length
            ? {
                  missedTimeline: buildTacticalTimeline(
                      fen,
                      bestLine,
                      "missed",
                      classification.missedMotifs,
                      input.pvSan,
                  ),
              }
            : {}),
    };

    motifCache.set(key, compared);
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
