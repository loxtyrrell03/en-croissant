import { INITIAL_FEN, makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./mixedTargetFork";

// Constructed legal openings, not owner games. Unrelated queen losses cannot
// erase an untouched pawn opportunity; queen gains cannot fund an ordinary
// reciprocal pawn capture either. Neither example promises a winning position.
export function independentPawnHistoryInput(reflected = false, reciprocal = false) {
    const fen = reflected ? reflectMixedForkFen(INITIAL_FEN) : INITIAL_FEN;
    const raw = (
        reciprocal
            ? "e2e4 e7e5 g1f3 b8c6 a2a3 a7a6 d1e2 g8f6 e2b5 c6d4 f3e5 d4b5 h2h3"
            : "e2e3 e7e5 g1f3 b8c6 a2a3 g8f6 d1e2 c6d4 e2b5 d4b5 b1c3 a7a6"
    ).split(" ");
    const moves = reflected ? raw.map(reflectMixedForkMove) : raw;
    const history = replayTacticalLine(fen, moves);
    if (history.length !== moves.length)
        throw Error("Illegal constructed independent pawn history");
    const capture = reciprocal ? "f6e4" : "f3e5";
    return {
        fen: makeFen(history.at(-1)!.after.toSetup()),
        tacticalHistory: { fen, moves },
        previousFen: makeFen(history.at(-1)!.before.toSetup()),
        previousMoveUci: moves.at(-1)!,
        pvUci: [reflected ? reflectMixedForkMove(capture) : capture],
    };
}
