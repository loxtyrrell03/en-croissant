import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./mixedTargetFork";

// Constructed opening layout, not an owner-game record: the a-pawn is advanced.
export const captureLiabilityPredecessor =
    "r2qkb1r/pppb1ppp/2n2n2/1B1pp3/3PP3/P1N2N2/1PP2PPP/R1BQK2R w KQkq - 0 1";

export function captureLiabilityInput(reflected = false) {
    const previousFen = reflected ? reflectMixedForkFen(captureLiabilityPredecessor) : captureLiabilityPredecessor;
    const previousMoveUci = reflected ? reflectMixedForkMove("f3g5") : "f3g5";
    return {
        fen: makeFen(replayTacticalLine(previousFen, [previousMoveUci])[0].after.toSetup()),
        previousFen,
        previousMoveUci,
        pvUci: [reflected ? reflectMixedForkMove("c6d4") : "c6d4"],
    };
}
