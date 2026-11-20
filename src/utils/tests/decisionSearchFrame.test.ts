import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { measureDecisionLine } from "../tacticalMotifs/decisionEvidence";
import {
    canStartDecisionSearch,
    validateDecisionSearchFrame,
} from "../tacticalMotifs/decisionSearchFrame";
import fixtures from "../../../benchmarks/decision-evidence/draw-aware-search/fixtures.json";

const origin = "7k/8/6r1/8/8/5R2/8/K7 w - - 0 1";
const cycle = ["f3f2", "g6g7", "f2f3", "g7g6"];
function repetition(plies: number) {
    const moves = [...cycle, ...cycle, ...cycle, ...cycle].slice(0, plies);
    const fen = makeFen(replayTacticalLine(origin, moves).at(-1)!.after.toSetup());
    return { fen, history: { fen: origin, moves } };
}
const scored = (fen: string, cp: number, ...pvUci: string[]) => ({ fen, cp, depth: 20, pvUci });

test("keeps a finite near-equal dead draw and refuses the same tail with a decisive score", () => {
    const { fen, candidates } = fixtures.deadDraw;
    expect(measureDecisionLine(fen, candidates[0])).toBeNull();
    const saved = validateDecisionSearchFrame(fen, candidates)?.[0];
    expect(saved?.pvUci).toEqual(candidates[0].pvUci.slice(0, 25));
    expect(saved?.cp).toBe(-27);
    expect(measureDecisionLine(fen, saved!)?.drawnEnding).toBe(true);
    expect(validateDecisionSearchFrame(fen, [{ ...candidates[0], cp: -300 }])).toBeNull();
});

test("keeps an announced third occurrence at the exact board", () => {
    const { fen, history } = repetition(7);
    const result = validateDecisionSearchFrame(fen, [scored(fen, 0, "g7g6", "f3f2")], history);
    expect(result?.[0].pvUci).toEqual(["g7g6"]);
    expect(measureDecisionLine(fen, result![0])?.drawnEnding).toBe(true);
    const forged = { ...result![0], claimHistory: { fen, moves: [] } };
    expect(measureDecisionLine(fen, forged)).toBeNull();
    expect(validateDecisionSearchFrame(fen, [scored(fen, 0, "g7h7")], history)).toBeNull();
});

test("honours the defender's draw while preserving a winning player's optional decline", () => {
    const { fen, history } = repetition(6);
    const incoming = scored(fen, 300, "f2f3", "g7h7");
    // Black can announce ...Rg6 after Rf3, which would refute a claimed win for White.
    expect(validateDecisionSearchFrame(fen, [incoming], history)).toBeNull();
    // The same choice plays on towards a win for Black if Black declines the draw.
    expect(validateDecisionSearchFrame(fen, [{ ...incoming, cp: -300 }], history)).toEqual([
        { ...incoming, cp: -300 },
    ]);
});

test("rejects the wrong history and an already completed fivefold repetition", () => {
    const { fen, history } = repetition(16);
    expect(canStartDecisionSearch(fen, history)).toBe(false);
    expect(validateDecisionSearchFrame(fen, [scored(fen, 0, "f3f2")], history)).toBeNull();
    expect(canStartDecisionSearch(fen, { fen: origin, moves: [] })).toBe(false);
});

test("distinguishes claims by the mover from claims by the defender in the same game", () => {
    const { fen, history, candidates } = fixtures.optionalClaim;
    expect(validateDecisionSearchFrame(fen, candidates.slice(1), history)).toEqual(
        candidates.slice(1),
    );
    expect(validateDecisionSearchFrame(fen, candidates, history)).toBeNull();
});

test("keeps a winning skewer and a drawing alternative in the same played comparison", () => {
    const { fen, history, comparisonCandidates } = fixtures.announcedDuringLine;
    const saved = validateDecisionSearchFrame(fen, comparisonCandidates, history);
    expect(saved?.[0]).toEqual(comparisonCandidates[0]);
    const alternative = saved?.[1];
    expect(alternative?.pvUci).toEqual(["d8e8", "e2d3", "e8d8", "d3e3", "d8e8"]);
    expect(measureDecisionLine(fen, alternative!)?.drawnEnding).toBe(true);
});
