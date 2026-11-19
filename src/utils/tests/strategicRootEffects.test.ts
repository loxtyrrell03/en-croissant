import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import {
    extractStrategicRootEffects,
    pawnUnattackedReach,
} from "../tacticalMotifs/strategicRootEffects";

const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
test("root pawn advance records space and the piece it frees, without equating reach with safe moves", () => {
    const line = {
        fen: start,
        depth: 18,
        cp: 30,
        pvUci: ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "a2a3", "a7a6"],
    };
    const effects = extractStrategicRootEffects(start, line);
    expect(effects).toContainEqual(
        expect.objectContaining({
            feature: "pawn-space",
            before: 2,
            after: 4,
            unit: "relative-rank",
        }),
    );
    expect(effects).toContainEqual(
        expect.objectContaining({
            feature: "piece-reach",
            squareOrFile: "f1",
            before: 0,
            unit: "squares",
        }),
    );
    expect(effects.every((effect) => effect.support === "board-fact")).toBe(true);
    expect(extractStrategicRootEffects(start, { ...line, upperbound: true })).toEqual([]);
});

test("a root pawn lock is distinguished from a lock established by a later opponent move", () => {
    const fen = "1n2k1n1/8/p7/8/P7/8/8/1N2K1N1 w - - 0 1";
    const line = {
        fen,
        depth: 18,
        cp: 0,
        pvUci: ["a4a5", "g8f6", "g1f3", "b8c6", "b1c3", "f6g4", "c3d5", "c6d4"],
    };
    expect(extractStrategicRootEffects(fen, line)).toContainEqual(
        expect.objectContaining({ feature: "pawn-lock", squareOrFile: "a", lastConsecutivePly: 8 }),
    );
    const opening = {
        fen: start,
        depth: 18,
        cp: 0,
        pvUci: ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6"],
    };
    expect(
        extractStrategicRootEffects(start, opening).some(
            (effect) => effect.feature === "pawn-lock",
        ),
    ).toBe(false);
});

test("a traded root pawn does not inherit another pawn's later space", () => {
    const fen = "1n2k1n1/8/4p3/8/2PP4/8/8/1N2K1N1 w - - 0 1";
    const line = {
        fen,
        depth: 18,
        cp: 0,
        pvUci: ["d4d5", "e6d5", "c4d5", "g8f6", "g1f3", "b8c6", "b1c3", "f6g4"],
    };
    expect(
        extractStrategicRootEffects(fen, line).some((effect) => effect.feature === "pawn-space"),
    ).toBe(false);
    // An illegal tail, even after an apparently plausible strategic beginning,
    // cannot provide a lasting feature certificate.
    expect(extractStrategicRootEffects(fen, { ...line, pvUci: [...line.pvUci, "d5d7"] })).toEqual(
        [],
    );
});

test("reach excludes opposing pawn attacks but does not hide absolute pins", () => {
    const fen = "4r1k1/8/8/3p4/8/4N3/8/4K3 w - - 0 1";
    const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const reach = pawnUnattackedReach(position, parseSquare("e3")!);
    expect(reach.has(parseSquare("d5")!)).toBe(true);
    expect(position.isLegal({ from: parseSquare("e3")!, to: parseSquare("d5")! })).toBe(false);
    const pawnAttackFen = "6k1/8/8/3p4/8/4N3/8/4K3 w - - 0 1";
    const attacked = Chess.fromSetup(parseFen(pawnAttackFen).unwrap()).unwrap();
    expect(pawnUnattackedReach(attacked, parseSquare("e3")!).has(parseSquare("c4")!)).toBe(false);
    expect(pawnUnattackedReach(attacked, parseSquare("e3")!).has(parseSquare("d5")!)).toBe(true);
});
