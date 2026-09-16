export const costlyPawnRecaptureCases = [
    {
        id: "rook-defender",
        fen: "6k1/8/8/3nq3/4P3/2PP4/2R5/4K3 b - - 0 1",
        positive: true,
    },
    {
        id: "second-defender-saves-exchange",
        fen: "7k/8/8/3nq3/4P3/1QPP4/2R5/4K3 b - - 0 1",
        positive: false,
    },
    {
        id: "rook-and-queen-defenders",
        fen: "2r4k/8/8/3nq3/4P3/1QPP4/2R5/4K3 b - - 0 1",
        positive: true,
    },
    {
        id: "missing-protector",
        fen: "6k1/8/8/3n4/4P3/2PP4/2R5/4K3 b - - 0 1",
        positive: false,
    },
    {
        id: "equal-recapturer",
        fen: "6k1/8/8/3nq3/4P3/2PP4/4N3/4K3 b - - 0 1",
        positive: false,
    },
    {
        id: "no-recapturer",
        fen: "6k1/8/8/3nq3/4P3/2PP4/8/4K3 b - - 0 1",
        positive: false,
    },
    {
        id: "off-square-rook-loss",
        fen: "6k1/8/8/3nq3/4P3/2PP4/1rR5/4K3 b - - 0 1",
        positive: false,
    },
] as const;
export const costlyPawnRecaptureMove = "d5c3";

// d2-d3 supplies exact non-capture context without creating the c3 opportunity.
export function costlyPawnRecaptureInput(row: { fen: string }) {
    const prior = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    prior.board.take(19);
    prior.board.set(11, { color: "white", role: "pawn" });
    prior.turn = "white";
    const previousFen = makeFen(prior.toSetup());
    const previousMoveUci = "d2d3";
    const move = parseUci(previousMoveUci)!;
    if (!prior.isLegal(move))
        throw new Error("Illegal costly-recapture context");
    prior.play(move);
    return {
        fen: makeFen(prior.toSetup()),
        pvUci: [costlyPawnRecaptureMove],
        previousFen,
        previousMoveUci,
    };
}
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
