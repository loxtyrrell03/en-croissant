import { expect, test } from "vitest";
import { preparePhoneManualImport } from "../manualImport";
import { parsePgnDatabase } from "../pgn";
import { webGameBoardSetup } from "../gameBoardSetup";

test("a raw FEN opens the exact position and side with no invented moves", () => {
    const fen = "7k/6pp/8/8/8/8/6PP/KR6 b - - 0 20";
    const prepared = preparePhoneManualImport(fen);
    const game = parsePgnDatabase(prepared.name, prepared.pgn).games[0];
    expect(prepared.kind).toBe("fen");
    expect(webGameBoardSetup(game)).toEqual({ startFen: fen, orientation: "black" });
    expect(game.moves).toEqual([]);
});

test("a PGN paste retains mainlines, alternatives, notes and multiple games", () => {
    const pgn =
        '[Event "Example one"]\n1. e4 {note} e5 (1... c5) 2. Nf3 *\n\n[Event "Example two"]\n1. d4 d5 *';
    const prepared = preparePhoneManualImport(pgn);
    expect(prepared.pgn).toBe(pgn);
    expect(parsePgnDatabase(prepared.name, prepared.pgn).games).toHaveLength(2);
});

test("invalid input fails before an import can replace the current board", () => {
    for (const value of ["", "not a game", "8/8/8/8/8/8/8/8 w - - 0 1", "1. e4 e5 2. Ke5"]) {
        expect(() => preparePhoneManualImport(value)).toThrow(/Paste|FEN|Game/);
    }
});
