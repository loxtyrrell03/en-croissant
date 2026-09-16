// Constructed positions: the g6 pawn closes h5 and the a2 pawn prevents
// Ra7+ counterplay. These are not the owner's complete game positions.
export const branchQuietMateFen = "4r3/4rk2/2n3p1/5n2/5P2/8/P4KPP/R6R b - - 0 1";
export const branchQuietMateLine = ["e7e2", "f2f1", "c6d4", "g2g3", "f5e3", "f1g1", "d4f3"];
export const branchQuietMateChoice = {
    fen: "4r3/p4k2/1N4p1/5n2/3n1P2/8/P3r1PP/R4K1R b - - 0 1",
    pvUci: ["a7b6", "a2a3", "f5e3", "f1g1", "d4f3", "g2f3", "e2g2"],
    bestLine: ["f5e3", "f1g1", "e2g2"],
    shortLine: ["a7b6", "a1e1", "f5e3", "f1g1", "e2g2"],
};
export const branchQuietMateCases = [
    {
        id: "checking-and-quiet-knight",
        fen: branchQuietMateFen,
        pvUci: branchQuietMateLine,
        positive: true,
    },
    {
        id: "capturable-checker",
        fen: branchQuietMateFen.replace("R6R", "R2B3R"),
        pvUci: branchQuietMateLine,
        positive: false,
    },
    {
        id: "king-flight",
        fen: branchQuietMateFen.replace("5P2", "8"),
        pvUci: branchQuietMateLine,
        positive: false,
    },
    {
        id: "rook-countercheck",
        fen: branchQuietMateFen.replace("P4KPP", "5KPP"),
        pvUci: branchQuietMateLine,
        positive: false,
    },
    {
        id: "root-only",
        fen: branchQuietMateFen,
        pvUci: branchQuietMateLine.slice(0, 1),
        positive: false,
    },
    {
        id: "claim-before-mate",
        fen: branchQuietMateFen.replace(" 0 1", " 99 1"),
        pvUci: branchQuietMateLine,
        positive: false,
    },
];
