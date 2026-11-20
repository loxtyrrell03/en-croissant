import { describe, expect, test } from "vitest";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { comparePasserRestraint } from "./passerRestraint";
import cases from "./fixtures.json";

function argumentsFor(row: DecisionAssessmentInput) {
    const [better, played] = row.comparisonCandidates!;
    const good = row.replyProbes!.find((probe) => probe.moveUci === better.pvUci[0])!;
    const bad = row.replyProbes!.find((probe) => probe.moveUci === played.pvUci[0])!;
    return [row.fen, better, played, good.lines[0], bad.lines, row.history] as const;
}

describe("passed-pawn restraint", () => {
    test("separates the kept king defence from the exchange loss", () => {
        const comparison = comparePasserRestraint(...argumentsFor(cases.checks));
        expect(comparison?.factor.description).toMatch(/king from c6.*d7/);
        expect(comparison?.episode).toMatchObject({ kind: "comparative" });
        expect(comparison?.episode?.explanation).toMatch(/stopping the d6 pawn costs at least 4.0/);
        expect(comparison?.controlLineUci).toEqual(["f8f7", "d6d7", "c6d7"]);
        expect(comparison?.checks).toHaveLength(3);
    });

    test("identifies the exchange sacrifice only with a matched reply comparison", () => {
        const [fen, best, played, defence, attacks, history] = argumentsFor(cases.support);
        const comparison = comparePasserRestraint(fen, best, played, defence, attacks, history);
        expect(comparison?.factor.feature).toBe("passed-pawn");
        expect(comparison?.episode?.explanation).toMatch(/Rxa7 Kxa7 d7.*c6.*Nxc6/);
        expect(
            comparePasserRestraint(fen, best, played, defence, [attacks[0]], history)?.episode,
        ).toBeNull();
    });

    test("holds the positional and tactical questions apart", () => {
        const comparison = comparePasserRestraint(...argumentsFor(cases.rookEnding));
        expect(comparison?.factor.description).toMatch(/Rf8.*rook from b8/);
        expect(comparison?.episode).toBeNull();
    });

    test("rejects a reply frame from a different board", () => {
        const [fen, best, played, defence, attacks, history] = argumentsFor(cases.support);
        expect(
            comparePasserRestraint(fen, best, played, { ...defence, fen }, attacks, history),
        ).toBeNull();
    });
});
