import { INITIAL_FEN, makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./mixedTargetFork";

// Constructed legal openings and complete-material analysis starts. These are
// not owner game exports. The final move is independently valued on its board.
const rows = [
    {
        id: "extra-pawn",
        fen: INITIAL_FEN,
        moves: "d2d4 b8c6 e2e3 e7e5 a2a3 d8f6 b1c3 e5d4 e3d4",
        move: "c6d4",
        gain: 100,
    },
    {
        id: "ordinary-pawn-trade",
        fen: INITIAL_FEN,
        moves: "d2d4 b8c6 e2e3 e7e5 a2a3 d8f6 b1c3 e5d4",
        move: "e3d4",
        gain: null,
    },
    {
        id: "capturable-knight",
        fen: INITIAL_FEN,
        moves: "d2d4 b8c6 e2e3 e7e5 g1f3 d8f6 b1c3 e5d4 e3d4",
        move: "c6d4",
        gain: null,
    },
    {
        id: "missing-queen-support",
        fen: INITIAL_FEN,
        moves: "d2d4 b8c6 e2e3 e7e5 a2a3 a7a6 b1c3 e5d4 e3d4",
        move: "c6d4",
        gain: null,
    },
    {
        id: "settled-bishops-then-queen",
        fen: "rnbrq1k1/ppp1ppbp/1n4pp/8/3B1P2/6N1/PPP1PPPP/RNBQ2KR b - - 0 1",
        moves: "g7d4 d1d4",
        move: "d8d4",
        gain: 900,
    },
    {
        id: "queen-with-rook-compensation",
        fen: "rnbrq1k1/ppp1ppbp/1n4pp/8/3B1P2/5N2/PPP1PPPP/RNBQ2KR b - - 0 1",
        moves: "g7d4 d1d4",
        move: "d8d4",
        gain: 400,
    },
];

export const settledRootExchangeCases = rows.flatMap((row) =>
    [false, true].map((reflected) => {
        const origin = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const moves = row.moves
            .split(" ")
            .map((move) => (reflected ? reflectMixedForkMove(move) : move));
        const history = replayTacticalLine(origin, moves);
        if (history.length !== moves.length)
            throw new Error(`Illegal constructed history: ${row.id}`);
        return {
            id: `${row.id}:${reflected}`,
            gain: row.gain,
            fen: makeFen(history.at(-1)!.after.toSetup()),
            previousFen: makeFen(history.at(-1)!.before.toSetup()),
            previousMoveUci: moves.at(-1)!,
            tacticalHistory: { fen: origin, moves },
            pvUci: [reflected ? reflectMixedForkMove(row.move) : row.move],
        };
    }),
);
