// Constructed positions for checking attacks with different defensive payoffs.
// Owner game positions and engine reports remain outside the repository.
export const checkingPawnPreparationFen =
    "4k1nr/p4ppp/2pr4/8/8/7Q/3P1P2/5R1K w - - 0 1";
export const checkingPawnPreparationLine = ["h3c8", "d6d8", "c8c6"];
export const checkingPawnPreparationCases = [
    {
        id: "mixed-pawn-and-rook-payoffs",
        fen: checkingPawnPreparationFen,
        pvUci: checkingPawnPreparationLine,
        positive: true,
    },
    {
        id: "capturable-checker",
        fen: checkingPawnPreparationFen.replace("4k1nr", "1r2k1nr"),
        pvUci: checkingPawnPreparationLine,
        positive: false,
    },
    {
        id: "additional-pawn-defender",
        fen: checkingPawnPreparationFen.replace("p4ppp", "pp3ppp"),
        pvUci: checkingPawnPreparationLine,
        positive: true,
    },
    {
        id: "already-available-piece",
        fen: checkingPawnPreparationFen.replace("7Q", "n6Q"),
        pvUci: checkingPawnPreparationLine,
        positive: false,
    },
    {
        id: "root-only",
        fen: checkingPawnPreparationFen,
        pvUci: ["h3c8"],
        positive: false,
    },
    {
        id: "claim-before-capture",
        fen: checkingPawnPreparationFen.replace("0 1", "99 1"),
        pvUci: checkingPawnPreparationLine,
        positive: false,
    },
];
