/** One real Lichess continuation and constructed mechanism/identity controls.
 * Labels are chess judgements, not engine tags. No private course data. */
export const directMaterialPayoffCases = [
    {
        id: "real-discovery",
        fen: "6k1/3n1p2/6p1/r2NP2p/4nP2/8/1PP3PP/3R1R1K w - - 0 26",
        pvUci: ["d5e7", "g8f8", "d1d7"],
        theme: "discoveredAttack",
        label: "Discovery Payoff",
        value: 320,
    },
    {
        id: "knight-fork",
        fen: "2q1k3/8/8/8/4N3/8/8/6K1 w - - 0 1",
        pvUci: ["e4d6", "e8f8", "d6c8"],
        theme: "fork",
        label: "Fork Payoff",
        value: 900,
    },
    {
        id: "rook-skewer",
        fen: "q1k5/8/8/8/8/8/8/4R1K1 w - - 0 1",
        pvUci: ["e1e8", "c8d7", "e8a8"],
        theme: "skewer",
        label: "Skewer Payoff",
        value: 900,
    },
    {
        id: "bishop-pin",
        fen: "5k2/4n3/5P2/8/8/2B5/8/6K1 w - - 0 1",
        pvUci: ["c3b4", "f8f7", "b4e7"],
        theme: "pin",
        label: "Pin Payoff",
        value: 320,
    },
];

export function reflectPayoff(row: (typeof directMaterialPayoffCases)[number]) {
    const fields = row.fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = fields[1] === "w" ? "b" : "w";
    return {
        ...row,
        id: row.id + ":black",
        fen: fields.join(" "),
        pvUci: row.pvUci.map((uci) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank)))),
    };
}
