// Constructed rook/queen battery, not an owner-game or course export.
// The pin wins material but only holds an approximately equal ending.
export const connectedPinCase = {
    id: "bishop-rook-battery",
    fen: "5r1k/5bpp/8/8/8/2Q2R2/8/7K b - - 0 1",
    move: "f7d5",
};
export const connectedPinControls = [
    {
        id: "no-rook-support",
        fen: connectedPinCase.fen.replace("5r1k", "7k"),
        move: connectedPinCase.move,
    },
    {
        id: "king-off-ray",
        fen: connectedPinCase.fen.replace("8/7K b", "7K/8 b"),
        move: connectedPinCase.move,
    },
    {
        id: "capture-the-pinner",
        fen: connectedPinCase.fen.replace("8/8/8/2Q2R2", "8/2Q5/8/5R2"),
        move: connectedPinCase.move,
    },
    {
        id: "extra-ray-blocker",
        fen: connectedPinCase.fen.replace("8/2Q2R2", "4P3/2Q2R2"),
        move: connectedPinCase.move,
    },
    {
        id: "ordinary-opening-pin",
        fen: "r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4",
        move: "c4b5",
    },
];
