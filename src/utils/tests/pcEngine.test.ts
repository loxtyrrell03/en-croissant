import { afterEach, expect, test, vi } from "vitest";
import type { EngineOptions } from "@/bindings";
import { createGamingPcLc0Engine } from "@/utils/engines";
import { getPcEngineBestMoves, type PcEngineAnalysisUpdate } from "@/utils/pcEngine";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

afterEach(() => {
    vi.unstubAllGlobals();
});

function streamingResponse(...messages: unknown[]) {
    const encoder = new TextEncoder();
    const chunk = encoder.encode(
        `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    );
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: vi
                    .fn()
                    .mockResolvedValueOnce({ value: chunk, done: false })
                    .mockResolvedValueOnce({ value: undefined, done: true }),
            }),
        },
    };
}

test("desktop PC LC0 streams lines with odds settings and White-relative scores", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
        streamingResponse(
            {
                type: "meta",
                engine: "LCZero 0.32.1",
                networkMode: "rook",
                networkName: "Rook odds",
            },
            {
                type: "uci",
                line: "info depth 7 multipv 1 score cp 30 nodes 1200 nps 4000 pv e7e5 g1f3",
            },
            { type: "done", bestmove: "e7e5" },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const updates: PcEngineAnalysisUpdate[] = [];
    const options: EngineOptions = {
        fen: INITIAL_FEN,
        moves: ["e2e4"],
        extraOptions: [
            { name: "MultiPV", value: "2" },
            { name: "AutoNetwork", value: "false" },
            { name: "OddsMode", value: "rook" },
        ],
    };

    const result = await getPcEngineBestMoves({
        engine: createGamingPcLc0Engine(),
        goMode: { t: "Depth", c: 7 },
        options,
        onUpdate: (update) => updates.push(update),
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:38419/v1/analyze");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        multipv: 2,
        depth: 7,
        engineKind: "lc0",
        lc0AutoNetwork: false,
        lc0Network: "rook",
    });
    expect(result?.[1][0]).toMatchObject({
        depth: 7,
        score: { value: { type: "cp", value: -30 } },
        uciMoves: ["e7e5", "g1f3"],
        sanMoves: ["e5", "Nf3"],
    });
    expect(updates.at(-1)).toMatchObject({
        networkMode: "rook",
        networkName: "Rook odds",
        engineName: "LCZero 0.32.1",
    });
});
