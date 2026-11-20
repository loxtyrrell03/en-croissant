import { describe, expect, it } from "vitest";
import fixture from "../../../benchmarks/decision-evidence/passer-role-contrasts/runtime-fixture.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { findPassedPawnRoles } from "../tacticalMotifs/decisionPassedPawnRole";

describe("a passed pawn's strategic role", () => {
    it("keeps the b6 purpose separate from the tactical capture order", () => {
        const report = assessChessDecision(fixture.chile)!;
        expect(report.position.category).toBe("mixed");
        const bf2 = report.moves.find(move => move.moveUci === "g3f2")!;
        expect(bf2.category).toBe("mixed");
        expect(bf2.tactical.reasons.join(" ")).toContain("Bxf2");
        expect(bf2.positional.basis).toBe("heuristic");
        expect(bf2.positional.reasons.join(" ")).toContain("passed pawn on b6");
        expect(bf2.sharedPassedPawn?.linesUci.map(line => line[1]).sort()).toEqual(["e3g5", "h6h5"]);
        const strategyOnly = assessChessDecision({ ...fixture.chile, captureOrder: undefined })!;
        expect(strategyOnly.position.category).toBe("positional");
    });

    it("recognizes a blocker that holds under two different replies", () => {
        const plan = findPassedPawnRoles(fixture.direct).moves.get("g1f2")!;
        expect(plan.description).toMatch(/passed pawn on f3.*stop its advance/);
        expect(new Set(plan.linesUci.map(line => line[1])).size).toBe(2);
        expect(plan.linesUci.every(line => line.length >= 5)).toBe(true);
    });

    it("identifies the exact legal handoff when the rook supports its replacement", () => {
        const plan = findPassedPawnRoles(fixture.handoff).moves.get("f7f8")!;
        expect(plan.description).toContain("Rf8 leaves f7");
        expect(plan.linesUci.every(line => line.includes("h8f7"))).toBe(true);
    });

    it("preserves the distinction between a position's pawn role and the other move's purpose", () => {
        const plans = findPassedPawnRoles(fixture.otherMove);
        expect(plans.moves.has(fixture.otherMove.candidates[0].pvUci[0])).toBe(false);
        const input = fixture.direct;
        const stale = { ...input, history: { ...input.history, moves: [] } };
        expect(findPassedPawnRoles(stale).position).toBeUndefined();
    });
});
