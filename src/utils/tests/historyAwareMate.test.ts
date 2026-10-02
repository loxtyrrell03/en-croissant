import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { proveHistoryAwareMate, proveHistoryAwareMateWithinBudget, retainsHistoryAwareMate,
    qualifyHistoryAwareMatingMotifs } from "../tacticalMotifs/historyAwareMate";
import { readTacticalRepetitionContext, advanceTacticalRepetitionContext, tacticalRepetitionPosition,
    tacticalRepetitionClaim, tacticalRepetitionBoundary } from "../tacticalMotifs/repetitionHistory";
import { classifyPositionTacticalMotifs, classifyMistakeReviewMotifs, buildMistakeReviewTacticalExplanation } from "../tacticalMotifs/mistakeReviewAdapter";
import { classifyProvedMistakeNature } from "../tacticalMotifs/mistakeNature";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";
import { preservesVerifiedMate, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { repetitionHistory, repetitionFlip, repetitionOrigin, repetitionCycle, repetitionMateLine } from "./fixtures/repetitionHistory";
import { deepMateOrigin, deepMateAlternativeOrigin, deepMateRepeated, deepMateClean, deepMateLine } from "./fixtures/historyAwareMate";

for (const mirrored of [false, true]) {
    const flip = (uci: string) => mirrored ? repetitionFlip(uci) : uci;
    const repeated = repetitionHistory(deepMateOrigin, deepMateRepeated, mirrored);
    const clean = repetitionHistory(deepMateOrigin, deepMateClean, mirrored);
    const alternative = repetitionHistory(deepMateAlternativeOrigin, deepMateRepeated, mirrored);
    const line = deepMateLine.map(flip);
    test(`deeper current claim, not an immediate root boundary; mirrored=${mirrored}`, () => {
        expect(repeated.fen).toBe(clean.fen);
        for (const row of [repeated, clean]) {
            expect(tacticalRepetitionBoundary(row.fen, line[0], row.tacticalHistory)).toBeNull();
            let context = readTacticalRepetitionContext(row.fen, row.tacticalHistory)!;
            context = advanceTacticalRepetitionContext(context, line[0])!;
            expect(tacticalRepetitionClaim(context)).toBeNull();
            context = advanceTacticalRepetitionContext(context, line[1])!;
            context = advanceTacticalRepetitionContext(context, line[2])!;
            expect(tacticalRepetitionClaim(context)).toBe(row === repeated ? "current-threefold" : null);
        }
    });
    test(`bounded proof distinguishes same-FEN histories and preserves a different route; mirrored=${mirrored}`, () => {
        expect(proveHistoryAwareMate(repeated.fen, line, repeated.tacticalHistory, 3).status).toBe("unproven");
        expect(proveHistoryAwareMate(clean.fen, line, clean.tacticalHistory, 3)).toMatchObject({ status: "proven", maxMoves: 3 });
        const proof = proveHistoryAwareMate(alternative.fen, line, alternative.tacticalHistory, 3);
        expect(proof).toMatchObject({ status: "proven", maxMoves: 3 });
        expect(proof.status === "proven" ? proof.line[2] : null).toBe(mirrored ? "Rb1+" : "Rb8+");
        const longer = proveHistoryAwareMateWithinBudget(repeated.fen, line, repeated.tacticalHistory, 3);
        expect(longer).toMatchObject({ status: "proven", maxMoves: 4 });
        expect(longer.visits).toBeLessThanOrEqual(65536);
        expect(longer.status === "proven" ? longer.line[2] : null).toBe(mirrored ? "Qxg3+" : "Qxg6+");
        expect(retainsHistoryAwareMate(repeated.fen, line, repeated.tacticalHistory)).toBe(true);
    });
    for (const length of [1, 5]) test(`public classification/live/review/nature repair false distance, not erase a real win; length=${length}, mirrored=${mirrored}`, () => {
        const pvUci = line.slice(0, length);
        for (const row of [repeated, clean, alternative, repeated]) {
            const expected = row === repeated ? "mateIn4" : "mateIn3";
            const result = classifyPositionTacticalMotifs({ ...row, pvUci });
            expect(result.motifs[0]?.id ?? null).toBe(expected);
            const live = buildLiveTacticalScan({ ...row, pvUci, depth: 16, engineName: "History regression" });
            expect(live.motifs[0]?.id ?? null).toBe(expected);
            const input = { ...row, pvUci, bestMoveUci: line[0], playedMoveUci: flip("a2a3") };
            const review = classifyMistakeReviewMotifs(input);
            expect(buildMistakeReviewTacticalExplanation(review)?.primary.id ?? null).toBe(expected);
            expect(classifyProvedMistakeNature(input).nature).toBe("tactical");
        }
        const repaired = classifyPositionTacticalMotifs({ ...repeated, pvUci });
        expect(repaired.motifs.some(m => m.id === "mateIn3")).toBe(false);
        expect(repaired.timeline?.filter(m => m.outcome === "mate").map(m => m.id)).toEqual(["mateIn4"]);
    });
    test(`mate-dependent value-less support is withheld, unrelated material remains; mirrored=${mirrored}`, () => {
        const base: TacticalMotifEvidence = { id: "mateIn3", label: "Forcing Mate", confidence: "high", source: "available",
            evidence: "Synthetic outcome-dependency contract, not a positional certificate", ply: 1, moveUci: line[0], value: 10000 };
        const support: TacticalMotifEvidence = { ...base, id: "deflection", label: "Mating Deflection", value: undefined, outcome: "mate" };
        const independent: TacticalMotifEvidence = { ...base, id: "fork", label: "Fork", value: 300 };
        const repaired = qualifyHistoryAwareMatingMotifs(repeated.fen, line, repeated.tacticalHistory, [base, support, independent]);
        expect(repaired.map(m => m.id)).toEqual(["mateIn4", "fork"]);
        expect(repaired[1]).toEqual(independent);
        const safe = qualifyHistoryAwareMatingMotifs(alternative.fen, line, alternative.tacticalHistory, [base, support, independent]);
        expect(safe.map(m => m.id)).toEqual(["mateIn3", "fork"]);
        expect(safe[0].evidence).toContain(mirrored ? "Rb1+" : "Rb8+");
    });
    test(`a conditional mating event is checked immediately after its own move; mirrored=${mirrored}`, () => {
        const conditional: TacticalMotifEvidence = { id: "mateIn2", label: "Forcing Mate", confidence: "high", source: "available",
            evidence: "Synthetic local-event contract", ply: 3, moveUci: line[2], value: 10000 };
        expect(qualifyHistoryAwareMatingMotifs(repeated.fen, line, repeated.tacticalHistory, [conditional])).toEqual([]);
        expect(qualifyHistoryAwareMatingMotifs(clean.fen, line, clean.tacticalHistory, [conditional]))
            .toEqual([expect.objectContaining({ id: "mateIn2", ply: 3, moveUci: line[2], outcome: "mate" })]);
        const concession: TacticalMotifEvidence = { ...conditional, id: "selfInterference", label: "Self-Interference",
            outcome: "mate", ply: 2, moveUci: line[1], actor: mirrored ? "white" : "black" };
        expect(qualifyHistoryAwareMatingMotifs(repeated.fen, line, repeated.tacticalHistory, [concession])).toEqual([]);
    });
    test(`an actual defender claim still forces abstention and cannot neutralize a missed mate; mirrored=${mirrored}`, () => {
        const reached = repetitionHistory(deepMateOrigin, [...deepMateRepeated, ...deepMateLine.slice(0, 2)], mirrored);
        const continuation = line.slice(2);
        expect(retainsHistoryAwareMate(reached.fen, continuation, reached.tacticalHistory)).toBe(false);
        const result = classifyPositionTacticalMotifs({ ...reached, pvUci: continuation });
        expect(result.motifs).toEqual([]); expect(result.timeline ?? []).toEqual([]);
        const live = buildLiveTacticalScan({ ...reached, pvUci: continuation, depth: 16, engineName: "Actual claim control" });
        expect(live.motifs).toEqual([]); expect(live.arrows).toEqual([]); expect(live.labels).toEqual([]);
    });
    test(`an unqualified history-blind mate cannot erase other review evidence; mirrored=${mirrored}`, () => {
        const row = repetitionHistory("2R3k1/5r2/4NppQ/5b2/3n4/3P1P2/PP2q1P1/1K6 b - - 0 1", deepMateRepeated, mirrored);
        expect(preservesVerifiedMate(replayTacticalLine(row.fen, line))).toBe(true);
        expect(retainsHistoryAwareMate(row.fen, line, row.tacticalHistory)).toBe(false);
        expect(retainsHistoryAwareMate(row.fen, line, undefined)).toBe(true);
        expect(proveHistoryAwareMateWithinBudget(row.fen, line, row.tacticalHistory).status).toBe("unknown");
        // This is insufficient evidence to neutralize a missed mate, NOT a
        // proof that every longer/quiet route draws or that a best move wins.
    });
    test(`independent root alternatives are qualified separately and metadata is rederived; mirrored=${mirrored}`, () => {
        const bad = flip("c1c8");
        const base: TacticalMotifEvidence = { id: "mateIn3", label: "Forcing Mate", confidence: "high", source: "available",
            evidence: "Synthetic candidate-group contract", ply: 1, moveUci: bad, value: 10000 };
        const good: TacticalMotifEvidence = { ...base, moveUci: line[0], verifiedCombination: true,
            comparison: "prevented", comparisonEvidence: "Old route comparison", alternativeCapture: true,
            alternativeLine: { fen: alternative.fen, uci: line, san: [] } };
        for (const order of [[base, good], [good, base]]) {
            const result = qualifyHistoryAwareMatingMotifs(alternative.fen, [bad], alternative.tacticalHistory, order);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ id: "mateIn3", moveUci: line[0] });
            expect(result[0].alternativeLine?.uci[2]).toBe(flip("b3b8"));
            expect(result[0].verifiedCombination).toBeUndefined();
            expect(result[0].comparison).toBeUndefined();
            expect(result[0].comparisonEvidence).toBeUndefined();
            expect(result[0].alternativeCapture).toBeUndefined();
        }
        const unbound = { ...good, alternativeLine: { ...good.alternativeLine!, fen: repeated.fen } };
        expect(qualifyHistoryAwareMatingMotifs(alternative.fen, [bad], alternative.tacticalHistory, [unbound])).toEqual([]);
    });
    test(`a larger supported distance cannot bypass history qualification; mirrored=${mirrored}`, () => {
        const motif: TacticalMotifEvidence = { id: "mateIn8", label: "Forcing Mate", confidence: "high", source: "available",
            evidence: "Synthetic unsupported-bound contract", ply: 1, moveUci: line[0], value: 10000 };
        expect(qualifyHistoryAwareMatingMotifs(repeated.fen, line, repeated.tacticalHistory, [motif])).toEqual([]);
        expect(proveHistoryAwareMate(repeated.fen, line, repeated.tacticalHistory, 8).status).toBe("unknown");
    });
    test(`actual named immediate mate is retained despite optional attacker claim; mirrored=${mirrored}`, () => {
        const row = repetitionHistory("3q2rk/6pp/7N/6N1/8/8/5PPP/6K1 w - - 0 1",
            Array(2).fill(["g5e4", "d8e8", "e4g5", "e8d8"]).flat(), mirrored);
        const pvUci = [flip("g5f7")];
        const before = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
        expect(before.motifs.some(m => /Mate$/.test(m.id))).toBe(true);
        expect(classifyPositionTacticalMotifs({ ...row, pvUci }).motifs).toEqual(before.motifs);
    });
    test(`capture reset permits the independent acceptance mate; mirrored=${mirrored}`, () => {
        let context = readTacticalRepetitionContext(repeated.fen, repeated.tacticalHistory)!;
        context = advanceTacticalRepetitionContext(context, line[0])!;
        context = advanceTacticalRepetitionContext(context, flip("h7h6"))!;
        expect(context.hasRepeatedPositions).toBe(false);
        expect(context.completeSinceReset).toBe(true);
        context = advanceTacticalRepetitionContext(context, flip("c1h1"))!;
        expect(tacticalRepetitionPosition(context)?.isCheckmate()).toBe(true);
    });
    test(`initially unrepeated history cannot certify a later looping PV's geometry; mirrored=${mirrored}`, () => {
        const row = repetitionHistory(repetitionOrigin, [], mirrored);
        const pvUci = [...repetitionCycle, ...repetitionCycle, ...repetitionMateLine].map(flip);
        expect(readTacticalRepetitionContext(row.fen, row.tacticalHistory)?.hasRepeatedPositions).toBe(false);
        const result = classifyPositionTacticalMotifs({ ...row, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "mateIn2", ply: 1 });
        expect(result.motifs.filter(m => m.outcome === "mate").every(m => m.ply === 1)).toBe(true);
        expect(result.timeline?.filter(m => m.outcome === "mate").every(m => m.ply === 1)).toBe(true);
        const named: TacticalMotifEvidence = { id: "anastasiaMate", label: "Named mating support", confidence: "high",
            evidence: "Synthetic looping-root dependency contract", source: "available", ply: 1,
            moveUci: pvUci[0], value: 10000, verifiedCombination: true };
        const support: TacticalMotifEvidence = { ...named, id: "deflection", label: "Mating Deflection", outcome: "mate", value: undefined };
        const certified = qualifyHistoryAwareMatingMotifs(row.fen, pvUci, row.tacticalHistory, [named, support]);
        expect(certified.map(m => m.id)).toEqual(["mateIn2"]);
        expect(certified[0].verifiedCombination).toBeUndefined();
        const alternative = { ...named, alternativeLine: { fen: row.fen, uci: pvUci, san: [] } };
        const alternateResult = qualifyHistoryAwareMatingMotifs(row.fen, repetitionMateLine.map(flip), row.tacticalHistory, [alternative]);
        expect(alternateResult.map(m => m.id)).toEqual(["mateIn2"]);
        expect(alternateResult[0].verifiedCombination).toBeUndefined();
    });
    test(`a six-move checking mate is qualified with inherited repetition; mirrored=${mirrored}`, () => {
        const row = repetitionHistory("3rr1k1/p6p/1p1q2p1/2p5/6N1/1PQP1KPP/P2p4/8 w - - 0 40",
            Array(2).fill(["c3b2", "d8c8", "b2c3", "c8d8"]).flat(), mirrored);
        const pvUci = ["g4h6", "g8f8", "c3h8", "f8e7", "h8g7", "e7e6", "g7f7", "e6e5", "h6g4", "e5d4", "f7c4"].map(flip);
        expect(readTacticalRepetitionContext(row.fen, row.tacticalHistory)?.hasRepeatedPositions).toBe(true);
        expect(proveHistoryAwareMate(row.fen, pvUci, row.tacticalHistory, 6)).toMatchObject({ status: "proven", maxMoves: 6 });
        expect(classifyPositionTacticalMotifs({ ...row, pvUci }).motifs[0]).toMatchObject({ id: "mateIn6", outcome: "mate" });
    });
}

test("replay context cannot be forged, mutate a cached board, or accept a FEN reset", () => {
    const row = repetitionHistory(deepMateOrigin, deepMateRepeated);
    const context = readTacticalRepetitionContext(row.fen, row.tacticalHistory)!;
    expect(Object.isFrozen(context)).toBe(true);
    const clone = tacticalRepetitionPosition(context)!;
    clone.play(parseUci(deepMateLine[0])!);
    expect(tacticalRepetitionPosition(context)?.turn).toBe("white");
    expect(advanceTacticalRepetitionContext({ ...context }, deepMateLine[0])).toBeNull();
    expect(advanceTacticalRepetitionContext(context, row.fen)).toBeNull();
    expect(advanceTacticalRepetitionContext(context, "a1a8")).toBeNull();
    expect(readTacticalRepetitionContext(row.fen.replace(" 9 6", " 0 6"), row.tacticalHistory)).toBeNull();
});

test.each([0, -1, 0.5, NaN, Infinity, 65537, 1])("invalid/exhausted bound %s cannot borrow a cached mate", limit => {
    const row = repetitionHistory(deepMateOrigin, deepMateClean);
    expect(proveHistoryAwareMate(row.fen, deepMateLine, row.tacticalHistory, 3).status).toBe("proven");
    expect(proveHistoryAwareMate(row.fen, deepMateLine, row.tacticalHistory, 3, limit).status).toBe("unknown");
});

test("a legal reduced prefix proves occurrences but not absence before a nonzero origin", () => {
    const origin = deepMateOrigin.replace(" 0 1", " 4 1");
    const row = repetitionHistory(origin, []);
    expect(readTacticalRepetitionContext(row.fen, row.tacticalHistory)?.completeSinceReset).toBe(false);
    const position = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    expect(position.halfmoves).toBe(4);
});

test("prior automatic75 termination cannot be revived by a later pawn reset", () => {
    const origin = "7k/8/5K2/8/8/8/P7/R7 b - - 149 1";
    const row = repetitionHistory(origin, ["h8g8", "a2a3"]);
    const context = readTacticalRepetitionContext(row.fen, row.tacticalHistory)!;
    expect(context.endedAtPly).toBe(1);
    expect(advanceTacticalRepetitionContext(context, "g8h8")).toBeNull();
    expect(tacticalRepetitionBoundary(row.fen, "g8h8", row.tacticalHistory)).toEqual({ kind: "game-over", endedAtPly: 1 });
});

test("a longer four-move checking mate is qualified inside the same fixed envelope", () => {
    const origin = "5r2/bpp2q1k/p2pR1p1/3P4/1PP3QP/P7/1B4P1/7K b - - 3 32";
    const row = repetitionHistory(origin, Array(2).fill(["f7g7", "h1h2", "g7f7", "h2h1"]).flat());
    const line = ["f7f1", "h1h2", "f1g1", "h2h3", "g1h1", "h3g3", "a7f2"];
    expect(readTacticalRepetitionContext(row.fen, row.tacticalHistory)?.hasRepeatedPositions).toBe(true);
    expect(proveHistoryAwareMate(row.fen, line, row.tacticalHistory, 4)).toMatchObject({ status: "proven", maxMoves: 4 });
    expect(classifyPositionTacticalMotifs({ ...row, pvUci: line }).motifs[0]).toMatchObject({ id: "mateIn4", outcome: "mate" });
});

test("immediate checkmate takes precedence over the75-move automatic boundary", () => {
    const row = repetitionHistory("7k/8/5KQ1/8/8/8/8/8 w - - 149 1", []);
    const context = advanceTacticalRepetitionContext(readTacticalRepetitionContext(row.fen, row.tacticalHistory)!, "g6g7")!;
    expect(context.endedAtPly).toBeUndefined();
    expect(tacticalRepetitionPosition(context)?.isCheckmate()).toBe(true);
    expect(proveHistoryAwareMate(row.fen, ["g6g7"], row.tacticalHistory, 1)).toMatchObject({ status: "proven", maxMoves: 1 });
});
