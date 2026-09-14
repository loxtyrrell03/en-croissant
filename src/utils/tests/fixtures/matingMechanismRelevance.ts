export const matingMechanismExamples = [
    {
        id: "49h84",
        fen: "8/4R1p1/p4k2/1b1p1p1p/1P4r1/2P3P1/3K4/4R3 w - - 2 49",
        pvUci: ["e1e6", "f6g5", "e7g7"],
    },
    {
        id: "qY3NM",
        fen: "4r2k/3R4/1q2rp1p/8/1p5P/p4QP1/7K/4R3 w - - 0 43",
        pvUci: ["f3f6", "e6f6", "e1e8", "f6f8", "e8f8"],
    },
    {
        id: "kO37k",
        fen: "5rk1/3Q1ppp/p3p3/1p6/1P2q3/P4R1P/2r2PP1/3R2K1 w - - 1 28",
        pvUci: ["d7f7", "f8f7", "d1d8", "f7f8", "f3f8"],
    },
];
export const matingMechanismControls = [
    {
        id: "absent-guard",
        theme: "selfInterference",
        fen: "8/4R1p1/p4k2/1b1p1p1p/1P6/2P3P1/3K4/4R3 w - - 2 49",
    },
    {
        id: "king-flight",
        theme: "selfInterference",
        fen: "8/4R1p1/p4k2/1b1p1p2/1P4r1/2P3P1/3K4/4R3 w - - 2 49",
    },
    {
        id: "second-guard",
        theme: "selfInterference",
        fen: "6r1/4R1p1/p4k2/1b1p1p1p/1P4r1/2P3P1/3K4/4R3 w - - 2 49",
    },
    {
        id: "pinned-guard",
        theme: "selfInterference",
        fen: "8/4R1p1/p4k2/1b1p1p1p/1P4r1/2P3Q1/3K4/4R3 w - - 2 49",
    },
    {
        id: "missing-approach",
        theme: "deflection",
        fen: "4r2k/3R4/1q2rp1p/8/1p5P/p4QP1/7K/8 w - - 0 43",
    },
    {
        id: "missing-support",
        theme: "deflection",
        fen: "4r2k/8/1q2rp1p/8/1p5P/p4QP1/7K/4R3 w - - 0 43",
    },
    {
        id: "extra-receiver",
        theme: "deflection",
        fen: "4r2k/3R1r2/1q2rp1p/8/1p5P/p4QP1/7K/4R3 w - - 0 43",
    },
    {
        id: "guarded-finish",
        theme: "deflection",
        fen: "4r2k/3R4/1q2rpnp/8/1p5P/p4QP1/7K/4R3 w - - 0 43",
    },
];
