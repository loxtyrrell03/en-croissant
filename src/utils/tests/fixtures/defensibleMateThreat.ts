// Public opening geometry, constructed independently of the private game audit.
export const defensibleMateThreatFen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3";
export const defensibleMateThreatCases = [
    { id: "opening-threat", fen: defensibleMateThreatFen, pvUci: ["d1h5", "g7g6", "h5f3"], cp: 0, positive: true },
    { id: "capturable-queen", fen: defensibleMateThreatFen.replace("2n5", "2n2n2").replace("kbnr", "kb1r"), pvUci: ["d1h5"], cp: 900, positive: false },
    { id: "ordinary-development", fen: defensibleMateThreatFen, pvUci: ["b1c3"], cp: 0, positive: false },
    { id: "missing-score", fen: defensibleMateThreatFen, pvUci: ["d1h5"], cp: undefined, positive: false },
    { id: "losing-candidate", fen: defensibleMateThreatFen, pvUci: ["d1h5"], cp: -500, positive: false },
];
