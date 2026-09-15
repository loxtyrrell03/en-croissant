// Constructed controls for catching a discovered target after it flees onto
// a pin. These are not additional independent real-game observations.
export const discoveryTrapFen = "2b1kb2/2p1pp2/8/3p4/2qP4/P1N2N2/1PP1P3/R2QKB2 w - - 0 1";
export const discoveryTrapCases = [
    { id: "covered-flights-and-king-pin", fen: discoveryTrapFen, positive: true },
    { id: "queen-b4-escape", fen: discoveryTrapFen.replace("P1N2N2", "2N2N2"), positive: false },
    { id: "queen-a4-escape", fen: discoveryTrapFen.replace("P1N2N2", "P4N2"), positive: false },
    {
        id: "checking-queen-capture-escape",
        fen: discoveryTrapFen.replace("1PP1P3", "2P1P3"),
        positive: false,
    },
    {
        id: "king-off-pinning-diagonal",
        fen: discoveryTrapFen.replace("2b1kb2", "2b2bk1"),
        positive: false,
    },
    {
        id: "discovery-still-blocked",
        fen: discoveryTrapFen.replace("P1N2N2", "P1NB1N2"),
        positive: false,
    },
    {
        id: "off-square-queen-liability",
        fen: discoveryTrapFen.replace("2b1kb2/2p1pp2", "Q1b1kb2/1bp1pp2"),
        positive: false,
    },
];
