// Real Lichess tA2XR, https://lichess.org/heingGcp/black#64.
// Controls are constructed modifications, not additional real games.
export const forkRepairFen = "4r1k1/6p1/7p/ppnNq1P1/4r3/1QP1P3/PP6/2K2N1R w - - 3 33";
export const forkRepairCases = [
    { id: "root-only", fen: forkRepairFen, pvUci: ["d5f6"], positive: true },
    { id: "quiet-queen-repair", fen: forkRepairFen, pvUci: ["d5f6", "g8h8", "b3f7"], positive: true },
    { id: "checking-queen-repair", fen: forkRepairFen, pvUci: ["d5f6", "g8f8", "b3g8"], positive: true },
    { id: "no-mating-rook", fen: forkRepairFen.replace("2K2N1R", "2K2N2"), pvUci: ["d5f6"], positive: false },
    { id: "blocked-mating-file", fen: forkRepairFen.replace("PP6", "PP5r"), pvUci: ["d5f6"], positive: false },
];
