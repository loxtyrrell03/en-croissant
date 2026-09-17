// Constructed material layouts, not exported owner positions.
export const capturingMixedForkFen = "6nr/6k1/7p/6q1/4P3/8/5PPP/4K2R b K - 0 1";
export const capturingMixedForkLine = ["g5g2", "h1f1", "g2e4", "e1d1"];
export const capturingMixedForkCases = [
    { id: "piece-and-pawn", fen: capturingMixedForkFen, gain: 200 },
    {
        id: "sacrificing-counterchecker",
        fen: capturingMixedForkFen
            .replace("6k1", "2Q1b1k1")
            .replace("7p", "3p3p")
            .replace("4P3", "3pP3"),
        gain: 200,
    },
    // Without the blocking pawns, Qc3+/Qg3+/Qe5+ need more than an immediate
    // capture answer. This is an unproved fork, not a claim that Qxg2 loses.
    {
        id: "unresolved-counterchecks",
        fen: capturingMixedForkFen.replace("6k1", "2Q1b1k1"),
        gain: null,
    },
    // Rh4 saves the rook and guards e4. The initial capture is not a fork win.
    { id: "defend-both", fen: capturingMixedForkFen.replace("5PPP", "5PP1"), gain: null },
    { id: "large-entry-credit", fen: capturingMixedForkFen.replace("5PPP", "5PQ1"), gain: null },
    { id: "capture-the-forker", fen: capturingMixedForkFen.replace("4K2R", "4KB1R"), gain: null },
    { id: "missing-pawn-target", fen: capturingMixedForkFen.replace("4P3", "8"), gain: null },
];
