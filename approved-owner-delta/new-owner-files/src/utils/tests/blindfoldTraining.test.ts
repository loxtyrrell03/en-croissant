import { expect, test } from "vitest";
import {
    findBlindfoldMove,
    getBlindfoldLegalMoves,
    getBlindfoldMoveInputStatus,
} from "@/utils/blindfoldTraining";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("lists legal SAN choices from the current blindfold position", () => {
    const moves = getBlindfoldLegalMoves(START_FEN);

    expect(moves).toHaveLength(20);
    expect(moves.map((move) => move.san)).toContain("e4");
    expect(moves.map((move) => move.san)).toContain("Nf3");
    expect(moves.find((move) => move.san === "e4")?.uci).toBe("e2e4");
});

test("matches manual SAN input with optional check suffixes", () => {
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";

    expect(findBlindfoldMove(fen, "Qxf7")?.san).toBe("Qxf7#");
    expect(findBlindfoldMove(fen, "Qxf7#")?.uci).toBe("h5f7");
});

test("reports empty, legal, and illegal manual move input", () => {
    expect(getBlindfoldMoveInputStatus(START_FEN, "").kind).toBe("empty");
    expect(getBlindfoldMoveInputStatus(START_FEN, "e4").kind).toBe("legal");
    expect(getBlindfoldMoveInputStatus(START_FEN, "e5").kind).toBe("illegal");
});
