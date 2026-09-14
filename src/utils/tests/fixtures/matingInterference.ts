/** Public Lichess snAK4 and constructed mechanism controls. The added-knight
 * positions challenge the recapture/escape accounting; their expected outcomes
 * must be judged independently, not inferred from a classifier miss. */
export const matingTrapFen = "8/2pqnkpp/2b2p2/8/1P1P4/2P1R2P/1Q3PP1/rNB3K1 b - - 2 22";
export const matingTrapLine = ["d7d5", "f2f3", "a1a2", "c3c4", "a2b2", "c4d5", "b2b1"];
export const rookMatingInterferenceFen = "r6k/1r6/4P3/6Q1/8/8/8/6RK w - - 0 1";
// A null expectation means no NEW independently proved mating interference,
// not that the position is quiet or losing. The already-blocked and extra-
// bishop controls have pre-existing mates; the open-king variant remains
// winning but has an unsupported checking exchange. The queen countercheck
// equalizes. These distinctions are checked in the fresh engine receipt.
export const matingInterferenceCases = [
    {
        id: "rook-interposition",
        fen: rookMatingInterferenceFen,
        move: "e6e7",
        expected: "interference",
    },
    {
        id: "queen-countercheck",
        fen: rookMatingInterferenceFen.replace("1r6", "1q6").replace("4P3", "2P1P3"),
        move: "e6e7",
        expected: null,
    },
    {
        id: "missing-mate-support",
        fen: rookMatingInterferenceFen.replace("6RK", "7K"),
        move: "e6e7",
        expected: null,
    },
    {
        id: "already-blocked-defence",
        fen: rookMatingInterferenceFen.replace("1r6", "1r3p2"),
        move: "e6e7",
        expected: null,
    },
    {
        id: "extra-diagonal-defender",
        fen: rookMatingInterferenceFen.replace("r6k", "r4b1k"),
        move: "e6e7",
        expected: null,
    },
    {
        id: "checking-resource",
        fen: rookMatingInterferenceFen.replace("6RK", "4K1R1"),
        move: "e6e7",
        expected: null,
    },
];
export function reflectMatingInterference<T extends { fen: string; move: string }>(row: T): T {
    const fields = row.fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (char) =>
            char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase(),
        );
    fields[1] = fields[1] === "w" ? "b" : "w";
    return {
        ...row,
        fen: fields.join(" "),
        move: row.move.replace(/[1-8]/g, (rank) => String(9 - Number(rank))),
    };
}
export const matingTrapControls = [
    { id: "missing-trapping-rook", fen: matingTrapFen.replace("rNB3K1", "1NB3K1") },
    { id: "missing-mating-bishop", fen: matingTrapFen.replace("2b2p2", "5p2") },
    { id: "knight-guards-b1-from-d2", fen: matingTrapFen.replace("1Q3PP1", "1Q1N1PP1") },
    { id: "knight-guards-b1-from-a3", fen: matingTrapFen.replace("2P1R2P", "N1P1R2P") },
];
