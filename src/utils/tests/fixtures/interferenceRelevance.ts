// Public CC0 real-game roots from the frozen secondary-theme development
// sample, followed by explicit constructed counterfactuals, not holdout data.
export const interferenceExamples = [
    {
        id: "J3vOR",
        fen: "4r2k/1bq1rpp1/p4p2/1pn2N2/8/2P4P/PPQ1BPP1/R3R1K1 b - - 5 21",
        pvUci: ["b7e4", "c2d2", "e4f5"],
        defender: "c2",
        target: "f5",
        gain: 150,
        reply: "e2d3",
        answer: "e4d3",
        kind: "removeGuard",
        branches: 43,
        recoveries: 40,
    },
    {
        id: "DBBd9",
        fen: "1r1q1rk1/pp1Nbpp1/7p/n2p4/Q7/2PP4/PP3PPP/R1B2RK1 b - - 1 15",
        pvUci: ["b7b5", "a4g4", "f7f5", "g4g3", "d8d7"],
        defender: "a4",
        target: "d7",
        gain: 220,
        reply: "a4g4",
        answer: "f7f5",
        kind: "recut",
        branches: 39,
        recoveries: 43,
    },
];

export const interferenceControls = [
    {
        id: "no-second-blocker",
        fen: "1r1q1rk1/pp1Nb1p1/7p/n2p4/Q7/2PP4/PP3PPP/R1B2RK1 b - - 1 15",
        move: "b7b5",
        defender: "a4",
        target: "d7",
        reply: "a4g4",
    },
    {
        id: "no-target-attacker",
        fen: "1r3rk1/pp1Nbpp1/7p/n2p4/Q7/2PP4/PP3PPP/R1B2RK1 b - - 1 15",
        move: "b7b5",
        defender: "a4",
        target: "d7",
        reply: "a4g4",
    },
    {
        id: "rook-countercapture",
        fen: "Rr1q1rk1/pp1Nbpp1/7p/n2p4/Q7/2PP4/PP3PPP/R1B2RK1 b - - 1 15",
        move: "b7b5",
        defender: "a4",
        target: "d7",
        reply: "a8b8",
    },
    {
        id: "no-guard-recapturer",
        fen: "4r2k/1bq1rpp1/p4p2/1p3N2/8/2P4P/PPQ1BPP1/R3R1K1 b - - 5 21",
        move: "b7e4",
        defender: "c2",
        target: "f5",
        reply: "e2d3",
    },
    {
        // Unsafe-payoff control, not a certified no-tactic position: Ke8
        // permits a longer mate, but Qxh7 loses to Rb1#. Rxe7 is the engine's
        // stronger defence; the discarded Kc8 instead allows e8=Q#.
        id: "mating-counterplay",
        fen: "3k4/1r5q/3PP3/8/8/1p6/1rb5/K6Q w - - 0 1",
        move: "e6e7",
        defender: "b7",
        target: "h7",
        reply: "d8e8",
    },
];

export const compensatedInterference = {
    fen: "5rk1/2q2p2/5bnp/R2Pp1p1/2p1P3/N4NP1/3Q1P1P/5BK1 b - - 3 28",
    pvUci: ["c4c3", "d2e3", "c7a5"],
};
