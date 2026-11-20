import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import { findSettledExchangePlan } from "@/utils/tacticalMotifs/decisionSettledExchange";
import { extractPositionalBoardFacts } from "@/utils/tacticalMotifs/positionalEvidence";
import fixture from "./fixture.json";

test("the new passed pawn supplies an independent reason for a tactical candidate", () => {
    const input = fixture.amsterdam;
    const report = classify(input, "Stockfish 19", input.history);
    expect(report?.moves[0]).toMatchObject({
        category: "mixed",
        positional: { basis: "heuristic" },
    });
    expect(report?.moves[0].settledExchangePlan?.description).toContain("passed pawn on d5");
    expect(report?.moves[0].settledExchangePlan?.linesUci.every(
        (moves) => moves.slice(0, 3).join(" ") === "f6e5 d4e5 d5d4",
    )).toBe(true);
});

test("the same rook can use the file by different routes after the exchange", () => {
    const input = fixture.romania;
    const root = input.candidates[0];
    const plan = findSettledExchangePlan(input.fen, root, input.replyProbes[0].lines[0]);
    expect(plan?.description).toContain("a-file");
    expect(plan?.description).toContain("Ra3");
    expect(plan?.description).toContain("Ra2");
    expect(classify(input, "Stockfish 19", input.history)?.moves[0].category).toBe("positional");
});

test("an open file and the wrong or incomplete reply provide no plan", () => {
    const input = fixture.amsterdam;
    const root = input.candidates[0];
    const reply = input.replyProbes[0].lines[0];
    expect(findSettledExchangePlan(input.fen, root, { ...reply, fen: root.fen })).toBeNull();
    expect(findSettledExchangePlan(input.fen, root, { ...reply, pvUci: reply.pvUci.slice(0, 2) })).toBeNull();
    expect(findSettledExchangePlan(input.fen, root, { ...reply, upperbound: true })).toBeNull();
});

test("Witney's f6 pawn is blocked and an unplayed file plan stays uncertain", () => {
    const input = fixture.witney;
    const root = input.candidates[0];
    const after = replayTacticalLine(input.fen, root.pvUci.slice(0, 5)).at(-1)!.after;
    expect(extractPositionalBoardFacts(makeFen(after.toSetup()))?.white.passedPawns).not.toContain("f6");
    expect(findSettledExchangePlan(input.fen, root, input.replyProbes[0].lines[0])).toBeNull();
});
