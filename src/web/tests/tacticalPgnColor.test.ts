import { expect, test } from "vitest";
import { parsePgnDatabase } from "../pgn";
import { createPhoneReviewCard } from "../mistakeReview";
import { readFileSync } from "node:fs";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";

const fen = "1rr3k1/5ppp/2B1b3/5p2/6N1/1P6/P1P2PPP/R3R1K1 b - - 0 21";
test.each([1, 21, 93])(
    "a Black-to-move FEN does not assign the first imported move to White (move %s)",
    (number) => {
        const start = fen.replace("0 21", `0 ${number}`);
        const game = parsePgnDatabase(
            "Public example",
            `[White "Opponent"]\n[Black "Tester"]\n[SetUp "1"]\n[FEN "${start}"]\n\n${number}... fxg4 ${number + 1}. Be4 ( ${number + 1}. Ba4 Rxc2 ) Rc5 1-0`,
        ).games[0];
        expect(game.moves.map((move) => move.color)).toEqual(["black", "white", "black"]);
        expect(game.moves.map((move) => move.ply)).toEqual([1, 2, 3]);
        expect(game.moves[0].fenBefore).toBe(start);
        const variations = game.moves.flatMap(move => move.variations ?? []);
        expect(variations).toHaveLength(1);
        expect(variations[0].map(move => move.san)).toEqual(["Ba4", "Rxc2"]);
        expect(variations[0].map(move => move.color)).toEqual(["white", "black"]);
        for (const move of [...game.moves, ...variations.flat()])
            expect(replayTacticalLine(move.fenBefore, [move.uci!])[0].before.turn).toBe(move.color);
    },
);

test("ordinary White-started imports retain their colour and line-index semantics", () => {
    const game = parsePgnDatabase("Opening", "1. e4 e5 2. Nf3 Nc6 *").games[0];
    expect(game.moves.map((move) => move.color)).toEqual(["white", "black", "white", "black"]);
    expect(game.moves.map((move) => move.ply)).toEqual([1, 2, 3, 4]);
});

test("the actual Black capture-choice mistake reaches the right player's review", () => {
    const evidence = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/quiet-game-context-stockfish-18.json", "utf8"),
    );
    const game = parsePgnDatabase(
        "Public example",
        `[White "Opponent"]\n[Black "Tester"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n21... fxg4 1-0`,
    ).games[0];
    const best = evidence.searches.find((s: any) => s.id === "context:C9q6jvtW:ply41:best");
    const reply = evidence.searches.find((s: any) => s.id === "context:C9q6jvtW:ply41:reply");
    const convert = (row: any) => ({
        source: "stockfish" as const,
        multipv: 1,
        depth: 16,
        score: {
            type: "cp" as const,
            value: row.lines[0].cp * (row.fen.split(" ")[1] === "b" ? -1 : 1),
        },
        uciMoves: row.lines[0].pvUci,
        sanMoves: row.lines[0].pvSan,
    });
    const card = createPhoneReviewCard(game, 0, "Tester", convert(best), convert(reply));
    expect(card).not.toBeNull();
    expect(card?.color).toBe("black");
    expect(card?.explanation).toMatch(/^Capture in the better line:/);
    expect(card?.bestTimeline?.[0].alternativeCapture).toBe(true);
    expect(createPhoneReviewCard(game, 0, "Opponent", convert(best), convert(reply))).toBeNull();
});
