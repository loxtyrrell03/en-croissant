export const mixedForkPreviousFen = "8/pp4p1/2r1p1k1/3p2Pp/3P3P/1PP3N1/P2n4/1K2R3 w - - 1 36";
export const mixedForkFen = "8/pp4p1/2r1p1k1/3p2Pp/3P3P/1PP3N1/P1Kn4/4R3 b - - 2 36";
export const mixedForkLine = ["d2f3", "e1h1", "f3d4", "c2d3", "d4b5"];
export const mixedForkControls = [
    { id: "unpin-king-b2", fen: mixedForkFen.replace("P1Kn4", "PK1n4") },
    { id: "missing-pinner", fen: mixedForkFen.replace("2r1p1k1", "4p1k1") },
    { id: "second-pawn-guard", fen: mixedForkFen.replace("4R3", "4R2R") },
    { id: "capture-the-forker", fen: mixedForkFen.replace("P1Kn4", "P1Kn2P1") },
    // Nf3+ still wins here via Rxe2 Nxd4+ and Nxe2. It is outside the
    // quiet/immediate-capture certificate, not evidence of a losing move.
    { id: "off-square-queen-liability", fen: mixedForkFen.replace("P1Kn4", "P1Knq3") },
];

export const reflectMixedForkMove = (uci: string) =>
    uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
export function reflectMixedForkFen(fen: string) {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = fields[1] === "w" ? "b" : "w";
    const reflectedRights = fields[2].replace(/[a-zA-Z]/g,
        (c) => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
    fields[2] = reflectedRights === "-" ? "-" : ["K", "Q", "k", "q"].filter(right => reflectedRights.includes(right)).join("");
    if (fields[3] !== "-") fields[3] = reflectMixedForkMove(fields[3]);
    return fields.join(" ");
}
