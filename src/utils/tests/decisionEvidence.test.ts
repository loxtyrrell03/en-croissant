import { expect, test } from "vitest";
import {
    measureDecisionLine,
    measurePositionDecision,
    compareDecisionConsequences,
    type DecisionEngineLine,
} from "../tacticalMotifs/decisionEvidence";

const exchange = "3q2k1/4bppp/5n2/3p2B1/8/2N2N2/2Q2PPP/6K1 b - - 0 1";
const line: DecisionEngineLine = {
    fen: exchange,
    cp: 40,
    depth: 18,
    pvUci: ["f6e4", "c3e4", "d5e4", "g5e7", "d8e7"],
};

test("balanced exchanges have zero net material despite four captures", () => {
    expect(measureDecisionLine(exchange, line)).toMatchObject({
        captures: 4,
        materialChangeCp: 0,
        checks: 0,
        promotions: 0,
        evaluationCp: 40,
        plies: 5,
        checkmate: false,
    });
});

test("malformed, illegal, wrong-board and bound-only lines cannot supply evidence", () => {
    for (const patch of [
        { pvUci: ["f6e4", "a1a8"] },
        { fen: exchange.replace("0 1", "99 1") },
        { lowerbound: true },
        { upperbound: true },
        { depth: NaN },
        { cp: Infinity },
        { pvUci: [] },
        { mate: NaN },
    ])
        expect(measureDecisionLine(exchange, { ...line, ...patch })).toBeNull();
    expect(measurePositionDecision("invalid", [line])).toBeNull();
});

test("castling is no capture and en passant includes the removed pawn", () => {
    const castle = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(
        measureDecisionLine(castle, { fen: castle, cp: 0, depth: 16, pvUci: ["e1h1", "e8a8"] }),
    ).toMatchObject({ captures: 0, materialChangeCp: 0 });
    const ep = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
    expect(measureDecisionLine(ep, { fen: ep, cp: 80, depth: 16, pvUci: ["e5d6"] })).toMatchObject({
        captures: 1,
        materialChangeCp: 100,
    });
});

test("promotion changes material and counts each legal promotion choice", () => {
    const fen = "7k/P7/8/8/8/8/8/7K w - - 0 1";
    const result = measurePositionDecision(fen, [{ fen, cp: 500, depth: 16, pvUci: ["a7a8q"] }]);
    expect(result?.legalMoves).toBe(7);
    expect(result?.lines[0]).toMatchObject({ promotions: 1, materialChangeCp: 800, checks: 1 });
    expect(result?.bestSecondGapCp).toBeNull();
});

test("comparison needs distinct roots and exact scores at one common depth", () => {
    const other = { ...line, cp: 5, pvUci: ["h7h6"] };
    expect(measurePositionDecision(exchange, [line, other])).toMatchObject({
        bestSecondGapCp: 35,
        candidatesWithin50Cp: 2,
        suppliedCandidates: 2,
    });
    expect(measurePositionDecision(exchange, [line, line])?.bestSecondGapCp).toBeNull();
    expect(
        measurePositionDecision(exchange, [line, { ...other, depth: 17 }])?.bestSecondGapCp,
    ).toBeNull();
    expect(measurePositionDecision(exchange, [other, line])?.bestSecondGapCp).toBeNull();
});

test("Black's material gain uses Black's perspective", () => {
    const fen = "7k/8/8/8/8/8/qR6/7K b - - 0 1";
    expect(measureDecisionLine(fen, { fen, cp: 950, depth: 16, pvUci: ["a2b2"] })).toMatchObject({
        materialChangeCp: 500,
        captures: 1,
    });
});

test("a drawn line cannot continue to collect a fictitious gain after threefold repetition", () => {
    const fen = "7k/8/8/8/8/8/8/R6K w - - 0 1";
    const cycle = ["a1a2", "h8g8", "a2a1", "g8h8"];
    const drawing = { fen, cp: 0, depth: 16, pvUci: [...cycle, ...cycle] };
    expect(measureDecisionLine(fen, drawing)?.drawnEnding).toBe(true);
    expect(measureDecisionLine(fen, { ...drawing, pvUci: [...drawing.pvUci, "a1a8"] })).toBeNull();
});

test("settled material evidence does not assign a positional or tactical category", () => {
    const fen = "r6k/7p/8/8/8/8/7P/R6K w - - 0 1";
    const best = {
        fen,
        cp: 400,
        depth: 18,
        pvUci: ["a1a8", "h8g7", "h1g1", "g7f6", "g1g2", "f6e5", "g2f3", "e5d5"],
    };
    const played = {
        fen,
        cp: 0,
        depth: 18,
        pvUci: ["h1g1", "h8g7", "g1g2", "g7f6", "g2f3", "f6e5", "f3e3", "e5d5"],
    };
    const result = compareDecisionConsequences(fen, best, played);
    expect(result).toMatchObject({
        consequence: "material-difference",
        materialDifferenceCp: 500,
        evaluationLossCp: 400,
    });
    expect(result).not.toHaveProperty("nature");
    expect(compareDecisionConsequences(fen, best, { ...played, depth: 12 }).consequence).toBe(
        "unresolved",
    );
    expect(compareDecisionConsequences(fen, best, { ...played, cp: 390 }).consequence).toBe(
        "unresolved",
    );
});

test("a later pawn reset cannot hide an earlier available fifty-move draw", () => {
    const fen = "7k/7p/8/8/8/8/8/R6K w - - 99 1";
    const evidence = { fen, cp: 400, depth: 18, pvUci: ["a1a2"] };
    expect(measureDecisionLine(fen, evidence)?.drawnEnding).toBe(true);
    expect(measureDecisionLine(fen, { ...evidence, pvUci: ["a1a2", "h7h6"] })).toBeNull();
});

test("candidate comparison cannot promote a later line after rejecting rank one", () => {
    const bad = { ...line, lowerbound: true };
    expect(
        measurePositionDecision(exchange, [
            bad,
            { ...line, pvUci: ["h7h6"] },
            { ...line, pvUci: ["g7g6"] },
        ])?.bestSecondGapCp,
    ).toBeNull();
});

test("king-destination and rook-square castling are one candidate", () => {
    const fen = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
    const common = { fen, depth: 18, cp: 500 };
    const result = measurePositionDecision(fen, [
        { ...common, pvUci: ["e1g1"] },
        { ...common, pvUci: ["e1h1"] },
    ]);
    expect(result?.lines).toHaveLength(1);
    expect(result?.bestSecondGapCp).toBeNull();
});
