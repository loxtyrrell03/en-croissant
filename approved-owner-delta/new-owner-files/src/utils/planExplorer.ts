import type { DrawShape } from "@lichess-org/chessground/draw";
import type { SquareName } from "chessops";
import type { PlanExplorerData, PlanExplorerLine, PlanExplorerPiece } from "@/bindings";

export const PLAN_BRUSH = "plan";
export const PLAN_WHITE_BRUSH = "planWhite";
export const PLAN_BLACK_BRUSH = "planBlack";
const PLAN_BRUSHES = new Set([PLAN_BRUSH, PLAN_WHITE_BRUSH, PLAN_BLACK_BRUSH]);
const AUTO_PLAN_MIN_SHARE = 0.05;
const AUTO_PLAN_MAX_LINES = 10;
const AUTO_PLAN_MAX_MAJOR_MINOR_LINES = 7;
const AUTO_PLAN_MAX_PAWN_LINES = 3;

export type PlanExplorerSegment = [SquareName, SquareName];
export type ColoredPlanExplorerLine = PlanExplorerLine & {
    color?: string;
    segments?: PlanExplorerSegment[];
};

const squarePattern = /^[a-h][1-8]$/;
const centralFiles = new Set(["c", "d", "e", "f"]);
const majorMinorRoles = new Set(["queen", "rook", "bishop", "knight"]);
const queensideFiles = new Set(["a", "b", "c"]);
const kingsideFiles = new Set(["f", "g", "h"]);
const homeRanks = new Set(["1", "8"]);
const liftRanksByColor = {
    white: new Set(["3", "4"]),
    black: new Set(["5", "6"]),
};

type AutoPlanLineOptions = {
    minGames?: number;
};

function isSquareName(square: string): square is SquareName {
    return squarePattern.test(square);
}

export function getPlanLineForSquare(data: PlanExplorerData | null, square: SquareName) {
    const piece = data?.pieces.find((piece) => piece.from === square);
    return piece?.lines[0] ? withPlanLineColor(piece.lines[0], piece.color) : null;
}

export function getTopPlanLines(data: PlanExplorerData | null, limit = 3) {
    const lines =
        data?.pieces
            .map((piece) =>
                piece.lines[0] ? withPlanLineColor(piece.lines[0], piece.color) : null,
            )
            .filter((line): line is ColoredPlanExplorerLine => !!line)
            .sort((a, b) => b.games - a.games) ?? [];

    return balancePlanLines(lines, limit);
}

function lineSignificanceFloor(data: PlanExplorerData) {
    const sampleSize = data.sampled_games || data.total_games || 0;
    return Math.max(3, Math.floor(sampleSize * AUTO_PLAN_MIN_SHARE));
}

function isCentralOrAdvancedPawnLine(line: PlanExplorerLine, color: string) {
    const squares = line.squares.filter(isSquareName);
    if (squares.length < 2) return false;

    const [from, to] = [squares[0], squares[squares.length - 1]];
    const fromFile = from[0];
    const toFile = to[0];
    const toRank = Number(to[1]);

    if (fromFile !== toFile) return true;
    if (centralFiles.has(fromFile)) return true;

    return color === "white" ? toRank >= 5 : toRank <= 4;
}

function topLine(piece: PlanExplorerPiece) {
    return piece.lines[0] ?? null;
}

function topLineGames(piece: PlanExplorerPiece) {
    return topLine(piece)?.games ?? 0;
}

export function getAutoPlanLines(
    data: PlanExplorerData | null,
    limit = AUTO_PLAN_MAX_LINES,
    options: AutoPlanLineOptions = {},
) {
    if (!data) return [];

    const minGames = Math.max(1, options.minGames ?? lineSignificanceFloor(data));

    const majorMinorLines = data.pieces
        .filter((piece) => majorMinorRoles.has(piece.role))
        .filter((piece) => topLineGames(piece) >= minGames)
        .sort((a, b) => topLineGames(b) - topLineGames(a) || a.from.localeCompare(b.from))
        .map((piece) => (topLine(piece) ? withPlanLineColor(topLine(piece)!, piece.color) : null))
        .filter((line): line is ColoredPlanExplorerLine => !!line);

    const pawnLines = data.pieces
        .filter((piece) => piece.role === "pawn")
        .filter((piece) => {
            const line = topLine(piece);
            return (
                !!line && line.games >= minGames && isCentralOrAdvancedPawnLine(line, piece.color)
            );
        })
        .sort((a, b) => topLineGames(b) - topLineGames(a) || a.from.localeCompare(b.from))
        .map((piece) => (topLine(piece) ? withPlanLineColor(topLine(piece)!, piece.color) : null))
        .filter((line): line is ColoredPlanExplorerLine => !!line);

    const balancedMajorMinorLines = balancePlanLines(
        majorMinorLines,
        AUTO_PLAN_MAX_MAJOR_MINOR_LINES,
    );
    const balancedPawnLines = balancePlanLines(pawnLines, AUTO_PLAN_MAX_PAWN_LINES);

    return balancePlanLines(
        [...balancedMajorMinorLines, ...balancedPawnLines].sort((a, b) => b.games - a.games),
        Math.min(limit, AUTO_PLAN_MAX_LINES),
    );
}

export function withPlanLineColor(line: PlanExplorerLine, color: string): ColoredPlanExplorerLine {
    return { ...line, color };
}

export function isPlanBrush(brush: DrawShape["brush"]) {
    return typeof brush === "string" && PLAN_BRUSHES.has(brush);
}

function brushForPlanLine(line: ColoredPlanExplorerLine) {
    return line.color === "black" ? PLAN_BLACK_BRUSH : PLAN_WHITE_BRUSH;
}

export function planLineToShapes(line: ColoredPlanExplorerLine): DrawShape[] {
    const shapes: DrawShape[] = [];
    const brush = brushForPlanLine(line);
    const segments = line.segments?.length
        ? line.segments
        : consecutiveSegments(line.squares.filter(isSquareName));

    for (let i = 0; i < segments.length; i++) {
        const [orig, dest] = segments[i];
        shapes.push({
            orig,
            dest,
            brush,
            modifiers: {
                lineWidth: Math.max(5, 10 - i * 1.5),
            },
        });
    }

    return shapes;
}

export function planLinesToShapes(lines: ColoredPlanExplorerLine[], maxShapes = 8): DrawShape[] {
    const shapes: DrawShape[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
        for (const shape of planLineToShapes(line)) {
            const key = `${shape.orig}-${shape.dest}-${shape.brush}`;
            if (seen.has(key)) continue;

            seen.add(key);
            shapes.push(shape);
        }
    }

    return balancePlanShapes(shapes, maxShapes);
}

export function formatPlanRoute(squares: string[]) {
    return squares.join(" -> ");
}

export function formatPlanPieceRoute(
    piece: Pick<PlanExplorerPiece, "color" | "role">,
    line: PlanExplorerLine,
) {
    const castling = piece.role === "king" ? detectPlanCastling(line, piece.color) : null;
    if (castling) {
        return `${castling.notation} (${castling.from} -> ${castling.kingTo})`;
    }

    return formatPlanRoute(line.squares);
}

export function summarizePlanPiece(piece: PlanExplorerPiece) {
    const line = piece.lines[0];
    const squares = line?.squares.filter(isSquareName) ?? [];
    if (squares.length < 2) return `${capitalize(piece.role)} route`;

    const from = squares[0];
    const to = squares[squares.length - 1];
    const area = boardArea(to);

    switch (piece.role) {
        case "pawn":
            return area === "center" ? "Central expansion" : `${capitalize(area)} pawn break`;
        case "knight":
        case "bishop":
            return `Minor piece ${squares.length >= 3 ? "reroute" : "development"} to ${area}`;
        case "rook":
            return isRookLift(piece.color, from, to) ? "Rook lift" : `Rook swing to ${area}`;
        case "queen":
            return area === "center" ? "Queen centralization" : `Queen swing to ${area}`;
        case "king":
            return castlingSummary(line, piece.color) ?? `King move to ${area}`;
        default:
            return `${capitalize(piece.role)} route to ${area}`;
    }
}

function balancePlanLines(lines: ColoredPlanExplorerLine[], limit: number) {
    const cappedLimit = Math.max(0, limit);
    if (cappedLimit === 0) return [];

    const whiteLines = lines.filter((line) => line.color === "white");
    const blackLines = lines.filter((line) => line.color === "black");
    if (whiteLines.length === 0 || blackLines.length === 0) {
        return lines.slice(0, cappedLimit);
    }

    const result: ColoredPlanExplorerLine[] = [];
    const queues = {
        white: whiteLines,
        black: blackLines,
    };
    const indexes = {
        white: 0,
        black: 0,
    };
    let nextColor: "white" | "black" = lines[0]?.color === "black" ? "black" : "white";

    while (result.length < cappedLimit) {
        const otherColor = nextColor === "white" ? "black" : "white";
        const selectedColor =
            indexes[nextColor] < queues[nextColor].length ? nextColor : otherColor;

        if (indexes[selectedColor] >= queues[selectedColor].length) break;

        result.push(queues[selectedColor][indexes[selectedColor]]);
        indexes[selectedColor] += 1;
        nextColor = selectedColor === "white" ? "black" : "white";
    }

    return result;
}

function balancePlanShapes(shapes: DrawShape[], limit: number) {
    const cappedLimit = Math.max(0, limit);
    if (cappedLimit === 0) return [];

    const whiteShapes = shapes.filter((shape) => shape.brush === PLAN_WHITE_BRUSH);
    const blackShapes = shapes.filter((shape) => shape.brush === PLAN_BLACK_BRUSH);
    if (whiteShapes.length === 0 || blackShapes.length === 0) {
        return shapes.slice(0, cappedLimit);
    }

    const result: DrawShape[] = [];
    const queues = {
        white: whiteShapes,
        black: blackShapes,
    };
    const indexes = {
        white: 0,
        black: 0,
    };
    let nextColor: "white" | "black" = shapes[0]?.brush === PLAN_BLACK_BRUSH ? "black" : "white";

    while (result.length < cappedLimit) {
        const otherColor = nextColor === "white" ? "black" : "white";
        const selectedColor =
            indexes[nextColor] < queues[nextColor].length ? nextColor : otherColor;

        if (indexes[selectedColor] >= queues[selectedColor].length) break;

        result.push(queues[selectedColor][indexes[selectedColor]]);
        indexes[selectedColor] += 1;
        nextColor = selectedColor === "white" ? "black" : "white";
    }

    return result;
}

function consecutiveSegments(squares: SquareName[]): PlanExplorerSegment[] {
    const segments: PlanExplorerSegment[] = [];
    for (let i = 0; i < squares.length - 1; i++) {
        segments.push([squares[i], squares[i + 1]]);
    }

    return segments;
}

function boardArea(square: SquareName) {
    const file = square[0];
    if (queensideFiles.has(file)) return "queenside";
    if (kingsideFiles.has(file)) return "kingside";
    return "center";
}

function isRookLift(color: string, from: SquareName, to: SquareName) {
    const liftRanks = color === "black" ? liftRanksByColor.black : liftRanksByColor.white;

    return from[0] === to[0] && homeRanks.has(from[1]) && liftRanks.has(to[1]);
}

export type PlanCastling = {
    side: "kingside" | "queenside";
    notation: "O-O" | "O-O-O";
    from: SquareName;
    kingTo: SquareName;
};

function castlingSummary(line: PlanExplorerLine, color: string) {
    const castling = detectPlanCastling(line, color);
    if (!castling) return null;

    return castling.side === "kingside" ? "Kingside castling" : "Queenside castling";
}

export function detectPlanCastling(line: PlanExplorerLine, color: string): PlanCastling | null {
    const squares = line.squares.filter(isSquareName);
    if (squares.length < 2) return null;

    const san = line.san.find((move) => /^O-O(?:-O)?/.test(move) || /^0-0(?:-0)?/.test(move));
    const from = squares[0];
    const inferredRank = color === "black" ? "8" : color === "white" ? "1" : from[1];
    const kingsideKingTo = `g${inferredRank}` as SquareName;
    const queensideKingTo = `c${inferredRank}` as SquareName;

    if (san) {
        if (/^(O-O-O|0-0-0)/.test(san)) {
            return {
                side: "queenside",
                notation: "O-O-O",
                from,
                kingTo: queensideKingTo,
            };
        }

        return {
            side: "kingside",
            notation: "O-O",
            from,
            kingTo: kingsideKingTo,
        };
    }

    const sameRank = squares.every((square) => square[1] === inferredRank);
    if (!sameRank) return null;

    const last = squares[squares.length - 1];
    const hasKingsideRookSquare = squares.some((square) => square[0] === "h");
    const hasQueensideRookSquare = squares.some((square) => square[0] === "a");

    if (last === kingsideKingTo || (last[0] === "f" && hasKingsideRookSquare)) {
        return {
            side: "kingside",
            notation: "O-O",
            from,
            kingTo: kingsideKingTo,
        };
    }
    if (last === queensideKingTo || (last[0] === "d" && hasQueensideRookSquare)) {
        return {
            side: "queenside",
            notation: "O-O-O",
            from,
            kingTo: queensideKingTo,
        };
    }

    return null;
}

function capitalize(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
