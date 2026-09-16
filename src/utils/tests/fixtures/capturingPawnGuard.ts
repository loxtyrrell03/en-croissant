import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

// Constructed controls, not additional owner games. The last move captures
// elsewhere; the nominated pawn is stationary and its former guard has left.
export const capturingPawnGuardCases = [
    {
        id: "pawn-guard",
        before: "r5k1/p5pp/3p4/2P1p3/8/5N2/P5PP/R5K1 b - - 0 1",
        previous: "d6c5",
        move: "f3e5",
        exposed: true,
        visible: true,
    },
    {
        id: "bishop-guard",
        before: "r5k1/p5pp/3b4/2P1p3/8/5N2/P4PPP/R5K1 b - - 0 1",
        previous: "d6c5",
        move: "f3e5",
        exposed: true,
        visible: true,
    },
    {
        id: "remaining-guard",
        before: "r5k1/p5pp/3p1p2/2P1p3/8/5N2/P5PP/R5K1 b - - 0 1",
        previous: "d6c5",
        move: "f3e5",
        exposed: true,
        visible: false,
    },
    {
        id: "still-defends",
        before: "r5k1/p1P3pp/3b4/4p3/8/5N2/P5PP/R5K1 b - - 0 1",
        previous: "d6c7",
        move: "f3e5",
        exposed: false,
        visible: false,
    },
    {
        id: "already-loose",
        before: "r5k1/p5pp/1p6/2P1p3/8/5N2/P5PP/R5K1 b - - 0 1",
        previous: "b6c5",
        move: "f3e5",
        exposed: false,
        visible: false,
    },
    {
        id: "ordinary-recapture",
        before: "r5k1/p5pp/4p3/3P4/2P5/8/P5PP/R5K1 b - - 0 1",
        previous: "e6d5",
        move: "c4d5",
        exposed: false,
        visible: false,
    },
    {
        id: "off-square-rook",
        before: "1r4k1/p5pp/3p4/2P1p3/8/5N2/PR4PP/6K1 b - - 0 1",
        previous: "d6c5",
        move: "f3e5",
        exposed: true,
        visible: false,
    },
    {
        id: "checking-needs-retention",
        before: "r7/p5pp/3p4/2P1p3/6k1/5N2/P5PP/R5K1 b - - 0 1",
        previous: "d6c5",
        move: "f3e5",
        exposed: false,
        visible: false,
    },
].map((row) => {
    const position = Chess.fromSetup(parseFen(row.before).unwrap()).unwrap();
    const move = parseUci(row.previous);
    if (!move || !position.isLegal(move))
        throw new Error(`Illegal constructed guard move: ${row.id}`);
    position.play(move);
    return { ...row, fen: makeFen(position.toSetup()) };
});

export function capturingPawnGuardInput(row = capturingPawnGuardCases[0]) {
    return {
        fen: row.fen,
        previousFen: row.before,
        previousMoveUci: row.previous,
        pvUci: [row.move],
    };
}
