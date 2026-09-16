/** Public Lichess 0rcU4, plus explicitly constructed contrary/capture boards. */
export const quietRootMateCases = [
    {
        id: "quiet-queen-mate",
        fen: "5rk1/Q1RR1pp1/4pq1p/4N3/5P2/4P3/Pr4PP/6K1 b - - 1 23",
        positive: true,
    },
    {
        id: "nonchecking-capture-mate",
        fen: "5rk1/Q1RR1pp1/4pq1p/4N3/5P1N/4P3/Pr4PP/6K1 b - - 1 23",
        positive: true,
    },
    {
        id: "capturable-queen",
        fen: "5rk1/Q1RR1pp1/4pq1p/4NN2/5P2/4P3/Pr4PP/6K1 b - - 1 23",
        positive: false,
    },
    {
        id: "capturable-capturing-queen",
        fen: "5rk1/Q1RR1pp1/4pq1p/4NN2/5P1N/4P3/Pr4PP/6K1 b - - 1 23",
        positive: false,
    },
    {
        id: "claimable-quiet-mate",
        fen: "5rk1/Q1RR1pp1/4pq1p/4N3/5P2/4P3/Pr4PP/6K1 b - - 99 23",
        positive: false,
    },
    {
        id: "capture-resets-claim",
        fen: "5rk1/Q1RR1pp1/4pq1p/4N3/5P1N/4P3/Pr4PP/6K1 b - - 99 23",
        positive: true,
    },
].map((row) => ({
    ...row,
    pvUci: ["f6h4", "e5d3", "b2b1", "c7c1", "b1c1", "d3c1", "h4e1"],
}));
