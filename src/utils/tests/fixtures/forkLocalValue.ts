// Constructed queen/king-and-knight fork, not an owner-game export.
export const forkLocalValueFen = "4k3/7p/8/8/4n3/8/P7/R2Q2K1 w - - 0 1";
export const forkLocalValueLine = ["d1a4", "e8e7", "a4e4", "e7d6"];
export const forkLocalValueLongLine = [...forkLocalValueLine, "e4h7"];
export const forkLocalValuePrefixFen = "4k3/7p/8/8/4n3/8/P6q/R2Q2K1 w - - 0 1";
export const forkLocalValuePrefixLine = ["g1h2", "h7h6", ...forkLocalValueLine];
export const forkMateLiabilityFen = "4r3/8/2n3Rp/7k/8/8/PPP2q1P/2BK4 w - - 0 1";

export const forkLocalValueCases = [
    { id: "mating-liability", fen: forkMateLiabilityFen, pvUci: ["g6h6"], gain: null },
    {
        id: "no-mating-rook",
        fen: forkMateLiabilityFen.replace("4r3", "8"),
        pvUci: ["g6h6"],
        gain: 320,
    },
    { id: "root-only", fen: forkLocalValueFen, pvUci: ["d1a4"], gain: 320 },
    { id: "later-pawn", fen: forkLocalValueFen, pvUci: forkLocalValueLongLine, gain: 320 },
    {
        id: "queen-takes-forker",
        fen: "q6k/8/8/1B6/8/8/2K5/4R3 w - - 0 1",
        pvUci: ["e1e8"],
        gain: 400,
    },
    {
        id: "capture-then-fork",
        fen: "q3n2k/8/8/1B6/8/8/2K5/4R3 w - - 0 1",
        pvUci: ["e1e8"],
        gain: 720,
    },
    {
        id: "promotion-interposition",
        fen: "4R3/2K5/8/8/1B6/8/5p2/q6k w - - 0 1",
        pvUci: ["e8e1"],
        gain: null,
    },
    {
        id: "underpromotion",
        fen: "K7/1P1q3p/k7/8/8/6P1/7P/8 w - - 0 54",
        pvUci: ["b7b8n"],
        gain: 1120,
    },
];
