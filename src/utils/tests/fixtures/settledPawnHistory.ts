import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { reflectMixedForkMove } from "./mixedTargetFork";

// Constructed legal opening sequences, not copied owner positions. In the
// first sequence the d4 pawn recaptures a knight that just captured a knight.
// That settled exchange must not become debt against a later loose-pawn gain.
const rows = [
    {
        id: "settled-knight-exchange",
        positive: true,
        moves: "e2e4 e7e5 g1f3 b8c6 a2a3 c6d4 f3d4 e5d4 c2c3 d7d6 d1a4 c7c6",
    },
    {
        id: "unrecovered-knight",
        positive: false,
        moves: "e2e4 e7e5 g1f3 a7a6 a2a3 b7b6 f3d4 e5d4 c2c3 d7d6 d1a4 c7c6",
    },
];

export const settledPawnHistoryCases = rows.flatMap((row) =>
    [false, true].map((reflected) => {
        const origin = reflected ? INITIAL_FEN.replace(" w ", " b ") : INITIAL_FEN;
        const moves = row.moves
            .split(" ")
            .map((move) => (reflected ? reflectMixedForkMove(move) : move));
        const position = Chess.fromSetup(parseFen(origin).unwrap()).unwrap();
        let previousFen = origin;
        for (const uci of moves) {
            const move = parseUci(uci);
            if (!move || !position.isLegal(move))
                throw new Error(`Illegal constructed history: ${row.id} ${uci}`);
            previousFen = makeFen(position.toSetup());
            position.play(move);
        }
        const capture = reflected ? reflectMixedForkMove("a4d4") : "a4d4";
        return {
            id: `${row.id}${reflected ? "-reflected" : ""}`,
            positive: row.positive,
            fen: makeFen(position.toSetup()),
            previousFen,
            previousMoveUci: moves.at(-1)!,
            tacticalHistory: { fen: origin, moves },
            pvUci: [capture],
        };
    }),
);
