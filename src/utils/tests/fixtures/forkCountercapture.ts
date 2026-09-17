// Constructed reduced material layout. Owner-game boards remain private.
export const forkCountercaptureFen = "2kr1b1r/1q2pppp/8/3pN3/8/Q1PPP3/1P3PPP/R3K2R w KQ - 0 1";
export const forkCountercaptureLine = ["e5f7", "e7e6", "f7d8", "f8a3", "d8b7"];
export const forkCountercapturePredecessor =
    "2kr1b1r/4pppp/2q5/3pN3/8/Q1PPP3/1P3PPP/R3K2R b KQ - 0 1";
export const forkCountercaptureCases = [
    { id: "capturable-forker", fen: forkCountercaptureFen.replace("2kr1b1r", "2kr1r1r"), pvUci: ["e5f7"], fork: false },
    {
        id: "root",
        fen: forkCountercaptureFen,
        pvUci: forkCountercaptureLine.slice(0, 1),
        fork: true,
    },
    { id: "countercapture", fen: forkCountercaptureFen, pvUci: forkCountercaptureLine, fork: true },
    {
        id: "no-connected-queen",
        fen: forkCountercaptureFen.replace("1q2pppp", "q3pppp"),
        pvUci: ["e5f7"],
        fork: false,
    },
    {
        id: "checking-flight",
        fen: forkCountercaptureFen.replace("Q1PPP3", "Q3P3"),
        pvUci: ["e5f7"],
        fork: false,
    },
];
