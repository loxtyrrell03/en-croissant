import { expect, test } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import { webGameBoardSetup } from "../gameBoardSetup";
import { parsePgnDatabase } from "../pgn";

const BLACK_FEN = "7k/6pp/8/8/8/8/6PP/KR6 b - - 0 20";
const imported = (moves = "", orientation = "") =>
    parsePgnDatabase("Fixture", `[SetUp "1"]\n[FEN "${BLACK_FEN}"]\n${orientation}\n${moves} *`, 1)
        .games[0];
test("phone retains an unplayed standalone FEN and faces its starting mover", () => {
    const game = imported();
    expect(game.moves).toHaveLength(0);
    expect(webGameBoardSetup(game)).toEqual({ startFen: BLACK_FEN, orientation: "black" });
    // Existing saved records need no new fields or migration.
    expect(webGameBoardSetup(JSON.parse(JSON.stringify(game)))).toEqual({
        startFen: BLACK_FEN,
        orientation: "black",
    });
});
test("phone game navigation uses its starting position; imported and explicit player perspectives win", () => {
    const game = imported("20... Kg8", '[Orientation " White "]');
    expect(game.moves[0].fenAfter.split(" ")[1]).toBe("w");
    expect(webGameBoardSetup(game)).toEqual({ startFen: BLACK_FEN, orientation: "white" });
    expect(webGameBoardSetup(game, "black").orientation).toBe("black");
    expect(webGameBoardSetup(imported("20... Kg8")).orientation).toBe("black");
});
test("malformed or absent old PGN headers retain existing first-move evidence and ordinary defaults", () => {
    expect(webGameBoardSetup({ moves: [], pgn: "" })).toEqual({
        startFen: INITIAL_FEN,
        orientation: "white",
    });
    const game = imported("20... Kg8");
    expect(webGameBoardSetup({ ...game, pgn: '[FEN "invalid"] *' })).toEqual({
        startFen: BLACK_FEN,
        orientation: "black",
    });
});
