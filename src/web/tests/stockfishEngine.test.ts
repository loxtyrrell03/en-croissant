import { describe, expect, it } from "vitest";
import type { WebEngineLine } from "../model";
import { dedupeWebStockfishLines } from "../stockfishEngine";

function makeLine(multipv: number, depth: number, rootMove: string): WebEngineLine {
  return {
    source: "stockfish",
    multipv,
    depth,
    score: { type: "cp", value: 20 - multipv },
    uciMoves: [rootMove],
    sanMoves: [],
  };
}

describe("Stockfish phone line updates", () => {
  it("removes a stale duplicate root move while MultiPV ranks advance depth", () => {
    const lines = dedupeWebStockfishLines([
      makeLine(1, 14, "e2e4"),
      makeLine(2, 14, "d2d4"),
      makeLine(3, 13, "d2d4"),
      makeLine(4, 13, "g1f3"),
    ]);

    expect(lines.map((line) => [line.multipv, line.uciMoves[0]])).toEqual([
      [1, "e2e4"],
      [2, "d2d4"],
      [4, "g1f3"],
    ]);
  });

  it("keeps the deeper representative when the lower rank is stale", () => {
    const lines = dedupeWebStockfishLines([
      makeLine(1, 10, "e2e4"),
      makeLine(2, 11, "e2e4"),
      makeLine(3, 11, "g1f3"),
    ]);

    expect(lines.map((line) => [line.multipv, line.depth, line.uciMoves[0]])).toEqual([
      [2, 11, "e2e4"],
      [3, 11, "g1f3"],
    ]);
  });
});
