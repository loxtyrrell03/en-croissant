import {
    type Chess,
    type Color,
    type Move,
    type Role,
    type Square,
    type SquareName,
    makeSquare,
    parseSquare,
    parseUci,
    squareFile,
    squareRank,
} from "chessops";
import { castlingSide } from "chessops/chess";
import { makeSan } from "chessops/san";
import { squareFromCoords } from "chessops/util";
import type {
    PlanExplorerData,
    PlanExplorerLine,
    PlanExplorerPiece,
    PlanExplorerSetup,
    PlanExplorerSetupPlan,
} from "@/bindings";
import { uciNormalize } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { getLichessGames, getMasterGames, type PositionData } from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";

export type OnlinePlanExplorerSource = "lch_all" | "lch_master";

const PLAN_FETCH_MOVES = 10;
const PLAN_BRANCH_WIDTH = 6;
const PLAN_MAX_REQUESTS = 72;
const PLAN_MIN_CHILD_SHARE = 0.03;
const PLAN_MAX_LINES_PER_PIECE = 8;
const PLAN_SETUP_FEATURED_PATHS_PER_COLOR = 7;
const PLAN_SETUP_SEED_PATHS_PER_COLOR = 4;
const PLAN_SETUP_MIN_PLANS = 3;
const PLAN_SETUP_MIN_COMPACT_PLANS = 2;
const PLAN_SETUP_MAX_PLANS = 6;
const PLAN_SETUP_MAX_RESULTS = 40;
const ROOT_SETUP_PAWN_SQUARES: Record<Color, Set<string>> = {
    white: new Set(["b3", "c3", "d3", "e3", "f3", "g3", "b4", "c4", "d4", "e4", "f4"]),
    black: new Set(["b6", "c6", "d6", "e6", "f6", "g6", "b5", "c5", "d5", "e5", "f5"]),
};
const ROOT_SETUP_PIECE_SQUARES: Record<Color, Partial<Record<Role, Set<string>>>> = {
    white: {
        knight: new Set(["c3", "d2", "e2", "f3"]),
        bishop: new Set(["b2", "d3", "e2", "f4", "g2", "g5"]),
        king: new Set(["c1", "g1"]),
    },
    black: {
        knight: new Set(["c6", "d7", "e7", "f6"]),
        bishop: new Set(["b7", "d6", "e7", "f5", "g4", "g7"]),
        king: new Set(["c8", "g8"]),
    },
};

type ExplorerMove = PositionData["moves"][number];

type ResultStats = {
    games: number;
    white: number;
    draw: number;
    black: number;
};

type TrackedPath = {
    color: Color;
    role: Role;
    from: SquareName;
    squares: SquareName[];
    san: string[];
    uci: string[];
};

type BranchNode = {
    position: Chess;
    play: string[];
    locations: Map<Square, string>;
    paths: Map<string, TrackedPath>;
    depth: number;
    stats: ResultStats;
};

type LineAccumulator = PlanExplorerLine;
type SetupCandidate = {
    key: string;
    slots: Map<string, string>;
    setup: PlanExplorerSetup;
};
type SetupGroup = SetupCandidate;

export async function getOnlinePlanExplorer(
    source: OnlinePlanExplorerSource,
    fen: string,
    options: LichessGamesOptions | MasterGamesOptions,
    maxPlies: number,
    token?: string,
): Promise<PlanExplorerData> {
    const [position, error] = positionFromFen(fen);
    if (!position) {
        throw new Error(`Invalid FEN: ${error?.message ?? fen}`);
    }

    const depthLimit = Math.max(1, Math.min(30, maxPlies));
    const rootData = await fetchExplorerPosition(source, fen, options, [], token);
    const rootStats = statsFromPosition(rootData);
    const root = createRootNode(position, rootStats);
    const leaves: BranchNode[] = [];
    const stack: BranchNode[] = [root];
    let requests = 1;

    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.depth >= depthLimit) {
            leaves.push(node);
            continue;
        }

        const nodeData =
            node.depth === 0
                ? rootData
                : await fetchExplorerPosition(source, fen, options, node.play, token);

        if (node.depth > 0) {
            requests += 1;
        }

        const children = selectCandidateMoves(nodeData)
            .map((move) => createChildNode(node, move))
            .filter((child): child is BranchNode => !!child);

        if (children.length === 0) {
            if (node.depth > 0) leaves.push(node);
            continue;
        }

        const remainingRequests = Math.max(0, PLAN_MAX_REQUESTS - requests - stack.length);
        const expandableChildren = children.slice(0, remainingRequests);
        const leafChildren = children.slice(remainingRequests);

        leaves.push(...leafChildren);

        for (const child of expandableChildren.reverse()) {
            stack.push(child);
        }
    }

    const { pieces, setups, sampledGames } = buildPiecesFromLeaves(leaves);

    return {
        fen,
        total_games: rootStats.games,
        sampled_games: sampledGames,
        max_plies: depthLimit,
        pieces,
        setups,
    };
}

async function fetchExplorerPosition(
    source: OnlinePlanExplorerSource,
    fen: string,
    options: LichessGamesOptions | MasterGamesOptions,
    play: string[],
    token?: string,
) {
    if (source === "lch_all") {
        return getLichessGames(
            fen,
            {
                ...(options as LichessGamesOptions),
                moves: PLAN_FETCH_MOVES,
                topGames: 0,
                recentGames: 0,
            },
            token,
            play,
        );
    }

    return getMasterGames(
        fen,
        {
            ...(options as MasterGamesOptions),
            moves: PLAN_FETCH_MOVES,
            topGames: 0,
        },
        token,
        play,
    );
}

function createRootNode(position: Chess, stats: ResultStats): BranchNode {
    const locations = new Map<Square, string>();
    const paths = new Map<string, TrackedPath>();

    for (const [square, piece] of position.board) {
        const from = makeSquare(square);
        const key = pieceKey(piece.color, piece.role, from);
        locations.set(square, key);
        paths.set(key, {
            color: piece.color,
            role: piece.role,
            from,
            squares: [from],
            san: [],
            uci: [],
        });
    }

    return {
        position,
        play: [],
        locations,
        paths,
        depth: 0,
        stats,
    };
}

function createChildNode(parent: BranchNode, explorerMove: ExplorerMove): BranchNode | null {
    const move = parseUci(explorerMove.uci);
    if (!move || !parent.position.isLegal(move)) {
        return null;
    }

    const position = parent.position.clone();
    const locations = new Map(parent.locations);
    const paths = clonePaths(parent.paths);
    const uci = uciNormalize(position, move);

    recordTrackedMove(position, move, uci, locations, paths);
    position.play(move);

    return {
        position,
        play: [...parent.play, uci],
        locations,
        paths,
        depth: parent.depth + 1,
        stats: statsFromMove(explorerMove),
    };
}

function recordTrackedMove(
    position: Chess,
    move: Move,
    uci: string,
    locations: Map<Square, string>,
    paths: Map<string, TrackedPath>,
) {
    if (!("from" in move)) return;

    const movingPiece = position.board.get(move.from);
    if (!movingPiece) return;

    const san = makeSan(position, move);
    const castle = movingPiece.role === "king" ? castlingSide(position, move) : undefined;
    if (castle) {
        recordCastlingMove(position, castle, move, san, uci, locations, paths);
        return;
    }

    const enPassantSquare = getEnPassantCaptureSquare(position, move, movingPiece.role);
    if (enPassantSquare !== undefined) {
        locations.delete(enPassantSquare);
    } else {
        locations.delete(move.to);
    }

    moveTrackedPiece(move.from, move.to, san, uci, locations, paths);
}

function recordCastlingMove(
    position: Chess,
    side: "a" | "h",
    move: Extract<Move, { from: Square; to: Square }>,
    san: string,
    uci: string,
    locations: Map<Square, string>,
    paths: Map<string, TrackedPath>,
) {
    const color = position.turn;
    const rank = color === "white" ? "1" : "8";
    const kingTo = parseSquare(`${side === "h" ? "g" : "c"}${rank}` as SquareName);
    const rookTo = parseSquare(`${side === "h" ? "f" : "d"}${rank}` as SquareName);
    const defaultRookFrom = parseSquare(`${side}${rank}` as SquareName);
    const moveToPiece = position.board.get(move.to);
    const rookFrom =
        moveToPiece?.color === color && moveToPiece.role === "rook" ? move.to : defaultRookFrom;
    const kingKey = locations.get(move.from);
    const rookKey = rookFrom !== undefined ? locations.get(rookFrom) : undefined;

    locations.delete(move.from);
    locations.delete(move.to);
    if (kingTo !== undefined) locations.delete(kingTo);
    if (rookFrom !== undefined) locations.delete(rookFrom);
    if (rookTo !== undefined) locations.delete(rookTo);

    if (kingKey && kingTo !== undefined) {
        appendTrackedSquare(kingKey, makeSquare(kingTo), san, uci, paths);
        locations.set(kingTo, kingKey);
    }
    if (rookKey && rookTo !== undefined) {
        appendTrackedSquare(rookKey, makeSquare(rookTo), san, uci, paths);
        locations.set(rookTo, rookKey);
    }
}

function moveTrackedPiece(
    from: Square,
    to: Square,
    san: string,
    uci: string,
    locations: Map<Square, string>,
    paths: Map<string, TrackedPath>,
) {
    const key = locations.get(from);
    if (!key) return;

    locations.delete(from);
    appendTrackedSquare(key, makeSquare(to), san, uci, paths);
    locations.set(to, key);
}

function appendTrackedSquare(
    key: string,
    to: SquareName,
    san: string,
    uci: string,
    paths: Map<string, TrackedPath>,
) {
    const path = paths.get(key);
    if (!path) return;

    path.squares.push(to);
    path.san.push(san);
    path.uci.push(uci);
}

function getEnPassantCaptureSquare(position: Chess, move: Move, role: Role) {
    if (!("from" in move) || role !== "pawn") return undefined;
    if (squareFile(move.from) === squareFile(move.to)) return undefined;
    if (position.board.get(move.to)) return undefined;
    return squareFromCoords(squareFile(move.to), squareRank(move.from));
}

function selectCandidateMoves(data: PositionData) {
    const total = Math.max(1, data.white + data.draws + data.black);
    const minGames = Math.max(2, Math.floor(total * PLAN_MIN_CHILD_SHARE));
    const candidates = [...data.moves]
        .map((move) => ({ move, stats: statsFromMove(move) }))
        .filter(({ stats }) => stats.games > 0)
        .sort((a, b) => b.stats.games - a.stats.games);
    const significant = candidates.filter(({ stats }) => stats.games >= minGames);
    const selected = significant.length > 0 ? significant : candidates.slice(0, 1);
    return selected.slice(0, PLAN_BRANCH_WIDTH).map(({ move }) => move);
}

function buildPiecesFromLeaves(leaves: BranchNode[]) {
    const grouped = new Map<string, Map<string, LineAccumulator>>();
    const setups: SetupGroup[] = [];
    let sampledGames = 0;

    for (const leaf of leaves) {
        if (leaf.depth === 0 || leaf.stats.games <= 0) continue;
        sampledGames += leaf.stats.games;

        const movedPaths = [...leaf.paths.values()].filter((path) => path.squares.length > 1);
        const setupPaths = [...leaf.paths.values()].filter(
            (path) => path.squares.length > 1 || isRootSetupAnchorPath(path),
        );
        for (const path of movedPaths) {
            if (path.squares.length <= 1) continue;

            const pieceMap = getOrInsert(
                grouped,
                pieceKey(path.color, path.role, path.from),
                () => new Map(),
            );
            const lineKey = path.squares.join(",");
            const existing = pieceMap.get(lineKey);
            if (existing) {
                existing.games += leaf.stats.games;
                existing.white += leaf.stats.white;
                existing.draw += leaf.stats.draw;
                existing.black += leaf.stats.black;
            } else {
                pieceMap.set(lineKey, {
                    squares: [...path.squares],
                    san: [...path.san],
                    uci: [...path.uci],
                    games: leaf.stats.games,
                    white: leaf.stats.white,
                    draw: leaf.stats.draw,
                    black: leaf.stats.black,
                });
            }
        }

        for (const candidate of collectSetupRows(setupPaths, leaf.stats)) {
            const existing = setups.find(
                (group) =>
                    group.key === candidate.key &&
                    compatibleSetupSlots(group.slots, candidate.slots),
            );
            if (existing) {
                mergeSetup(existing.setup, candidate.setup);
                mergeSetupSlots(existing.slots, candidate.slots);
            } else {
                setups.push(candidate);
            }
        }
    }

    const pieces = [...grouped.entries()]
        .map(([key, lineMap]) => {
            const [color, role, from] = key.split("|");
            const lines = [...lineMap.values()].sort((a, b) => b.games - a.games);
            const total = lines.reduce((sum, line) => sum + line.games, 0);
            return {
                color,
                role,
                from,
                total,
                lines: lines.slice(0, PLAN_MAX_LINES_PER_PIECE),
            };
        })
        .sort(
            (a, b) =>
                b.total - a.total ||
                a.color.localeCompare(b.color) ||
                a.role.localeCompare(b.role) ||
                a.from.localeCompare(b.from),
        ) as PlanExplorerPiece[];

    const setupRows = setups
        .map((group) => group.setup)
        .map(limitSetupPlans)
        .filter(isValidSetupRow)
        .sort(
            (a, b) =>
                b.games - a.games ||
                b.plans.length - a.plans.length ||
                setupKey(a.plans).localeCompare(setupKey(b.plans)),
        )
        .slice(0, PLAN_SETUP_MAX_RESULTS);

    return { pieces, setups: setupRows, sampledGames };
}

function collectSetupRows(paths: TrackedPath[], stats: ResultStats): SetupCandidate[] {
    const byColor = new Map<Color, TrackedPath[]>();
    for (const path of paths) {
        const feature = setupFeaturePath(path);
        if (!isSetupFamilyPath(feature)) continue;

        const pathsForColor = getOrInsert(byColor, feature.color, () => []);
        pathsForColor.push(feature);
    }

    const setups: SetupCandidate[] = [];
    for (const rawColorPaths of byColor.values()) {
        const featured = dedupeSetupPaths(rawColorPaths)
            .sort((a, b) => setupPathPriority(b) - setupPathPriority(a) || compareTrackedPath(a, b))
            .slice(0, PLAN_SETUP_FEATURED_PATHS_PER_COLOR);

        const selectedByKey = new Map<string, TrackedPath[]>();
        for (const seed of selectSetupSeedPaths(featured)) {
            const selected = selectSetupPaths(featured, seed);
            const key = setupFamilyKeyFromPaths(selected);
            mergeSelectedSetupPaths(
                getOrInsert(selectedByKey, key, () => []),
                selected,
            );
        }

        for (const [key, selectedPaths] of selectedByKey) {
            const selected = limitSelectedSetupPaths(selectedPaths);
            setups.push({
                key,
                slots: setupSlots(selected),
                setup: setupFromPaths(selected, stats),
            });
        }
    }

    return setups;
}

function setupFeaturePath(path: TrackedPath): TrackedPath {
    if (path.squares.length <= 2) {
        return clonePath(path);
    }

    return {
        ...path,
        squares: path.squares.slice(0, 2),
        san: path.san.slice(0, 1),
        uci: path.uci.slice(0, 1),
    };
}

function isSetupFamilyPath(path: TrackedPath) {
    return path.squares.length > 1 || isRootSetupAnchorPath(path);
}

function dedupeSetupPaths(paths: TrackedPath[]) {
    const deduped = new Map<string, TrackedPath>();
    for (const path of paths) {
        deduped.set(setupPathKey(path), path);
    }
    return [...deduped.values()];
}

function selectSetupSeedPaths(paths: TrackedPath[]) {
    const seeds = paths.filter(isSetupSeedPath);
    const selected = seeds.length > 0 ? seeds : paths;
    return [...selected]
        .sort((a, b) => setupSeedPriority(b) - setupSeedPriority(a) || compareTrackedPath(a, b))
        .slice(0, PLAN_SETUP_SEED_PATHS_PER_COLOR);
}

function selectSetupPaths(paths: TrackedPath[], seed: TrackedPath) {
    const selected = [clonePath(seed)];
    const candidates = paths
        .filter((path) => setupPathKey(path) !== setupPathKey(seed))
        .filter((path) => isSetupSupportPath(seed, path))
        .sort(
            (a, b) => setupSupportPriority(b) - setupSupportPriority(a) || compareTrackedPath(a, b),
        );

    for (const candidate of candidates) {
        if (selected.length >= PLAN_SETUP_MAX_PLANS) break;
        selected.push(clonePath(candidate));
    }

    return selected.sort(compareTrackedPath);
}

function setupFamilyKeyFromPaths(paths: TrackedPath[]) {
    let anchors = paths.filter(isStructuralSetupPath);
    if (anchors.length === 0) anchors = paths.filter(isSetupSeedPath);
    if (anchors.length === 0) anchors = paths.filter((path) => !isStructuralSetupPath(path));
    if (anchors.length === 0) anchors = paths;

    return setupKeyFromPaths(
        [...anchors]
            .sort(
                (a, b) =>
                    selectedSetupPathPriority(b) - selectedSetupPathPriority(a) ||
                    compareTrackedPath(a, b),
            )
            .slice(0, PLAN_SETUP_MAX_PLANS),
    );
}

function mergeSelectedSetupPaths(existing: TrackedPath[], incoming: TrackedPath[]) {
    const seen = new Set(existing.map(setupPathKey));
    for (const path of incoming) {
        if (!seen.has(setupPathKey(path))) {
            existing.push(clonePath(path));
            seen.add(setupPathKey(path));
        }
    }
}

function limitSelectedSetupPaths(paths: TrackedPath[]) {
    return [...paths]
        .sort(
            (a, b) =>
                selectedSetupPathPriority(b) - selectedSetupPathPriority(a) ||
                compareTrackedPath(a, b),
        )
        .slice(0, PLAN_SETUP_MAX_PLANS)
        .sort(compareTrackedPath);
}

function selectedSetupPathPriority(path: TrackedPath) {
    return setupSupportPriority(path) + (isSetupSeedPath(path) ? 20 : 0);
}

function isRootSetupAnchorPath(path: TrackedPath) {
    if (path.squares.length !== 1 || path.san.length > 0 || path.uci.length > 0) return false;
    const square = path.from;
    if (path.role === "pawn") return ROOT_SETUP_PAWN_SQUARES[path.color].has(square);

    return ROOT_SETUP_PIECE_SQUARES[path.color][path.role]?.has(square) ?? false;
}

function isRootCastlingAnchorPath(path: TrackedPath) {
    return path.role === "king" && isRootSetupAnchorPath(path);
}

function isStructuralSetupPath(path: TrackedPath) {
    return path.role === "pawn";
}

function isSetupSeedPath(path: TrackedPath) {
    if (isRootSetupAnchorPath(path)) {
        return path.role === "knight" || path.role === "bishop" || path.role === "king";
    }
    if (path.role === "pawn") return isFianchettoPawnSeed(path);
    if (path.role === "knight" || path.role === "bishop") return isDevelopmentSetupPath(path);
    return path.role === "king" && isCastle(path);
}

function setupSeedPriority(path: TrackedPath) {
    if (path.role === "pawn" && isFianchettoPawnSeed(path)) return 110;
    if (path.role === "knight" || path.role === "bishop") return 86;
    if (path.role === "king" && isCastle(path)) return 82;
    return 40;
}

function isFianchettoPawnSeed(path: TrackedPath) {
    const to = path.squares.at(-1);
    if (path.role !== "pawn" || !to) return false;
    if (path.from[0] !== to[0] || !["b", "g"].includes(path.from[0])) return false;
    return path.color === "white"
        ? path.from[1] === "2" && to[1] === "3"
        : path.from[1] === "7" && to[1] === "6";
}

function isSetupSupportPath(seed: TrackedPath, path: TrackedPath) {
    if (seed.color !== path.color) return false;
    return isDevelopmentSetupPath(path) || isCastle(path) || isSetupPawnSupportPath(path);
}

function isDevelopmentSetupPath(path: TrackedPath) {
    return (
        (path.role === "knight" || path.role === "bishop") &&
        (path.squares.length > 1 || isRootSetupAnchorPath(path))
    );
}

function isSetupPawnSupportPath(path: TrackedPath) {
    const to = path.squares.at(-1);
    if (path.role !== "pawn" || !to) return false;
    if (isRootSetupAnchorPath(path)) return true;
    if (isFianchettoPawnSeed(path)) return true;
    return path.from[0] === to[0] && ["c", "d", "e", "f"].includes(path.from[0]);
}

function setupSupportPriority(path: TrackedPath) {
    if (path.role === "king" && isCastle(path)) return 110;
    if (path.role === "bishop" || path.role === "knight") return 104;
    if (path.role === "pawn" && isFianchettoPawnSeed(path)) return 96;
    if (path.role === "pawn" && isSetupPawnSupportPath(path)) return 82;
    return 40;
}

function setupFromPaths(paths: TrackedPath[], stats: ResultStats): PlanExplorerSetup {
    const sorted = [...paths].sort(compareTrackedPath);
    return {
        plans: sorted.map((path) => setupPlanFromPath(path, stats)),
        games: stats.games,
        white: stats.white,
        draw: stats.draw,
        black: stats.black,
    };
}

function setupKeyFromPaths(paths: TrackedPath[]) {
    return [...paths]
        .sort(compareTrackedPath)
        .map((path) => `${path.color}|${path.role}|${path.from}|${path.squares.join("-")}`)
        .join("||");
}

function setupSlots(paths: TrackedPath[]) {
    const slots = new Map<string, string>();
    for (const path of paths) {
        const slot = setupSlot(path);
        if (slot) slots.set(slot.key, slot.value);
    }
    return slots;
}

function setupSlot(path: TrackedPath) {
    if (isStructuralSetupPath(path)) return null;
    if (path.squares.length <= 1) return null;

    const destination = path.squares.at(-1);
    if (!destination) return null;

    if (path.role === "king") {
        const castling = path.san.find((san) => san.startsWith("O-O") || san.startsWith("0-0"));
        if (castling) {
            return {
                key: `king:${path.color}:${path.from}`,
                value:
                    castling.startsWith("O-O-O") || castling.startsWith("0-0-0")
                        ? "queenside"
                        : "kingside",
            };
        }
    }

    return {
        key: `piece:${path.color}:${path.role}:${path.from}`,
        value: destination,
    };
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

function mergeSetup(existing: PlanExplorerSetup, incoming: PlanExplorerSetup) {
    existing.games += incoming.games;
    existing.white += incoming.white;
    existing.draw += incoming.draw;
    existing.black += incoming.black;

    const existingPlans = new Map(existing.plans.map((plan) => [setupPlanKey(plan), plan]));
    for (const plan of incoming.plans) {
        const key = setupPlanKey(plan);
        const existingPlan = existingPlans.get(key);
        if (existingPlan) {
            mergeLineStats(existingPlan.line, plan.line);
        } else {
            existing.plans.push(plan);
            existingPlans.set(key, plan);
        }
    }
}

function mergeLineStats(existing: PlanExplorerLine, incoming: PlanExplorerLine) {
    existing.games += incoming.games;
    existing.white += incoming.white;
    existing.draw += incoming.draw;
    existing.black += incoming.black;
}

function limitSetupPlans(setup: PlanExplorerSetup): PlanExplorerSetup {
    return {
        ...setup,
        plans: [...setup.plans].sort(compareSetupPlansForOutput).slice(0, PLAN_SETUP_MAX_PLANS),
    };
}

function compareSetupPlansForOutput(a: PlanExplorerSetupPlan, b: PlanExplorerSetupPlan) {
    return (
        setupPlanOutputPriority(b) - setupPlanOutputPriority(a) ||
        setupPlanKey(a).localeCompare(setupPlanKey(b))
    );
}

function setupPlanOutputPriority(plan: PlanExplorerSetupPlan) {
    if (
        plan.role === "king" &&
        plan.line.san.some((san) => san.startsWith("O-O") || san.startsWith("0-0"))
    ) {
        return 112;
    }
    if (plan.role === "bishop" || plan.role === "knight") return 106;
    if (plan.role === "pawn" && isFianchettoSetupPlan(plan)) return 98;
    if (plan.role === "pawn" && isSetupPawnPlan(plan)) return 90;
    if (plan.role === "pawn") return 70;
    if (plan.role === "rook") return 76;
    if (plan.role === "queen") return 72;
    return 50;
}

function isValidSetupRow(setup: PlanExplorerSetup) {
    if (!setup.plans.some(isSetupAnchorPlan)) return false;
    if (setup.plans.length >= PLAN_SETUP_MIN_PLANS) return true;

    return (
        setup.plans.length >= PLAN_SETUP_MIN_COMPACT_PLANS &&
        setup.plans.some(isStructuralSetupPlan)
    );
}

function isSetupAnchorPlan(plan: PlanExplorerSetupPlan) {
    return (
        plan.role === "knight" ||
        plan.role === "bishop" ||
        (plan.role === "king" &&
            (plan.line.squares.length <= 1 ||
                plan.line.san.some((san) => san.startsWith("O-O") || san.startsWith("0-0"))))
    );
}

function isStructuralSetupPlan(plan: PlanExplorerSetupPlan) {
    return plan.role === "pawn";
}

function isFianchettoSetupPlan(plan: PlanExplorerSetupPlan) {
    const to = plan.line.squares.at(-1);
    if (plan.role !== "pawn" || !to) return false;
    if (plan.from[0] !== to[0] || !["b", "g"].includes(plan.from[0])) return false;
    return plan.color === "white"
        ? plan.from[1] === "2" && to[1] === "3"
        : plan.from[1] === "7" && to[1] === "6";
}

function isSetupPawnPlan(plan: PlanExplorerSetupPlan) {
    const to = plan.line.squares.at(-1);
    if (plan.role !== "pawn" || !to) return false;
    return (
        isFianchettoSetupPlan(plan) ||
        (plan.from[0] === to[0] && ["c", "d", "e", "f"].includes(plan.from[0]))
    );
}

function setupPlanFromPath(path: TrackedPath, stats: ResultStats): PlanExplorerSetupPlan {
    return {
        color: path.color,
        role: path.role,
        from: path.from,
        line: {
            squares: [...path.squares],
            san: [...path.san],
            uci: [...path.uci],
            games: stats.games,
            white: stats.white,
            draw: stats.draw,
            black: stats.black,
        },
    };
}

function setupPathPriority(path: TrackedPath) {
    if (isRootSetupAnchorPath(path)) {
        if (path.role === "king") return 92;
        if (path.role === "pawn") return 88;
        if (path.role === "knight" || path.role === "bishop") return 84;
        return 72;
    }

    const roleScore = (() => {
        switch (path.role) {
            case "queen":
                return 80;
            case "rook":
                return 72;
            case "knight":
            case "bishop":
                return 68;
            case "king":
                return path.san.some((san) => san.startsWith("O-O") || san.startsWith("0-0"))
                    ? 70
                    : 34;
            case "pawn":
                return isCentralOrAdvancedPawnPath(path) ? 64 : 42;
            default:
                return 40;
        }
    })();

    return roleScore + Math.min(path.san.length, 4) * 6;
}

function isCentralOrAdvancedPawnPath(path: TrackedPath) {
    if (path.role !== "pawn" || path.squares.length < 2) return false;
    const first = path.squares[0];
    const last = path.squares[path.squares.length - 1];
    const firstFile = first[0];
    const lastFile = last[0];
    const lastRank = Number(last[1]);

    return (
        firstFile !== lastFile ||
        ["c", "d", "e", "f"].includes(firstFile) ||
        (path.color === "white" ? lastRank >= 5 : lastRank <= 4)
    );
}

function compareTrackedPath(a: TrackedPath, b: TrackedPath) {
    return (
        a.color.localeCompare(b.color) ||
        a.role.localeCompare(b.role) ||
        a.from.localeCompare(b.from) ||
        a.squares.join("-").localeCompare(b.squares.join("-"))
    );
}

function setupKey(plans: PlanExplorerSetupPlan[]) {
    return plans.map(setupPlanKey).join("||");
}

function setupPlanKey(plan: PlanExplorerSetupPlan) {
    return `${plan.color}|${plan.role}|${plan.from}|${plan.line.squares.join("-")}`;
}

function statsFromPosition(data: PositionData): ResultStats {
    return {
        games: data.white + data.draws + data.black,
        white: data.white,
        draw: data.draws,
        black: data.black,
    };
}

function statsFromMove(move: ExplorerMove): ResultStats {
    return {
        games: move.white + move.draws + move.black,
        white: move.white,
        draw: move.draws,
        black: move.black,
    };
}

function clonePath(path: TrackedPath): TrackedPath {
    return {
        ...path,
        squares: [...path.squares],
        san: [...path.san],
        uci: [...path.uci],
    };
}

function isCastle(path: TrackedPath) {
    return (
        isRootCastlingAnchorPath(path) ||
        path.san.some((san) => san.startsWith("O-O") || san.startsWith("0-0"))
    );
}

function setupPathKey(path: TrackedPath) {
    return `${path.color}|${path.role}|${path.from}|${path.squares.join("-")}`;
}

function clonePaths(paths: Map<string, TrackedPath>) {
    return new Map([...paths.entries()].map(([key, path]) => [key, clonePath(path)]));
}

function getOrInsert<K, V>(map: Map<K, V>, key: K, create: () => V) {
    const existing = map.get(key);
    if (existing) return existing;

    const value = create();
    map.set(key, value);
    return value;
}

function pieceKey(color: Color | string, role: Role | string, from: SquareName | string) {
    return `${color}|${role}|${from}`;
}
