import type { Color } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { positionFromFen } from "./chessops";

export function explicitPgnOrientation(value: unknown): Color | null {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return normalized === "white" || normalized === "black" ? normalized : null;
}

/** An imported perspective wins. Otherwise a standalone position faces its
 * starting mover; navigation through that game never changes the orientation. */
export function pgnOrientation(fen: string, requested?: unknown, fallback: Color = "white"): Color {
    const explicit = explicitPgnOrientation(requested);
    if (explicit) return explicit;
    const [position] = positionFromFen(fen);
    return position && makeFen(position.toSetup()) !== INITIAL_FEN ? position.turn : fallback;
}
