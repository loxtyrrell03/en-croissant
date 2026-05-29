import {
    type Color,
    type Move,
    type Role,
    type Square,
    type SquareName,
    makeSquare,
    parseSquare,
    parseUci,
} from "chessops";
import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { BestMoves, Score, ScoreValue } from "@/bindings";
import type { PlanExplorerData, PlanExplorerLine, PlanExplorerPiece } from "@/bindings";
import { detectPlanCastling, type PlanExplorerSegment } from "./planExplorer";
import { positionFromFen } from "./chessops";

export type EnginePlanCategory =
    | "castling"
    | "pieceRoute"
    | "pieceDestination"
    | "pawnBreak"
    | "sideExpansion";

export type EngineApproval = "Strong" | "OK" | "Weak" | "Unclear";
export type EnginePlanConfidence = "High" | "Medium" | "Low";

export type EnginePlanPv = {
    rank: number;
    depth: number;
    multipv: number;
    score: Score;
    evalCp: number | null;
    qualityCp: number | null;
    uciMoves: string[];
    sanMoves: string[];
};

export type EnginePlanEvidence = EnginePlanPv & {
    firstMove: string;
};

export type EnginePlanSignal = {
    signature: string;
    category: EnginePlanCategory;
    label: string;
    color: Color;
    role?: Role;
    routeSquares?: string[];
    routeSegments?: [string, string][];
};

export type EnginePlan = EnginePlanSignal & {
    approval: EngineApproval;
    confidence: EnginePlanConfidence;
    explanation: string;
    supportCount: number;
    supportRatio: number;
    appearsInTopPv: boolean;
    evidence: EnginePlanEvidence[];
    bestEvalCp: number | null;
    averageEvalCp: number | null;
    weightedEvalCp: number | null;
};

export type EnginePlanReport = {
    fen: string;
    totalPvs: number;
    requestedMultipv: number;
    limitLabel: string;
    pvs: EnginePlanPv[];
    plans: EnginePlan[];
};

export type EnginePlanReportOptions = {
    requestedMultipv: number;
    limitLabel: string;
};

export type EnginePlanMovePreview = {
    index: number;
    san: string;
    uci: string;
    fen: string;
    from: SquareName;
    to: SquareName;
    color: Color;
    moveNumber: number;
};

export type PlanExplorerEnginePlanMatch = {
    plan: EnginePlan;
    match: "route" | "routePrefix" | "destination" | "pawnBreak" | "expansion" | "castling";
};

type PieceState = {
    id: string;
    color: Color;
    role: Role;
    squares: string[];
    uciMoves: string[];
};
type ExpansionSide = "queenside" | "kingside" | "central";
type ExpansionSegmentMap = Record<Color, Record<ExpansionSide, [string, string][]>>;
type EngineCastlingMove = {
    side: "kingside" | "queenside";
    kingTo: SquareName;
    rookFrom: SquareName;
    rookTo: SquareName;
};

const PV_WEIGHTS = [1, 0.8, 0.65, 0.5];
const MIN_CLEAR_PVS = 3;
const MIN_STABLE_DEPTH = 6;
const NEAR_BEST_CP = 80;
const DECENT_CP = 150;
const PAWN_BREAKS: Record<Color, Set<string>> = {
    white: new Set([
        "b4",
        "b5",
        "c4",
        "c5",
        "d4",
        "d5",
        "e4",
        "e5",
        "f4",
        "f5",
        "g4",
        "g5",
        "h4",
        "h5",
    ]),
    black: new Set(["b5", "c5", "e5", "f5", "g5", "h5"]),
};
const CENTRAL_FILES = new Set(["c", "d", "e", "f"]);
const QUEENSIDE_FILES = new Set(["a", "b", "c"]);
const KINGSIDE_FILES = new Set(["f", "g", "h"]);
const CENTRAL_EXPANSION_FILES = new Set(["d", "e"]);
const SQUARE_PATTERN = /^[a-h][1-8]$/;

export function buildEnginePlanReport(
    fen: string,
    bestMoves: BestMoves[],
    options: EnginePlanReportOptions,
): EnginePlanReport {
    const sideToMove = sideToMoveFromFen(fen);
    const pvs = bestMoves
        .slice()
        .sort((a, b) => a.multipv - b.multipv)
        .map((line, index) => toEnginePlanPv(line, index + 1, sideToMove));

    const rootBestQuality = bestRootQuality(pvs);
    const grouped = new Map<string, EnginePlanSignal & { evidence: EnginePlanEvidence[] }>();

    for (const pv of pvs) {
        const signals = extractPlansFromPv(fen, pv);
        for (const signal of signals) {
            const existing = grouped.get(signal.signature);
            const evidence = { ...pv, firstMove: pv.sanMoves[0] ?? pv.uciMoves[0] ?? "" };
            if (existing) {
                existing.evidence.push(evidence);
            } else {
                grouped.set(signal.signature, {
                    ...signal,
                    evidence: [evidence],
                });
            }
        }
    }

    const plans = Array.from(grouped.values())
        .map((group) => scorePlan(group, pvs.length, rootBestQuality))
        .sort(comparePlans);

    return {
        fen,
        totalPvs: pvs.length,
        requestedMultipv: options.requestedMultipv,
        limitLabel: options.limitLabel,
        pvs,
        plans,
    };
}

export function extractPlansFromPv(fen: string, pv: Pick<EnginePlanPv, "uciMoves">) {
    const [pos] = positionFromFen(fen);
    if (!pos) return [];

    const pieceStates = new Map<string, PieceState>();
    const squareToPieceId = new Map<string, string>();
    const pawnMovementFiles: Record<Color, Set<string>> = {
        white: new Set(),
        black: new Set(),
    };
    const pawnExpansionSegments: ExpansionSegmentMap = {
        white: {
            queenside: [],
            kingside: [],
            central: [],
        },
        black: {
            queenside: [],
            kingside: [],
            central: [],
        },
    };
    const signals = new Map<string, EnginePlanSignal>();

    initializePieces(pos, pieceStates, squareToPieceId);

    for (const uci of pv.uciMoves) {
        const move = parseUci(uci);
        if (!move || !isNormalMove(move)) break;

        const from = makeSquare(move.from);
        const to = makeSquare(move.to);
        if (!from || !to) break;

        const piece = pos.board.get(move.from);
        if (!piece) break;

        const castle = piece.role === "king" ? engineCastlingMove(pos, move, piece.color) : null;
        const destination = castle?.kingTo ?? to;
        const pieceId = squareToPieceId.get(from) ?? makePieceId(piece.color, piece.role, from);
        let state = pieceStates.get(pieceId);
        if (!state) {
            state = {
                id: pieceId,
                color: piece.color,
                role: piece.role,
                squares: [from],
                uciMoves: [],
            };
            pieceStates.set(pieceId, state);
        }

        state.squares.push(destination);
        state.uciMoves.push(uci);
        if (move.promotion) {
            state.role = move.promotion;
        }

        if (piece.role === "pawn") {
            recordPawnSignals(piece.color, from, destination, pos, signals);
            pawnMovementFiles[piece.color].add(destination[0]);
            recordPawnExpansionSegment(piece.color, from, destination, pawnExpansionSegments);
        }

        if (castle) {
            addSignal(signals, {
                signature: `castling:${piece.color}:${castle.side}`,
                category: "castling",
                label: `${capitalize(piece.color)} castles ${castle.side}`,
                color: piece.color,
                role: "king",
                routeSquares: [from, castle.kingTo],
            });
            const rookId = squareToPieceId.get(castle.rookFrom);
            moveTrackedCastlingRook(castle, uci, pieceStates, rookId);
            squareToPieceId.delete(from);
            squareToPieceId.delete(to);
            squareToPieceId.delete(castle.kingTo);
            squareToPieceId.delete(castle.rookFrom);
            squareToPieceId.delete(castle.rookTo);
            squareToPieceId.set(castle.kingTo, pieceId);
            if (rookId) {
                squareToPieceId.set(castle.rookTo, rookId);
            }
            pos.play(move);
            continue;
        }

        squareToPieceId.delete(from);
        squareToPieceId.delete(to);
        squareToPieceId.set(destination, pieceId);
        pos.play(move);
    }

    for (const state of pieceStates.values()) {
        if (!isRoutePiece(state.role) || state.squares.length < 2) continue;

        const finalSquare = state.squares[state.squares.length - 1];
        const movedAtLeastTwice = state.squares.length >= 3;
        const interestingDestination = isInterestingDestination(
            state.role,
            state.color,
            finalSquare,
        );

        if (movedAtLeastTwice) {
            addSignal(signals, {
                signature: `piece_route:${state.color}:${formatRouteToken(state.role, state.squares)}`,
                category: "pieceRoute",
                label: `${capitalize(state.color)} ${state.role} route ${formatRouteToken(
                    state.role,
                    state.squares,
                )}`,
                color: state.color,
                role: state.role,
                routeSquares: state.squares,
            });
        }

        if (!movedAtLeastTwice && interestingDestination) {
            addSignal(signals, {
                signature: `piece_destination:${state.color}:${state.role}:${finalSquare}`,
                category: "pieceDestination",
                label: `${capitalize(state.color)} ${state.role} reaches ${finalSquare}`,
                color: state.color,
                role: state.role,
                routeSquares: state.squares,
            });
        }
    }

    for (const color of ["white", "black"] as const) {
        recordSideExpansionSignals(
            color,
            pawnMovementFiles[color],
            pawnExpansionSegments[color],
            signals,
        );
    }

    return Array.from(signals.values());
}

export function categoryLabel(category: EnginePlanCategory) {
    switch (category) {
        case "castling":
            return "Castling";
        case "pieceRoute":
            return "Piece route";
        case "pieceDestination":
            return "Destination";
        case "pawnBreak":
            return "Pawn break";
        case "sideExpansion":
            return "Expansion";
    }
}

export function engineReportToPlanExplorerData(report: EnginePlanReport): PlanExplorerData {
    const pieces = new Map<string, PlanExplorerPiece>();
    let maxPlies = 0;

    for (const plan of report.plans) {
        const routeSegments = toPlanSegments(plan.routeSegments);
        const routeSquares = plan.routeSquares ?? flattenSegments(routeSegments);
        if (routeSquares.length < 2 && routeSegments.length === 0) continue;

        const from = routeSquares[0];
        const role = plan.role ?? "pawn";
        const key =
            plan.category === "sideExpansion"
                ? `${plan.signature}:${from}`
                : `${plan.color}:${role}:${from}`;
        const line: PlanExplorerLine & { segments?: PlanExplorerSegment[] } = {
            squares: routeSquares,
            san: plan.evidence[0]?.sanMoves ?? [],
            uci: plan.evidence[0]?.uciMoves ?? [],
            games: plan.supportCount,
            white: 0,
            draw: 0,
            black: 0,
        };
        if (routeSegments.length > 0) {
            line.segments = routeSegments;
        }
        maxPlies = Math.max(maxPlies, line.uci.length, routeSegments.length);

        const existing = pieces.get(key);
        if (existing) {
            existing.total += plan.supportCount;
            existing.lines.push(line);
        } else {
            pieces.set(key, {
                color: plan.color,
                role,
                from,
                total: plan.supportCount,
                lines: [line],
            });
        }
    }

    return {
        fen: report.fen,
        total_games: report.totalPvs,
        sampled_games: report.totalPvs,
        max_plies: maxPlies,
        pieces: Array.from(pieces.values())
            .map((piece) => ({
                ...piece,
                lines: piece.lines.sort((a, b) => b.games - a.games),
            }))
            .sort((a, b) => b.total - a.total || a.from.localeCompare(b.from)),
    };
}

export function getPvMovePreviews(
    fen: string,
    uciMoves: string[],
    sanMoves: string[] = [],
): EnginePlanMovePreview[] {
    const [pos] = positionFromFen(fen);
    if (!pos) return [];

    const fields = fen.trim().split(/\s+/);
    let moveNumber = Number(fields[5] ?? "1");
    if (!Number.isFinite(moveNumber) || moveNumber < 1) {
        moveNumber = 1;
    }

    const previews: EnginePlanMovePreview[] = [];
    for (const [index, uci] of uciMoves.entries()) {
        const move = parseUci(uci);
        if (!move || !isNormalMove(move)) break;

        const from = makeSquare(move.from);
        const to = makeSquare(move.to);
        if (!from || !to) break;

        const color = pos.turn;
        pos.play(move);
        previews.push({
            index,
            san: sanMoves[index] ?? uci,
            uci,
            fen: makeFen(pos.toSetup()),
            from,
            to,
            color,
            moveNumber,
        });

        if (color === "black") {
            moveNumber += 1;
        }
    }

    return previews;
}

export function formatEvalCp(cp: number | null) {
    if (cp === null) return "n/a";
    const value = Math.abs(cp / 100).toFixed(2);
    if (cp > 0) return `+${value}`;
    if (cp < 0) return `-${value}`;
    return "0.00";
}

export function formatScoreValue(score: ScoreValue) {
    if (score.type === "mate") {
        const prefix = score.value > 0 ? "+" : score.value < 0 ? "-" : "";
        return `${prefix}M${Math.abs(score.value)}`;
    }
    return formatEvalCp(score.value);
}

export function getPlanExplorerLineEnginePlan(
    piece: Pick<PlanExplorerPiece, "color" | "role">,
    line: PlanExplorerLine,
    report: EnginePlanReport | null,
): PlanExplorerEnginePlanMatch | null {
    if (!report) return null;

    const color = toColor(piece.color);
    const role = toRole(piece.role);
    const squares = line.squares.filter((square): square is SquareName => !!toSquareName(square));
    if (!color || !role || squares.length < 2) return null;

    const firstSquare = squares[0];
    const lastSquare = squares[squares.length - 1];
    const exactRouteSignature = `piece_route:${color}:${formatRouteToken(role, squares)}`;
    const exactRoutePlan = report.plans.find((plan) => plan.signature === exactRouteSignature);
    if (exactRoutePlan) {
        return { plan: exactRoutePlan, match: "route" };
    }

    const prefixRoutePlans = report.plans.filter(
        (plan) =>
            plan.category === "pieceRoute" &&
            plan.color === color &&
            plan.role === role &&
            !!plan.routeSquares &&
            startsWithRoute(plan.routeSquares, squares),
    );
    const prefixRoutePlan = strongestPlan(prefixRoutePlans);
    if (prefixRoutePlan) {
        return { plan: prefixRoutePlan, match: "routePrefix" };
    }

    if (role === "king") {
        const lineCastling = detectPlanCastling(line, piece.color);
        const castlingPlan = strongestPlan(
            report.plans.filter(
                (plan) =>
                    plan.category === "castling" &&
                    plan.color === color &&
                    ((!!plan.routeSquares && startsWithRoute(plan.routeSquares, squares)) ||
                        (!!lineCastling &&
                            plan.signature === `castling:${color}:${lineCastling.side}`)),
            ),
        );
        if (castlingPlan) {
            return { plan: castlingPlan, match: "castling" };
        }
    }

    if (role === "pawn") {
        const pawnBreakPlan = report.plans.find(
            (plan) => plan.signature === `pawn_break:${color}:${lastSquare}`,
        );
        if (pawnBreakPlan) {
            return { plan: pawnBreakPlan, match: "pawnBreak" };
        }

        const expansionPlan = strongestPlan(
            report.plans.filter(
                (plan) =>
                    plan.category === "sideExpansion" &&
                    plan.color === color &&
                    plan.routeSegments?.some(
                        ([from, to]) => from === firstSquare && to === lastSquare,
                    ),
            ),
        );
        if (expansionPlan) {
            return { plan: expansionPlan, match: "expansion" };
        }
    }

    const destinationPlan = report.plans.find(
        (plan) => plan.signature === `piece_destination:${color}:${role}:${lastSquare}`,
    );
    if (destinationPlan) {
        return { plan: destinationPlan, match: "destination" };
    }

    return null;
}

export function enginePlanStrengthScore(plan: EnginePlan | null | undefined) {
    if (!plan) return -1;
    return (
        engineApprovalScore(plan.approval) * 100_000 +
        engineConfidenceScore(plan.confidence) * 10_000 +
        plan.supportCount * 100 +
        (plan.appearsInTopPv ? 50 : 0) +
        (plan.supportRatio || 0)
    );
}

export function engineApprovalScore(approval: EngineApproval) {
    switch (approval) {
        case "Strong":
            return 3;
        case "OK":
            return 2;
        case "Unclear":
            return 1;
        case "Weak":
            return 0;
    }
}

export function engineConfidenceScore(confidence: EnginePlanConfidence) {
    switch (confidence) {
        case "High":
            return 3;
        case "Medium":
            return 2;
        case "Low":
            return 1;
    }
}

function toEnginePlanPv(line: BestMoves, rank: number, sideToMove: Color): EnginePlanPv {
    const evalCp = line.score.value.type === "cp" ? line.score.value.value : null;
    return {
        rank,
        depth: line.depth,
        multipv: line.multipv,
        score: line.score,
        evalCp,
        qualityCp: evalCp === null ? null : qualityForSide(evalCp, sideToMove),
        uciMoves: line.uciMoves,
        sanMoves: line.sanMoves,
    };
}

function scorePlan(
    group: EnginePlanSignal & { evidence: EnginePlanEvidence[] },
    totalPvs: number,
    rootBestQuality: number | null,
): EnginePlan {
    const supportCount = group.evidence.length;
    const supportRatio = totalPvs > 0 ? supportCount / totalPvs : 0;
    const appearsInTopPv = group.evidence.some((line) => line.rank === 1);
    const cpEvidence = group.evidence.filter((line) => line.evalCp !== null);
    const qualityEvidence = group.evidence.filter((line) => line.qualityCp !== null);
    const hasMateOrMissingEval = cpEvidence.length !== group.evidence.length;
    const lowDepth = group.evidence.some((line) => line.depth > 0 && line.depth < MIN_STABLE_DEPTH);
    const weightedEvalCp = weightedAverageCp(group.evidence, "evalCp");
    const averageEvalCp = averageCp(group.evidence, "evalCp");
    const bestEvalCp = bestSupportingEvalCp(group.evidence);
    const weightedQualityCp = weightedAverageCp(group.evidence, "qualityCp");
    const nearBest =
        rootBestQuality !== null &&
        weightedQualityCp !== null &&
        weightedQualityCp >= rootBestQuality - NEAR_BEST_CP;
    const decent =
        rootBestQuality !== null &&
        weightedQualityCp !== null &&
        weightedQualityCp >= rootBestQuality - DECENT_CP;
    const mainlyWorse =
        rootBestQuality !== null &&
        weightedQualityCp !== null &&
        weightedQualityCp < rootBestQuality - DECENT_CP;

    let approval: EngineApproval;
    if (
        totalPvs < MIN_CLEAR_PVS ||
        hasMateOrMissingEval ||
        lowDepth ||
        qualityEvidence.length !== group.evidence.length
    ) {
        approval = "Unclear";
    } else if (appearsInTopPv && supportRatio >= 0.5) {
        approval = "Strong";
    } else if (supportRatio >= 0.6 && nearBest) {
        approval = "Strong";
    } else if (supportRatio >= 0.3 || appearsInTopPv || decent) {
        approval = "OK";
    } else if (supportRatio < 0.3 && !appearsInTopPv && mainlyWorse) {
        approval = "Weak";
    } else {
        approval = "Unclear";
    }

    return {
        ...group,
        approval,
        confidence: confidenceForPlan(appearsInTopPv, supportRatio),
        explanation: explanationForPlan(approval, {
            totalPvs,
            hasMateOrMissingEval,
            lowDepth,
            appearsInTopPv,
            nearBest,
        }),
        supportCount,
        supportRatio,
        appearsInTopPv,
        evidence: group.evidence.sort((a, b) => a.rank - b.rank),
        bestEvalCp,
        averageEvalCp,
        weightedEvalCp,
    };
}

function confidenceForPlan(appearsInTopPv: boolean, supportRatio: number): EnginePlanConfidence {
    if (appearsInTopPv && supportRatio >= 0.5) return "High";
    if (appearsInTopPv || supportRatio >= 0.3) return "Medium";
    return "Low";
}

function explanationForPlan(
    approval: EngineApproval,
    context: {
        totalPvs: number;
        hasMateOrMissingEval: boolean;
        lowDepth: boolean;
        appearsInTopPv: boolean;
        nearBest: boolean;
    },
) {
    if (approval === "Unclear") {
        if (context.totalPvs < MIN_CLEAR_PVS) {
            return "There are not enough PVs to judge this plan confidently.";
        }
        if (context.hasMateOrMissingEval) {
            return "Mate scores or missing evals make the raw CP comparison awkward.";
        }
        if (context.lowDepth) {
            return "The analysis depth is still low, so treat this as provisional.";
        }
        return "The supporting PVs give mixed evidence for this plan.";
    }

    if (approval === "Strong") {
        if (context.appearsInTopPv && context.nearBest) {
            return "Stockfish's top lines commonly include this plan, and supporting lines maintain the evaluation.";
        }
        if (context.appearsInTopPv) {
            return "Stockfish's top lines commonly include this plan.";
        }
        return "Several top lines include this plan, and their evaluations stay close to the preferred lines.";
    }

    if (approval === "OK") {
        return context.appearsInTopPv
            ? "This appears in PV1, though the support is not broad enough for Strong."
            : "Stockfish includes this plan in a meaningful share of its preferred lines.";
    }

    return "This plan appears only in lower-ranked lines and lacks support from PV1.";
}

function comparePlans(a: EnginePlan, b: EnginePlan) {
    const approvalDiff = approvalRank(a.approval) - approvalRank(b.approval);
    if (approvalDiff !== 0) return approvalDiff;
    if (a.supportCount !== b.supportCount) return b.supportCount - a.supportCount;
    if (a.appearsInTopPv !== b.appearsInTopPv) return a.appearsInTopPv ? -1 : 1;
    return a.label.localeCompare(b.label);
}

function approvalRank(approval: EngineApproval) {
    switch (approval) {
        case "Strong":
            return 0;
        case "OK":
            return 1;
        case "Unclear":
            return 2;
        case "Weak":
            return 3;
    }
}

function weightedAverageCp(evidence: EnginePlanEvidence[], key: "evalCp" | "qualityCp") {
    let weighted = 0;
    let totalWeight = 0;
    for (const line of evidence) {
        const value = line[key];
        if (value === null) continue;

        const weight = pvWeight(line.rank);
        weighted += value * weight;
        totalWeight += weight;
    }

    return totalWeight > 0 ? weighted / totalWeight : null;
}

function averageCp(evidence: EnginePlanEvidence[], key: "evalCp" | "qualityCp") {
    const values = evidence
        .map((line) => line[key])
        .filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bestSupportingEvalCp(evidence: EnginePlanEvidence[]) {
    const cpLines = evidence.filter((line) => line.evalCp !== null && line.qualityCp !== null);
    if (cpLines.length === 0) return null;
    return cpLines.reduce((best, line) => (line.qualityCp! > best.qualityCp! ? line : best)).evalCp;
}

function bestRootQuality(pvs: EnginePlanPv[]) {
    const values = pvs
        .map((line) => line.qualityCp)
        .filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    return Math.max(...values);
}

function pvWeight(rank: number) {
    return PV_WEIGHTS[rank - 1] ?? 0.4;
}

function sideToMoveFromFen(fen: string): Color {
    return fen.split(/\s+/)[1] === "b" ? "black" : "white";
}

function qualityForSide(cp: number, sideToMove: Color) {
    return sideToMove === "white" ? cp : -cp;
}

function initializePieces(
    pos: NonNullable<ReturnType<typeof positionFromFen>[0]>,
    pieceStates: Map<string, PieceState>,
    squareToPieceId: Map<string, string>,
) {
    for (let square = 0; square < 64; square += 1) {
        const typedSquare = square as Square;
        const piece = pos.board.get(typedSquare);
        const squareName = makeSquare(typedSquare);
        if (!piece || !squareName) continue;

        const id = makePieceId(piece.color, piece.role, squareName);
        pieceStates.set(id, {
            id,
            color: piece.color,
            role: piece.role,
            squares: [squareName],
            uciMoves: [],
        });
        squareToPieceId.set(squareName, id);
    }
}

function makePieceId(color: Color, role: Role, square: string) {
    return `${color}:${role}:${square}`;
}

function isNormalMove(move: Move): move is Move & { from: Square; to: Square; promotion?: Role } {
    return "from" in move && "to" in move;
}

function engineCastlingMove(
    pos: NonNullable<ReturnType<typeof positionFromFen>[0]>,
    move: Move & { from: Square; to: Square },
    color: Color,
): EngineCastlingMove | null {
    const side = castlingSide(pos, move);
    if (!side) return null;

    const rank = color === "white" ? "1" : "8";
    const kingTo = toSquareName(`${side === "h" ? "g" : "c"}${rank}`);
    const rookTo = toSquareName(`${side === "h" ? "f" : "d"}${rank}`);
    const defaultRookFrom = toSquareName(`${side}${rank}`);
    const moveTo = makeSquare(move.to);
    const moveToPiece = pos.board.get(move.to);
    const rookFrom =
        moveTo && moveToPiece?.color === color && moveToPiece.role === "rook"
            ? moveTo
            : defaultRookFrom;

    if (!kingTo || !rookTo || !rookFrom) return null;

    return {
        side: side === "h" ? "kingside" : "queenside",
        kingTo,
        rookFrom,
        rookTo,
    };
}

function moveTrackedCastlingRook(
    castle: EngineCastlingMove,
    uci: string,
    pieceStates: Map<string, PieceState>,
    rookId: string | undefined,
) {
    if (!rookId) return;

    const rookState = pieceStates.get(rookId);
    if (!rookState || rookState.squares[rookState.squares.length - 1] === castle.rookTo) return;

    rookState.squares.push(castle.rookTo);
    rookState.uciMoves.push(uci);
}

function recordPawnSignals(
    color: Color,
    origin: string,
    destination: string,
    pos: NonNullable<ReturnType<typeof positionFromFen>[0]>,
    signals: Map<string, EnginePlanSignal>,
) {
    if (!PAWN_BREAKS[color].has(destination)) return;
    if (!attacksEnemyPawn(color, destination, pos)) return;

    const file = destination[0];
    const kind = CENTRAL_FILES.has(file)
        ? "central break"
        : KINGSIDE_FILES.has(file)
          ? "kingside pawn break"
          : "queenside pawn break";
    const moveLabel = color === "black" ? `...${destination}` : destination;
    addSignal(signals, {
        signature: `pawn_break:${color}:${destination}`,
        category: "pawnBreak",
        label: `${capitalize(color)} plays ${moveLabel} ${kind}`,
        color,
        role: "pawn",
        routeSquares: [origin, destination],
    });
}

function attacksEnemyPawn(
    color: Color,
    destination: string,
    pos: NonNullable<ReturnType<typeof positionFromFen>[0]>,
) {
    for (const squareName of pawnAttackSquares(color, destination)) {
        const square = parseSquare(squareName);
        if (square === undefined) continue;

        const piece = pos.board.get(square);
        if (piece?.role === "pawn" && piece.color !== color) {
            return true;
        }
    }

    return false;
}

function pawnAttackSquares(color: Color, square: string) {
    const fileIndex = square.charCodeAt(0) - "a".charCodeAt(0);
    const rank = Number(square[1]);
    const nextRank = color === "white" ? rank + 1 : rank - 1;
    if (!Number.isInteger(rank) || nextRank < 1 || nextRank > 8) return [];

    const squares: string[] = [];
    for (const fileDelta of [-1, 1]) {
        const nextFileIndex = fileIndex + fileDelta;
        if (nextFileIndex < 0 || nextFileIndex > 7) continue;

        squares.push(`${String.fromCharCode("a".charCodeAt(0) + nextFileIndex)}${nextRank}`);
    }

    return squares;
}

function recordSideExpansionSignals(
    color: Color,
    files: Set<string>,
    segments: Record<ExpansionSide, [string, string][]>,
    signals: Map<string, EnginePlanSignal>,
) {
    const queenside = countFiles(files, QUEENSIDE_FILES);
    const kingside = countFiles(files, KINGSIDE_FILES);
    const center = countFiles(files, CENTRAL_EXPANSION_FILES);

    if (queenside >= 2) {
        addSideExpansion(color, "queenside", segments.queenside, signals);
    }
    if (kingside >= 2) {
        addSideExpansion(color, "kingside", segments.kingside, signals);
    }
    if (center >= 2) {
        addSideExpansion(color, "central", segments.central, signals);
    }
}

function addSideExpansion(
    color: Color,
    side: "queenside" | "kingside" | "central",
    segments: [string, string][],
    signals: Map<string, EnginePlanSignal>,
) {
    addSignal(signals, {
        signature: `side_expansion:${color}:${side}`,
        category: "sideExpansion",
        label: `${capitalize(color)} ${side === "central" ? "central break" : `${side} expansion`}`,
        color,
        role: "pawn",
        routeSegments: uniqueSegments(segments),
    });
}

function recordPawnExpansionSegment(
    color: Color,
    origin: string,
    destination: string,
    segments: ExpansionSegmentMap,
) {
    const file = destination[0];
    const segment: [string, string] = [origin, destination];

    if (QUEENSIDE_FILES.has(file)) {
        segments[color].queenside.push(segment);
    }
    if (KINGSIDE_FILES.has(file)) {
        segments[color].kingside.push(segment);
    }
    if (CENTRAL_EXPANSION_FILES.has(file)) {
        segments[color].central.push(segment);
    }
}

function countFiles(files: Set<string>, group: Set<string>) {
    let count = 0;
    for (const file of files) {
        if (group.has(file)) count += 1;
    }
    return count;
}

function uniqueSegments(segments: [string, string][]) {
    const seen = new Set<string>();
    const unique: [string, string][] = [];

    for (const [from, to] of segments) {
        const key = `${from}-${to}`;
        if (seen.has(key)) continue;

        seen.add(key);
        unique.push([from, to]);
    }

    return unique;
}

function toPlanSegments(segments: [string, string][] | undefined): PlanExplorerSegment[] {
    return (
        segments
            ?.map(([from, to]) => {
                const fromSquare = toSquareName(from);
                const toSquare = toSquareName(to);
                return fromSquare && toSquare
                    ? ([fromSquare, toSquare] as PlanExplorerSegment)
                    : null;
            })
            .filter((segment): segment is PlanExplorerSegment => !!segment) ?? []
    );
}

function flattenSegments(segments: PlanExplorerSegment[]) {
    return segments.flatMap(([from, to]) => [from, to]);
}

function toSquareName(square: string): SquareName | null {
    return SQUARE_PATTERN.test(square) ? (square as SquareName) : null;
}

function startsWithRoute(route: string[], prefix: string[]) {
    if (prefix.length > route.length) return false;
    return prefix.every((square, index) => route[index] === square);
}

function strongestPlan(plans: EnginePlan[]) {
    return (
        plans
            .slice()
            .sort(
                (a, b) =>
                    enginePlanStrengthScore(b) - enginePlanStrengthScore(a) ||
                    b.supportCount - a.supportCount ||
                    a.label.localeCompare(b.label),
            )[0] ?? null
    );
}

function toColor(value: string): Color | null {
    return value === "white" || value === "black" ? value : null;
}

function toRole(value: string): Role | null {
    switch (value) {
        case "pawn":
        case "knight":
        case "bishop":
        case "rook":
        case "queen":
        case "king":
            return value;
        default:
            return null;
    }
}

function addSignal(signals: Map<string, EnginePlanSignal>, signal: EnginePlanSignal) {
    signals.set(signal.signature, signal);
}

function isRoutePiece(role: Role) {
    return role !== "pawn" && role !== "king";
}

function isInterestingDestination(role: Role, color: Color, square: string) {
    if (!isRoutePiece(role)) return false;

    const file = square[0];
    const rank = Number(square[1]);
    if (CENTRAL_FILES.has(file)) return true;
    if (role === "rook" || role === "queen") return true;
    return color === "white" ? rank >= 4 : rank <= 5;
}

function formatRouteToken(role: Role, squares: string[]) {
    return `${pieceLetter(role)}${squares.join("-")}`;
}

function pieceLetter(role: Role) {
    switch (role) {
        case "knight":
            return "N";
        case "bishop":
            return "B";
        case "rook":
            return "R";
        case "queen":
            return "Q";
        case "king":
            return "K";
        case "pawn":
            return "";
    }
}

function capitalize(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
