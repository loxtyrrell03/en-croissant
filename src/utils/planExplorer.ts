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

export type ColoredPlanExplorerLine = PlanExplorerLine & { color?: string };

const squarePattern = /^[a-h][1-8]$/;
const centralFiles = new Set(["c", "d", "e", "f"]);
const majorMinorRoles = new Set(["queen", "rook", "bishop", "knight"]);

function isSquareName(square: string): square is SquareName {
    return squarePattern.test(square);
}

export function getPlanLineForSquare(data: PlanExplorerData | null, square: SquareName) {
    const piece = data?.pieces.find((piece) => piece.from === square);
    return piece?.lines[0] ? withPlanLineColor(piece.lines[0], piece.color) : null;
}

export function getTopPlanLines(data: PlanExplorerData | null, limit = 3) {
    return (
        data?.pieces
            .map((piece) =>
                piece.lines[0] ? withPlanLineColor(piece.lines[0], piece.color) : null,
            )
            .filter((line): line is ColoredPlanExplorerLine => !!line)
            .sort((a, b) => b.games - a.games)
            .slice(0, limit) ?? []
    );
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

export function getAutoPlanLines(data: PlanExplorerData | null) {
    if (!data) return [];

    const minGames = lineSignificanceFloor(data);

    const majorMinorLines = data.pieces
        .filter((piece) => majorMinorRoles.has(piece.role))
        .filter((piece) => topLineGames(piece) >= minGames)
        .sort((a, b) => topLineGames(b) - topLineGames(a) || a.from.localeCompare(b.from))
        .slice(0, AUTO_PLAN_MAX_MAJOR_MINOR_LINES)
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
        .slice(0, AUTO_PLAN_MAX_PAWN_LINES)
        .map((piece) => (topLine(piece) ? withPlanLineColor(topLine(piece)!, piece.color) : null))
        .filter((line): line is ColoredPlanExplorerLine => !!line);

    return [...majorMinorLines, ...pawnLines]
        .sort((a, b) => b.games - a.games)
        .slice(0, AUTO_PLAN_MAX_LINES);
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
    const squares = line.squares.filter(isSquareName);
    const shapes: DrawShape[] = [];
    const brush = brushForPlanLine(line);

    for (let i = 0; i < squares.length - 1; i++) {
        shapes.push({
            orig: squares[i],
            dest: squares[i + 1],
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
            if (shapes.length >= maxShapes) return shapes;
        }
    }

    return shapes;
}

export function formatPlanRoute(squares: string[]) {
    return squares.join(" -> ");
}
