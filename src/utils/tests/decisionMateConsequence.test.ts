import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import {
    compareMateConsequence,
    findAllowedImmediateMate,
} from "../tacticalMotifs/decisionMateConsequence";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";

const fen = "6k1/p4ppp/8/8/8/8/7P/4R2K b - - 0 1";
const escape: DecisionEngineLine = { fen, cp: -290, depth: 18, pvUci: ["h7h6", "e1e8", "g8h7"] };
const allowed: DecisionEngineLine = { fen, cp: null, mate: -1, depth: 18, pvUci: ["a7a6", "e1e8"] };
const after = makeFen(replayTacticalLine(fen, ["a7a6"])[0].after.toSetup());
const mate: DecisionEngineLine = { fen: after, cp: null, mate: 1, depth: 18, pvUci: ["e1e8"] };

test("allowing verified mate is diagnosed without converting it to a pawn loss", () => {
    const report = assessChessDecision({
        fen,
        candidates: [escape, allowed],
        comparisonCandidates: [escape, allowed],
        playedMoveUci: "a7a6",
        replyProbes: [{ moveUci: "a7a6", lines: [mate] }],
    });
    expect(report?.mistakeStatus).toBe("assessed");
    expect(report?.mistake).toMatchObject({
        category: "tactical",
        evaluationLossCp: null,
        mateConsequence: { kind: "allowed", mateIn: 1, lineUci: ["a7a6", "e1e8"] },
    });
});

test("wrong-board lines, inconsistent mate distances, and incomplete mates are not accepted", () => {
    for (const change of [
        { fen },
        { mate: 2 },
        { pvUci: ["e1e7"] },
        { depth: 12 },
        { upperbound: true },
    ]) {
        expect(
            compareMateConsequence(fen, escape, allowed, undefined, { ...mate, ...change }),
        ).toBeNull();
    }
    expect(compareMateConsequence(fen, escape, allowed)).toBeNull();
    expect(
        compareMateConsequence(fen, { ...escape, cp: null, mate: -3 }, allowed, undefined, mate),
    ).toBeNull();
});

test("a missed legal mate in one needs no engine reply", () => {
    const position = fen.replace(" b ", " w ");
    const checkmate = { fen: position, cp: null, mate: 1, depth: 18, pvUci: ["e1e8"] };
    const quiet = { fen: position, cp: 100, depth: 18, pvUci: ["h2h3", "h7h6", "e1e8", "g8h7"] };
    const report = assessChessDecision({
        fen: position,
        candidates: [checkmate, quiet],
        playedMoveUci: "h2h3",
    });
    expect(report?.mistake).toMatchObject({
        category: "tactical",
        evaluationLossCp: null,
        tactical: { basis: "bounded-proof" },
        mateConsequence: { kind: "missed", mateIn: 1, lineUci: ["e1e8"] },
    });
});

test("a missed mate in two converts the reply distance to the original mover's perspective", () => {
    const position = "r4rk1/6pp/1p1Bp3/p7/P1PP4/4nqP1/Q2R3P/4R1K1 b - - 2 25";
    const mating = { fen: position, cp: null, mate: 2, depth: 18, pvUci: ["f3f1", "e1f1", "f8f1"] };
    const played = { fen: position, cp: 0, depth: 18, pvUci: ["f8f6", "d6f4"] };
    const reply = {
        fen: makeFen(replayTacticalLine(position, ["f3f1"])[0].after.toSetup()),
        cp: null,
        mate: -1,
        depth: 18,
        pvUci: ["e1f1", "f8f1"],
    };
    expect(compareMateConsequence(position, mating, played, reply)).toMatchObject({
        kind: "missed",
        mateIn: 2,
        lineUci: mating.pvUci,
    });
    expect(compareMateConsequence(position, mating, played, { ...reply, mate: -2 })).toBeNull();
});

test("mate in one after the actual move can be verified from the leader's frame alone", () => {
    const report = assessChessDecision({ fen, candidates: [escape], playedMoveUci: "a7a6" });
    expect(report?.mistakeStatus).toBe("assessed");
    expect(report?.mistake).toMatchObject({
        category: "tactical",
        evaluationLossCp: null,
        tactical: { basis: "bounded-proof" },
        mateConsequence: {
            kind: "allowed",
            mateIn: 1,
            lineUci: ["a7a6", "e1e8"],
            avoidingMoveUci: "h7h6",
        },
    });
});

test("a played move can create a new mating threat", () => {
    const before = "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2";
    const better = { fen: before, cp: -80, depth: 18, pvUci: ["g2g3"] };
    expect(findAllowedImmediateMate(before, better, "g2g4")).toMatchObject({
        avoidingMoveUci: "g2g3",
        lineUci: ["g2g4", "d8h4"],
    });
});

test("bad FEN identity, checkmated alternatives and already forced mate abstain", () => {
    for (const bad of [
        { ...escape, pvUci: ["a7a5"] },
        { ...escape, cp: null, mate: -3 },
        { ...escape, depth: 12 },
        { ...escape, fen: after },
        { ...escape, upperbound: true },
    ]) {
        expect(findAllowedImmediateMate(fen, bad, "a7a6")).toBeNull();
    }
    expect(findAllowedImmediateMate(fen, escape, "a8a6")).toBeNull();
});

test("an automatic draw on the played move takes precedence over a later mate", () => {
    const origin = "6k1/5ppp/8/1n6/8/8/7P/4R2K w - - 1 23";
    const cycle = ["e1e2", "b5a7", "e2e1", "a7b5"];
    const moves = [...cycle, ...cycle, ...cycle, ...cycle.slice(0, 3)];
    const root = makeFen(replayTacticalLine(origin, moves).at(-1)!.after.toSetup());
    const better = { ...escape, fen: root };
    expect(findAllowedImmediateMate(root, better, "a7b5")?.mateIn).toBe(1);
    expect(findAllowedImmediateMate(root, better, "a7b5", { fen: origin, moves })).toBeNull();
});
