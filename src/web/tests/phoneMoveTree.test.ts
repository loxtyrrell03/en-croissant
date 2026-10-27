import { describe, expect, it } from "vitest";
import type { WebCompanionState } from "../model";
import { annotatePhoneMove, annotatePhoneDrawings } from "../phoneAnnotations";
import { phoneDrawingSeat } from "../phoneDrawings";
import {
    choosePhoneMoveLine,
    findPhoneMoveLine,
    phoneMoveRootLines,
    playPhoneMoves,
    resetPhonePosition,
    resetPhoneLine,
} from "../phoneMoveTree";
import { parsePgnDatabase, webGameToLine, webGameToRootLines } from "../pgn";
import { createEmptyWebState } from "../storage";
import { createWebStateSession } from "../webStateSession";
import { validPhoneMoveTree } from "../movePanel";

function fixture(
    pgn = '[White "Invented White"]\n[Black "Invented Black"]\n[PersonalSyncRef "keep-id"]\n{Root} 1. e4 {Note [%cal Ge2e4]} e5 2. Nf3 Nc6 *',
) {
    const state = createEmptyWebState();
    const imported = parsePgnDatabase("Invented game", pgn, 1);
    const game = imported.games[0];
    state.databases = [imported.database];
    state.gamesByDatabase = { [game.databaseId]: imported.games };
    state.board = {
        ...state.board,
        annotationOwnerId: "board-a",
        sourceDatabaseId: game.databaseId,
        sourceGameId: game.id,
        line: webGameToLine(game),
        startFen: game.moves[0]?.fenBefore ?? state.board.startFen,
        cursor: 1,
    };
    return state;
}
const game = (state: WebCompanionState) => state.gamesByDatabase[state.board.sourceDatabaseId!][0];
const play = (state: WebCompanionState, ...ucis: string[]) =>
    playPhoneMoves(state, phoneDrawingSeat(state).owner, ucis);
const at = (state: WebCompanionState, cursor: number) => ({
    ...state,
    board: { ...state.board, cursor },
});
const select = (
    state: WebCompanionState,
    line: WebCompanionState["board"]["line"],
    cursor = line.length,
) => choosePhoneMoveLine(state, phoneDrawingSeat(state).owner, line, cursor);
const sans = (line: { san: string }[]) => line.map((move) => move.san);

describe("phone played mainlines and variations", () => {
    it("resets position and explored line separately without deleting mainline or variations", () => {
        const branch = play(fixture(), "c7c5", "g1f3");
        const owner = phoneDrawingSeat(branch).owner;
        const position = resetPhonePosition(branch, owner);
        expect(position.board.cursor).toBe(0);
        expect(sans(position.board.line)).toEqual(["e4", "c5", "Nf3"]);
        expect(game(position).pgn).toBe(game(branch).pgn);
        const main = resetPhoneLine(branch, owner);
        expect(sans(main.board.line)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
        expect(main.board.cursor).toBe(1);
        expect(game(main).pgn).toBe(game(branch).pgn);
        expect(resetPhoneLine(branch, "old-owner")).toBe(branch);
        expect(resetPhonePosition(branch, "old-owner")).toBe(branch);
    });

    it("preserves a custom starting position and blank-board moves during reset", () => {
        const state = createEmptyWebState();
        state.board.startFen = "7k/6pp/8/8/8/8/6PP/KR6 b - - 0 20";
        const played = play(state, "h7h6");
        const next = resetPhonePosition(played, phoneDrawingSeat(played).owner);
        expect(next.board.startFen).toBe(state.board.startFen);
        expect(next.board.cursor).toBe(0);
        expect(next.board.line[0].san).toBe("h6");
        expect(next.board.moveTree).toEqual(played.board.moveTree);
    });
    it("retains the imported mainline, comments and sync identity while saving a tried continuation", () => {
        const original = fixture();
        const before = JSON.stringify(original);
        const next = play(original, "c7c5", "g1f3");
        expect(sans(game(next).moves)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
        expect(sans(next.board.line)).toEqual(["e4", "c5", "Nf3"]);
        expect(game(next).pgn).toMatch(/\(\s*1\.\.\. c5 2\. Nf3\s*\)/);
        for (const retained of ["Root", "Note", "[%cal Ge2e4]", '[PersonalSyncRef "keep-id"]'])
            expect(game(next).pgn).toContain(retained);
        expect(JSON.stringify(original)).toBe(before);
        const reopened = parsePgnDatabase("Reload", game(next).pgn).games[0];
        expect(sans(webGameToRootLines(reopened)[0][0].variations![0])).toEqual(["c5", "Nf3"]);
    });

    it("replaying a known mainline or side move advances without truncating its saved continuation", () => {
        let state = fixture("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *");
        const original = game(state);
        state = play(state, "e7e5");
        expect(state.board.cursor).toBe(2);
        expect(sans(state.board.line)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
        expect(game(state)).toBe(original);
        state = play(at(state, 1), "c7c5");
        expect(state.board.cursor).toBe(2);
        expect(sans(state.board.line)).toEqual(["e4", "c5", "Nf3", "d6"]);
        expect(game(state)).toBe(original);
    });

    it("keeps multiple root and nested alternatives when moving between branches", () => {
        let state = play(fixture(), "c7c5", "g1f3", "d7d6");
        state = play(at(state, 2), "b1c3");
        state = play(at(state, 0), "d2d4", "d7d5");
        const roots = phoneMoveRootLines(state);
        expect(sans(roots[0])).toEqual(["e4", "e5", "Nf3", "Nc6"]);
        expect(sans(roots[1])).toEqual(["d4", "d5"]);
        expect(sans(roots[0][0].variations![0])).toEqual(["c5", "Nf3", "d6"]);
        expect(sans(roots[0][0].variations![0][0].variations![0])).toEqual(["Nc3"]);
        state = select(state, roots[0], 1);
        state = play(state, "c7c5");
        expect(sans(state.board.line)).toEqual(["e4", "c5", "Nf3", "d6"]);
        expect(state.board.cursor).toBe(2);
    });

    it("rejects a stale board callback and a partly illegal plan without partial edits", () => {
        const state = fixture();
        const owner = phoneDrawingSeat(state).owner;
        const moved = at(state, 2);
        expect(playPhoneMoves(moved, owner, ["c7c5"])).toBe(moved);
        expect(play(state, "c7c5", "e2e4")).toBe(state);
        const replacement = { ...state, board: { ...state.board, annotationOwnerId: "other" } };
        expect(playPhoneMoves(replacement, owner, ["c7c5"])).toBe(replacement);
        expect(choosePhoneMoveLine(replacement, owner, state.board.line)).toBe(replacement);
    });

    it("keeps a Black-to-move custom root when adding a first-move alternative", () => {
        const fen = "7k/8/8/8/8/8/8/K7 b - - 11 37";
        let state = fixture(`[SetUp "1"]\n[FEN "${fen}"]\n37... Kh7 38. Kb1 *`);
        state = play(at(state, 0), "h8g8");
        expect(sans(phoneMoveRootLines(state)[0])).toEqual(["Kh7", "Kb1"]);
        expect(sans(phoneMoveRootLines(state)[1])).toEqual(["Kg8"]);
        expect(game(state).pgn).toContain(`[FEN "${fen}"]`);
        expect(state.board.cursor).toBe(1);
    });

    it("preserves old unfiled imported branches before trying another line", () => {
        const state = fixture();
        state.board.line = webGameToLine(
            parsePgnDatabase("Legacy draft", "1. e4 c5 2. Nf3 *").games[0],
        );
        const next = play(at(state, 1), "c7c6");
        expect(phoneMoveRootLines(next)[0][0].variations!.map(sans)).toEqual([
            ["c5", "Nf3"],
            ["c6"],
        ]);
        const returned = select(state, phoneMoveRootLines(state)[0], 1);
        expect(phoneMoveRootLines(returned)[0][0].variations!.map(sans)).toEqual([["c5", "Nf3"]]);
    });

    it("uses acknowledged portable metadata without dropping the active board branch or other marks", () => {
        let state = play(fixture(), "c7c5");
        const previousBoard = state.board;
        const updated = parsePgnDatabase(
            "Acknowledged game",
            game(state).pgn.replace("c5", "c5 {Remote note [%csl Rd5]}"),
        ).games[0];
        state = {
            ...state,
            gamesByDatabase: {
                ...state.gamesByDatabase,
                [game(state).databaseId]: [
                    {
                        ...game(state),
                        ...updated,
                        id: game(state).id,
                        databaseId: game(state).databaseId,
                    },
                ],
            },
        };
        expect(state.board).toBe(previousBoard);
        state = play(state, "g1f3");
        expect(sans(state.board.line)).toEqual(["e4", "c5", "Nf3"]);
        expect(state.board.line[1].comments).toEqual(["Remote note"]);
        expect(state.board.line[1].shapes).toEqual([{ orig: "d5", brush: "red" }]);
        expect(game(state).pgn).toContain("Note [%cal Ge2e4]");
        expect(game(state).pgn).toContain("Remote note [%csl Rd5]");
    });

    it("accepts old absent trees and validates nested stored branches without accepting cycles", () => {
        const roots = phoneMoveRootLines(play(fixture(), "c7c5"));
        expect(validPhoneMoveTree(undefined)).toBe(true);
        expect(validPhoneMoveTree(roots)).toBe(true);
        for (const value of [null, {}, [null], [[{}]], [[{ ...roots[0][0], variations: {} }]]])
            expect(validPhoneMoveTree(value)).toBe(false);
        const cycle = [[{ ...roots[0][0] }]];
        cycle[0][0].variations = cycle;
        expect(validPhoneMoveTree(cycle)).toBe(false);
    });

    it.each(["blank", "prep"])(
        "retains independent %s mainline, branches and annotations through navigation",
        (mode) => {
            let state = fixture();
            const originalGame = game(state);
            if (mode === "blank")
                state = {
                    ...state,
                    board: { ...state.board, sourceDatabaseId: null, sourceGameId: null },
                };
            else
                state = {
                    ...state,
                    activePrepId: "prep",
                    prepWorkspaces: [
                        {
                            id: "prep",
                            name: "Invented prep",
                            opponent: "Fixture",
                            userColor: "white",
                            sourceIds: [],
                            startFen: state.board.startFen,
                            line: state.board.line,
                            notesByFen: {},
                            preparedMoves: {},
                            createdAt: 1,
                            updatedAt: 1,
                        },
                    ],
                };
            state = play(state, "c7c5");
            state = annotatePhoneMove(
                state,
                2,
                { comments: ["Side note"], annotations: ["!"] },
                phoneDrawingSeat(state).owner,
            );
            state = annotatePhoneDrawings(state, phoneDrawingSeat(state).owner, [
                { orig: "c7", dest: "c5", brush: "green" },
            ]);
            const root = phoneMoveRootLines(state)[0];
            state = select(state, root, 1);
            state = play(state, "c7c5");
            const selected = phoneDrawingSeat(state).line;
            expect(selected[1].comments).toEqual(["Side note"]);
            expect(selected[1].annotations).toEqual(["!"]);
            expect(selected[1].shapes).toHaveLength(1);
            expect(sans(phoneMoveRootLines(state)[0])).toEqual(["e4", "e5", "Nf3", "Nc6"]);
            expect(state.gamesByDatabase[originalGame.databaseId][0]).toBe(originalGame);
            expect(findPhoneMoveLine(phoneMoveRootLines(state), selected)).not.toBeNull();
        },
    );

    it("retains the whole edited game across a failed save and subsequent verified retry", async () => {
        let fail = true;
        let saved: WebCompanionState | null = null;
        const session = createWebStateSession({
            load: async () => fixture(),
            save: async (state) => {
                if (fail) throw Error("Fixture full");
                saved = structuredClone(state);
            },
        });
        await session.load();
        session.setState((state) => play(state, "c7c5"));
        await expect(session.flush()).rejects.toThrow("Fixture full");
        expect(game(session.getSnapshot().state).pgn).toContain("c5");
        fail = false;
        await session.flush();
        expect(game(saved!).pgn).toContain("c5");
        expect(sans(phoneMoveRootLines(saved!)[0])).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    });
});
