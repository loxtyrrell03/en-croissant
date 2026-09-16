// Constructed stripped-down battery, not a private owner-game position.
// Ng5 reveals Bc4-Qf7-Kg8. The queen can collect the bishop, or Black can
// collect the knight, but either route still gives up the queen for two minors.
export const discoveredPinPriorityFen = "6k1/5q1p/4Np2/5p2/2B5/1P6/8/2K5 w - - 0 1";
export const discoveredPinPriorityLine = ["e6g5", "f6g5", "c4f7", "g8f7"];
export const discoveredPinPriorityControls = [
    {
        name: "queen can take the unguarded bishop",
        fen: discoveredPinPriorityFen.replace("1P6", "8"),
    },
    { name: "queen is not pinned to the king", fen: discoveredPinPriorityFen.replace("6k1", "7k") },
];
