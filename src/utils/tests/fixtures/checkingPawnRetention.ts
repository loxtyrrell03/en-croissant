// Constructed boards. The zero score is a nomination-policy input, not a
// Stockfish judgement; real owner positions are kept in the private audit.
export const checkingPawnRetentionFen = "4k3/2Q5/2p5/8/8/bq6/8/1N4K1 w - - 0 1";
export const checkingPawnLiabilityFen = "4k3/2Q5/2p4p/6p1/7B/bq6/8/1N4K1 w - - 0 1";
export const checkingPawnRetentionLine = ["c7c6", "e8f8", "b1a3"];
export const checkingPawnRetentionCases = [
    {
        id: "retained",
        fen: checkingPawnRetentionFen,
        pvUci: checkingPawnRetentionLine,
        positive: true,
    },
    {
        id: "bishop-liability",
        fen: checkingPawnLiabilityFen,
        pvUci: checkingPawnRetentionLine,
        positive: false,
    },
    { id: "root-only", fen: checkingPawnRetentionFen, pvUci: ["c7c6"], positive: false },
    {
        id: "quiet-followup",
        fen: checkingPawnRetentionFen,
        pvUci: ["c7c6", "e8f8", "c6c7"],
        positive: false,
    },
];
