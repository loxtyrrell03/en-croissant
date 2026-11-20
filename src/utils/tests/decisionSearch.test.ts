import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
    decisionCaptureChoices,
    gatherCheckingDefence,
    gatherDecisionEvidence,
    gatherExtraPositionChoice,
} from "@/components/panels/tactics/decisionSearch";
import { assessChessDecision } from "@/utils/tacticalMotifs/decisionAssessment";
import type { BestMoves, EngineOptions } from "@/bindings";
import type { LocalEngine } from "@/utils/engines";
import cases from "../../../benchmarks/decision-evidence/defence-after-attack/fixtures.json";
import mateTwo from "../../../benchmarks/decision-evidence/played-mate-in-two/fixtures.json";
import drawFrames from "../../../benchmarks/decision-evidence/draw-aware-search/fixtures.json";

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

test("a drawing alternative with an engine tail does not hide the defensive tactic", async () => {
    const fixture = drawFrames.gatherDefensiveResource;
    const input = (frames: typeof fixture.candidates | (typeof fixture.replyProbes)[0]["lines"], sign: number) =>
        frames.map((frame, index): BestMoves => ({
            ...lines([frame.pvUci], [0], frame.depth)[0],
            multipv: index + 1,
            score: {
                value: frame.mate == null
                    ? { type: "cp", value: sign * frame.cp! }
                    : { type: "mate", value: sign * frame.mate },
                wdl: null,
            },
        }));
    native.getBestMoves.mockImplementation((_engine, _tab, _mode, options: EngineOptions) =>
        Promise.resolve([100, options.moves.length === fixture.history.moves.length
            ? input(fixture.candidates, -1)
            : input(fixture.replyProbes[0].lines, 1)]),
    );
    const saved = await gatherDecisionEvidence(
        engine,
        { fen: fixture.fen, playedMoveUci: fixture.playedMoveUci, history: fixture.history },
        new AbortController().signal,
        vi.fn(),
    );
    expect(saved.candidates.map((row) => row.pvUci[0])).toEqual(["g4g3", "e4e3", "f4f3"]);
    expect(saved.candidates.slice(1).map((row) => row.pvUci.length)).toEqual([8, 10]);
    expect(saved.replyProbes?.[0].lines[0].pvUci[0]).toBe("h2h3");
    const report = assessChessDecision({ ...saved, history: fixture.history });
    expect(report?.position.tactical.reasons.join(" ")).toMatch(/Kg1.*Re1.*Kh3/);
    expect(native.getBestMoves).toHaveBeenCalledTimes(2);
});

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

test("an exact mate in one skips the paired and played-reply searches", async () => {
    const before = "6k1/p4ppp/8/8/8/8/7P/4R2K b - - 0 1";
    const originalReplies = [
        ["h7h6", "e1e8", "g8h7"],
        ["g7g6", "e1e8", "g8g7"],
        ["f7f6", "e1e8", "g8f7"],
    ];
    const defensiveReplies = [
        ["e1e8", "g8h7"],
        ["h1g2", "h6h5"],
        ["e1e4", "a7a6"],
    ];
    native.getBestMoves.mockImplementation((_engine, _tab, _mode, options: EngineOptions) =>
        Promise.resolve([
            100,
            options.moves.length
                ? lines(defensiveReplies, [290, 280, 250])
                : lines(originalReplies, [290, 300, 330]),
        ]),
    );
    const evidence = await gatherDecisionEvidence(
        engine,
        { fen: before, playedMoveUci: "a7a6", history: { fen: before, moves: [] } },
        new AbortController().signal,
        vi.fn(),
    );
    expect(evidence.comparisonCandidates).toBeUndefined();
    expect(native.getBestMoves.mock.calls.map((call) => call[3].moves)).toEqual([[], ["h7h6"]]);
    expect(native.getBestMoves.mock.calls.every((call) => !call[3].searchMoves?.length)).toBe(true);
    expect(assessChessDecision(evidence)?.mistake?.mateConsequence?.lineUci).toEqual([
        "a7a6",
        "e1e8",
    ]);
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

test("checking defence searches the exact alternative and played checkpoints within the session", async () => {
    const { input, checkingDefence, captures, expectedBoards } = cases.passedPawn;
    const target = { fen: input.fen, history: { fen: input.fen, moves: [] } };
    const request = {
        better: { fen: expectedBoards[0], prefix: ["f8f7", "e6e7"] },
        played: { fen: expectedBoards[1], prefix: ["c6d7", "e6e7"] },
        captures,
    };
    const abort = new AbortController();
    native.getBestMoves.mockImplementation((_engine, _tab, _mode, options: EngineOptions) => {
        if (options.searchMoves) {
            const frame = checkingDefence.capture;
            return Promise.resolve([100, lines([frame.pvUci], [frame.cp], frame.depth)]);
        }
        return Promise.resolve([100, lines([["d7c6"], ["d7d8"], ["d7c8"]], [-740, -800, -830])]);
    });
    const result = await gatherCheckingDefence(engine, target, request, abort.signal, Date.now() + 5000);
    expect(result?.capture).toMatchObject({ fen: request.better.fen, pvUci: checkingDefence.capture.pvUci });
    expect(result?.played).toMatchObject({ fen: request.played.fen, pvUci: ["d7c6"] });
    const calls = native.getBestMoves.mock.calls;
    expect(calls.map((call) => call[2])).toEqual([{ t: "Nodes", c: 2_400_000 }, { t: "Nodes", c: 2_400_000 }]);
    expect(calls[0][3]).toMatchObject({ fen: input.fen, moves: request.better.prefix, searchMoves: captures });
    expect(calls[1][3]).toMatchObject({ fen: input.fen, moves: request.played.prefix });
    await expect(gatherCheckingDefence(engine, target, request, abort.signal, Date.now())).resolves.toBeNull();
    expect(native.getBestMoves).toHaveBeenCalledTimes(2);
});

test("the extra comparison uses a short list, one paired search and an independent reply", async () => {
    const start = "r7/4k3/4p3/8/8/2N5/7P/6K1 w - - 0 1";
    const best = ["c3b5", "e7f7", "g1f2", "f7g6", "f2g3", "a8a1"];
    const alternative = ["c3d5", "e6d5", "g1g2", "e7f6", "g2f3", "f6e5", "h2h3"];
    const candidates = [
        { fen: start, cp: -100, depth: 18, pvUci: best },
        { fen: start, cp: -120, depth: 18, pvUci: ["c3a4"] },
        { fen: start, cp: -150, depth: 18, pvUci: ["h2h3"] },
    ];
    const target = { fen: start, history: { fen: start, moves: [] } };
    let failReply = false;
    native.getBestMoves.mockImplementation((_engine, _tab, _mode, options: EngineOptions) => {
        if (options.searchMoves)
            return Promise.resolve([100, lines([best, alternative], [-100, -410])]);
        if (options.moves[0] === alternative[0]) {
            if (failReply) return Promise.reject(new Error("The optional reply failed"));
            return Promise.resolve([
                100,
                lines([alternative.slice(1), ["e7f7"], ["e7d8"]], [-408, -155, -90]),
            ]);
        }
        return Promise.resolve([
            100,
            lines(
                [best, ["c3a4"], ["h2h3"], alternative, ["g1f2"], ["c3b1"]],
                [-100, -125, -160, -175, -200, -250],
                10,
            ),
        ]);
    });
    const add = () =>
        gatherExtraPositionChoice(
            engine,
            target,
            candidates,
            new AbortController().signal,
            Date.now() + 10_000,
        );
    const extraPositionChoice = await add();
    const result = assessChessDecision({ fen: start, candidates, extraPositionChoice });
    expect(result?.position.tactical).toMatchObject({
        support: "supported",
        basis: "engine-supported",
    });
    expect(result?.position.tacticalContrast?.explanation).toContain("exd5");
    expect(result?.position.examinedChoices).toBe(4);
    expect(result?.moves.map((move) => move.moveUci)).toEqual(["c3b5", "c3a4", "h2h3"]);
    expect(result?.mistake).toBeNull();
    const calls = native.getBestMoves.mock.calls;
    expect(calls.map((call) => call[2])).toEqual([
        { t: "Nodes", c: 90_000 },
        { t: "Nodes", c: 1_200_000 },
        { t: "Nodes", c: 1_000_000 },
    ]);
    expect(calls[0][3].extraOptions).toContainEqual({ name: "MultiPV", value: "6" });
    expect(calls[1][3].searchMoves).toEqual(["c3b5", "c3d5"]);
    expect(calls[2][3]).toMatchObject({ fen: start, moves: ["c3d5"] });
    failReply = true;
    await expect(add()).resolves.toBeUndefined();
});

test("one restricted query uses the better move's history and can fail independently", async () => {
    const start = "5k2/1p3r2/3R2p1/7n/P6P/1P3n2/1K3R2/8 w - - 1 32";
    const best = ["d6d3", "f3e5", "f2f7"];
    const played = ["d6g6", "h5f4", "g6d6"];
    let failControl = false;
    native.getBestMoves.mockImplementation((_engine, _tab, _mode, options: EngineOptions) => {
        if (options.searchMoves?.[0] === "h5f4")
            return failControl
                ? Promise.reject(new Error("Engine rejected the optional query"))
                : Promise.resolve([100, lines([["h5f4", "d3f3"]], [444])]);
        if (options.moves[0] === played[0])
            return Promise.resolve([
                100,
                lines([played.slice(1), ["f8e7"], ["f7f5"]], [44, 100, 300]),
            ]);
        if (options.moves[0] === best[0])
            return Promise.resolve([
                100,
                lines([best.slice(1), ["b7b6"], ["f7f5"]], [377, 400, 450]),
            ]);
        return Promise.resolve([
            100,
            options.searchMoves
                ? lines([best, played], [420, 50])
                : lines([best, played, ["a4a5"]], [420, 50, 20]),
        ]);
    });
    const result = await gatherDecisionEvidence(
        engine,
        { fen: start, playedMoveUci: played[0], history: { fen: start, moves: [] } },
        new AbortController().signal,
        vi.fn(),
    );
    expect(result.sharedReply).toMatchObject({
        betterMoveUci: "d6d3",
        playedMoveUci: "d6g6",
        line: { cp: -444, pvUci: ["h5f4", "d3f3"] },
    });
    const matches = native.getBestMoves.mock.calls.filter(
        (call) => call[3].searchMoves?.[0] === "h5f4",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0][2]).toEqual({ t: "Nodes", c: 1_000_000 });
    expect(matches[0][3]).toMatchObject({ fen: start, moves: ["d6d3"] });
    failControl = true;
    const fallback = await gatherDecisionEvidence(
        engine,
        { fen: start, playedMoveUci: played[0], history: { fen: start, moves: [] } },
        new AbortController().signal,
        vi.fn(),
    );
    expect(fallback.sharedReply).toBeUndefined();
    expect(fallback.replyProbes).toEqual(result.replyProbes);
});

test("position analysis checks one plausible alternative on its own board and history", async () => {
    const start = "r7/4k3/4p3/8/8/2N5/7P/6K1 w - - 0 1";
    const best = ["c3b5", "e7f7", "g1f2", "f7g6", "f2g3", "a8a1"];
    const alternative = ["c3d5", "e6d5", "g1g2", "e7f6", "g2f3", "f6e5", "h2h3"];
    let failAlternative = false;
    native.getBestMoves.mockImplementation((_engine, _tab, _mode, options: EngineOptions) => {
        if (options.moves[0] === best[0])
            return Promise.resolve([
                100,
                lines([best.slice(1), ["a8a1"], ["e7d7"]], [-100, -70, -40]),
            ]);
        if (options.moves[0] === alternative[0])
            return failAlternative
                ? Promise.reject(new Error("Engine rejected the optional position query"))
                : Promise.resolve([
                      100,
                      lines([alternative.slice(1), ["e7f7"], ["e7d8"]], [-408, -155, -90]),
                  ]);
        return Promise.resolve([100, lines([best, alternative, ["h2h3"]], [-100, -410, -510])]);
    });
    const analyse = () =>
        gatherDecisionEvidence(
            engine,
            { fen: start, history: { fen: start, moves: [] } },
            new AbortController().signal,
            vi.fn(),
        );
    const report = await analyse();
    expect(report.positionReply).toMatchObject({
        moveUci: alternative[0],
        lines: [expect.objectContaining({ cp: 408 }), expect.anything(), expect.anything()],
    });
    expect(report.replyProbes?.map((probe) => probe.moveUci)).toEqual([best[0]]);
    expect(native.getBestMoves.mock.calls.map((call) => call[3].moves)).toEqual([
        [],
        [best[0]],
        [alternative[0]],
    ]);
    expect(native.getBestMoves.mock.calls.at(-1)?.[2]).toEqual({ t: "Nodes", c: 1_000_000 });
    failAlternative = true;
    const fallback = await analyse();
    expect(fallback.positionReply).toBeUndefined();
    expect(fallback.replyProbes).toEqual(report.replyProbes);
});

test("a verified quiet mate in two skips played searches and retains the leading reply", async () => {
    const { fen: root, playedMoveUci, candidates, replyProbes } = mateTwo.quiet;
    const stronger = candidates[0].pvUci[0];
    const searched = replyProbes.find((probe) => probe.moveUci === stronger)!.lines;
    native.getBestMoves.mockImplementation((_engine, _tab, _mode, options: EngineOptions) => {
        const atRoot = !options.moves.length;
        const perspective = atRoot ? -1 : 1;
        const frames = atRoot ? candidates : searched;
        return Promise.resolve([100, frames.map((line, index) => ({
            nodes: 600000,
            nps: 300000,
            depth: line.depth,
            multipv: index + 1,
            uciMoves: line.pvUci.slice(0, 2),
            sanMoves: [],
            score: {
                value: line.cp === null
                    ? { type: "mate", value: line.mate! * perspective }
                    : { type: "cp", value: line.cp * perspective },
                wdl: null,
            },
        }))]);
    });
    const evidence = await gatherDecisionEvidence(
        engine,
        { fen: root, playedMoveUci, history: { fen: root, moves: [] } },
        new AbortController().signal,
        vi.fn(),
    );
    expect(native.getBestMoves.mock.calls.map((call) => call[3].moves)).toEqual([[], [stronger]]);
    expect(native.getBestMoves.mock.calls.every((call) => !call[3].searchMoves?.length)).toBe(true);
    expect(evidence.comparisonCandidates).toBeUndefined();
    expect(assessChessDecision(evidence)?.mistake?.mateConsequence).toMatchObject({
        kind: "allowed",
        mateIn: 2,
        proof: "legal",
        avoidingMoveUci: stronger,
    });
});
