/** Constructed controls, not a prevalence or accuracy sample. Real-game
 * coverage is replayed separately from the frozen public/private corpora. */
export const captureGainLiabilityCases = [
    {
        id: "checking-queen-loss",
        fen: "5r2/Q1RR1ppk/4p2p/8/4KP2/3rP3/P1q3PP/1B6 b - - 1 30",
        move: "d3d7",
        gain: -400,
        label: undefined,
    },
    {
        id: "partial-compensation",
        fen: "6k1/2RR4/8/8/4K3/3r4/2q5/1b6 b - - 0 1",
        move: "d3d7",
        gain: 100,
        label: "Material Gain",
    },
    {
        id: "free-queen",
        fen: "r5k1/5ppp/8/8/Q7/8/5PPP/6K1 b - - 0 1",
        move: "a8a4",
        gain: 900,
        label: "Hanging Piece",
    },
    {
        id: "knight-for-rook-loss",
        fen: "7k/8/5n2/3qP1P1/8/8/8/3R2K1 w - - 0 1",
        move: "e5f6",
        gain: -180,
        label: undefined,
    },
    {
        id: "rook-acceptance-mated",
        fen: "5r1k/7R/4B3/4NpP1/8/3Q4/8/6K1 b - - 0 1",
        move: "h8h7",
        gain: null,
        label: undefined,
    },
    {
        id: "stalemating-capture",
        fen: "k7/8/1rK5/8/1Q6/8/8/8 w - - 0 1",
        move: "b4b6",
        gain: null,
        label: undefined,
    },
];

export function reflectCaptureLiability(row: (typeof captureGainLiabilityCases)[number]) {
    const fields = row.fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = fields[1] === "w" ? "b" : "w";
    return {
        ...row,
        id: `${row.id}:reflected`,
        fen: fields.join(" "),
        move: row.move.replace(/[1-8]/g, (rank) => String(9 - Number(rank))),
    };
}
