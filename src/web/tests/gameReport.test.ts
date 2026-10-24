import { webcrypto } from "node:crypto";
import { makeUci } from "chessops";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { positionFromFen } from "@/utils/chessops";
import { readGameReportRun } from "@/utils/gameReportRun";
import { treeIteratorMainLine } from "@/utils/treeReducer";
import {
    analyzeWebGameReport,
    readWebGameReport,
    savedWebGameReport,
    webReportTree,
} from "../gameReport";
import { parsePgnDatabase } from "../pgn";
import { analyzeWithWebStockfish18 } from "../stockfishEngine";
import type { WebReportGame } from "../gameReport";
vi.mock("../stockfishEngine", () => ({ analyzeWithWebStockfish18: vi.fn() }));
const analyze = vi.mocked(analyzeWithWebStockfish18);
const limits = { depth: 8, timeMs: 50 };
function game(pgn = "1. e4 e5 2. Nf3 Nc6 *"): WebReportGame {
    const parsed = parsePgnDatabase("Report fixture", pgn, 1).games[0];
    return {
        startFen: parsed.moves[0].fenBefore,
        line: parsed.moves,
        white: "White fixture",
        black: "Black fixture",
    };
}
function legalLine(fen: string, cp = 30) {
    const [position] = positionFromFen(fen);
    let uci = "";
    for (const [from, destinations] of position!.allDests()) {
        for (const to of destinations)
            if (position!.isLegal({ from, to })) {
                uci = makeUci({ from, to });
                break;
            }
        if (uci) break;
    }
    return [
        {
            source: "stockfish" as const,
            depth: 7,
            multipv: 1,
            engineName: "Stockfish fixture",
            score: { type: "cp" as const, value: cp },
            uciMoves: [uci],
            sanMoves: [],
        },
    ];
}
beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    analyze.mockReset().mockImplementation(async ({ fen }) => legalLine(fen));
});
afterEach(() => vi.unstubAllGlobals());
test("a phone report evaluates its root, retains actual caps/depth and shares native portable run verification", async () => {
    const source = game(),
        before = JSON.stringify(source),
        progress = vi.fn();
    const result = await analyzeWebGameReport(source, { limits, onProgress: progress });
    expect(analyze).toHaveBeenCalledTimes(5);
    expect(
        analyze.mock.calls.every(
            ([request]) =>
                request.reportLimits?.depth === 8 &&
                request.reportLimits.timeMs === 50 &&
                request.preferStoredEvaluation === undefined,
        ),
    ).toBe(true);
    expect(progress.mock.calls).toEqual([
        [0, 5],
        [1, 5],
        [2, 5],
        [3, 5],
        [4, 5],
        [5, 5],
    ]);
    expect(JSON.stringify(source)).toBe(before);
    const restoredRoot = JSON.parse(JSON.stringify(result.root));
    expect(await readGameReportRun(result.run, restoredRoot)).toMatchObject({
        engine: "Stockfish fixture",
        limit: { t: "Combined", c: limits },
    });
    expect([...treeIteratorMainLine(result.root)].every(({ node }) => node.depth === 7)).toBe(true);
    expect(result.report.analysedPlies).toBe(4);
});
test("a Black custom start uses its actual root score and original move number, with no fabricated White accuracy", async () => {
    const source = game('[SetUp "1"]\n[FEN "7k/6pp/8/8/8/8/6PP/KR6 b - - 0 20"]\n20... Kg8 *');
    analyze.mockImplementation(async ({ fen }) =>
        legalLine(fen, fen === source.startFen ? -400 : 400),
    );
    const result = await analyzeWebGameReport(source, { limits });
    expect(result.report.white.accuracy).toBeNull();
    expect(result.report.black.accuracy).toBeLessThan(20);
    expect(result.report.chart[0].label).toBe("20... Kg8");
    expect(result.root.score?.value).toEqual({ type: "cp", value: -400 });
});
test("checkmate is resolved by legal history without asking the engine for an empty terminal PV", async () => {
    const result = await analyzeWebGameReport(game("1. f3 e5 2. g4 Qh4# 0-1"), { limits });
    expect(analyze).toHaveBeenCalledTimes(4);
    expect(result.rulePositions).toEqual([4]);
    expect([...treeIteratorMainLine(result.root)].at(-1)?.node.score?.value).toEqual({
        type: "mate",
        value: -1,
    });
    expect(result.report.chart.at(-1)?.scoreText).toBe("Black mates");
});
test("threefold repetition uses the whole history and records a rule result", async () => {
    const result = await analyzeWebGameReport(
        game("1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 *"),
        { limits },
    );
    expect(result.rulePositions).toEqual([8]);
    expect(analyze).toHaveBeenCalledTimes(8);
    expect([...treeIteratorMainLine(result.root)].at(-1)?.node.score?.value).toEqual({
        type: "cp",
        value: 0,
    });
});

test("a fifty-move draw keeps its original clock history", async () => {
    const source = game('[SetUp "1"]\n[FEN "7k/6pp/8/8/8/8/6PP/KR6 b - - 99 20"]\n20... Kg8 *');
    const result = await analyzeWebGameReport(source, { limits });
    expect(result.rulePositions).toEqual([1]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.root.children[0].score?.value).toEqual({ type: "cp", value: 0 });
});

test("saved report evidence round-trips with its actual limits and recomputed current labels", async () => {
    const source = game();
    const result = await analyzeWebGameReport(source, { limits });
    const saved = savedWebGameReport(result);
    saved.root.halfMoves = 100; // Display counters are rebuilt from the real FEN.
    const restored = await readWebGameReport(JSON.parse(JSON.stringify(saved)), {
        ...source,
        white: "Renamed fixture",
    });
    expect(restored?.report.white.name).toBe("Renamed fixture");
    expect(restored?.report.chart[0].label).toBe("1. e4");
    expect(restored?.details.limit).toEqual({ t: "Combined", c: limits });
    expect(restored?.report.white.accuracy).toBe(result.report.white.accuracy);
});
test("different games and changed score/depth evidence cannot borrow a saved report", async () => {
    const source = game(),
        result = await analyzeWebGameReport(source, { limits });
    expect(await readWebGameReport(savedWebGameReport(result), game("1. d4 d5 *"))).toBeNull();
    const score = savedWebGameReport(result);
    score.root.children[0].score!.value.value += 1;
    expect(await readWebGameReport(score, source)).toBeNull();
    const depth = savedWebGameReport(result);
    depth.root.depth = 22;
    expect(await readWebGameReport(depth, source)).toBeNull();
    expect(await readWebGameReport({ version: 1, root: {}, run: "broken" }, source)).toBeNull();
});
test.each(["fenBefore", "fenAfter", "uci", "san"] as const)(
    "mismatched %s fails before any engine request",
    async (field) => {
        const source = game();
        const line = source.line.map((move) => ({ ...move }));
        line[1][field] = field === "uci" ? "a7a6" : field === "san" ? "a6" : source.startFen;
        await expect(analyzeWebGameReport({ ...source, line }, { limits })).rejects.toThrow(
            /report position/,
        );
        expect(analyze).not.toHaveBeenCalled();
    },
);
test("new settings and edits to source arrays cannot alter an in-flight report snapshot", async () => {
    const source = game(),
        selected = { ...limits };
    analyze.mockImplementation(async ({ fen }) => {
        selected.depth = 22;
        (source.line as unknown[]).pop();
        return legalLine(fen);
    });
    const result = await analyzeWebGameReport(source, { limits: selected });
    expect(analyze).toHaveBeenCalledTimes(5);
    expect(result.report.totalPlies).toBe(4);
    expect((await readGameReportRun(result.run, result.root))?.limit).toEqual({
        t: "Combined",
        c: limits,
    });
});
test("cancelled or replaced requests cannot produce a completed report", async () => {
    let current = true;
    await expect(
        analyzeWebGameReport(game(), {
            limits,
            isCurrent: () => current,
            onProgress: (done) => {
                if (done === 1) current = false;
            },
        }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(analyze).toHaveBeenCalledTimes(1);
});
test("failed, cached or over-cap evidence remains a visible failure instead of a fallback report", async () => {
    analyze.mockImplementation(async ({ fen }) => [
        { ...legalLine(fen)[0], source: "lichess-cloud", depth: 65 },
    ]);
    await expect(analyzeWebGameReport(game(), { limits })).rejects.toThrow(
        /no usable bounded report score/,
    );
    expect(analyze).toHaveBeenCalledTimes(1);
});
test("empty and oversized lines fail before replay or engine work", () => {
    const source = game();
    expect(() => webReportTree({ ...source, line: [] })).toThrow(/1–2,000/);
    expect(() => webReportTree({ ...source, line: Array(2001).fill(source.line[0]) })).toThrow(
        /1–2,000/,
    );
});
