// Constructed controls, not additional owner or Lichess games.
export const checkingExchangeFen = "3rk3/2Q5/2p5/8/8/b6q/5P2/1N3RK1 w - - 0 1";
export const checkingExchangeLine = ["c7c6", "h3d7", "c6d7", "d8d7"];
export const checkingExchangeCases = [
    {
        id: "retained-through-interposition",
        fen: checkingExchangeFen,
        pvUci: checkingExchangeLine,
        positive: true,
    },
    {
        id: "rook-interposition",
        fen: "k7/7r/p7/8/8/8/7P/R5K1 w - - 0 1",
        pvUci: ["a1a6", "h7a7", "a6a7", "a8a7"],
        positive: true,
    },
    // The initial draft chose Nxa3 here and allowed a mating king hunt.
    {
        id: "exposed-king-mating-counterplay",
        fen: "3rk3/2Q5/2p5/8/8/b6q/8/1N4K1 w - - 0 1",
        pvUci: checkingExchangeLine,
        positive: false,
    },
    {
        id: "capturable-checker",
        fen: checkingExchangeFen.replace("2p5/8/8", "2p5/n7/8"),
        pvUci: checkingExchangeLine,
        positive: false,
    },
    {
        id: "unequal-interposer",
        fen: checkingExchangeFen,
        pvUci: ["c7c6", "d8d7", "c6d7"],
        positive: false,
    },
    { id: "no-nominated-exchange", fen: checkingExchangeFen, pvUci: ["c7c6"], positive: false },
    {
        id: "terminal-drawn-trade",
        fen: "k7/7r/p7/8/8/8/8/R5K1 w - - 0 1",
        pvUci: ["a1a6", "h7a7", "a6a7", "a8a7"],
        positive: false,
    },
];
