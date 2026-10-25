import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webLichessCloudDataToLines, type WebLichessCloudData } from "../lichessCloud";

const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const good = { fen, depth: 30, knodes: 10, pvs: [{ moves: "e2e4 e7e5", cp: 24 }] };
const raw = (value: unknown) => value as WebLichessCloudData;
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("rejects a supplied FEN for a different position even when the moves look legal here", () => {
  expect(webLichessCloudDataToLines(fen, { ...good, fen: fen.replace(" w ", " b ") })).toEqual([]);
});
it("omits malformed/non-finite scores without renumbering valid stored lines", () => {
  const result = webLichessCloudDataToLines(
    fen,
    raw({
      ...good,
      pvs: [
        { moves: "e2e4", cp: 0 },
        { moves: "d2d4", cp: null },
        { moves: "g1f3", mate: -3 },
        { moves: "c2c4", cp: Number.NaN },
        { moves: "b1c3", cp: "20" },
        { moves: "b2b3", mate: Infinity },
      ],
    }),
  );
  expect(result.map((line) => ({ rank: line.multipv, score: line.score }))).toEqual([
    { rank: 1, score: { type: "cp", value: 0 } },
    { rank: 3, score: { type: "mate", value: -3 } },
  ]);
});
it("keeps only the legal PV prefix and keeps its SAN and UCI moves aligned", () => {
  const result = webLichessCloudDataToLines(fen, {
    ...good,
    pvs: [
      { moves: "e2e4 e7e5 e2e5", cp: 24 },
      { moves: "e2e5", cp: 40 },
    ],
  });
  expect(result).toHaveLength(1);
  expect(result[0].uciMoves).toEqual(["e2e4", "e7e5"]);
  expect(result[0].sanMoves).toEqual(["e4", "e5"]);
});
it("preserves zero, root-only and legacy missing/counter-only FEN data in White perspective", () => {
  const blackFen = fen.replace(" w ", " b ");
  expect(
    webLichessCloudDataToLines(blackFen, raw({ pvs: [{ moves: "e7e5", cp: 0 }] }))[0],
  ).toMatchObject({
    score: { type: "cp", value: 0 },
    uciMoves: ["e7e5"],
    sanMoves: ["e5"],
  });
  expect(
    webLichessCloudDataToLines(blackFen, {
      ...good,
      fen: blackFen.replace("0 1", "18 40"),
      pvs: [{ moves: "e7e5", cp: 24 }],
    })[0].score.value,
  ).toBe(24);
});
it("does not cache malformed stored responses and recovers at the same live position", async () => {
  let readable = false,
    reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/cloud-eval")) {
        reads++;
        return json(
          readable
            ? good
            : {
                ...good,
                fen: fen.replace(" w ", " b "),
                pvs: [{ moves: "e2e4", cp: null }],
              },
        );
      }
      if (url.includes("/api/engine/start")) return json({});
      if (url.includes("/v1/analyze")) {
        readable = true;
        return new Response(
          '{"type":"uci","line":"info depth 8 score cp 30 pv e2e4 e7e5"}\n{"type":"done","bestmove":"e2e4"}\n',
          { status: 200, headers: { "content-type": "application/x-ndjson" } },
        );
      }
      throw new Error(`Unexpected fixture endpoint: ${url}`);
    }),
  );
  const { analyzeWithWebStockfish18 } = await import("../stockfishEngine");
  const request = { fen, multipv: 1, depth: 8, preferStoredEvaluation: true };
  expect((await analyzeWithWebStockfish18(request))[0].source).toBe("stockfish");
  const failedReads = reads;
  expect((await analyzeWithWebStockfish18(request))[0]).toMatchObject({
    source: "lichess-cloud",
    score: { value: 24 },
  });
  expect(reads).toBe(failedReads + 1);
});
it("does not use another position or a malformed score as Prep evidence", async () => {
  let readable = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json(
        readable
          ? good
          : {
              ...good,
              fen: fen.replace(" w ", " b "),
              pvs: [{ moves: "e2e4", cp: null }],
            },
      ),
    ),
  );
  const { queryWebLichessCloudEngineMoves } = await import("../lichessCloud");
  const request = { fen, side: "black" as const, multipv: 1 };
  expect(await queryWebLichessCloudEngineMoves(request)).toEqual([]);
  readable = true;
  expect(await queryWebLichessCloudEngineMoves(request)).toMatchObject([
    { san: "e4", scoreCpForSide: -24, rank: 1 },
  ]);
});
it("keeps an invalid successful HTTP response retryable in the shared cloud cache", async () => {
  let readable = false;
  const fetch = vi.fn(async () => json(readable ? good : {}));
  vi.stubGlobal("fetch", fetch);
  const { queryWebLichessCloudLines } = await import("../lichessCloud");
  await expect(queryWebLichessCloudLines({ fen, multipv: 1 })).rejects.toThrow(
    "Stored evaluation data is invalid for this position. Retry lookup.",
  );
  readable = true;
  expect((await queryWebLichessCloudLines({ fen, multipv: 1 }))[0].score.value).toBe(24);
  expect(fetch).toHaveBeenCalledTimes(2);
});
