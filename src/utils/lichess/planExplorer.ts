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
import type { PlanExplorerData, PlanExplorerLine, PlanExplorerPiece } from "@/bindings";
import { uciNormalize } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { getLichessGames, getMasterGames, type PositionData } from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";

export type OnlinePlanExplorerSource = "lch_all" | "lch_master";

const PLAN_FETCH_MOVES = 6;
const PLAN_BRANCH_WIDTH = 4;
const PLAN_MAX_REQUESTS = 36;
const PLAN_MIN_CHILD_SHARE = 0.05;
const PLAN_MAX_LINES_PER_PIECE = 8;

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

    const { pieces, sampledGames } = buildPiecesFromLeaves(leaves);

    return {
        fen,
        total_games: rootStats.games,
        sampled_games: sampledGames,
        max_plies: depthLimit,
        pieces,
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
        recordCastlingMove(position.turn, castle, move, san, uci, locations, paths);
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
    color: Color,
    side: "a" | "h",
    move: Extract<Move, { from: Square; to: Square }>,
    san: string,
    uci: string,
    locations: Map<Square, string>,
    paths: Map<string, TrackedPath>,
) {
    const rank = color === "white" ? "1" : "8";
    const rookFrom = parseSquare(`${side}${rank}` as SquareName);
    const rookTo = parseSquare(`${side === "h" ? "f" : "d"}${rank}` as SquareName);

    moveTrackedPiece(move.from, move.to, san, uci, locations, paths);
    if (rookFrom !== undefined && rookTo !== undefined) {
        moveTrackedPiece(rookFrom, rookTo, san, uci, locations, paths);
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
    let sampledGames = 0;

    for (const leaf of leaves) {
        if (leaf.depth === 0 || leaf.stats.games <= 0) continue;
        sampledGames += leaf.stats.games;

        for (const path of leaf.paths.values()) {
            if (path.squares.length <= 1) continue;

            const pieceMap = getOrInsert(grouped, pieceKey(path.color, path.role, path.from), () =>
                new Map(),
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

    return { pieces, sampledGames };
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

function clonePaths(paths: Map<string, TrackedPath>) {
    return new Map(
        [...paths.entries()].map(([key, path]) => [
            key,
            {
                ...path,
                squares: [...path.squares],
                san: [...path.san],
                uci: [...path.uci],
            },
        ]),
    );
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
