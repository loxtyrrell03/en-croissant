// Constructed rook-lift mechanism and contrary resources, not owner PGNs.
export const shortMatingThreatCases = [
    {
        id: "rook-lift-with-countercheck",
        fen: "2b2r1k/5r2/5PQ1/ppp5/6P1/8/1P5P/R3K1R1 w - - 0 1",
        move: "g1g3",
        positive: true,
    },
    // Rxf6+ forces liquidation: Qxf6+ Rxf6+ gives up the queen for a rook.
    // The position can remain winning; that does not prove this new gain/mate.
    {
        id: "f-file-countercheck-forces-liquidation",
        fen: "2b2r1k/5r2/5PQ1/ppp5/6P1/8/1P5P/R4KR1 w - - 0 1",
        move: "g1g3",
        positive: false,
    },
    {
        id: "queen-capture-refutes-threat",
        fen: "2b2r1k/5r2/5PQ1/ppp5/5nP1/8/1P5P/R3K1R1 w - - 0 1",
        move: "g1g3",
        positive: false,
    },
    {
        id: "blocked-and-capturable-rook",
        fen: "2b2r1k/5r2/5PQ1/ppp5/6Pp/8/1P5P/R3K1R1 w - - 0 1",
        move: "g1g3",
        positive: false,
    },
    {
        id: "existing-short-threat",
        fen: "2b2r1k/5r2/5PQ1/ppp5/6P1/6R1/1P5P/R3K3 w - - 0 1",
        move: "b2b3",
        positive: false,
    },
    {
        id: "claimable-position",
        fen: "2b2r1k/5r2/5PQ1/ppp5/6P1/8/1P5P/R3K1R1 w - - 98 1",
        move: "g1g3",
        positive: false,
    },
];
