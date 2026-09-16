// Constructed mate-or-material geometry, with pawn locations changed from the
// development game. Without the second pawn a short mating route still
// handles the king escape. Negative cases refute this finite certificate,
// not necessarily the whole position's winning evaluation.
export const captureMatingGuardCases = [
    {
        id: "mate-or-exchange-or-pawn",
        fen: "2r2rk1/1R5n/p2p3P/5p2/6pK/1PP5/8/5b2 b - - 0 1",
        positive: true,
        gain: 200,
    },
    {
        id: "no-second-target",
        fen: "2r2rk1/1R5n/p2p3P/5p2/6pK/2P5/8/5b2 b - - 0 1",
        positive: true,
        gain: 280,
    },
    {
        id: "protected-guard-capturer",
        fen: "2r2rk1/1R5n/p2p2BP/5p2/6pK/1PP5/8/5b2 b - - 0 1",
        positive: false,
    },
    {
        id: "missing-pawn-mating-guard",
        fen: "2r2rk1/1R5n/p2p3P/8/6pK/1PP5/8/5b2 b - - 0 1",
        positive: false,
    },
];
