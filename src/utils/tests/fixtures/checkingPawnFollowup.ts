// Constructed controls extending the public checking-pawn fixture, not owner
// boards. The bishop payoff is replaced by a pawn and its knight is supported.
export const checkingPawnFollowupFen =
    "4k3/2Q5/2p5/8/8/pq6/5PPP/RN4K1 w - - 0 1";
export const checkingPawnFollowupLine = ["c7c6", "e8f8", "b1a3"];
export const checkingPawnFollowupCases = [
    {
        id: "supported-pawn-followup",
        fen: checkingPawnFollowupFen,
        positive: true,
    },
    {
        id: "unsupported-knight",
        fen: checkingPawnFollowupFen.replace("RN4K1", "1N4K1"),
        positive: false,
    },
    {
        id: "off-square-bishop-loss",
        fen: "4k3/2Q5/2p4p/6p1/7B/pq6/5PPP/RN4K1 w - - 0 1",
        positive: false,
    },
    {
        id: "capturable-checker",
        fen: checkingPawnFollowupFen.replace("2p5/8", "2p5/n7"),
        positive: false,
    },
    {
        id: "mating-counterplay",
        fen: "4k3/2Q5/2p5/8/8/p6q/5Pp1/RN4K1 w - - 0 1",
        positive: false,
    },
];
