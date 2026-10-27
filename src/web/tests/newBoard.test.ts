import { describe, expect, it } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import { annotatePhoneDrawings, annotatePhoneMove } from "../phoneAnnotations";
import { phoneDrawingSeat } from "../phoneDrawings";
import { choosePhoneMoveLine, playPhoneMoves } from "../phoneMoveTree";
import {
    createPhoneBoard,
    NewBoardSaveError,
    retainBoardBeforeNew,
    startNewPhoneBoard,
} from "../newBoard";
import { createEmptyWebState } from "../storage";
import { createWebStateSession } from "../webStateSession";
import { phoneWorkspaceOwner } from "../workspacePreferences";
import { parsePgnDatabase, webGameToRootLines } from "../pgn";
import type { WebCompanionState } from "../model";

const play = (state: WebCompanionState, ...moves: string[]) =>
    playPhoneMoves(state, phoneDrawingSeat(state).owner, moves);
const currentGame = (state: WebCompanionState) =>
    state.gamesByDatabase[state.board.sourceDatabaseId!]![0];

describe("new phone boards", () => {
    it("creates distinct named files even within one millisecond and keeps older boards", () => {
        const first = createPhoneBoard(createEmptyWebState());
        const second = createPhoneBoard(first);
        expect(second.databases.map((db) => db.name)).toEqual(["Untitled.pgn", "Untitled (2).pgn"]);
        expect(second.board.annotationOwnerId).not.toBe(first.board.annotationOwnerId);
        expect(second.board.line).toEqual([]);
        expect(second.board.startFen).toBe(INITIAL_FEN);
        expect(second.gamesByDatabase[first.board.sourceDatabaseId!]).toBe(
            first.gamesByDatabase[first.board.sourceDatabaseId!],
        );
        expect(JSON.parse(JSON.stringify(second)).databases).toHaveLength(2);
    });

    it("retains blank-board mainline, root alternative, nested variation, notes, NAGs and drawings in reopenable PGN", () => {
        let state = play(createEmptyWebState(), "e2e4", "e7e5", "g1f3");
        const main = state.board.line;
        state.board.cursor = 1;
        state = play(state, "c7c5", "g1f3");
        state = annotatePhoneMove(state, 2, { comments: ["Sicilian note"], annotations: ["!?"] });
        state.board.cursor = 2;
        state = annotatePhoneDrawings(state, phoneDrawingSeat(state).owner, [
            { orig: "c7", dest: "c5", brush: "green" },
        ]);
        state = choosePhoneMoveLine(state, phoneDrawingSeat(state).owner, main, 0);
        state = play(state, "d2d4", "d7d5");
        state.board.sourceComments = ["Root note"];
        state.board.rootShapes = [{ orig: "e4", brush: "red" }];
        const before = JSON.stringify(state);
        const retained = retainBoardBeforeNew(state);
        const pgn = currentGame(retained).pgn;
        expect(pgn).toContain("Root note");
        expect(pgn).toContain("Sicilian note");
        expect(pgn).toContain("[%cal Gc7c5]");
        expect(pgn).toContain("[%csl Re4]");
        const roots = webGameToRootLines(parsePgnDatabase("Reopened", pgn).games[0]);
        expect(roots[0].map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
        expect(roots[1].map((m) => m.san)).toEqual(["d4", "d5"]);
        expect(roots[0][0].variations![0].map((m) => m.san)).toEqual(["c5", "Nf3"]);
        expect(roots[0][0].variations![0][0].annotations).toContain("!?");
        expect(JSON.stringify(state)).toBe(before);
    });

    it("opens black-to-move FEN as a fresh game and rejects invalid positions without mutation", () => {
        const state = createEmptyWebState();
        const fen = play(state, "e2e4").board.line[0].fenAfter;
        const next = createPhoneBoard(state, "Black to play", fen);
        expect(next.board.startFen).toBe(fen);
        expect(currentGame(next).pgn).toContain(`[FEN "${fen}"]`);
        expect(next.board.cursor).toBe(0);
        expect(() => createPhoneBoard(state, "Invalid", "8/8/8/8/8/8/8/8 w - - 0 1")).toThrow(
            /not legal/,
        );
        expect(state.databases).toEqual([]);
    });

    it("leaves Prep and its lines saved when opening a fresh board", () => {
        const state = createEmptyWebState();
        state.activePrepId = "prep";
        state.prepWorkspaces = [
            { id: "prep", startFen: INITIAL_FEN, line: [], userColor: "black" } as never,
        ];
        const next = createPhoneBoard(retainBoardBeforeNew(state));
        expect(next.activePrepId).toBeNull();
        expect(next.prepWorkspaces).toBe(state.prepWorkspaces);
        expect(next.board.orientation).toBe("black");
    });

    it("save failure keeps the old board, and retry creates exactly one new file", async () => {
        let fail = true;
        const session = createWebStateSession({
            load: async () => play(createEmptyWebState(), "e2e4"),
            save: async () => {
                if (fail) throw new Error("Storage full");
            },
        });
        await session.load();
        const error = await startNewPhoneBoard(
            session,
            phoneWorkspaceOwner(session.getSnapshot().state),
        ).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(NewBoardSaveError);
        const retryOwner = (error as NewBoardSaveError).retryOwner;
        expect(session.getSnapshot().state.board.line[0].san).toBe("e4");
        expect(session.getSnapshot().state.databases).toHaveLength(1);
        fail = false;
        await startNewPhoneBoard(session, retryOwner);
        await session.flush();
        expect(session.getSnapshot().state.databases).toHaveLength(2);
        expect(session.getSnapshot().state.board.line).toEqual([]);
        expect(session.getSnapshot().savedState).toBe(session.getSnapshot().state);
    });

    it("a move played during saving cancels the switch and preserves the newer move", async () => {
        let release!: () => void;
        const saved = new Promise<void>((resolve) => {
            release = resolve;
        });
        const session = createWebStateSession({
            load: async () => play(createEmptyWebState(), "e2e4"),
            save: async () => saved,
        });
        await session.load();
        const promise = startNewPhoneBoard(
            session,
            phoneWorkspaceOwner(session.getSnapshot().state),
        );
        session.setState((state) => play(state, "e7e5"));
        release();
        await expect(promise).rejects.toThrow(/board changed/i);
        expect(session.getSnapshot().state.board.line.map((m) => m.san)).toEqual(["e4", "e5"]);
        expect(session.getSnapshot().state.databases).toHaveLength(1);
    });

    it("an old position sheet cannot replace a different board", async () => {
        const session = createWebStateSession({
            load: async () => createPhoneBoard(createEmptyWebState()),
            save: async () => {},
        });
        await session.load();
        const owner = phoneWorkspaceOwner(session.getSnapshot().state);
        session.setState((state) => createPhoneBoard(state, "Other"));
        await expect(startNewPhoneBoard(session, owner)).rejects.toThrow(/board changed/i);
        expect(session.getSnapshot().state.board.sourceTitle).toBe("Other.pgn");
        await session.flush();
    });
});
