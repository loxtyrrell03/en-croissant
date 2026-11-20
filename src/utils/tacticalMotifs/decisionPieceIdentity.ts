import { castlingSide, type Chess } from "chessops/chess";
import type { Square } from "chessops/types";
import { kingCastlesTo, rookCastlesTo } from "chessops/util";
import type { TacticalReplayStep } from "./causalTactics";

export function initialPieceIdentities(position: Chess) {
    return new Map<Square, Square>([...position.board].map(([square]) => [square, square]));
}

/** The values remain the original squares, including through promotion. */
export function followPieceIdentities(
    identities: Map<Square, Square>,
    { before, move, capture }: TacticalReplayStep,
) {
    const origin = identities.get(move.from)!;
    identities.delete(move.from);
    const castle = castlingSide(before, move);
    if (castle) {
        const rook = before.castles.rook[before.turn][castle]!;
        const rookOrigin = identities.get(rook)!;
        identities.delete(rook);
        identities.set(rookCastlesTo(before.turn, castle), rookOrigin);
        identities.set(kingCastlesTo(before.turn, castle), origin);
        return undefined;
    }
    let captured: Square | undefined;
    if (capture) {
        const taken =
            before.epSquare === move.to && before.board.get(move.from)?.role === "pawn"
                ? move.to + (before.turn === "white" ? -8 : 8)
                : move.to;
        captured = identities.get(taken);
        identities.delete(taken);
    }
    identities.set(move.to, origin);
    return captured;
}
