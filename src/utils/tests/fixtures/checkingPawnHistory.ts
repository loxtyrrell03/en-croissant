import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

// Constructed full-history controls, not additional owner games or engine
// rankings. Synthetic scores exercise admission, not best-move selection.
const controls = [
    {
        id: "loose-pawn-with-check",
        moves: ["e2e4", "d7d5", "d1h5", "e7e5", "g1f3", "e8e7"],
        root: "h5e5",
        gain: true,
    },
    {
        id: "pawn-guard-captures-queen",
        moves: ["e2e4", "d7d6", "d1h5", "e7e5", "g1f3", "e8e7"],
        root: "h5e5",
        gain: false,
    },
    {
        id: "checking-sacrifice-recovery",
        moves: ["e2e4", "e7e5", "g1f3", "f7f6", "f3e5", "f6e5", "d1h5", "g7g6"],
        root: "h5e5",
        gain: false,
    },
    {
        id: "poisoned-f7-pawn",
        moves: ["e2e4", "e7e5", "f1c4", "b8c6", "g1f3", "g8f6"],
        root: "c4f7",
        gain: false,
    },
];
const reflect = (uci: string) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
export const checkingPawnHistoryCases = controls.flatMap((row) =>
    [false, true].map((reflected) => {
        const origin = reflected ? INITIAL_FEN.replace(" w ", " b ") : INITIAL_FEN;
        const moves = reflected ? row.moves.map(reflect) : row.moves;
        const move = reflected ? reflect(row.root) : row.root;
        const pos = Chess.fromSetup(parseFen(origin).unwrap()).unwrap();
        for (const uci of moves) {
            const action = parseUci(uci);
            if (!action || !pos.isLegal(action))
                throw new Error(`Illegal history control ${row.id}`);
            pos.play(action);
        }
        return {
            id: `${row.id}${reflected ? ":reflected" : ""}`,
            gain: row.gain,
            fen: makeFen(pos.toSetup()),
            tacticalHistory: { fen: origin, moves },
            pvUci: [move],
            depth: 16,
            engineName: "Constructed history control",
            variations: [{ pvUci: [move], cp: 100, depth: 16 }],
        };
    }),
);
