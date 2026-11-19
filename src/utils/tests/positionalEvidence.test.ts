import { expect, test } from "vitest";
import { extractPositionalBoardFacts } from "../tacticalMotifs/positionalEvidence";

test("supported minor-piece squares account for future pawn challenges in both colours", () => {
    const before = "6k1/1p6/2b5/8/3P4/8/8/6K1 b - - 0 1";
    expect(extractPositionalBoardFacts(before)?.black.minorSquaresWithoutPawnChallengers).toEqual(
        [],
    );
    expect(
        extractPositionalBoardFacts(before.replace("3P4", "8"))?.black
            .minorSquaresWithoutPawnChallengers,
    ).toEqual(["c6"]);
    // An opposing pawn which has passed the square cannot move backwards to attack it.
    expect(
        extractPositionalBoardFacts(before.replace("1p6", "1p1P4").replace("3P4", "8"))?.black
            .minorSquaresWithoutPawnChallengers,
    ).toEqual(["c6"]);
    const white = "6k1/8/8/3p4/8/2B5/1P6/6K1 w - - 0 1";
    expect(extractPositionalBoardFacts(white)?.white.minorSquaresWithoutPawnChallengers).toEqual(
        [],
    );
    expect(
        extractPositionalBoardFacts(white.replace("3p4", "8"))?.white
            .minorSquaresWithoutPawnChallengers,
    ).toEqual(["c3"]);
});

test("isolated doubled pawns and open files are observed separately", () => {
    const fen = "6k1/3p4/8/2P5/8/2P5/8/2RRR1K1 w - - 0 1";
    expect(extractPositionalBoardFacts(fen)?.white).toMatchObject({
        doubledPawnFiles: ["c"],
        isolatedPawns: ["c3", "c5"],
        rooksOnOpenFiles: ["e1"],
        rooksOnSemiOpenFiles: ["d1"],
        passedPawns: [],
    });
});

test("passed pawns consider adjacent files and direction", () => {
    const fen = "6k1/8/8/2P5/3p4/8/8/6K1 w - - 0 1";
    const facts = extractPositionalBoardFacts(fen)!;
    expect(facts.white.passedPawns).toEqual(["c5"]);
    expect(facts.black.passedPawns).toEqual(["d4"]);
    expect(extractPositionalBoardFacts("invalid")).toBeNull();
});

test("promoted bishops on the same colour complex do not create a bishop pair", () => {
    expect(extractPositionalBoardFacts("6k1/8/8/8/8/8/8/B1B3K1 w - - 0 1")?.white.bishopPair).toBe(
        false,
    );
    expect(extractPositionalBoardFacts("6k1/8/8/8/8/8/8/BB4K1 w - - 0 1")?.white.bishopPair).toBe(
        true,
    );
});
