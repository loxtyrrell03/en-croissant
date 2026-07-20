import { describe, expect, it } from "vitest";
import {
  getWebCoachBookPdfUrl,
  getWebCoachMoves,
  makeWebCoachMovetext,
  type WebCoachBookPassage,
} from "../chessCoach";

describe("phone chess coach context", () => {
  it("builds colour-aware move evidence from an analysis line", () => {
    const moves = getWebCoachMoves(null, [
      {
        actor: "user",
        san: "e4",
        uci: "e2e4",
        fenBefore: "8/8/8/8/8/8/8/8 w - - 0 1",
        fenAfter: "8/8/8/8/8/8/8/8 b - - 0 1",
      },
      {
        actor: "opponent",
        san: "e5",
        uci: "e7e5",
        fenBefore: "8/8/8/8/8/8/8/8 b - - 0 1",
        fenAfter: "8/8/8/8/8/8/8/8 w - - 0 2",
      },
    ]);

    expect(moves.map((move) => [move.ply, move.color, move.san])).toEqual([
      [1, "white", "e4"],
      [2, "black", "e5"],
    ]);
    expect(makeWebCoachMovetext(moves)).toBe("1. e4 e5");
  });

  it("opens the exact retrieved PDF page", () => {
    const passage = {
      sourceUrl: "/api/chess-books/pdf?bookId=calculation",
      pdfPageStart: 12,
    } as WebCoachBookPassage;
    expect(getWebCoachBookPdfUrl(passage)).toContain(
      "api/chess-books/pdf?bookId=calculation#page=12",
    );
  });
});
