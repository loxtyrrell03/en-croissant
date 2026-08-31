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
    | "pawnSetup"
    | "pawnBreak"
    | "sideExpansion";

export type EngineApproval = "Strong" | "OK" | "Weak" | "Unclear";
export type EnginePlanConfidence = "High" | "Medium" | "Low";
export type EnginePlanContext = "rootChoice" | "continuation" | "opponentResponse";

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
    // 0-based ply within this PV at which the owning signal/setup became true;
    // null when the signal is root-established or its ply is unavailable.
    completionPly: number | null;
    context: EnginePlanContext;
};

export type EnginePlanSignal = {
    signature: string;
    category: EnginePlanCategory;
    label: string;
    color: Color;
    role?: Role;
    routeSquares?: string[];
    routeSegments?: [string, string][];
    origin?: "pv" | "root" | "template";
    // 0-based index into pv.uciMoves of the move that first established this
    // signal within its PV. Undefined for root-origin signals, which are not
    // evidence that a setup is formed by a future PV move.
    ply?: number;
};

export type EnginePlan = EnginePlanSignal & {
    context: EnginePlanContext;
    approval: EngineApproval;
    confidence: EnginePlanConfidence;
    explanation: string;
    supportCount: number;
    supportRatio: number;
    appearsInTopPv: boolean;
    directSupportCount: number;
    directSupportRatio: number;
    directAppearsInTopPv: boolean;
    conditionalSupportCount: number;
    conditionalSupportRatio: number;
    conditionalAppearsInTopPv: boolean;
    evidence: EnginePlanEvidence[];
    bestEvalCp: number | null;
    averageEvalCp: number | null;
    weightedEvalCp: number | null;
    bestQualityCp: number | null;
    averageQualityCp: number | null;
    weightedQualityCp: number | null;
    bestCpLoss: number | null;
    weightedCpLoss: number | null;
    medianCompletionPly: number | null;
};

export type EnginePlanSetup = {
    signature: string;
    label: string;
    archetype: string | null;
    color: Color;
    plans: EnginePlan[];
    context: EnginePlanContext;
    approval: EngineApproval;
    confidence: EnginePlanConfidence;
    explanation: string;
    supportCount: number;
    supportRatio: number;
    appearsInTopPv: boolean;
    directSupportCount: number;
    directSupportRatio: number;
    directAppearsInTopPv: boolean;
    conditionalSupportCount: number;
    conditionalSupportRatio: number;
    conditionalAppearsInTopPv: boolean;
    evidence: EnginePlanEvidence[];
    bestEvalCp: number | null;
    averageEvalCp: number | null;
    weightedEvalCp: number | null;
    bestQualityCp: number | null;
    averageQualityCp: number | null;
    weightedQualityCp: number | null;
    bestCpLoss: number | null;
    weightedCpLoss: number | null;
    medianCompletionPly: number | null;
};

export type EnginePlanReport = {
    fen: string;
    totalPvs: number;
    requestedMultipv: number;
    limitLabel: string;
    pvs: EnginePlanPv[];
    plans: EnginePlan[];
    displayPlans: EnginePlan[];
    setups: EnginePlanSetup[];
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
    match:
        | "route"
        | "routePrefix"
        | "destination"
        | "pawnSetup"
        | "pawnBreak"
        | "expansion"
        | "castling";
};

type PieceState = {
    id: string;
    color: Color;
    role: Role;
    squares: string[];
    uciMoves: string[];
    // Parallel to uciMoves: the 0-based PV index of each tracked move, so the
    // last entry gives the ply at which the piece reached its final square.
    moveIndices: number[];
};
type ExpansionSide = "queenside" | "kingside" | "central";
type ExpansionSegment = { from: string; to: string; ply: number };
type ExpansionSegmentMap = Record<Color, Record<ExpansionSide, ExpansionSegment[]>>;
type EngineCastlingMove = {
    side: "kingside" | "queenside";
    kingTo: SquareName;
    rookFrom: SquareName;
    rookTo: SquareName;
};
// PVs whose quality stays within VIABLE_PV_CP of the best root line. Support is
// measured against these rather than every requested (often junk) multipv line.
type ViablePvContext = {
    totalViable: number;
    viableRanks: Set<number>;
};

const PV_WEIGHTS = [1, 0.8, 0.65, 0.5];
const MIN_CLEAR_PVS = 3;
const MIN_STABLE_DEPTH = 6;
const NEAR_BEST_CP = 80;
const DECENT_CP = 150;
const VIABLE_PV_CP = 80;
const ENGINE_SETUP_FEATURED_SIGNALS_PER_COLOR = 7;
const ENGINE_SETUP_MIN_PLANS = 3;
const ENGINE_SETUP_MAX_PLANS = 6;
const ENGINE_SETUP_MAX_RESULTS_PER_COLOR = 4;
const ENGINE_PLAN_MAX_ROWS_PER_COLOR = 4;
const ENGINE_PLAN_MAX_DESTINATION_ROWS_PER_COLOR = 2;
// Color-symmetric: the attacksEnemyPawn gate prevents false positives, so both
// colors share one set covering every {b..h}x{4,5} break square.
const PAWN_BREAKS: Set<string> = new Set([
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
]);
// Single table shared by PV-observed pawn moves and root structure detection.
const PAWN_SETUP_SQUARES: Record<Color, Set<string>> = {
    white: new Set(["b3", "c3", "d3", "e3", "f3", "g3", "b4", "c4", "d4", "e4", "f4"]),
    black: new Set(["b6", "c6", "d6", "e6", "f6", "g6", "b5", "c5", "d5", "e5", "f5"]),
};
const ROOT_SETUP_PIECE_SQUARES: Record<Color, Partial<Record<Role, Set<string>>>> = {
    white: {
        knight: new Set(["c3", "d2", "e2", "f3"]),
        bishop: new Set(["b2", "d3", "e2", "f4", "g2", "g5"]),
    },
    black: {
        knight: new Set(["c6", "d7", "e7", "f6"]),
        bishop: new Set(["b7", "d6", "e7", "f5", "g4", "g7"]),
    },
};
const CENTRAL_FILES = new Set(["c", "d", "e", "f"]);
const QUEENSIDE_FILES = new Set(["a", "b", "c"]);
const KINGSIDE_FILES = new Set(["f", "g", "h"]);
const CENTRAL_EXPANSION_FILES = new Set(["d", "e"]);
const FIANCHETTO_BISHOP_SQUARES: Record<Color, Set<string>> = {
    white: new Set(["b2", "g2"]),
    black: new Set(["b7", "g7"]),
};
const SQUARE_PATTERN = /^[a-h][1-8]$/;
type EngineSetupGroup = {
    keySignatures: string[];
    signatures: Set<string>;
    color: Color;
    slots: Map<string, string>;
    evidence: EnginePlanEvidence[];
};
type EngineSetupTemplateComponent = {
    signature: string;
    category: EnginePlanCategory;
    label: string;
    color: Color;
    role?: Role;
    routeSquares?: string[];
    origin?: "template";
};
type EngineSetupTemplate = {
    id: string;
    archetype: string;
    color: Color;
    components: EngineSetupTemplateComponent[];
    required: string[];
    // Template candidates are scored only from these distinctive PV-backed signatures.
    preferredEvidence: string[];
};

const ENGINE_SETUP_TEMPLATES: EngineSetupTemplate[] = [
    {
        id: "white-catalan",
        archetype: "Catalan",
        color: "white",
        required: ["pawn_setup:white:d4", "pawn_setup:white:c4"],
        preferredEvidence: ["pawn_setup:white:g3", "piece_destination:white:bishop:g2"],
        components: [
            setupPawnComponent("white", "d2", "d4"),
            setupPawnComponent("white", "c2", "c4"),
            setupPieceComponent("white", "knight", "g1", "f3"),
            setupPawnComponent("white", "g2", "g3"),
            setupPieceComponent("white", "bishop", "f1", "g2"),
            setupCastlingComponent("white", "kingside"),
        ],
    },
    {
        id: "white-london",
        archetype: "London",
        color: "white",
        required: ["pawn_setup:white:d4"],
        preferredEvidence: ["piece_destination:white:bishop:f4"],
        components: [
            setupPawnComponent("white", "d2", "d4"),
            setupPieceComponent("white", "bishop", "c1", "f4"),
            setupPieceComponent("white", "knight", "g1", "f3"),
            setupPawnComponent("white", "e2", "e3"),
            setupPawnComponent("white", "c2", "c3"),
            setupCastlingComponent("white", "kingside"),
        ],
    },
    {
        id: "white-colle",
        archetype: "Colle",
        color: "white",
        required: ["pawn_setup:white:d4"],
        preferredEvidence: ["piece_destination:white:bishop:d3", "pawn_setup:white:e3"],
        components: [
            setupPawnComponent("white", "d2", "d4"),
            setupPieceComponent("white", "knight", "g1", "f3"),
            setupPawnComponent("white", "e2", "e3"),
            setupPieceComponent("white", "bishop", "f1", "d3"),
            setupPawnComponent("white", "c2", "c3"),
            setupCastlingComponent("white", "kingside"),
        ],
    },
    {
        id: "white-english-fianchetto",
        archetype: "English fianchetto",
        color: "white",
        required: ["pawn_setup:white:c4"],
        preferredEvidence: ["pawn_setup:white:g3", "piece_destination:white:bishop:g2"],
        components: [
            setupPawnComponent("white", "c2", "c4"),
            setupPawnComponent("white", "g2", "g3"),
            setupPieceComponent("white", "bishop", "f1", "g2"),
            setupPieceComponent("white", "knight", "b1", "c3"),
            setupPieceComponent("white", "knight", "g1", "f3"),
            setupCastlingComponent("white", "kingside"),
        ],
    },
    {
        id: "black-kings-indian",
        archetype: "King's Indian",
        color: "black",
        required: ["piece_destination:black:knight:f6"],
        preferredEvidence: ["pawn_setup:black:g6", "piece_destination:black:bishop:g7"],
        components: [
            setupPieceComponent("black", "knight", "g8", "f6"),
            setupPawnComponent("black", "g7", "g6"),
            setupPieceComponent("black", "bishop", "f8", "g7"),
            setupPawnComponent("black", "d7", "d6"),
            setupCastlingComponent("black", "kingside"),
        ],
    },
    {
        id: "black-queens-indian",
        archetype: "Queen's Indian",
        color: "black",
        required: ["piece_destination:black:knight:f6", "pawn_setup:black:e6"],
        preferredEvidence: ["pawn_setup:black:b6", "piece_destination:black:bishop:b7"],
        components: [
            setupPieceComponent("black", "knight", "g8", "f6"),
            setupPawnComponent("black", "e7", "e6"),
            setupPawnComponent("black", "b7", "b6"),
            setupPieceComponent("black", "bishop", "c8", "b7"),
            setupPieceComponent("black", "bishop", "f8", "e7"),
            setupCastlingComponent("black", "kingside"),
        ],
    },
    {
        id: "black-slav",
        archetype: "Slav",
        color: "black",
        required: ["pawn_setup:black:d5"],
        preferredEvidence: ["pawn_setup:black:c6", "piece_destination:black:bishop:f5"],
        components: [
            setupPawnComponent("black", "d7", "d5"),
            setupPawnComponent("black", "c7", "c6"),
            setupPieceComponent("black", "knight", "g8", "f6"),
            setupPieceComponent("black", "bishop", "c8", "f5"),
            setupPawnComponent("black", "e7", "e6"),
            setupCastlingComponent("black", "kingside"),
        ],
    },
    {
        id: "white-kia",
        archetype: "King's Indian Attack",
        color: "white",
        required: ["piece_destination:white:bishop:g2", "pawn_setup:white:d3"],
        preferredEvidence: ["pawn_setup:white:d3", "piece_destination:white:bishop:g2"],
        components: [
            setupPieceComponent("white", "knight", "g1", "f3"),
            setupPawnComponent("white", "g2", "g3"),
            setupPieceComponent("white", "bishop", "f1", "g2"),
            setupPawnComponent("white", "d2", "d3"),
            setupPawnComponent("white", "e2", "e4"),
            setupPieceComponent("white", "knight", "b1", "d2"),
            setupCastlingComponent("white", "kingside"),
        ],
    },
    {
        id: "white-torre",
        archetype: "Torre",
        color: "white",
        required: ["pawn_setup:white:d4", "piece_destination:white:bishop:g5"],
        preferredEvidence: ["piece_destination:white:bishop:g5"],
        components: [
            setupPawnComponent("white", "d2", "d4"),
            setupPieceComponent("white", "knight", "g1", "f3"),
            setupPieceComponent("white", "bishop", "c1", "g5"),
            setupPawnComponent("white", "e2", "e3"),
            setupPawnComponent("white", "c2", "c3"),
            setupPieceComponent("white", "knight", "b1", "d2"),
            setupCastlingComponent("white", "kingside"),
        ],
    },
    {
        id: "white-stonewall",
        archetype: "Stonewall",
        color: "white",
        required: ["pawn_setup:white:d4", "pawn_setup:white:f4"],
        preferredEvidence: ["pawn_setup:white:f4", "piece_destination:white:bishop:d3"],
        components: [
            setupPawnComponent("white", "d2", "d4"),
            setupPawnComponent("white", "e2", "e3"),
            setupPawnComponent("white", "f2", "f4"),
            setupPieceComponent("white", "bishop", "f1", "d3"),
            setupPieceComponent("white", "knight", "g1", "f3"),
            setupPawnComponent("white", "c2", "c3"),
            setupCastlingComponent("white", "kingside"),
        ],
    },
    {
        id: "white-jobava",
        archetype: "Jobava London",
        color: "white",
        required: [
            "pawn_setup:white:d4",
            "piece_destination:white:knight:c3",
            "piece_destination:white:bishop:f4",
        ],
        preferredEvidence: [
            "piece_destination:white:knight:c3",
            "piece_destination:white:bishop:f4",
        ],
        components: [
            setupPawnComponent("white", "d2", "d4"),
            setupPieceComponent("white", "knight", "b1", "c3"),
            setupPieceComponent("white", "bishop", "c1", "f4"),
            setupPawnComponent("white", "e2", "e3"),
        ],
    },
    {
        id: "black-stonewall-dutch",
        archetype: "Stonewall Dutch",
        color: "black",
        required: ["pawn_setup:black:d5", "pawn_setup:black:f5"],
        preferredEvidence: ["pawn_setup:black:f5", "piece_destination:black:bishop:d6"],
        components: [
            setupPawnComponent("black", "f7", "f5"),
            setupPawnComponent("black", "e7", "e6"),
            setupPawnComponent("black", "d7", "d5"),
            setupPieceComponent("black", "bishop", "f8", "d6"),
            setupPieceComponent("black", "knight", "g8", "f6"),
            setupPawnComponent("black", "c7", "c6"),
            setupCastlingComponent("black", "kingside"),
        ],
    },
    {
        id: "black-hedgehog",
        archetype: "Hedgehog",
        color: "black",
        required: ["pawn_setup:black:b6", "pawn_setup:black:d6", "pawn_setup:black:e6"],
        preferredEvidence: ["piece_destination:black:bishop:b7", "pawn_setup:black:d6"],
        components: [
            setupPawnComponent("black", "b7", "b6"),
            setupPieceComponent("black", "bishop", "c8", "b7"),
            setupPawnComponent("black", "e7", "e6"),
            setupPawnComponent("black", "d7", "d6"),
            setupPieceComponent("black", "bishop", "f8", "e7"),
            setupPieceComponent("black", "knight", "g8", "f6"),
            setupPieceComponent("black", "knight", "b8", "d7"),
            setupCastlingComponent("black", "kingside"),
        ],
    },
];

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
    const viable = computeViablePvs(pvs, rootBestQuality);
    const grouped = new Map<string, EnginePlanSignal & { evidence: EnginePlanEvidence[] }>();
    const signalsByPv = new Map<number, EnginePlanSignal[]>();
    const rootSetupSignals = extractRootSetupSignals(fen);

    for (const pv of pvs) {
        const signals = extractPlansFromPv(fen, pv);
        signalsByPv.set(pv.rank, signals);
        for (const signal of signals) {
            const existing = grouped.get(signal.signature);
            const evidence = {
                ...pv,
                firstMove: pv.sanMoves[0] ?? pv.uciMoves[0] ?? "",
                completionPly: signal.ply ?? null,
                context: contextForEvidence(signal.color, sideToMove, signal.ply ?? 0),
            };
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
        .map((group) => scorePlan(group, pvs.length, rootBestQuality, viable))
        .sort(comparePlans);
    const displayPlans = selectDisplayEnginePlans(plans);
    const setups = buildEnginePlanSetups(
        fen,
        signalsByPv,
        rootSetupSignals,
        plans,
        pvs,
        rootBestQuality,
        viable,
    );

    return {
        fen,
        totalPvs: pvs.length,
        requestedMultipv: options.requestedMultipv,
        limitLabel: options.limitLabel,
        pvs,
        plans,
        displayPlans,
        setups,
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

    for (const [moveIndex, uci] of pv.uciMoves.entries()) {
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
                moveIndices: [],
            };
            pieceStates.set(pieceId, state);
        }

        state.squares.push(destination);
        state.uciMoves.push(uci);
        state.moveIndices.push(moveIndex);
        if (move.promotion) {
            state.role = move.promotion;
        }

        if (piece.role === "pawn") {
            recordPawnSignals(piece.color, from, destination, pos, signals, moveIndex);
            pawnMovementFiles[piece.color].add(destination[0]);
            recordPawnExpansionSegment(
                piece.color,
                from,
                destination,
                pawnExpansionSegments,
                moveIndex,
            );
        }

        if (castle) {
            addSignal(signals, {
                signature: `castling:${piece.color}:${castle.side}`,
                category: "castling",
                label: `${capitalize(piece.color)} castles ${castle.side}`,
                color: piece.color,
                role: "king",
                routeSquares: [from, castle.kingTo],
                ply: moveIndex,
            });
            const rookId = squareToPieceId.get(castle.rookFrom);
            moveTrackedCastlingRook(castle, uci, moveIndex, pieceStates, rookId);
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
        // Established when the piece reaches its final square, i.e. its last move.
        const arrivalPly = state.moveIndices[state.moveIndices.length - 1];

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
                ply: arrivalPly,
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
                ply: arrivalPly,
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

function extractRootSetupSignals(fen: string) {
    const [pos] = positionFromFen(fen);
    if (!pos) return [];

    const signals = new Map<string, EnginePlanSignal>();
    for (const color of ["white", "black"] as const) {
        for (const square of PAWN_SETUP_SQUARES[color]) {
            const piece = pieceAt(pos, square);
            if (piece?.color !== color || piece.role !== "pawn") continue;

            addSignal(signals, {
                signature: `pawn_setup:${color}:${square}`,
                category: "pawnSetup",
                label: `${capitalize(color)} has ${formatPawnSetupSquare(
                    color,
                    square,
                )} ${pawnSetupKind(color, square)}`,
                color,
                role: "pawn",
                routeSquares: [square],
                origin: "root",
            });
        }

        for (const [role, squares] of Object.entries(ROOT_SETUP_PIECE_SQUARES[color]) as [
            Role,
            Set<string>,
        ][]) {
            for (const square of squares) {
                const piece = pieceAt(pos, square);
                if (piece?.color !== color || piece.role !== role) continue;

                addSignal(signals, {
                    signature: `piece_destination:${color}:${role}:${square}`,
                    category: "pieceDestination",
                    label: `${capitalize(color)} ${role} is already on ${square}`,
                    color,
                    role,
                    routeSquares: [square],
                    origin: "root",
                });
            }
        }

        recordRootCastlingSignal(color, pos, signals);
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
        case "pawnSetup":
            return "Pawn setup";
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
        setups: [],
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

        const pawnSetupPlan = report.plans.find(
            (plan) => plan.signature === `pawn_setup:${color}:${lastSquare}`,
        );
        if (pawnSetupPlan) {
            return { plan: pawnSetupPlan, match: "pawnSetup" };
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

function buildEnginePlanSetups(
    fen: string,
    signalsByPv: Map<number, EnginePlanSignal[]>,
    rootSetupSignals: EnginePlanSignal[],
    plans: EnginePlan[],
    pvs: EnginePlanPv[],
    rootBestQuality: number | null,
    viable: ViablePvContext,
): EnginePlanSetup[] {
    const rootSide = sideToMoveFromFen(fen);
    const plansBySignature = new Map(plans.map((plan) => [plan.signature, plan]));
    const rootSignalsBySignature = new Map(
        rootSetupSignals.map((signal) => [signal.signature, signal]),
    );
    const rootSignatures = new Set(rootSignalsBySignature.keys());
    const pvsByRank = new Map(pvs.map((pv) => [pv.rank, pv]));
    const grouped: EngineSetupGroup[] = [];

    for (const [rank, signals] of signalsByPv) {
        const pv = pvsByRank.get(rank);
        if (!pv) continue;

        // completionPly is resolved per-group after the final setup signatures are
        // known (see the grouped.map below); this per-PV line is a placeholder.
        const evidence: EnginePlanEvidence = {
            ...pv,
            firstMove: pv.sanMoves[0] ?? pv.uciMoves[0] ?? "",
            completionPly: null,
            context: "continuation",
        };
        const uniqueSignals = uniqueSetupSignals([...rootSetupSignals, ...signals]);
        const byColor = groupSignalsByColor(uniqueSignals);

        for (const [color, colorSignals] of byColor) {
            const featured = colorSignals
                .filter(
                    (signal) =>
                        plansBySignature.has(signal.signature) ||
                        rootSignalsBySignature.has(signal.signature),
                )
                .sort(compareSetupSignals)
                .slice(0, ENGINE_SETUP_FEATURED_SIGNALS_PER_COLOR);
            if (featured.length < ENGINE_SETUP_MIN_PLANS) continue;

            const { keySignatures, setupSignatures, slots } =
                consolidateEngineSetupSignals(featured);
            if (setupSignatures.length < ENGINE_SETUP_MIN_PLANS) continue;
            if (setupSignatures.every((signature) => rootSignatures.has(signature))) continue;

            const existing = grouped.find(
                (group) =>
                    group.color === color &&
                    sameStringArray(group.keySignatures, keySignatures) &&
                    compatibleSetupSlots(group.slots, slots),
            );
            if (existing) {
                for (const signature of setupSignatures) {
                    existing.signatures.add(signature);
                }
                mergeSetupSlots(existing.slots, slots);
                if (!existing.evidence.some((line) => line.rank === evidence.rank)) {
                    existing.evidence.push(evidence);
                }
            } else {
                grouped.push({
                    keySignatures,
                    signatures: new Set(setupSignatures),
                    color,
                    slots,
                    evidence: [evidence],
                });
            }
        }
    }

    const pvSetups = grouped
        .map((group) => {
            const signatures = Array.from(group.signatures).sort((a, b) => a.localeCompare(b));
            // Resolve each supporting PV's completion ply against this setup's final
            // signature set. Root-established anchors do not establish the setup in
            // a PV and therefore cannot turn it into an evaluated root choice.
            const evidence = group.evidence.flatMap((line) => {
                const completionPly = setupEvidenceCompletionPly(
                    signatures,
                    signalsByPv.get(line.rank) ?? [],
                    rootSignatures,
                );
                return completionPly === null
                    ? []
                    : [
                          {
                              ...line,
                              completionPly,
                              context: contextForSetupEvidence(group.color, rootSide),
                          },
                      ];
            });
            const setupPlans = signatures
                .map((signature) => {
                    const plan = plansBySignature.get(signature);
                    if (plan) return plan;

                    const rootSignal = rootSignalsBySignature.get(signature);
                    return rootSignal
                        ? scoreRootSetupAnchor(
                              rootSignal,
                              evidence,
                              pvs.length,
                              rootBestQuality,
                              viable,
                          )
                        : null;
                })
                .filter((plan): plan is EnginePlan => !!plan)
                .sort(compareSetupPlans);
            return scoreSetup(
                signatures,
                group.color,
                setupPlans,
                evidence,
                pvs.length,
                rootBestQuality,
                viable,
            );
        })
        .filter((setup): setup is EnginePlanSetup => !!setup);
    const candidateSetups = buildCandidateEngineSetups(
        fen,
        rootSetupSignals,
        plansBySignature,
        pvs,
        rootBestQuality,
        viable,
    ).filter((setup) => setup.plans.every((plan) => plan.origin !== "template"));

    const deduped = dedupeEngineSetups([...pvSetups, ...candidateSetups]);
    const merged = mergeContainedSetups(deduped, { totalPvs: pvs.length, rootBestQuality, viable });
    return (["white", "black"] as const)
        .flatMap((color) =>
            merged
                .filter((setup) => setup.color === color)
                .filter((setup) =>
                    isHighConfidenceEngineSetup(setup, pvs.length, viable, rootSignatures),
                )
                .sort(compareSetups)
                .slice(0, ENGINE_SETUP_MAX_RESULTS_PER_COLOR),
        )
        .sort(compareSetups);
}

function isHighConfidenceEngineSetup(
    setup: EnginePlanSetup,
    totalPvs: number,
    viable: ViablePvContext,
    rootSignatures: Set<string>,
) {
    const exactRanks = new Set(setup.evidence.map((line) => line.rank));
    const eligibleRanks =
        viable.totalViable > 0
            ? new Set([...exactRanks].filter((rank) => viable.viableRanks.has(rank)))
            : exactRanks;
    const denominator = viable.totalViable > 0 ? viable.totalViable : totalPvs;
    const exactSupportRatio = denominator > 0 ? eligibleRanks.size / denominator : 0;
    if (eligibleRanks.size < 2 || exactSupportRatio < 0.6) return false;
    if (setup.plans.some((plan) => plan.origin === "template")) return false;

    const salientAnchors = setup.plans.filter(
        (plan) =>
            plan.category === "castling" ||
            (plan.category === "pieceDestination" &&
                (plan.role === "bishop" || plan.role === "knight")) ||
            (plan.category === "pawnSetup" && isFianchettoPlan(plan)),
    );
    if (salientAnchors.length < 2) return false;

    return setup.plans.some((plan) => {
        if (
            plan.origin !== "pv" ||
            plan.ply === undefined ||
            rootSignatures.has(plan.signature) ||
            (plan.category !== "pawnSetup" && plan.category !== "castling")
        ) {
            return false;
        }

        const recurringEligibleRanks = new Set(
            plan.evidence.filter((line) => eligibleRanks.has(line.rank)).map((line) => line.rank),
        );
        return recurringEligibleRanks.size >= 2;
    });
}

function isFianchettoPlan(plan: EnginePlan) {
    const target = plan.routeSquares?.at(-1);
    return (
        plan.category === "pawnSetup" &&
        (target === "b3" || target === "g3" || target === "b6" || target === "g6")
    );
}

function buildCandidateEngineSetups(
    fen: string,
    rootSetupSignals: EnginePlanSignal[],
    plansBySignature: Map<string, EnginePlan>,
    pvs: EnginePlanPv[],
    rootBestQuality: number | null,
    viable: ViablePvContext,
) {
    const [pos] = positionFromFen(fen);
    if (!pos) return [];
    const rootSide = sideToMoveFromFen(fen);

    const rootSignalsBySignature = new Map(
        rootSetupSignals.map((signal) => [signal.signature, signal]),
    );
    const anchoredSignatures = new Set([
        ...rootSignalsBySignature.keys(),
        ...plansBySignature.keys(),
    ]);
    const candidates: EnginePlanSetup[] = [];
    for (const template of ENGINE_SETUP_TEMPLATES) {
        const signals = materializeSetupTemplateSignals(template, pos, rootSignalsBySignature);
        if (signals.length < ENGINE_SETUP_MIN_PLANS) continue;

        const signatures = sortedSignalSignatures(signals);
        if (!template.required.every((signature) => anchoredSignatures.has(signature))) continue;

        const evidence = collectTemplateEvidence(template, plansBySignature).map((line) => ({
            ...line,
            context: contextForSetupEvidence(template.color, rootSide),
        }));
        if (evidence.length === 0) continue;

        const setupPlans = signals
            .map((signal) => {
                const plan = plansBySignature.get(signal.signature);
                if (plan) return plan;

                return scoreRootSetupAnchor(signal, evidence, pvs.length, rootBestQuality, viable);
            })
            .sort(compareSetupPlans);
        const setup = scoreSetup(
            signatures,
            template.color,
            setupPlans,
            evidence,
            pvs.length,
            rootBestQuality,
            viable,
            template.archetype,
        );
        if (setup) candidates.push(setup);
    }

    return candidates;
}

function materializeSetupTemplateSignals(
    template: EngineSetupTemplate,
    pos: NonNullable<ReturnType<typeof positionFromFen>[0]>,
    rootSignalsBySignature: Map<string, EnginePlanSignal>,
) {
    const signals: EnginePlanSignal[] = [];
    for (const component of template.components) {
        const rootSignal = rootSignalsBySignature.get(component.signature);
        if (rootSignal) {
            signals.push(rootSignal);
            continue;
        }

        if (setupTemplateComponentAvailable(component, pos)) {
            signals.push(component);
        }
    }

    return uniqueSetupSignals(signals);
}

function setupTemplateComponentAvailable(
    component: EngineSetupTemplateComponent,
    pos: NonNullable<ReturnType<typeof positionFromFen>[0]>,
) {
    const route = component.routeSquares;
    const from = route?.[0];
    const to = route?.at(-1);
    if (!from || !to || !component.role) return false;

    const destinationPiece = pieceAt(pos, to);
    if (destinationPiece?.color === component.color && destinationPiece.role === component.role) {
        return true;
    }

    const originPiece = pieceAt(pos, from);
    if (originPiece?.color !== component.color || originPiece.role !== component.role) {
        return false;
    }

    if (component.category === "castling") {
        const rank = component.color === "white" ? "1" : "8";
        const rook = pieceAt(pos, `h${rank}`);
        return rook?.color === component.color && rook.role === "rook";
    }

    return true;
}

function collectTemplateEvidence(
    template: EngineSetupTemplate,
    plansBySignature: Map<string, EnginePlan>,
) {
    return collectEvidenceForSignatures(template.preferredEvidence, plansBySignature);
}

function collectEvidenceForSignatures(
    signatures: string[],
    plansBySignature: Map<string, EnginePlan>,
) {
    const evidence = new Map<number, EnginePlanEvidence>();
    for (const signature of signatures) {
        const plan = plansBySignature.get(signature);
        if (!plan) continue;

        for (const line of plan.evidence) {
            evidence.set(line.rank, line);
        }
    }

    return Array.from(evidence.values()).sort((a, b) => a.rank - b.rank);
}

function dedupeEngineSetups(setups: EnginePlanSetup[]) {
    const bySignature = new Map<string, EnginePlanSetup>();
    for (const setup of setups) {
        const existing = bySignature.get(setup.signature);
        if (!existing || compareSetups(setup, existing) < 0) {
            bySignature.set(setup.signature, setup);
        }
    }
    return Array.from(bySignature.values());
}

type SetupScoreContext = {
    totalPvs: number;
    rootBestQuality: number | null;
    viable: ViablePvContext;
};

// Collapse a setup whose plan-signature set is a strict subset of another
// same-color setup into that superset, unioning their supporting evidence.
// Processing smallest-first lets subset chains fully collapse into the largest.
function mergeContainedSetups(
    setups: EnginePlanSetup[],
    ctx: SetupScoreContext,
): EnginePlanSetup[] {
    const dropped = new Set<EnginePlanSetup>();
    const smallestFirst = setups.slice().sort((a, b) => a.plans.length - b.plans.length);

    for (const subset of smallestFirst) {
        if (dropped.has(subset)) continue;

        const subsetSignatures = new Set(subset.plans.map((plan) => plan.signature));
        const subsetSlots = setupSlots(subset.plans);

        let target: EnginePlanSetup | null = null;
        for (const candidate of setups) {
            if (candidate === subset || dropped.has(candidate)) continue;
            if (candidate.color !== subset.color) continue;

            const candidateSignatures = new Set(candidate.plans.map((plan) => plan.signature));
            if (!isStrictSubset(subsetSignatures, candidateSignatures)) continue;
            if (!compatibleSetupSlots(setupSlots(candidate.plans), subsetSlots)) continue;

            if (
                !target ||
                candidate.plans.length > target.plans.length ||
                (candidate.plans.length === target.plans.length &&
                    compareSetups(candidate, target) < 0)
            ) {
                target = candidate;
            }
        }

        if (!target) continue;

        rescoreMergedSetup(target, unionEvidenceByRank(target.evidence, subset.evidence), ctx);
        dropped.add(subset);
    }

    return setups.filter((setup) => !dropped.has(setup));
}

function rescoreMergedSetup(
    setup: EnginePlanSetup,
    evidence: EnginePlanEvidence[],
    ctx: SetupScoreContext,
) {
    const support = adjustSetupSupportForInferredComponents(
        scoreEngineEvidence(evidence, ctx.totalPvs, ctx.rootBestQuality, ctx.viable, "setup"),
        setup.plans,
    );
    const archetype = setupArchetype(setup.color, setup.plans);
    setup.archetype = archetype;
    setup.label = setupLabel(setup.color, setup.plans, archetype);
    Object.assign(setup, support);
}

function isStrictSubset(subset: Set<string>, superset: Set<string>) {
    if (subset.size >= superset.size) return false;
    for (const value of subset) {
        if (!superset.has(value)) return false;
    }
    return true;
}

function unionEvidenceByRank(a: EnginePlanEvidence[], b: EnginePlanEvidence[]) {
    const byRank = new Map<number, EnginePlanEvidence>();
    for (const line of a) byRank.set(line.rank, line);
    for (const line of b) {
        if (!byRank.has(line.rank)) byRank.set(line.rank, line);
    }
    return Array.from(byRank.values()).sort((x, y) => x.rank - y.rank);
}

function consolidateEngineSetupSignals(signals: EnginePlanSignal[]) {
    const structural = signals.filter(isStructuralSetupSignal);
    const extras = signals.filter((signal) => !isStructuralSetupSignal(signal));
    const keySignals =
        structural.length > 0 ? structural : signals.slice(0, ENGINE_SETUP_MAX_PLANS);
    const setupSignals = [...structural, ...extras].slice(0, ENGINE_SETUP_MAX_PLANS);

    return {
        keySignatures: sortedSignalSignatures(keySignals),
        setupSignatures: sortedSignalSignatures(setupSignals),
        slots: setupSlots(setupSignals),
    };
}

function isStructuralSetupSignal(signal: EnginePlanSignal) {
    return (
        signal.category === "pawnSetup" ||
        signal.category === "pawnBreak" ||
        signal.category === "sideExpansion"
    );
}

function sortedSignalSignatures(signals: EnginePlanSignal[]) {
    return signals.map((signal) => signal.signature).sort((a, b) => a.localeCompare(b));
}

function setupSlots(signals: EnginePlanSignal[]) {
    const slots = new Map<string, string>();
    for (const signal of signals) {
        const slot = setupSlot(signal);
        if (slot) slots.set(slot.key, slot.value);
    }
    return slots;
}

function setupSlot(signal: EnginePlanSignal) {
    if (isStructuralSetupSignal(signal)) return null;

    if (signal.category === "castling") {
        return { key: `king:${signal.color}`, value: signal.signature };
    }

    if (signal.category === "pieceDestination" || signal.category === "pieceRoute") {
        const from = signal.routeSquares?.[0];
        const destination = signal.routeSquares?.at(-1);
        if (!signal.role || !from || !destination || from === destination) return null;

        return {
            key: `piece:${signal.color}:${signal.role}:${from}`,
            value: destination,
        };
    }

    return null;
}

function compatibleSetupSlots(existing: Map<string, string>, incoming: Map<string, string>) {
    for (const [key, value] of incoming) {
        const existingValue = existing.get(key);
        if (existingValue !== undefined && existingValue !== value) return false;
    }
    return true;
}

function mergeSetupSlots(existing: Map<string, string>, incoming: Map<string, string>) {
    for (const [key, value] of incoming) {
        existing.set(key, value);
    }
}

function sameStringArray(a: string[], b: string[]) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function uniqueSetupSignals(signals: EnginePlanSignal[]) {
    const unique = new Map<string, EnginePlanSignal>();
    for (const signal of signals) {
        unique.set(signal.signature, signal);
    }
    return Array.from(unique.values());
}

function groupSignalsByColor(signals: EnginePlanSignal[]) {
    const byColor = new Map<Color, EnginePlanSignal[]>();
    for (const signal of signals) {
        const group = byColor.get(signal.color) ?? [];
        group.push(signal);
        byColor.set(signal.color, group);
    }
    return byColor;
}

function scoreSetup(
    signatures: string[],
    color: Color,
    plans: EnginePlan[],
    evidence: EnginePlanEvidence[],
    totalPvs: number,
    rootBestQuality: number | null,
    viable: ViablePvContext,
    forcedArchetype: string | null = null,
): EnginePlanSetup | null {
    if (plans.length < ENGINE_SETUP_MIN_PLANS || evidence.length === 0) return null;

    const support = adjustSetupSupportForInferredComponents(
        scoreEngineEvidence(evidence, totalPvs, rootBestQuality, viable, "setup"),
        plans,
    );
    const archetype = forcedArchetype ?? setupArchetype(color, plans);
    return {
        signature: signatures.join("||"),
        label: setupLabel(color, plans, archetype),
        archetype,
        color,
        plans,
        ...support,
    };
}

function adjustSetupSupportForInferredComponents(
    support: ReturnType<typeof scoreEngineEvidence>,
    plans: EnginePlan[],
): ReturnType<typeof scoreEngineEvidence> {
    const inferredComponents = plans.filter((plan) => plan.origin === "template").length;
    if (inferredComponents === 0) return support;

    const directPvComponents = plans.filter((plan) => plan.origin === "pv").length;
    let approval = support.approval;
    let confidence = support.confidence;

    if (directPvComponents === 0) {
        approval = "Unclear";
    } else if (approval === "Strong" && directPvComponents < 2) {
        approval = "OK";
    }

    if (confidence === "High" && directPvComponents < plans.length - inferredComponents) {
        confidence = "Medium";
    }
    if (confidence === "High" && directPvComponents < 2) {
        confidence = "Medium";
    }

    const inferredLabel =
        inferredComponents === 1 ? "1 component is" : `${inferredComponents} components are`;
    return {
        ...support,
        approval,
        confidence,
        explanation: `${support.explanation} ${inferredLabel} inferred from the setup template rather than directly shown in the engine PVs.`,
    };
}

function scoreRootSetupAnchor(
    signal: EnginePlanSignal,
    evidence: EnginePlanEvidence[],
    totalPvs: number,
    rootBestQuality: number | null,
    viable: ViablePvContext,
): EnginePlan {
    return {
        ...signal,
        ...scoreEngineEvidence(evidence, totalPvs, rootBestQuality, viable, "setup"),
    };
}

function scoreEngineEvidence(
    evidence: EnginePlanEvidence[],
    totalPvs: number,
    rootBestQuality: number | null,
    viable: ViablePvContext,
    subject: "plan" | "setup",
) {
    const directEvidence = evidence.filter((line) => line.context === "rootChoice");
    const conditionalEvidence = evidence.filter((line) => line.context !== "rootChoice");
    const directSupportCount = directEvidence.length;
    const directSupportRatio = totalPvs > 0 ? directSupportCount / totalPvs : 0;
    const directAppearsInTopPv = directEvidence.some((line) => line.rank === 1);
    const conditionalSupportCount = conditionalEvidence.length;
    const conditionalSupportRatio = totalPvs > 0 ? conditionalSupportCount / totalPvs : 0;
    const conditionalAppearsInTopPv = conditionalEvidence.some((line) => line.rank === 1);
    const context: EnginePlanContext =
        directEvidence.length > 0
            ? "rootChoice"
            : evidence.every((line) => line.context === "opponentResponse")
              ? "opponentResponse"
              : "continuation";
    const contextualEvidence = context === "rootChoice" ? directEvidence : conditionalEvidence;
    const supportCount = contextualEvidence.length;
    const medianCompletionPly = medianCompletionPlyOf(contextualEvidence);
    // Measure support against viable PVs (near the best eval) so junk multipv
    // lines don't dilute the ratio. Fall back to raw totals when none are viable.
    const viableSupport =
        viable.totalViable > 0
            ? contextualEvidence.filter((line) => viable.viableRanks.has(line.rank)).length
            : supportCount;
    const supportRatio =
        viable.totalViable > 0
            ? viableSupport / viable.totalViable
            : totalPvs > 0
              ? supportCount / totalPvs
              : 0;
    const appearsInTopPv = contextualEvidence.some((line) => line.rank === 1);
    // MultiPV scores evaluate root moves. A later continuation or opponent
    // response is only conditional evidence inside that line and must not
    // inherit the root move's evaluation or CP loss.
    const scoredEvidence = context === "rootChoice" ? directEvidence : [];
    const cpEvidence = scoredEvidence.filter((line) => line.evalCp !== null);
    const qualityEvidence = scoredEvidence.filter((line) => line.qualityCp !== null);
    const hasMateOrMissingEval = cpEvidence.length !== scoredEvidence.length;
    const lowDepth = scoredEvidence.some((line) => line.depth > 0 && line.depth < MIN_STABLE_DEPTH);
    const weightedEvalCp = weightedAverageCp(scoredEvidence, "evalCp", rootBestQuality);
    const averageEvalCp = averageCp(scoredEvidence, "evalCp");
    const bestEvalCp = bestSupportingEvalCp(scoredEvidence);
    const weightedQualityCp = weightedAverageCp(scoredEvidence, "qualityCp", rootBestQuality);
    const averageQualityCp = averageCp(scoredEvidence, "qualityCp");
    const bestQualityCp = bestSupportingQualityCp(scoredEvidence);
    const bestCpLoss =
        rootBestQuality !== null && bestQualityCp !== null
            ? Math.max(0, rootBestQuality - bestQualityCp)
            : null;
    const weightedCpLoss =
        rootBestQuality !== null && weightedQualityCp !== null
            ? Math.max(0, rootBestQuality - weightedQualityCp)
            : null;
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
    if (context !== "rootChoice") {
        approval = "Unclear";
    } else if (
        totalPvs < MIN_CLEAR_PVS ||
        hasMateOrMissingEval ||
        lowDepth ||
        qualityEvidence.length !== scoredEvidence.length
    ) {
        approval = "Unclear";
    } else if (directAppearsInTopPv && nearBest) {
        approval = "Strong";
    } else if (nearBest || decent) {
        approval = "OK";
    } else if (mainlyWorse) {
        approval = "Weak";
    } else {
        approval = "Unclear";
    }

    return {
        approval,
        confidence:
            context === "rootChoice"
                ? confidenceForPlan(directAppearsInTopPv, directSupportRatio)
                : supportCount >= 2 && supportRatio >= 0.5
                  ? "Medium"
                  : "Low",
        explanation: explanationForPlan(approval, context, {
            totalPvs,
            hasMateOrMissingEval,
            lowDepth,
            appearsInTopPv,
            nearBest,
            subject,
            supportCount,
        }),
        context,
        supportCount,
        supportRatio,
        appearsInTopPv,
        directSupportCount,
        directSupportRatio,
        directAppearsInTopPv,
        conditionalSupportCount,
        conditionalSupportRatio,
        conditionalAppearsInTopPv,
        evidence: evidence.slice().sort((a, b) => a.rank - b.rank),
        bestEvalCp,
        averageEvalCp,
        weightedEvalCp,
        bestQualityCp,
        averageQualityCp,
        weightedQualityCp,
        bestCpLoss,
        weightedCpLoss,
        medianCompletionPly,
    };
}

// Median 0-based completion ply across the evidence lines that carry one, with an
// even count returning the mean of the two middle values; null when none apply.
function medianCompletionPlyOf(evidence: EnginePlanEvidence[]): number | null {
    const plies = evidence
        .map((line) => line.completionPly)
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
    if (plies.length === 0) return null;

    const mid = Math.floor(plies.length / 2);
    return plies.length % 2 === 1 ? plies[mid] : (plies[mid - 1] + plies[mid]) / 2;
}

// Latest ply at which a not-already-established setup signature becomes true
// within one PV. Root-origin signatures are context only: they do not count as
// future setup evidence or as ply-zero root choices.
function setupEvidenceCompletionPly(
    signatures: string[],
    pvSignals: EnginePlanSignal[],
    rootSignatures: Set<string>,
): number | null {
    let maxPly: number | null = null;
    const setupSignatures = new Set(signatures);
    for (const signal of pvSignals) {
        if (!setupSignatures.has(signal.signature)) continue;
        if (rootSignatures.has(signal.signature)) continue;
        if (signal.origin !== "pv" || signal.ply === undefined) continue;
        maxPly = maxPly === null ? signal.ply : Math.max(maxPly, signal.ply);
    }

    return maxPly;
}

function setupLabel(color: Color, plans: EnginePlan[], archetype: string | null) {
    const names = plans.slice(0, 4).map((plan) => compactPlanLabel(plan));
    const suffix = plans.length > names.length ? ` +${plans.length - names.length}` : "";
    const prefix = archetype
        ? `${capitalize(color)} ${archetype} setup`
        : `${capitalize(color)} setup`;
    return `${prefix}: ${names.join(", ")}${suffix}`;
}

// Recognize a setup by matching it against the shared ENGINE_SETUP_TEMPLATES
// rather than hand-rolled conditions, so recognition never drifts from the
// templates used to build candidate setups.
function setupArchetype(color: Color, plans: EnginePlan[]) {
    const signatures = new Set(plans.map((plan) => plan.signature));

    let best: { template: EngineSetupTemplate; matched: number } | null = null;
    for (const template of ENGINE_SETUP_TEMPLATES) {
        if (template.color !== color) continue;
        if (!template.required.every((signature) => signatures.has(signature))) continue;
        if (!template.preferredEvidence.some((signature) => signatures.has(signature))) continue;

        const matched = template.components.filter((component) =>
            signatures.has(component.signature),
        ).length;
        if (matched < 3) continue;

        if (
            !best ||
            matched > best.matched ||
            (matched === best.matched && template.required.length > best.template.required.length)
        ) {
            best = { template, matched };
        }
    }

    return best?.template.archetype ?? null;
}

function compactPlanLabel(plan: EnginePlan) {
    switch (plan.category) {
        case "castling":
            return plan.label.replace(/^White |^Black /, "");
        case "pawnSetup":
        case "pawnBreak":
            return plan.routeSquares?.at(-1)
                ? plan.color === "black"
                    ? `...${plan.routeSquares.at(-1)}`
                    : plan.routeSquares.at(-1)!
                : plan.label;
        case "pieceDestination":
            return plan.role && plan.routeSquares?.at(-1)
                ? `${pieceLetter(plan.role)}${plan.routeSquares.at(-1)}`
                : plan.label;
        case "pieceRoute":
            return plan.role && plan.routeSquares
                ? `${pieceLetter(plan.role)}${plan.routeSquares.join("-")}`
                : plan.label;
        case "sideExpansion":
            return plan.label.replace(/^White |^Black /, "");
    }
}

function compareSetupSignals(a: EnginePlanSignal, b: EnginePlanSignal) {
    return (
        setupSignalPriority(b) - setupSignalPriority(a) || a.signature.localeCompare(b.signature)
    );
}

function setupSignalPriority(signal: EnginePlanSignal) {
    switch (signal.category) {
        case "castling":
            return 92;
        case "pawnSetup":
            return 88;
        case "pieceDestination":
            return signal.role === "bishop" || signal.role === "knight" ? 84 : 72;
        case "pawnBreak":
            return 82;
        case "sideExpansion":
            return 78;
        case "pieceRoute":
            return 74;
    }
}

function compareSetupPlans(a: EnginePlan, b: EnginePlan) {
    return setupSignalPriority(b) - setupSignalPriority(a) || a.label.localeCompare(b.label);
}

function compareSetups(a: EnginePlanSetup, b: EnginePlanSetup) {
    const approvalDiff = approvalRank(a.approval) - approvalRank(b.approval);
    if (approvalDiff !== 0) return approvalDiff;
    if (!!a.archetype !== !!b.archetype) return a.archetype ? -1 : 1;
    if (a.supportCount !== b.supportCount) return b.supportCount - a.supportCount;
    if (a.plans.length !== b.plans.length) return b.plans.length - a.plans.length;
    if (a.appearsInTopPv !== b.appearsInTopPv) return a.appearsInTopPv ? -1 : 1;
    return a.label.localeCompare(b.label);
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
    viable: ViablePvContext,
): EnginePlan {
    return {
        ...group,
        ...scoreEngineEvidence(group.evidence, totalPvs, rootBestQuality, viable, "plan"),
    };
}

function contextForEvidence(color: Color, rootSide: Color, completionPly: number) {
    if (color !== rootSide) return "opponentResponse" as const;
    return completionPly === 0 ? ("rootChoice" as const) : ("continuation" as const);
}

function contextForSetupEvidence(color: Color, rootSide: Color) {
    return color === rootSide ? ("continuation" as const) : ("opponentResponse" as const);
}

/**
 * Keep the complete evidence set for matching and setup mining while giving
 * the panel a bounded, low-noise projection. The principal root choice stays;
 * later ideas need recurrence or strategic salience in PV1. Other MultiPV
 * alternatives remain in the complete `plans` evidence set.
 */
export function selectDisplayEnginePlans(plans: EnginePlan[]) {
    const useful = plans.filter((plan) => {
        // Bare pawn-square signals remain available to setup mining but are too
        // incidental to occupy a standalone plan row, including a3/h3/b3-style
        // moves that happen to be PV1's root choice. Real breaks have their own
        // signal and evidence rules below.
        if (plan.category === "pawnSetup") return false;

        // Keep every MultiPV alternative in `plans` for integrations and setup
        // mining, but show only the principal evaluated root choice in the
        // bounded panel projection.
        if (plan.context === "rootChoice") return plan.directAppearsInTopPv;

        if (plan.category === "pieceDestination") return plan.supportCount >= 2;
        if (plan.category === "pawnBreak") {
            return plan.supportCount >= 2 || plan.appearsInTopPv;
        }
        if (plan.category === "castling") {
            return plan.appearsInTopPv && plan.supportCount >= 2;
        }

        // A wing-level expansion signature currently merges different pawn
        // pairs, so it remains internal until segment-level recurrence proves a
        // concrete plan rather than a coincidental collection of pawn moves.
        if (plan.category === "sideExpansion") return false;

        // Only a top-PV, multi-move minor-piece route is plan-like enough to
        // display once. Heavy-piece routes are commonly tactical transfers or
        // captures within the finite PV and remain available as internal data.
        if (plan.category === "pieceRoute") {
            return (
                (plan.role === "knight" || plan.role === "bishop") &&
                plan.appearsInTopPv &&
                (plan.routeSquares?.length ?? 0) >= 3
            );
        }
        return false;
    });

    return (["white", "black"] as const)
        .flatMap((color) => {
            const selected: EnginePlan[] = [];
            let destinationRows = 0;
            for (const plan of useful
                .filter((candidate) => candidate.color === color)
                .sort(compareDisplayPlans)) {
                if (
                    plan.category === "pieceDestination" &&
                    destinationRows >= ENGINE_PLAN_MAX_DESTINATION_ROWS_PER_COLOR
                ) {
                    continue;
                }
                selected.push(plan);
                if (plan.category === "pieceDestination") destinationRows += 1;
                if (selected.length === ENGINE_PLAN_MAX_ROWS_PER_COLOR) break;
            }
            return selected;
        })
        .sort(compareDisplayPlans);
}

function compareDisplayPlans(a: EnginePlan, b: EnginePlan) {
    const contextRank = (plan: EnginePlan) =>
        plan.context === "rootChoice" ? 3 : plan.context === "continuation" ? 2 : 1;
    const contextDiff = contextRank(b) - contextRank(a);
    if (contextDiff !== 0) return contextDiff;
    if (a.supportCount !== b.supportCount) return b.supportCount - a.supportCount;
    if (a.appearsInTopPv !== b.appearsInTopPv) return a.appearsInTopPv ? -1 : 1;
    const categoryDiff = setupSignalPriority(b) - setupSignalPriority(a);
    if (categoryDiff !== 0) return categoryDiff;
    return a.label.localeCompare(b.label);
}

function confidenceForPlan(appearsInTopPv: boolean, supportRatio: number): EnginePlanConfidence {
    if (appearsInTopPv && supportRatio >= 0.5) return "High";
    if (appearsInTopPv || supportRatio >= 0.3) return "Medium";
    return "Low";
}

function explanationForPlan(
    approval: EngineApproval,
    evidenceContext: EnginePlanContext,
    context: {
        totalPvs: number;
        hasMateOrMissingEval: boolean;
        lowDepth: boolean;
        appearsInTopPv: boolean;
        nearBest: boolean;
        subject: "plan" | "setup";
        supportCount: number;
    },
) {
    const subject = context.subject;
    const support = `${context.supportCount} engine line${context.supportCount === 1 ? "" : "s"}`;
    if (evidenceContext === "opponentResponse") {
        return `This opponent ${subject} appears conditionally in ${support} after the root-side choices. It is PV-supported, not an independently scored best ${subject}; robustness across other replies is unmeasured.`;
    }
    if (evidenceContext === "continuation") {
        return `This ${subject} is reached later in ${support} after earlier moves. It is a conditional PV-supported continuation, not an independently scored root choice; robustness across other replies is unmeasured.`;
    }
    if (approval === "Unclear") {
        if (context.totalPvs < MIN_CLEAR_PVS) {
            return `There are not enough PVs to judge this ${subject} confidently.`;
        }
        if (context.hasMateOrMissingEval) {
            return "Mate scores or missing evals make the raw CP comparison awkward.";
        }
        if (context.lowDepth) {
            return "The analysis depth is still low, so treat this as provisional.";
        }
        return `The supporting PVs give mixed evidence for this ${subject}.`;
    }

    if (approval === "Strong") {
        if (context.appearsInTopPv && context.nearBest) {
            return `Stockfish's top lines commonly include this ${subject}, and supporting lines maintain the evaluation.`;
        }
        if (context.appearsInTopPv) {
            return `Stockfish's top lines commonly include this ${subject}.`;
        }
        return `Several top lines include this ${subject}, and their evaluations stay close to the preferred lines.`;
    }

    if (approval === "OK") {
        return context.appearsInTopPv
            ? "This appears in PV1, though the support is not broad enough for Strong."
            : `Stockfish includes this ${subject} in a meaningful share of its preferred lines.`;
    }

    return `This ${subject} appears only in lower-ranked lines and lacks support from PV1.`;
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

function weightedAverageCp(
    evidence: EnginePlanEvidence[],
    key: "evalCp" | "qualityCp",
    rootBestQuality: number | null,
) {
    let weighted = 0;
    let totalWeight = 0;
    for (const line of evidence) {
        const value = line[key];
        if (value === null) continue;

        const weight = evalGapWeight(line, rootBestQuality);
        weighted += value * weight;
        totalWeight += weight;
    }

    return totalWeight > 0 ? weighted / totalWeight : null;
}

// Weight a supporting line by how close its eval is to the best root line rather
// than by its multipv rank. Rank-blind lines (mate/missing eval, or no root
// baseline) fall back to the legacy rank weighting.
function evalGapWeight(line: EnginePlanEvidence, rootBestQuality: number | null) {
    if (line.qualityCp === null || rootBestQuality === null) {
        return pvWeight(line.rank);
    }
    const gap = Math.max(0, rootBestQuality - line.qualityCp);
    return clamp(1 - gap / (2 * DECENT_CP), 0.2, 1);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
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

function bestSupportingQualityCp(evidence: EnginePlanEvidence[]) {
    const values = evidence
        .map((line) => line.qualityCp)
        .filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    return Math.max(...values);
}

function bestRootQuality(pvs: EnginePlanPv[]) {
    const values = pvs
        .map((line) => line.qualityCp)
        .filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    return Math.max(...values);
}

function computeViablePvs(pvs: EnginePlanPv[], rootBestQuality: number | null): ViablePvContext {
    const viableRanks = new Set<number>();
    if (rootBestQuality === null) {
        return { totalViable: 0, viableRanks };
    }
    for (const pv of pvs) {
        if (pv.qualityCp !== null && pv.qualityCp >= rootBestQuality - VIABLE_PV_CP) {
            viableRanks.add(pv.rank);
        }
    }
    return { totalViable: viableRanks.size, viableRanks };
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
            moveIndices: [],
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
    moveIndex: number,
    pieceStates: Map<string, PieceState>,
    rookId: string | undefined,
) {
    if (!rookId) return;

    const rookState = pieceStates.get(rookId);
    if (!rookState || rookState.squares[rookState.squares.length - 1] === castle.rookTo) return;

    rookState.squares.push(castle.rookTo);
    rookState.uciMoves.push(uci);
    rookState.moveIndices.push(moveIndex);
}

function recordPawnSignals(
    color: Color,
    origin: string,
    destination: string,
    pos: NonNullable<ReturnType<typeof positionFromFen>[0]>,
    signals: Map<string, EnginePlanSignal>,
    ply: number,
) {
    recordPawnSetupSignal(color, origin, destination, signals, ply);

    if (!PAWN_BREAKS.has(destination)) return;
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
        ply,
    });
}

function recordPawnSetupSignal(
    color: Color,
    origin: string,
    destination: string,
    signals: Map<string, EnginePlanSignal>,
    ply: number,
) {
    if (!PAWN_SETUP_SQUARES[color].has(destination)) return;

    const moveLabel = formatPawnSetupSquare(color, destination);
    addSignal(signals, {
        signature: `pawn_setup:${color}:${destination}`,
        category: "pawnSetup",
        label: `${capitalize(color)} plays ${moveLabel} ${pawnSetupKind(color, destination)}`,
        color,
        role: "pawn",
        routeSquares: [origin, destination],
        ply,
    });
}

function formatPawnSetupSquare(color: Color, square: string) {
    return color === "black" ? `...${square}` : square;
}

function pawnSetupKind(color: Color, square: string) {
    const fianchetto =
        color === "white" ? square === "b3" || square === "g3" : square === "b6" || square === "g6";
    if (fianchetto) return "fianchetto setup";
    if (CENTRAL_FILES.has(square[0])) return "central structure";
    return "space gain";
}

function recordRootCastlingSignal(
    color: Color,
    pos: NonNullable<ReturnType<typeof positionFromFen>[0]>,
    signals: Map<string, EnginePlanSignal>,
) {
    const rank = color === "white" ? "1" : "8";
    const kingSideKing = `g${rank}`;
    const queenSideKing = `c${rank}`;

    if (
        pieceAt(pos, kingSideKing)?.color === color &&
        pieceAt(pos, kingSideKing)?.role === "king"
    ) {
        addSignal(signals, {
            signature: `castling:${color}:kingside`,
            category: "castling",
            label: `${capitalize(color)} has castled kingside`,
            color,
            role: "king",
            routeSquares: [kingSideKing],
            origin: "root",
        });
    }
    if (
        pieceAt(pos, queenSideKing)?.color === color &&
        pieceAt(pos, queenSideKing)?.role === "king"
    ) {
        addSignal(signals, {
            signature: `castling:${color}:queenside`,
            category: "castling",
            label: `${capitalize(color)} has castled queenside`,
            color,
            role: "king",
            routeSquares: [queenSideKing],
            origin: "root",
        });
    }
}

function pieceAt(pos: NonNullable<ReturnType<typeof positionFromFen>[0]>, squareName: string) {
    const square = parseSquare(squareName);
    return square === undefined ? undefined : pos.board.get(square);
}

function setupPawnComponent(color: Color, from: string, to: string): EngineSetupTemplateComponent {
    return {
        signature: `pawn_setup:${color}:${to}`,
        category: "pawnSetup",
        label: `${capitalize(color)} plays ${formatPawnSetupSquare(color, to)} setup move`,
        color,
        role: "pawn",
        routeSquares: [from, to],
        origin: "template",
    };
}

function setupPieceComponent(
    color: Color,
    role: Role,
    from: string,
    to: string,
): EngineSetupTemplateComponent {
    return {
        signature: `piece_destination:${color}:${role}:${to}`,
        category: "pieceDestination",
        label: `${capitalize(color)} ${role} reaches ${to}`,
        color,
        role,
        routeSquares: [from, to],
        origin: "template",
    };
}

function setupCastlingComponent(
    color: Color,
    side: "kingside" | "queenside",
): EngineSetupTemplateComponent {
    const rank = color === "white" ? "1" : "8";
    const kingTo = side === "kingside" ? `g${rank}` : `c${rank}`;
    return {
        signature: `castling:${color}:${side}`,
        category: "castling",
        label: `${capitalize(color)} castles ${side}`,
        color,
        role: "king",
        routeSquares: [`e${rank}`, kingTo],
        origin: "template",
    };
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
    segments: Record<ExpansionSide, ExpansionSegment[]>,
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
    segments: ExpansionSegment[],
    signals: Map<string, EnginePlanSignal>,
) {
    addSignal(signals, {
        signature: `side_expansion:${color}:${side}`,
        category: "sideExpansion",
        label: `${capitalize(color)} ${side === "central" ? "central break" : `${side} expansion`}`,
        color,
        role: "pawn",
        routeSegments: uniqueSegments(
            segments.map((segment): [string, string] => [segment.from, segment.to]),
        ),
        // Established when this side reached its second distinct expanded file.
        ply: sideExpansionPly(segments),
    });
}

// The move index at which a side's distinct-file count first reached 2 — i.e. the
// ply that turned a single advanced pawn into an actual flank/central expansion.
function sideExpansionPly(segments: ExpansionSegment[]): number {
    const files = new Set<string>();
    for (const segment of segments) {
        const file = segment.to[0];
        if (files.has(file)) continue;

        files.add(file);
        if (files.size === 2) return segment.ply;
    }
    return segments[segments.length - 1]?.ply ?? 0;
}

function recordPawnExpansionSegment(
    color: Color,
    origin: string,
    destination: string,
    segments: ExpansionSegmentMap,
    ply: number,
) {
    const file = destination[0];
    const segment: ExpansionSegment = { from: origin, to: destination, ply };

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
    // Keep the earliest ply when the same signature is recorded twice within a PV,
    // so a signal is credited to the move that first established it.
    const existingPly = signals.get(signal.signature)?.ply;
    const ply =
        existingPly !== undefined && signal.ply !== undefined
            ? Math.min(existingPly, signal.ply)
            : (signal.ply ?? existingPly);
    signals.set(signal.signature, { ...signal, origin: signal.origin ?? "pv", ply });
}

function isRoutePiece(role: Role) {
    return role !== "pawn" && role !== "king";
}

function isInterestingDestination(role: Role, color: Color, square: string) {
    if (!isRoutePiece(role)) return false;

    const file = square[0];
    const rank = Number(square[1]);
    if (role === "bishop" && FIANCHETTO_BISHOP_SQUARES[color].has(square)) return true;
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
