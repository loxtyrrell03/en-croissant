import { INITIAL_FEN, makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./mixedTargetFork";

// Constructed opening, not an owner game. A pawn captures an offered bishop,
// then advances onto a loose square. Waiting without another capture should
// not erase that already established local opportunity.
export function advancedPawnHistoryInput(reflected = false, waiting = true) {
    const start = reflected ? reflectMixedForkFen(INITIAL_FEN) : INITIAL_FEN;
    const opening = "a2a3 e7e5 b2b3 f8c5 h2h3 c5e3 f2e3 g8f6 e3e4";
    const raw = `${opening}${waiting ? " b8c6 a3a4 a7a6 h3h4" : ""}`.split(" ");
    const moves = reflected ? raw.map(reflectMixedForkMove) : raw;
    const steps = replayTacticalLine(start, moves);
    if (steps.length !== moves.length) throw Error("Illegal constructed advanced-pawn history");
    const last = steps.at(-1)!;
    return {
        fen: makeFen(last.after.toSetup()),
        tacticalHistory: { fen: start, moves },
        previousFen: makeFen(last.before.toSetup()),
        previousMoveUci: last.uci,
        pvUci: [reflected ? reflectMixedForkMove("f6e4") : "f6e4"],
    };
}
