import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

// Pure legal-history construction also runs in the Node service/HTTP harnesses;
// no classifier implementation is used to construct its own test inputs.
export function advancedPawnSequenceInput(raw: string, capture: string, reflected = false) {
    const flip = (move: string) => reflected ? move.replace(/[1-8]/g, rank => String(9 - Number(rank))) : move;
    const start = reflected ? INITIAL_FEN.replace(" w ", " b ") : INITIAL_FEN;
    const moves = raw.split(" ").map(flip);
    const position = Chess.fromSetup(parseFen(start).unwrap()).unwrap();
    let previousFen = start;
    for (const uci of moves) {
        previousFen = makeFen(position.toSetup());
        const move = parseUci(uci);
        if (!move || !position.isLegal(move)) throw Error(`Illegal constructed advanced-pawn history: ${uci}`);
        position.play(move);
    }
    return { fen: makeFen(position.toSetup()), tacticalHistory: { fen: start, moves },
        previousFen, previousMoveUci: moves.at(-1)!, pvUci: [flip(capture)] };
}

// Constructed opening, not an owner game. A pawn captures an offered bishop,
// then advances onto a loose square. Waiting without another capture should
// not erase that already established local opportunity.
export function advancedPawnHistoryInput(reflected = false, waiting = true, defended = false) {
    const opening = "a2a3 e7e5 b2b3 f8c5 h2h3 c5e3 f2e3 g8f6 e3e4";
    return advancedPawnSequenceInput(`${opening}${waiting ? ` b8c6 a3a4 a7a6 ${defended ? "d2d3" : "h3h4"}` : ""}`, "f6e4", reflected);
}

export function advancedPawnIntegrationCases() {
    return [false, true].flatMap(reflected => [
        { id: `advanced:${reflected}`, positive: true, ...advancedPawnHistoryInput(reflected) },
        { id: `defended:${reflected}`, positive: false, ...advancedPawnHistoryInput(reflected, true, true) },
        { id: `gambit-return:${reflected}`, positive: false, ...advancedPawnSequenceInput(
            "e2e4 e7e5 f2f4 e5f4 b1c3 f4f3 a2a3 a7a6 h2h3 h7h6", "g1f3", reflected) },
    ]);
}
