// Constructed teaching positions; not exports of owner games or paid courses.
// Accepting the minor-piece offer vacates a line to a different fork victim.
export const forkRayClearanceCases = [
    { id: "queen-diagonal", fen: "8/5b2/6N1/8/2N5/1K1P4/4q3/1k6 b - - 0 1", move: "f7c4" },
];

export const forkRayClearanceControls = [
    // Qc2+ can be captured by the king; Qb1 is not a legal queen move from e2.
    { id: "unprotected-forker", fen: "8/5b2/6N1/8/2N5/1K1P4/4q3/k7 b - - 0 1", move: "f7c4" },
    // The simpler direct capture makes the checking fork unnecessary.
    { id: "direct-queen-capture", fen: "8/5b2/6N1/8/2N1q3/1K1P4/8/1k6 b - - 0 1", move: "f7c4" },
    { id: "direct-rook-deflection", fen: "7k/2N5/8/b7/1N6/2P5/2r5/6K1 b - - 0 1", move: "a5b4" },
    // Accepting also defends Nc5: ...Rc1+ ...Rxc5 can be met by bxc5.
    { id: "receiver-defends-victim", fen: "7k/8/8/b1N5/1N6/2P5/2r5/6K1 b - - 0 1", move: "a5b4" },
    // Vacating d3 does not clear the entire diagonal to Ng6.
    { id: "second-ray-blocker", fen: "8/5b2/6N1/5P2/2N1q3/1K1P4/8/1k6 b - - 0 1", move: "f7c4" },
    { id: "pawn-not-material-fork", fen: "8/5b2/6P1/8/2N1q3/1K1P4/8/1k6 b - - 0 1", move: "f7c4" },
    // ...Rc1+ already has the c-file: axb4 did not prepare its ray.
    { id: "already-open-ray", fen: "7k/2N5/8/b7/1N6/P7/2r5/6K1 b - - 0 1", move: "a5b4" },
    { id: "second-file-blocker", fen: "7k/2N5/8/b7/1NP5/2P5/2r5/6K1 b - - 0 1", move: "a5b4" },
    // The supposed fork victim can capture the checking rook itself.
    { id: "victim-captures-forker", fen: "7k/2R5/8/b7/1N6/2P5/2r5/6K1 b - - 0 1", move: "a5b4" },
];
