import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import { pgnOrientation } from "@/utils/pgnOrientation";
import type { WebColor, WebGame } from "./model";

/** Re-read portable headers so existing saved games gain the same behavior
 * without a data migration. Explicit Prep/player choices remain authoritative. */
export function webGameBoardSetup(game: Pick<WebGame, "moves" | "pgn">, orientation?: WebColor) {
    let startFen = game.moves[0]?.fenBefore ?? INITIAL_FEN;
    let importedOrientation: unknown;
    try {
        const parsed = parsePgn(game.pgn)[0];
        importedOrientation = parsed?.headers.get("Orientation");
        if (parsed && game.moves.length === 0) {
            startFen = makeFen(startingPosition(parsed.headers).unwrap().toSetup());
        }
    } catch {
        // Existing move evidence remains usable if old portable headers fail.
    }
    return { startFen, orientation: orientation ?? pgnOrientation(startFen, importedOrientation) };
}
