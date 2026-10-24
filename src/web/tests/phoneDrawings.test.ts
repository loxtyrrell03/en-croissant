import { describe, expect, it } from "vitest";
import { createEmptyWebState } from "../storage";
import { createWebStateSession } from "../webStateSession";
import { parsePgnDatabase, webGameToLine, webGameToRootLines } from "../pgn";
import {
    annotatePhoneDrawings,
    annotatePhoneMove,
    phonePrepAnnotationContext,
    savedPhoneDrawings,
} from "../phoneAnnotations";
import { normalizePhoneDrawings, phoneDrawingSeat, togglePhoneDrawing } from "../phoneDrawings";
import type { WebCompanionState, WebDrawing } from "../model";

const arrow: WebDrawing = { orig: "e2", dest: "e4", brush: "green" };
const circle: WebDrawing = { orig: "d5", brush: "red" };
function fixture(
    pgn = '[White "Invented White"]\n[Black "Invented Black"]\n{Root note [%csl Yd4]} 1. e4 {Move note [%cal Ge2e4] [%clk 0:04:59] [%eval 0.25,17] [%timestamp 123]} e5 *',
) {
    const imported = parsePgnDatabase("Drawing fixture", pgn, 1);
    const game = imported.games[0];
    const state = createEmptyWebState();
    state.databases = [imported.database];
    state.gamesByDatabase = { [game.databaseId]: [game] };
    state.board = {
        ...state.board,
        annotationOwnerId: "fixture-board",
        sourceDatabaseId: game.databaseId,
        sourceGameId: game.id,
        startFen: game.moves[0]?.fenBefore ?? state.board.startFen,
        line: webGameToLine(game),
        cursor: 1,
    };
    return state;
}
const game = (state: WebCompanionState) => state.gamesByDatabase[state.board.sourceDatabaseId!][0];
const draw = (state: WebCompanionState, shapes: WebDrawing[]) =>
    annotatePhoneDrawings(state, phoneDrawingSeat(state).owner, shapes);
const at = (state: WebCompanionState, cursor: number) => ({
    ...state,
    board: { ...state.board, cursor },
});

describe("phone saved-node drawing ownership", () => {
    it("imports root and move arrows/circles separately from notes and keeps legal variation marks", () => {
        const state = fixture();
        expect(savedPhoneDrawings(at(state, 0))).toEqual([{ orig: "d4", brush: "yellow" }]);
        expect(savedPhoneDrawings(state)).toEqual([arrow]);
        expect(savedPhoneDrawings(at(state, 2))).toEqual([]);
        expect(game(state).moves[0].comments).toEqual(["Move note"]);
        expect(game(state).moves[0].clockSeconds).toBe(299);
        const imported = parsePgnDatabase("Variation", "1. e4 (1. d4 {[%cal Rd2d4]} d5) e5 *")
            .games[0];
        expect(webGameToRootLines(imported)[1][0].shapes).toEqual([
            { orig: "d2", dest: "d4", brush: "red" },
        ]);
    });

    it("keeps accumulated marks through navigation, exports them, and clears only the chosen node", () => {
        const original = fixture();
        let state = draw(original, [arrow, circle]);
        expect(original.board.line[0].shapes).toEqual([arrow]);
        expect(savedPhoneDrawings(at(state, 2))).toEqual([]);
        state = draw(at(state, 2), [{ orig: "e7", dest: "e5", brush: "blue" }]);
        expect(savedPhoneDrawings(at(state, 1))).toEqual([arrow, circle]);
        state = draw(at(state, 1), []);
        expect(savedPhoneDrawings(state)).toEqual([]);
        expect(savedPhoneDrawings(at(state, 2))).toEqual([
            { orig: "e7", dest: "e5", brush: "blue" },
        ]);
        const reloaded = parsePgnDatabase("Reload", game(state).pgn).games[0];
        expect(reloaded.rootShapes).toHaveLength(1);
        expect(reloaded.moves[0].shapes ?? []).toEqual([]);
        expect(reloaded.moves[1].shapes).toHaveLength(1);
        for (const evidence of ["Root note", "Move note", "%clk", "%eval", "%timestamp"])
            expect(game(state).pgn).toContain(evidence);
    });

    it("saves marks at the root and retains them when move notes and glyphs change", () => {
        let state = draw(at(fixture(), 0), [circle]);
        expect(game(state).pgn).toContain("[%csl Rd5]");
        state = draw(at(state, 1), [arrow, circle]);
        state = annotatePhoneMove(
            state,
            1,
            { comments: ["Updated note"], annotations: ["?!"] },
            phoneDrawingSeat(state).owner,
        );
        const reloaded = parsePgnDatabase("Reload", game(state).pgn).games[0];
        expect(reloaded.rootShapes).toEqual([circle]);
        expect(reloaded.moves[0].shapes).toEqual([circle, arrow]); // Portable circles precede arrows.
        expect(reloaded.moves[0].comments).toEqual(["Updated note"]);
        expect(reloaded.moves[0].annotations).toEqual(["?!"]);
        expect(reloaded.moves[0].clockSeconds).toBe(299);
    });

    it("distinguishes transpositions and writes the exact side-line node", () => {
        let state = fixture("1. Nf3 (1. Nc3 Nc6 2. Nf3 Nf6) Nf6 2. Nc3 Nc6 *");
        const roots = webGameToRootLines(game(state));
        state = draw(at(state, 4), [arrow]);
        const main = state.board.line;
        state = { ...state, board: { ...state.board, line: roots[1], cursor: 4 } };
        expect(main[3].fenAfter).toBe(state.board.line[3].fenAfter);
        expect(savedPhoneDrawings(state)).toEqual([]);
        state = draw(state, [circle]);
        expect(savedPhoneDrawings({ ...state, board: { ...state.board, line: main } })).toEqual([
            arrow,
        ]);
        const reopened = webGameToRootLines(parsePgnDatabase("Reload", game(state).pgn).games[0]);
        expect(reopened[0][3].shapes).toEqual([arrow]);
        expect(reopened[1][3].shapes).toEqual([circle]);
    });

    it("rejects late draw/note callbacks after navigation, board replacement or a source switch", () => {
        const state = fixture();
        const owner = phoneDrawingSeat(state).owner;
        for (const next of [
            at(state, 2),
            { ...state, board: { ...state.board, sourceGameId: "another" } },
            { ...state, board: { ...state.board, annotationOwnerId: "reopened" } },
        ]) {
            expect(annotatePhoneDrawings(next, owner, [circle])).toBe(next);
            expect(annotatePhoneMove(next, 1, { comments: ["Late"] }, owner)).toBe(next);
        }
    });

    it("keeps Prep drawings independent from other Prep workspaces and source games", () => {
        const state = fixture();
        const prep = {
            id: "prep-a",
            name: "Prep A",
            opponent: "Opponent",
            userColor: "white" as const,
            sourceIds: [],
            startFen: state.board.startFen,
            line: state.board.line,
            notesByFen: {},
            preparedMoves: {},
            createdAt: 1,
            updatedAt: 1,
        };
        state.prepWorkspaces = [prep, { ...prep, id: "prep-b" }];
        state.activePrepId = prep.id;
        const next = draw(state, [circle]);
        expect(savedPhoneDrawings(next)).toEqual([circle]);
        expect(savedPhoneDrawings({ ...next, activePrepId: "prep-b" })).toEqual([arrow]);
        expect(next.gamesByDatabase).toBe(state.gamesByDatabase);
        expect(state.prepWorkspaces[0].line[0].shapes).toEqual([arrow]);
    });

    it("reads older workspace drawings from their portable PGN without changing saved state", () => {
        const state = fixture();
        delete state.board.line[0].shapes;
        delete game(state).moves[0].shapes;
        delete game(state).rootShapes;
        const before = JSON.stringify(state);
        expect(savedPhoneDrawings(state)).toEqual([arrow]);
        expect(savedPhoneDrawings(at(state, 0))).toEqual([{ orig: "d4", brush: "yellow" }]);
        expect(JSON.stringify(state)).toBe(before);
    });

    it("retains a draft branch's drawings by history when its active line is replaced", () => {
        const state = fixture();
        state.board.sourceGameId = null;
        state.board.sourceDatabaseId = null;
        const next = draw(state, [circle]);
        const oldLine = next.board.line;
        const otherLine = webGameToLine(parsePgnDatabase("Other", "1. d4 d5 *").games[0]);
        const switched = { ...next, board: { ...next.board, line: otherLine } };
        expect(savedPhoneDrawings(switched)).toEqual([]);
        expect(
            savedPhoneDrawings({ ...switched, board: { ...switched.board, line: oldLine } }),
        ).toEqual([circle]);
    });

    it("rejects inconsistent move/FEN evidence rather than attaching marks to another portable node", () => {
        const state = fixture();
        state.board.line = state.board.line.map((move) => ({
            ...move,
            fenAfter: state.board.startFen,
        }));
        expect(draw(state, [circle])).toBe(state);
        expect(annotatePhoneMove(state, 1, { comments: ["Must not land"] })).toBe(state);
    });

    it("preserves a Black-to-move custom root and an unplayed position on portable export", () => {
        const custom = "7k/8/8/8/8/8/8/K7 b - - 11 37";
        let state = fixture(`[SetUp "1"]\n[FEN "${custom}"]\n{[%csl Gh8]} *`);
        state.board.startFen = custom;
        state = draw(at(state, 0), [circle]);
        expect(game(state).pgn).toContain(`[FEN "${custom}"]`);
        expect(parsePgnDatabase("Reload", game(state).pgn).games[0].rootShapes).toEqual([circle]);
    });

    it("carries a custom starting root and its marks into a new independent Prep", () => {
        const startFen = "7k/8/8/8/8/8/8/K7 b - - 11 37";
        let state = fixture(`[SetUp "1"]\n[FEN "${startFen}"]\n{[%csl Gh8]} *`);
        state.board.startFen = startFen;
        state = draw(at(state, 0), [circle]);
        const sourcePgn = game(state).pgn;
        const context = phonePrepAnnotationContext(state);
        expect(context.startFen).toBe(startFen);
        expect(context.rootShapes).toEqual([circle]);
        expect(context.drawings).not.toBe(state.board.drawings);
        const prep = {
            ...context,
            id: "custom-prep",
            name: "Custom",
            opponent: "Opponent",
            userColor: "black" as const,
            sourceIds: [],
            line: state.board.line,
            notesByFen: {},
            preparedMoves: {},
            createdAt: 1,
            updatedAt: 1,
        };
        const selected = { ...state, activePrepId: prep.id, prepWorkspaces: [prep] };
        expect(savedPhoneDrawings(selected)).toEqual([circle]);
        const edited = draw(selected, [arrow]);
        expect(savedPhoneDrawings(edited)).toEqual([arrow]);
        expect(savedPhoneDrawings({ ...edited, activePrepId: null })).toEqual([circle]);
        expect(game(edited).pgn).toBe(sourcePgn);
    });

    it("keeps drawing edits through a failed workspace commit and retries the newest evidence", async () => {
        let failing = true;
        const session = createWebStateSession({
            load: async () => fixture(),
            save: async () => {
                if (failing) throw new Error("Storage full");
            },
        });

        await session.load();
        session.setState((state) => draw(state, [circle]));
        await expect(session.flush()).rejects.toThrow("Storage full");
        expect(savedPhoneDrawings(session.getSnapshot().state)).toEqual([circle]);
        expect(savedPhoneDrawings(session.getSnapshot().savedState!)).toEqual([arrow]);
        failing = false;
        await session.flush();
        expect(savedPhoneDrawings(session.getSnapshot().savedState!)).toEqual([circle]);
    });

    it("toggles only the selected mark and excludes transient/unsupported overlays", () => {
        expect(togglePhoneDrawing([arrow, circle], "e2", "e4", "green")).toEqual([circle]);
        expect(togglePhoneDrawing([arrow, circle], "e2", "e4", "blue")).toEqual([
            circle,
            { ...arrow, brush: "blue" },
        ]);
        expect(togglePhoneDrawing([arrow], "d5", "d5", "red")).toEqual([arrow, circle]);
        expect(
            normalizePhoneDrawings([
                arrow,
                arrow,
                { orig: "z9", brush: "red" },
                { ...circle, piece: { role: "knight" } },
                { ...circle, brush: "paleGreen" },
                { ...circle, customSvg: "x" },
            ]),
        ).toEqual([arrow]);
    });
});
