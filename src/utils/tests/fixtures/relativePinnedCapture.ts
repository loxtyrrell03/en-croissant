// Constructed geometric/compensation controls, not additional owner games.
export const relativePinnedCaptureCases = [
    {
        id: "rook-pins-pawn-to-queen",
        fen: "3r2k1/5ppp/6b1/8/4P3/3P4/8/3QK3 b - - 0 1",
        move: "g6e4",
        positive: true,
    },
    {
        id: "no-pinner",
        fen: "6k1/5ppp/6b1/8/4P3/3P4/8/3QK3 b - - 0 1",
        move: "g6e4",
        positive: false,
    },
    {
        id: "queen-off-ray",
        fen: "3r2k1/5ppp/6b1/8/4P3/3P4/8/2Q1K3 b - - 0 1",
        move: "g6e4",
        positive: false,
    },
    {
        id: "rear-rook-insufficient-compensation",
        fen: "3r2k1/5ppp/6b1/8/4P3/3P4/8/3RK3 b - - 0 1",
        move: "g6e4",
        positive: false,
    },
    {
        id: "already-profitable-queen-capture",
        fen: "3r2k1/5ppp/6b1/8/4Q3/3P4/8/3QK3 b - - 0 1",
        move: "g6e4",
        positive: false,
    },
    {
        id: "off-ray-pinner-liability",
        fen: "3r2k1/5ppp/6b1/6B1/4P3/3P4/8/3QK3 b - - 0 1",
        move: "g6e4",
        positive: false,
    },
    {
        id: "rook-countercheck-releases-pin",
        fen: "8/6rk/5n2/8/4p3/3P4/1B6/4K3 w - - 0 1",
        move: "d3e4",
        positive: false,
    },
    {
        id: "bishop-pins-knight-to-rook",
        fen: "6k1/6r1/5n2/8/2P1p3/1P1P4/1BKP4/8 w - - 0 1",
        move: "d3e4",
        positive: true,
    },
    {
        id: "bishop-knight-exchange-not-a-relative-pin",
        fen: "6k1/4b2p/5n2/6B1/8/3B4/8/6K1 w - - 0 1",
        move: "d3h7",
        positive: false,
    },
];
