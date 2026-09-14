import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSquare, parseUci } from "chessops/util";

export const promotionCounterplayBase = "3R4/5k2/6p1/p7/3pNr2/2p2P1P/P5PK/8 b - - 3 41";
export const promotionCounterplayLine = ["f4e4", "f3e4", "c3c2", "d8d4", "c2c1q"];
// Fresh depth-16 root PV from the public promotion-counterplay engine receipt.
export const promotionCounterplayEngineLine = [
    "f4e4",
    "f3e4",
    "c3c2",
    "d8c8",
    "d4d3",
    "a2a3",
    "f7e6",
    "c8c5",
    "d3d2",
    "c5c2",
    "d2d1q",
    "c2c6",
    "e6f7",
    "e4e5",
    "d1d4",
];

// Fixed public-root perturbations, not a representative game sample or a list
// of predetermined tactical negatives.
export function promotionCounterplayCases() {
    const cases: { id: string; fen: string }[] = [];
    const add = (id: string, pos: Chess) => {
        if (Chess.fromSetup(pos.toSetup()).isErr || !pos.isLegal(parseUci("f4e4")!)) return;
        cases.push({ id, fen: makeFen(pos.toSetup()) });
    };
    for (const role of ["queen", "rook", "bishop", "knight"] as const)
        for (const square of [
            "a1",
            "b1",
            "c1",
            "e1",
            "f1",
            "g1",
            "h1",
            "a4",
            "b4",
            "c4",
            "d5",
            "e5",
            "h5",
            "b6",
            "c6",
            "d6",
            "h6",
            "a8",
            "b8",
            "c8",
            "e8",
            "g8",
            "h8",
        ]) {
            const pos = Chess.fromSetup(parseFen(promotionCounterplayBase).unwrap()).unwrap();
            pos.board.set(parseSquare(square)!, { color: "white", role });
            add(`${role}-${square}`, pos);
        }
    for (let square = 0; square < 64; square++) {
        const pos = Chess.fromSetup(parseFen(promotionCounterplayBase).unwrap()).unwrap();
        if (pos.board.has(square)) continue;
        pos.board.take(parseSquare("f7")!);
        pos.board.set(square, { color: "black", role: "king" });
        add(`king-${square}`, pos);
    }
    return cases;
}

export const pawnRaceRefutations = promotionCounterplayCases()
    .filter((row) => ["king-3", "king-12", "king-13", "king-24"].includes(row.id))
    .map((row) => ({
        ...row,
        historicalLine: (
            {
                "king-3": [
                    "f4e4",
                    "f3e4",
                    "c3c2",
                    "d8d4",
                    "d1e1",
                    "d4c4",
                    "e1d1",
                    "c4d4",
                    "d1e1",
                    "d4c4",
                    "e1d2",
                    "c4d4",
                    "d2c3",
                    "a2a3",
                    "c2c1q",
                ],
                "king-12": [
                    "f4e4",
                    "f3e4",
                    "c3c2",
                    "d8c8",
                    "d4d3",
                    "a2a3",
                    "e2d1",
                    "e4e5",
                    "c2c1q",
                    "c8c1",
                    "d1c1",
                    "e5e6",
                    "d3d2",
                    "e6e7",
                    "d2d1q",
                    "e7e8q",
                    "c1b1",
                    "e8e4",
                    "b1a1",
                ],
                "king-13": [
                    "f4e4",
                    "f3e4",
                    "c3c2",
                    "d8c8",
                    "d4d3",
                    "c8c3",
                    "d3d2",
                    "c3f3",
                    "f2e1",
                    "f3e3",
                    "e1d1",
                    "a2a3",
                    "c2c1q",
                ],
                "king-24": [
                    "f4e4",
                    "f3e4",
                    "c3c2",
                    "d8c8",
                    "d4d3",
                    "c8c4",
                    "a4a3",
                    "c4c3",
                    "a3a2",
                    "g2g3",
                    "a2b1",
                    "c3b3",
                    "b1a1",
                    "b3a3",
                    "a1b2",
                    "a3d3",
                    "c2c1q",
                ],
            } as Record<string, string[]>
        )[row.id],
    }));

// This exact route was selected by an intermediate proof. The promotion
// permits Rc8+, after which every king evasion loses the new queen.
export const skeweredPromotionLine = [
    "f4e4",
    "f3e4",
    "c3c2",
    "d8d4",
    "a4b5",
    "a2a4",
    "b5c5",
    "d4d8",
    "c2c1q",
    "d8c8",
];
