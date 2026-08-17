import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebEngineLine } from "../model";
import { analyzeWithWebStockfish18, dedupeWebStockfishLines } from "../stockfishEngine";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MISSING_FEN = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
const PREFETCH_ROOT_FEN = "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1";
const PREFETCH_NEXT_FEN =
    "rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w KQkq - 0 2";
const ABORT_FEN = "rnbqkbnr/pppppppp/8/8/4N3/8/PPPPPPPP/RNBQKB1R b KQkq - 1 1";
const RETRY_FEN = "rnbqkbnr/pppp1ppp/8/4p3/6P1/8/PPPPPP1P/RNBQKBNR b KQkq - 0 2";
const PC_ONLY_FEN = "rnbqkbnr/pppppp1p/6p1/8/5P2/8/PPPPP1PP/RNBQKBNR w KQkq - 0 2";

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
    it("uses a stored evaluation without starting PC analysis", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
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
        });
        vi.stubGlobal("fetch", fetchMock);
        const updates: WebEngineLine[][] = [];

        const lines = await analyzeWithWebStockfish18({
            fen: INITIAL_FEN,
            multipv: 3,
            depth: 70,
            onUpdate: (nextLines) => updates.push(nextLines),
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/cloud-eval?");
        expect(
            lines.map((line) => [line.source, line.depth, line.uciMoves[0]]),
        ).toEqual([
            ["lichess-cloud", 65, "c2c4"],
            ["lichess-cloud", 65, "e2e4"],
            ["lichess-cloud", 65, "g1f3"],
        ]);
        expect(updates).toEqual([lines]);
    });

    it("starts PC analysis only after confirming the stored evaluation is missing", async () => {
        const encoder = new TextEncoder();
        const remoteChunk = encoder.encode(
            `${JSON.stringify({
                type: "uci",
                line: "info depth 14 seldepth 18 multipv 1 score cp 23 nodes 120000 nps 4000000 pv e2e4 e7e5",
            })}\n${JSON.stringify({ type: "done", bestmove: "e2e4" })}\n`,
        );
        const reader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({ value: remoteChunk, done: false })
                .mockResolvedValueOnce({ value: undefined, done: true }),
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 404 })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                body: { getReader: () => reader },
            });
        vi.stubGlobal("fetch", fetchMock);
        const liveUpdates: WebEngineLine[][] = [];

        const lines = await analyzeWithWebStockfish18({
            fen: MISSING_FEN,
            multipv: 3,
            depth: 100,
            infinite: true,
            onUpdate: (nextLines) => liveUpdates.push(nextLines),
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/cloud-eval?");
        expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/v1/analyze");
        expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
            depth: 70,
            infinite: true,
        });
        expect(
            lines.map((line) => [
                line.source,
                line.executionLocation,
                line.depth,
                line.uciMoves[0],
            ]),
        ).toEqual([["stockfish", "gaming-pc", 14, "e2e4"]]);
        expect(liveUpdates.at(-1)).toEqual(lines);
    });

    it("retries a broken PC stream on the PC without starting the phone engine", async () => {
        const encoder = new TextEncoder();
        const remoteChunk = encoder.encode(
            `${JSON.stringify({
                type: "uci",
                line: "info depth 12 multipv 1 score cp 18 nodes 80000 nps 5000000 pv g1f3 d7d5",
            })}\n`,
        );
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 404 })
            .mockRejectedValueOnce(new TypeError("socket closed"))
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                body: {
                    getReader: () => ({
                        read: vi
                            .fn()
                            .mockResolvedValueOnce({ value: remoteChunk, done: false })
                            .mockResolvedValueOnce({ value: undefined, done: true }),
                    }),
                },
            });
        const workerConstructor = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("Worker", workerConstructor);

        const lines = await analyzeWithWebStockfish18({
            fen: RETRY_FEN,
            multipv: 3,
            depth: 70,
        });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/v1/analyze");
        expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/v1/analyze");
        expect(lines[0]).toMatchObject({ executionLocation: "gaming-pc", uciMoves: ["g1f3", "d7d5"] });
        expect(workerConstructor).not.toHaveBeenCalled();
    });

    it("reports a PC failure instead of ever falling back to phone analysis", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 404 })
            .mockRejectedValueOnce(new TypeError("first PC stream failed"))
            .mockRejectedValueOnce(new TypeError("second PC stream failed"));
        const workerConstructor = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("Worker", workerConstructor);

        await expect(
            analyzeWithWebStockfish18({ fen: PC_ONLY_FEN, multipv: 3, depth: 70 }),
        ).rejects.toThrow("phone analysis is disabled");
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(workerConstructor).not.toHaveBeenCalled();
    });

    it("prefetches upcoming game positions and reuses them without another request", async () => {
        const fetchMock = vi.fn().mockImplementation(async (input: URL | RequestInfo) => {
            const url = new URL(String(input));
            const fen = url.searchParams.get("fen") ?? INITIAL_FEN;
            const fenKey = fen.split(/\s+/).slice(0, 4).join(" ");
            const nextFenKey = PREFETCH_NEXT_FEN.split(/\s+/).slice(0, 4).join(" ");
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    fen,
                    depth: 60,
                    knodes: 1_000,
                    pvs: [{ moves: fenKey === nextFenKey ? "g1f3" : "e7e5", cp: 12 }],
                }),
            };
        });
        vi.stubGlobal("fetch", fetchMock);

        await analyzeWithWebStockfish18({
            fen: PREFETCH_ROOT_FEN,
            multipv: 1,
            depth: 70,
            prefetchFens: [PREFETCH_NEXT_FEN],
        });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(
            fetchMock.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("fen")),
        ).toEqual([PREFETCH_ROOT_FEN, PREFETCH_NEXT_FEN.split(/\s+/).slice(0, 4).join(" ")]);

        const nextLines = await analyzeWithWebStockfish18({
            fen: PREFETCH_NEXT_FEN,
            multipv: 1,
            depth: 70,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(nextLines[0]?.uciMoves[0]).toBe("g1f3");
    });

    it("does not start PC analysis when a move change cancels the cache lookup", async () => {
        let resolveFetch!: (response: unknown) => void;
        const fetchMock = vi.fn().mockReturnValue(
            new Promise((resolve) => {
                resolveFetch = resolve;
            }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const controller = new AbortController();

        const analysis = analyzeWithWebStockfish18({
            fen: ABORT_FEN,
            multipv: 3,
            depth: 70,
            signal: controller.signal,
        });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        controller.abort();

        await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/cloud-eval?");
        resolveFetch({ ok: false, status: 404 });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
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
