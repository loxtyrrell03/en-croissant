// Constructed, public regressions. The first pair differs only by a defender
// that can capture the queen; neither is an owner-game board.
export const captureMateFen = "7k/7p/5Kp1/7Q/8/8/7p/8 w - - 0 1";
export const captureMateLine = ["h5h2", "h7h5", "f6g6", "h8g8", "h2b8"];
export const captureMateCases = [
    {
        id: "queen-countercheck",
        fen: "r6k/1q6/2P1P3/6Q1/8/8/8/6RK w - - 0 1",
        pvUci: ["c6b7", "a8a5", "g5g8"],
        mate: 2,
    },
    { id: "king-approach", fen: captureMateFen, pvUci: captureMateLine, mate: 3 },
    {
        id: "queen-capture-defence",
        fen: captureMateFen.replace("8/8/7p", "8/5n2/7p"),
        pvUci: ["h5h2"],
        mate: null,
    },
    { id: "next-turn", fen: "7k/7p/5K1p/7Q/8/8/8/8 w - - 0 1", pvUci: ["h5h6"], mate: 2 },
    {
        id: "deflection-payoff",
        fen: "8/8/6pp/5Qqk/2B1N1p1/8/3B4/6K1 w - - 2 2",
        pvUci: ["d2g5"],
        mate: 2,
    },
];
