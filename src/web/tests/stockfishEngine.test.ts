import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebEngineLine } from "../model";
import { analyzeWithWebStockfish18, dedupeWebStockfishLines } from "../stockfishEngine";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  it("shows stored cloud evaluations immediately, then starts remote Stockfish", async () => {
    const encoder = new TextEncoder();
    const remoteChunks = [
      encoder.encode(
        `${JSON.stringify({
          type: "uci",
          line: "info depth 14 seldepth 18 multipv 1 score cp 23 nodes 120000 nps 4000000 pv e2e4 e7e5",
        })}\n${JSON.stringify({ type: "done", bestmove: "e2e4" })}\n`,
      ),
    ];
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ value: remoteChunks[0], done: false })
        .mockResolvedValueOnce({ value: undefined, done: true }),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          fen: INITIAL_FEN,
          depth: 65,
          knodes: 593_446_314,
          pvs: [
            { moves: "c2c4 e7e5", cp: 19 },
            { moves: "e2e4 e7e5", cp: 17 },
            { moves: "g1f3 e7e6", cp: 14 },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: { getReader: () => reader },
      });
    vi.stubGlobal("fetch", fetchMock);
    const updates: WebEngineLine[][] = [];

    const lines = await analyzeWithWebStockfish18({
      fen: INITIAL_FEN,
      multipv: 3,
      depth: 14,
      onUpdate: (nextLines) => updates.push(nextLines),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/cloud-eval?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/v1/analyze");
    expect(updates[0]?.map((line) => [line.source, line.depth, line.uciMoves[0]])).toEqual([
      ["lichess-cloud", 65, "c2c4"],
      ["lichess-cloud", 65, "e2e4"],
      ["lichess-cloud", 65, "g1f3"],
    ]);
    expect(
      lines.map((line) => [line.source, line.executionLocation, line.depth, line.uciMoves[0]]),
    ).toEqual([["stockfish", "gaming-pc", 14, "e2e4"]]);
    expect(updates.at(-1)).toEqual(lines);
  });

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
