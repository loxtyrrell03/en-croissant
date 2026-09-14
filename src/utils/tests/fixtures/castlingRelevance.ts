/** Constructed controls plus the legal castling reply that crashed the public
 * 4Ds65 rare-theme audit. A legal castle is not itself a tactical certificate. */
export const castlingCases = [
    {
        id: "real-long-crash",
        fen: "r5k1/p4p1p/6pP/1p1p4/4rPb1/6P1/PPP1B3/R3K2R w KQ - 1 22",
        pvUci: ["e1a1", "a8e8", "d1d5", "e4e5", "d5e5"],
        kingTo: "c1",
        rookFrom: "a1",
        rookTo: "d1",
        mate: false,
    },
    {
        id: "short-check-not-mate",
        fen: "5k2/8/8/8/8/8/8/4K2R w K - 0 1",
        pvUci: ["e1h1"],
        kingTo: "g1",
        rookFrom: "h1",
        rookTo: "f1",
        mate: false,
    },
    {
        id: "short-mate",
        fen: "5k2/8/8/8/8/8/4R1R1/4K2R w K - 0 1",
        pvUci: ["e1h1"],
        kingTo: "g1",
        rookFrom: "h1",
        rookTo: "f1",
        mate: true,
    },
    {
        id: "long-mate",
        fen: "3k4/8/8/8/8/8/2R1R3/R3K3 w Q - 0 1",
        pvUci: ["e1a1"],
        kingTo: "c1",
        rookFrom: "a1",
        rookTo: "d1",
        mate: true,
    },
];

export function reflectCastle(row: (typeof castlingCases)[number]) {
    const flipCase = (s: string) =>
        s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    const flipRank = (s: string) => s.replace(/[1-8]/g, (r) => String(9 - Number(r)));
    const fields = row.fen.split(" ");
    fields[0] = flipCase(fields[0].split("/").reverse().join("/"));
    fields[1] = fields[1] === "w" ? "b" : "w";
    fields[2] = flipCase(fields[2]);
    fields[3] = flipRank(fields[3]);
    return {
        ...row,
        id: `${row.id}:black`,
        fen: fields.join(" "),
        pvUci: row.pvUci.map(flipRank),
        kingTo: flipRank(row.kingTo),
        rookFrom: flipRank(row.rookFrom),
        rookTo: flipRank(row.rookTo),
    };
}

export const castlingAliasCases = [...castlingCases, ...castlingCases.map(reflectCastle)].flatMap(
    (row) => [
        row,
        {
            ...row,
            id: `${row.id}:king-uci`,
            pvUci: [row.pvUci[0].slice(0, 2) + row.kingTo, ...row.pvUci.slice(1)],
        },
    ],
);
