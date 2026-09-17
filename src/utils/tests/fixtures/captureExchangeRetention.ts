import { INITIAL_FEN, makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./mixedTargetFork";

// Constructed legal opening. Moving the queen off d1 lets ...Qxd4 retain the
// pawn taken by ...Nxd4 after Nxd4; keeping Qd1 permits Qxd4 in return.
export function captureExchangeRetentionInput(reflected = false, queenSafe = true) {
    const origin = reflected ? reflectMixedForkFen(INITIAL_FEN) : INITIAL_FEN;
    const raw =
        `d2d4 b8c6 e2e3 e7e5 g1f3 d8f6 b1c3 f8e7 ${queenSafe ? "d1e2" : "h2h3"} e5d4 e3d4 c6d4 f3d4`.split(
            " ",
        );
    const moves = reflected ? raw.map(reflectMixedForkMove) : raw;
    const history = replayTacticalLine(origin, moves);
    if (history.length !== moves.length) throw Error("Illegal constructed exchange history");
    return {
        fen: makeFen(history.at(-1)!.after.toSetup()),
        previousFen: makeFen(history.at(-1)!.before.toSetup()),
        previousMoveUci: moves.at(-1)!,
        tacticalHistory: { fen: origin, moves },
        pvUci: [reflected ? reflectMixedForkMove("f6d4") : "f6d4"],
    };
}
