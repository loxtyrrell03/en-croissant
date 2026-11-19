import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
    decisionCaptureChoices,
    gatherDecisionEvidence,
} from "@/components/panels/tactics/decisionSearch";
import type { BestMoves, EngineOptions } from "@/bindings";
import type { LocalEngine } from "@/utils/engines";

const native = vi.hoisted(() => ({ listen: vi.fn(), getBestMoves: vi.fn(), kill: vi.fn() }));
vi.mock("@/bindings", () => ({ events: { bestMovesPayload: { listen: native.listen } } }));
vi.mock("@/utils/engines", () => ({ getBestMoves: native.getBestMoves, killEngine: native.kill }));

const engine = {
    id: "fixture",
    name: "Stockfish",
    version: "fixture",
    path: "test-only",
    type: "local",
    settings: [],
} satisfies LocalEngine;
const fen = "8/2r1k2p/3b4/8/8/2N5/1P5P/6K1 w - - 0 1";
const first = ["b2b4", "e7f7", "g1f2"];
const second = ["b2b3", "e7f7", "g1f2"];
const third = ["h2h3", "e7f7", "g1f2"];
const blackReplies = [
    ["e7f7", "g1f2"],
    ["d6c5", "b4c5"],
    ["e7d7", "g1f2"],
];
const conditional = ["d6b4", "c3d5", "e7f7", "d5c7", "b4d6", "g1f2", "f7g6", "f2e3"];
const after = "8/2r1k2p/3b4/8/1P6/2N5/7P/6K1 b - - 0 1";
const lines = (moves: string[][], scores = [100, 50, 20], depth = 18): BestMoves[] =>
    moves.map((uciMoves, index) => ({
        nodes: 600000,
        nps: 300000,
        depth,
        multipv: index + 1,
        uciMoves,
        sanMoves: [],
        score: { value: { type: "cp", value: scores[index] }, wdl: null },
    }));

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    native.listen.mockResolvedValue(vi.fn());
    native.kill.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

test("a decision search keeps candidate, unrestricted reply and capture evidence separate", async () => {
    native.getBestMoves.mockImplementation((_engine, _tab, _mode, options: EngineOptions) => {
        if (options.searchMoves?.[0] === "d6b4")
            return Promise.resolve([100, lines([conditional], [500])]);
        if (options.moves.length)
            return Promise.resolve([100, lines(blackReplies, [100, 120, 130])]);
        return Promise.resolve([100, lines([first, second, third])]);
    });
    const result = await gatherDecisionEvidence(
        engine,
        { fen, history: { fen, moves: [] } },
        new AbortController().signal,
        vi.fn(),
    );
    expect(result.candidates[0].pvUci).toEqual(first);
    expect(result.replyProbes?.[0].lines[0]).toMatchObject({ fen: after, cp: -100 });
    expect(result.replyProbes?.[0].targetedCaptures?.[0]).toMatchObject({
        line: { fen: after, cp: -500, pvUci: conditional },
    });
    expect(native.getBestMoves.mock.calls.map((call) => call[3].moves)).toEqual([
        [],
        ["b2b4"],
        ["b2b4"],
    ]);
    expect(new Set(native.getBestMoves.mock.calls.map((call) => call[1])).size).toBe(3);
});

test("an exact frame is required and a reply from a cancelled startup is cleaned up", async () => {
    const controller = new AbortController();
    const removed = vi.fn();
    native.listen.mockResolvedValue(removed);
    native.getBestMoves.mockImplementation(() => new Promise(() => {}));
    const underway = gatherDecisionEvidence(engine, { fen }, controller.signal, vi.fn());
    await Promise.resolve();
    const listener = native.listen.mock.calls[0][0];
    const tab = native.getBestMoves.mock.calls[0][1];
    const payload = {
        engine: engine.id,
        tab,
        fen,
        moves: [],
        progress: 100,
        bestLines: lines([first, second, third]),
    };
    listener({ payload: { ...payload, tab: "another-run" } });
    expect(native.kill).not.toHaveBeenCalled();
    controller.abort();
    await expect(underway).rejects.toMatchObject({ name: "AbortError" });
    expect(native.kill).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    listener({ payload });
    expect(native.kill).toHaveBeenCalledTimes(2);
    expect(removed).toHaveBeenCalledTimes(1);
});

test("capture nominations allow en passant and reject an ordinary defended-piece capture", () => {
    expect(decisionCaptureChoices("8/2r1k2p/8/8/3p4/2N5/4P2P/6K1 w - - 0 1", "e2e4")).toEqual([
        "d4e3",
    ]);
    expect(decisionCaptureChoices("1q3rk1/2N2ppp/8/7Q/8/3B4/8/R5K1 w - - 0 1", "a1a8")).toEqual([]);
});
