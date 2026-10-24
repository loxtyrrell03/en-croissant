import { webcrypto } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { parseUci } from "chessops";
import { createTreeStore } from "@/state/store/tree";
import { getPGN, parsePgnTokens } from "../chess";
import { GAME_REPORT_RUN_HEADER, readGameReportRun, recordGameReportRun } from "../gameReportRun";
import { createNode, defaultTree } from "../treeReducer";
import type { Token } from "@/bindings";
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

function fixture() {
    vi.stubGlobal("crypto", webcrypto);
    const tree = defaultTree();
    tree.root.score = { value: { type: "cp", value: 15 }, wdl: null };
    tree.root.depth = 8;
    const child = createNode({
        fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        move: parseUci("e2e4")!,
        san: "e4",
        halfMoves: 1,
    });
    child.score = { value: { type: "cp", value: 29 }, wdl: null };
    child.depth = 7;
    tree.root.children.push(child);
    return createTreeStore(undefined, tree);
}
const details = {
    engine: "Fixture Stockfish",
    limit: { t: "Combined" as const, c: { depth: 8, timeMs: 50 } },
};

test("a completed run retains its own limits through session/PGN serialization", async () => {
    const store = fixture();
    await recordGameReportRun(store, details, () => true);
    const { root, headers } = store.getState();
    const raw = headers.other![GAME_REPORT_RUN_HEADER];
    const run = await readGameReportRun(raw, root);
    expect(run?.limit).toEqual(details.limit);
    expect(run?.engine).toBe(details.engine);
    const pgn = getPGN(root, {
        headers,
        glyphs: true,
        comments: true,
        variations: true,
        extraMarkups: true,
    });
    expect(pgn).toContain(`ECGameAnalysis "${raw}"`);
    expect(pgn).toContain("[%eval +0.15,8]");
    expect(pgn).toContain("[%eval +0.29,7]");
    // Use the actual native-token parser with the exact exported tag/marks.
    const tokens: Token[] = [
        { type: "Header", value: { tag: GAME_REPORT_RUN_HEADER, value: raw } },
        { type: "Comment", value: "[%eval +0.15,8]" },
        { type: "San", value: "e4" },
        { type: "Comment", value: "[%eval +0.29,7]" },
        { type: "Outcome", value: "*" },
    ];
    const restored = parsePgnTokens(tokens);
    expect(restored.root.depth).toBe(8);
    expect(restored.root.children[0].depth).toBe(7);
    expect(
        await readGameReportRun(restored.headers.other![GAME_REPORT_RUN_HEADER], restored.root),
    ).toEqual(run);
    const session = JSON.parse(JSON.stringify(store.getState()));
    expect(
        await readGameReportRun(session.headers.other[GAME_REPORT_RUN_HEADER], session.root),
    ).toEqual(run);
});

test("comments/marks keep run identity but changed game, score or actual depth invalidates it", async () => {
    const store = fixture();
    await recordGameReportRun(store, details, () => true);
    const raw = store.getState().headers.other![GAME_REPORT_RUN_HEADER];
    store.getState().setComment("My notes");
    store.getState().setShapes([{ orig: "e2", dest: "e4", brush: "green" }]);
    expect(await readGameReportRun(raw, store.getState().root)).not.toBeNull();
    for (const change of ["score", "depth", "game"] as const) {
        const root = structuredClone(store.getState().root);
        if (change === "score") root.children[0].score!.value.value += 1;
        if (change === "depth") root.children[0].depth! += 1;
        if (change === "game") root.children = [];
        expect(await readGameReportRun(raw, root)).toBeNull();
    }
    expect(await readGameReportRun(undefined, store.getState().root)).toBeNull();
    for (const invalid of ["%broken", "{}", "x".repeat(4097)])
        expect(await readGameReportRun(invalid, store.getState().root)).toBeNull();
});

test("late checksum completion cannot attach metadata to a replacement request or evidence", async () => {
    const store = fixture();
    await recordGameReportRun(store, details, () => false);
    expect(store.getState().headers.other).toBeUndefined();
    const pending = recordGameReportRun(store, details, () => true);
    store.getState().setScore({ value: { type: "cp", value: 100 }, wdl: null });
    await pending;
    expect(store.getState().headers.other).toBeUndefined();
});
