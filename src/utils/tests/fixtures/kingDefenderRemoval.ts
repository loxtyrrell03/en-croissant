// Constructed positions: the defender protects a king's capture square.
// These are not copied game FENs. Negative cases invalidate this particular
// local mechanism, not necessarily every tactical option in the position.
export const kingDefenderRemovalCases = [
    {
        id: "bishop-guard",
        fen: "8/2k5/3b3R/8/5r2/6K1/8/R7 w - - 0 1",
        move: "h6d6",
        positive: true,
    },
    {
        id: "knight-guard",
        fen: "8/3k4/4n2R/8/5r2/6K1/8/R7 w - - 0 1",
        move: "h6e6",
        positive: true,
    },
    {
        id: "replacement-bishop",
        fen: "8/2k5/3b3R/2b5/5r2/6K1/8/R7 w - - 0 1",
        move: "h6d6",
        positive: false,
    },
    {
        id: "second-guard",
        fen: "8/2k5/3b3R/6b1/5r2/6K1/8/R7 w - - 0 1",
        move: "h6d6",
        positive: false,
    },
    {
        id: "off-square-queen",
        fen: "1r6/2k5/3b3R/8/1Q3r2/6K1/8/R7 w - - 0 1",
        move: "h6d6",
        positive: false,
    },
    {
        id: "missing-target",
        fen: "8/2k5/3b3R/8/8/6K1/8/R7 w - - 0 1",
        move: "h6d6",
        positive: false,
    },
    {
        id: "guard-already-free",
        fen: "2k5/8/3b3R/8/5r2/6K1/8/R7 w - - 0 1",
        move: "h6d6",
        positive: false,
    },
] as const;
