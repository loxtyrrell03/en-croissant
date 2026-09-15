// Constructed geometry controls. The separate private audit replays whole
// owner games; these positions are not additional independent real games.
export const quietPieceForkFen = "4k3/2p5/8/3p4/2qP2b1/P4N2/1PP1P3/R2QKB2 w - - 0 1";
export const quietPieceForkMove = "f3e5";
export const quietPieceForkCases = [
    { id: "allied-countercheck-captures", fen: quietPieceForkFen, positive: true },
    {
        id: "queen-defends-bishop-on-file",
        fen: quietPieceForkFen.replace("2qP2b1", "2q3b1"),
        positive: false,
    },
    { id: "queen-e6-defends-bishop", fen: quietPieceForkFen.replace("3p4", "8"), positive: false },
    { id: "queen-c8-defends-bishop", fen: quietPieceForkFen.replace("2p5", "8"), positive: false },
    {
        id: "no-answer-to-countercheck",
        fen: quietPieceForkFen.replace("P4N2", "5N2"),
        positive: false,
    },
    {
        id: "queen-d4-defends-bishop",
        fen: quietPieceForkFen.replace("R2QKB2", "R3KB2"),
        positive: false,
    },
];
