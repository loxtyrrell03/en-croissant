// Public real-game counterfactual: White answered Qd6+ with Kg1, after
// which ...Rxf2? permits a discovered check and promotion on d8.
export const directThreatFen = "3r2k1/6p1/3qP2p/8/1p5P/pQ6/5rP1/R3R1K1 w - - 0 37";
export const directThreatLine = ["e6e7", "f2f7", "e7d8r", "d6d8"];
export const directThreatControls = [
    { id: "missing-revealed-check", fen: directThreatFen.replace("pQ6", "p7") },
    { id: "no-material-victim", fen: directThreatFen.replace("3r2k1", "6k1") },
    {
        id: "checking-ray-interposition",
        fen: directThreatFen.replace("1p5P", "1p1q3P").replace("3qP2p", "4P2p"),
    },
];
