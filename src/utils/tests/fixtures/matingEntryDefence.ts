// Constructed boards derived from mating geometry, not complete owner games.
export const matingEntryDefence = {
    fen: "4r3/4rk2/2n3p1/5n2/N7/5P2/P4KPP/R6R w - - 0 1",
    playedMoveUci: "f3f4",
    bestMoveUci: "a4c3",
    pvUci: ["a4c3", "e8d8", "a1d1"],
    refutationUci: ["e7e2", "f2f1", "c6d4", "a4c3", "f5e3", "f1g1", "e2g2"],
};

export const poisonedMatingEntries = [
    {
        id: "capture-permits-immediate-mate",
        fen: "6k1/1b6/8/8/8/7q/4RPPP/r3B1K1 b - - 0 1",
        move: "a1e1",
        capture: "e2e1",
        mate: ["h3g2"],
        distance: 2,
    },
    {
        id: "capture-permits-quiet-mating-setup",
        fen: "4r3/5kBp/2n3p1/5nB1/5P2/8/P3r1PP/R5KR b - - 0 1",
        move: "h7h6",
        capture: "g5h6",
        mate: ["f5e3", "a1e1", "e2g2"],
        distance: 3,
    },
];
