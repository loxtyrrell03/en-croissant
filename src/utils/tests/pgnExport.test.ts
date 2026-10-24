import { expect, it, vi } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import { parsePgn } from "chessops/pgn";
import { createTreeStore } from "@/state/store/tree";
import { getMoveText, getPGN } from "../chess";

vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
const options = { glyphs: true, comments: true, variations: true, extraMarkups: true };

it.each([
    [
        "7k/8/8/8/8/8/8/K7 w - - 11 37",
        ["Ka2", "Kg8", "Kb2"],
        "Kb1",
        "37. Ka2",
        "37. Kb1",
        "38. Kb2",
    ],
    [
        "7k/8/8/8/8/8/8/K7 b - - 11 37",
        ["Kg8", "Ka2", "Kh7"],
        "Kh7",
        "37... Kg8",
        "37... Kh7",
        "38. Ka2",
    ],
] as const)(
    "exports custom-root move counters and variations from %s",
    (fen, moves, alternative, first, branch, later) => {
        const store = createTreeStore();
        store.getState().setFen(fen);
        store.getState().setComment("Root note");
        store.getState().makeMoves({ payload: [...moves] });
        store.getState().goToStart();
        store.getState().makeMove({ payload: alternative });
        store.getState().setComment("Alternative note");
        const before = JSON.stringify(store.getState());
        const { root, headers } = store.getState();
        const pgn = getPGN(root, { ...options, headers });
        for (const value of [fen, "Root note", "Alternative note", first, branch, later])
            expect(pgn).toContain(value);
        expect(pgn).toContain("(");
        expect(JSON.stringify(store.getState())).toBe(before);
        // Engine/history indices stay relative to the root; export must not rebase them.
        expect(root.halfMoves).toBe(fen.includes(" b ") ? 1 : 0);
        expect(root.children[0].halfMoves).toBe(root.halfMoves + 1);
        expect(
            getMoveText(root.children[0].children[0].children[0], {
                ...options,
                isFirst: true,
            }),
        ).toContain(fen.includes(" b ") ? "38... Kh7" : "38. Kb2");
    },
);

it("keeps standard game numbering and empty custom-root metadata", () => {
    const store = createTreeStore();
    store.getState().makeMoves({ payload: ["e4", "e5", "Nf3"] });
    let { root, headers } = store.getState();
    expect(root.fen).toBe(INITIAL_FEN);
    expect(getPGN(root, { ...options, headers })).toContain("1. e4 e5 2. Nf3");
    const fen = "7k/8/8/8/8/8/8/K7 b - - 11 37";
    store.getState().setFen(fen);
    ({ root, headers } = store.getState());
    const empty = getPGN(root, { ...options, headers });
    expect(empty).toContain(`[FEN "${fen}"]`);
    expect(empty).toContain('[SetUp "1"]');
    expect(empty).not.toContain("37.");
});

it("exports each annotation once without comma-separated duplicates", () => {
    const store = createTreeStore();
    store.getState().makeMove({ payload: "e4" });
    store.getState().setCurrentNodeMetadata({ annotations: ["!", "!?", "="] });
    const { root, headers } = store.getState();
    const pgn = getPGN(root, { ...options, headers });
    expect(pgn).toContain("1. e4 $1 $5 $10");
    expect(parsePgn(pgn)[0].moves.children[0].data.nags).toEqual([1, 5, 10]);
    expect(pgn).not.toContain(",");
    expect(getPGN(root, { ...options, headers, glyphs: false })).not.toContain("$10");
});
