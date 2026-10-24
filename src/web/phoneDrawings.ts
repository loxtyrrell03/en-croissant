import { makeSquare, parseSquare } from "chessops";
import { makeComment, parseComment } from "chessops/pgn";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { WebCompanionState, WebDrawing, WebDrawingBrush } from "./model";

export const PHONE_DRAWING_BRUSHES: WebDrawingBrush[] = ["green", "red", "blue", "yellow"];
export type PhoneDrawingUpdate = readonly unknown[] | ((current: WebDrawing[]) => WebDrawing[]);

/** Only portable user marks are saved. Engine/piece/SVG overlays stay separate. */
export function normalizePhoneDrawings(shapes: readonly unknown[] | undefined): WebDrawing[] {
    const result: WebDrawing[] = [];
    if (!Array.isArray(shapes)) return result;
    for (const value of shapes ?? []) {
        if (!value || typeof value !== "object") continue;
        const shape = value as Partial<DrawShape>;
        if (
            shape.piece ||
            shape.customSvg ||
            !PHONE_DRAWING_BRUSHES.includes(shape.brush as WebDrawingBrush)
        )
            continue;
        if (typeof shape.orig !== "string" || !/^[a-h][1-8]$/.test(shape.orig)) continue;
        if (
            shape.dest !== undefined &&
            (typeof shape.dest !== "string" || !/^[a-h][1-8]$/.test(shape.dest))
        )
            continue;
        const drawing: WebDrawing = { orig: shape.orig, brush: shape.brush as WebDrawingBrush };
        if (shape.dest && shape.dest !== shape.orig) drawing.dest = shape.dest;
        if (
            !result.some(
                (old) =>
                    old.orig === drawing.orig &&
                    old.dest === drawing.dest &&
                    old.brush === drawing.brush,
            )
        )
            result.push(drawing);
    }
    return result;
}

export function phoneDrawingsFromComments(comments: readonly string[] | undefined): WebDrawing[] {
    return normalizePhoneDrawings(
        (comments ?? []).flatMap((comment) =>
            parseComment(comment).shapes.map((shape) => ({
                orig: makeSquare(shape.from),
                dest: makeSquare(shape.to),
                brush: shape.color,
            })),
        ),
    );
}

export function phoneDrawingComment(shapes: readonly WebDrawing[]): string {
    return makeComment({
        shapes: shapes.map((shape) => ({
            from: parseSquare(shape.orig)!,
            to: parseSquare(shape.dest ?? shape.orig)!,
            color: shape.brush,
        })),
    });
}

export function togglePhoneDrawing(
    shapes: readonly WebDrawing[],
    orig: string,
    dest: string,
    brush: WebDrawingBrush,
): WebDrawing[] {
    const next = normalizePhoneDrawings([{ orig, dest, brush }])[0];
    if (!next) return normalizePhoneDrawings(shapes);
    const old = shapes.find((shape) => shape.orig === next.orig && shape.dest === next.dest);
    const others = shapes.filter((shape) => shape.orig !== next.orig || shape.dest !== next.dest);
    return normalizePhoneDrawings(old?.brush === brush ? others : [...others, next]);
}

/** Exact root + move history, scoped to the actual board or Prep owner, never FEN alone. */
export function phoneDrawingSeat(state: WebCompanionState) {
    const prep = state.prepWorkspaces.find((item) => item.id === state.activePrepId);
    const line = prep?.line ?? state.board.line;
    const startFen = prep?.startFen ?? state.board.startFen;
    const cursor = Math.max(0, Math.min(state.board.cursor, line.length));
    const prefix = line.slice(0, cursor);
    const fen = prefix.at(-1)?.fenAfter ?? startFen;
    const node = JSON.stringify([startFen, prefix.map((move) => move.uci ?? move.san), fen]);
    const owner = JSON.stringify([
        prep?.id ?? state.board.annotationOwnerId ?? null,
        prep ? null : state.board.sourceDatabaseId,
        prep ? null : state.board.sourceGameId,
        node,
    ]);
    return { prep, line, startFen, cursor, fen, node, owner };
}

let boardOwnerSequence = 0;
export function newPhoneAnnotationOwner() {
    return globalThis.crypto?.randomUUID?.() ?? `phone-board-${Date.now()}-${++boardOwnerSequence}`;
}

export function phoneDrawingsToChessground(shapes: readonly WebDrawing[]): DrawShape[] {
    return normalizePhoneDrawings(shapes).map((shape) => ({
        ...shape,
        orig: shape.orig as DrawShape["orig"],
        dest: shape.dest as DrawShape["dest"],
    }));
}
