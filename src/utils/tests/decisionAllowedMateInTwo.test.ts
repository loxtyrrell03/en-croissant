import { expect, test } from "vitest";
import { findAllowedMateInTwo } from "../tacticalMotifs/decisionAllowedMateInTwo";
import fixtures from "../../../benchmarks/decision-evidence/played-mate-in-two/fixtures.json";

test("finds the quiet first move without a scored played line", () => {
    const { fen, candidates, playedMoveUci, history } = fixtures.quiet;
    expect(findAllowedMateInTwo(fen, candidates[0], playedMoveUci, history)).toMatchObject({
        kind: "allowed",
        mateIn: 2,
        proof: "legal",
        avoidingMoveUci: "e5d4",
        avoidingLineUci: ["e5d4", "f5b1", "d4c5"],
        explanation: expect.stringContaining("Kf4 allows mate in two starting with Bb1"),
    });
    expect(
        findAllowedMateInTwo(fen, candidates[0], playedMoveUci, history, undefined, "checking"),
    ).toBeNull();
});

test("rejects a cooperative mating continuation and an already-lost root", () => {
    for (const input of [fixtures.cooperative, fixtures.already]) {
        expect(
            findAllowedMateInTwo(
                input.fen,
                input.candidates[0],
                input.playedMoveUci,
                input.history,
            ),
        ).toBeNull();
    }
});

test("a finite score cannot make a stronger move that still permits mate an avoidance", () => {
    const { fen, candidates, playedMoveUci, history } = fixtures.otherMatingChoice;
    const alternate = candidates.find((line) => line.pvUci[0] === "c1c3")!;
    expect(
        findAllowedMateInTwo(fen, { ...alternate, cp: 0, mate: null }, playedMoveUci, history),
    ).toBeNull();
});

test("abstains on a malformed history and a different root board", () => {
    const { fen, candidates, playedMoveUci, history } = fixtures.quiet;
    expect(
        findAllowedMateInTwo(fen, candidates[0], playedMoveUci, { ...history, moves: [] }),
    ).toBeNull();
    expect(
        findAllowedMateInTwo(
            fen,
            { ...candidates[0], fen: fixtures.cooperative.fen },
            playedMoveUci,
            history,
        ),
    ).toBeNull();
});
