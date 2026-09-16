// Constructed material/king-safety controls, not additional owner games.
export const checkingAlliedRetentionLine = ["c7c6", "h3d7", "c6a8"];
export const checkingAlliedRetentionCases = [
    {
        id: "pinned-interposer-support",
        fen: "4k3/2Q5/2p5/3r4/8/5P1q/4P3/1N3RK1 w - - 0 1",
        positive: true,
    },
    {
        id: "no-allied-rook",
        fen: "4k3/2Q5/2p5/3r4/8/5P1q/4P3/1N4K1 w - - 0 1",
        positive: false,
    },
    // The root is winning in fresh engine searches, but the old selected Qf2
    // safety witness permits mate in four. Withholding this certificate is not
    // a claim that the whole position has no tactic.
    {
        id: "no-f-pawn-shield",
        fen: "4k3/2Q5/2p5/3r4/8/7q/4P3/1N3RK1 w - - 0 1",
        positive: false,
    },
    {
        id: "additional-bishop-counterplay",
        fen: "4k3/2Q5/2pb4/3r4/8/5P1q/4P3/1N3RK1 w - - 0 1",
        positive: false,
    },
];
