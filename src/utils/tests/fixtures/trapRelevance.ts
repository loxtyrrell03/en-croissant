// CC0 Lichess qn2Fy and explicit, constructed counterfactuals. These are
// development judgements, not a held-out estimate of all-position accuracy.
export const trappedRookFen = "3r2k1/pp2bpp1/2p4p/8/3PN3/P2Pr2P/1P4P1/3R1RK1 w - - 2 23";
export const trappedRookLine = ["g1f2", "e3e4", "d3e4"];

export const trapControls = [
    {
        id: "absent-knight",
        fen: "3r2k1/pp2bpp1/2p4p/8/3P4/P2Pr2P/1P4P1/3R1RK1 w - - 2 23",
        reply: "e3e6",
        reason: "Re6 is a safe rook flight.",
    },
    {
        id: "open-file",
        fen: "3r2k1/pp2bpp1/2p4p/8/4N3/P2Pr2P/1P4P1/3R1RK1 w - - 2 23",
        reply: "e3d3",
        reason: "Rexd3 exploits the open d-file and captures a pawn.",
    },
    {
        id: "missing-pawn-guard",
        fen: "3r2k1/pp2bpp1/2p4p/8/3PN3/P2Pr2P/1P6/3R1RK1 w - - 2 23",
        reply: "e3h3",
        reason: "Rxh3 escapes because g2 no longer guards h3.",
    },
    {
        id: "promotion-counterplay",
        fen: "3r2k1/pp2bpp1/2p4p/8/3PN3/P2Pr2P/1p4P1/3R1RK1 w - - 2 23",
        reply: "b2b1q",
        reason: "Black can promote instead of accepting a material-only trap.",
    },
    {
        id: "off-square-queen",
        fen: "2Qr2k1/pp2bpp1/2p4p/8/3PN3/P2Pr2P/1P4P1/3R1RK1 w - - 2 23",
        reply: "d8c8",
        reason: "Rxc8 wins a queen elsewhere; Kxe3 cannot compensate.",
    },
] as const;

export const unrelatedPayoffTrap = {
    fen: "4k2r/3nbpp1/8/4p2Q/4P3/8/PBq2PPP/R3K2R b KQk - 0 17",
    pvUci: ["c2b2", "a1d1", "h8h5"],
};
