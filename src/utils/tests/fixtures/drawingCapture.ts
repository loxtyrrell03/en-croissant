/** Judgements frozen before querying exact outcomes. Do not turn every
 * drawn ending or material exchange into a tactical saving resource. */
export const drawingCaptureCases = [
    {
        id: "equivalent-saving-captures",
        fen: "7k/8/8/4q3/2N1K3/8/8/8 w - - 0 1",
        move: "e4e5",
        judgement:
            "King or knight can remove the last queen. If both save a draw, choosing either must not count as missing the other tactic.",
    },
    {
        id: "allow-drawing-capture",
        fen: "7k/8/8/r7/4K3/8/8/8 b - - 0 1",
        move: "a5e5",
        judgement:
            "Offering the last rook should give up a won ending. Compare an independently winning alternative before accusing this move of allowing a saving capture.",
    },
    {
        id: "allowed-rook-rescue",
        fen: "7k/8/8/4r3/4K3/8/8/8 w - - 1 2",
        move: "e4e5",
        judgement:
            "Exact reached position after the rook offer, retaining the correct move clock for cause comparison.",
    },
    {
        id: "black-rook-rescue",
        fen: "8/8/8/4k3/4R3/8/8/7K b - - 0 1",
        move: "e5e4",
        judgement:
            "Colour-reversed king capture should save the same draw; do not reverse the provider child outcome twice.",
    },
    {
        id: "king-rook-rescue",
        fen: "7k/8/8/4r3/4K3/8/8/8 w - - 0 1",
        move: "e4e5",
        judgement:
            "Taking the unprotected checking rook ends the game; test whether other legal moves lose.",
    },
    {
        id: "king-queen-rescue",
        fen: "7k/8/8/4q3/4K3/8/8/8 w - - 0 1",
        move: "e4e5",
        judgement:
            "Taking the unprotected checking queen should save a draw, not win a queen ending.",
    },
    {
        id: "knight-queen-rescue",
        fen: "2q2k2/8/3N4/8/8/8/8/6K1 w - - 0 1",
        move: "d6c8",
        judgement:
            "The actual payoff of a checking fork reaches K+N versus K; distinguish it from another profitable capture.",
    },
    {
        id: "bishop-rook-exchange",
        fen: "7k/1r6/8/8/8/5B2/8/6K1 w - - 0 1",
        move: "f3b7",
        judgement:
            "Rook versus bishop is often drawn; a routine capture must not be called the only saving tactic if quiet drawing moves exist.",
    },
    {
        id: "knight-pawn-rescue",
        fen: "8/8/8/8/8/2N5/p7/2k3K1 w - - 0 1",
        move: "c3a2",
        judgement:
            "Stopping the last passed pawn may be the defensive resource. Check all alternatives, including knight checks.",
    },
    {
        id: "already-dead",
        fen: "7k/8/8/4b3/4K3/8/8/8 w - - 0 1",
        move: "e4e5",
        judgement: "Already insufficient material before the capture: no saving tactic.",
    },
    {
        id: "stalemate-blunder",
        fen: "k7/8/1rK5/8/1Q6/8/8/8 w - - 0 1",
        move: "b4b6",
        judgement:
            "A rook capture that stalemates may throw away a win. Never call it a saving draw without the root outcome.",
    },
];
