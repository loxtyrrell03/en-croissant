import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
const reflectMixedForkMove = (uci: string) => uci.replace(/[1-8]/g, rank => String(9 - Number(rank)));

export const persistentPawnMoves = [
    "e2e4",
    "e7e5",
    "g1f3",
    "b8c6",
    "a2a3",
    "g8f6",
    "f1c4",
];
const rows = [
    {
        id: "older-loose-pawn",
        moves: persistentPawnMoves,
        capture: "f6e4",
        positive: true,
    },
    {
        id: "petroff-recovery",
        moves: ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "d7d6", "e5f3"],
        capture: "f6e4",
        positive: false,
    },
    {
        id: "delayed-catalan",
        moves: [
            "d2d4",
            "d7d5",
            "c2c4",
            "e7e6",
            "g1f3",
            "g8f6",
            "g2g3",
            "d5c4",
            "f1g2",
            "b8c6",
            "d1a4",
            "c8d7",
        ],
        capture: "a4c4",
        positive: false,
    },
];
export const persistentPawnCases = rows.flatMap((row) =>
    [false, true].map((reflected) => {
        // Full initial rights are symmetric; replay, rather than reflecting reached
        // clocks/rights, constructs the exact target for the opposite first mover.
        const origin = reflected
            ? INITIAL_FEN.replace(" w ", " b ")
            : INITIAL_FEN;
        const moves = reflected
            ? row.moves.map(reflectMixedForkMove)
            : row.moves;
        const root = reflected
            ? reflectMixedForkMove(row.capture)
            : row.capture;
        const position = Chess.fromSetup(parseFen(origin).unwrap()).unwrap();
        let previousFen = origin;
        for (const uci of moves) {
            const move = parseUci(uci);
            if (!move || !position.isLegal(move)) throw new Error(`Illegal public history fixture ${row.id}`);
            previousFen = makeFen(position.toSetup());
            position.play(move);
        }
        return {
            id: `${row.id}${reflected ? "-reflected" : ""}`,
            positive: row.positive,
            fen: makeFen(position.toSetup()),
            previousFen,
            previousMoveUci: moves.at(-1)!,
            tacticalHistory: { fen: origin, moves },
            pvUci: [root],
            variations: [{ pvUci: [root], cp: 100, depth: 16 }],
        };
    }),
);
