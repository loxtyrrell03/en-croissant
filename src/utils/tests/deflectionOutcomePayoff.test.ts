import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// New output-blind public development nominations Gtvlx and sGGZN.
// Source tags do not supply these judgments: actual reply/mate sets were
// independently replayed before classification. Neither is a holdout.
const mateFen = "1r3rk1/p1pn1ppp/b4b2/6q1/3PB3/1P2P2P/PBPN1P2/R2QK2R b KQ - 2 15";
const mateLine = ["g5e3", "f2e3", "f6h4"];
const gainFen = "6k1/4r1q1/N2R1pp1/1B3b2/5pP1/4Q3/PPr4P/6K1 w - - 0 32";
const gainLine = ["d6d8", "g8h7", "e3h3", "g7h6", "d8h8", "h7h8", "h3h6"];
const row = (fen: string, line: string[], mirror: boolean) => ({
    fen: mirror ? reflectMixedForkFen(fen) : fen,
    pvUci: mirror ? line.map(reflectMixedForkMove) : line,
});

for (const mirror of [false, true]) {
    for (const length of [1, 3]) {
        test(`all-mating deflection is support, not a pawn gain, length=${length}, mirror=${mirror}`, () => {
            const input = row(mateFen, mateLine.slice(0, length), mirror);
            const result = classifyPositionTacticalMotifs(input);
            expect(result.motifs[0]?.id).toBe("mateIn2");
            const mechanism = result.motifs.find(m => m.id === "deflection");
            expect(mechanism).toMatchObject({ label: "Mating Deflection", relevance: "secondary" });
            expect(mechanism?.value).toBeUndefined();
            expect(mechanism?.evidence).toContain("Every legal defence permits mate");
            expect(mechanism?.evidence).not.toContain("not a forced-mate claim");
        });
    }
    for (const local of [false, true]) {
        test(`accepted deflection includes the sacrificed rook, local=${local}, mirror=${mirror}`, () => {
            const input = row(gainFen, gainLine, mirror);
            const steps = replayTacticalLine(input.fen, input.pvUci);
            const result = classifyPositionTacticalMotifs(local ? {
                fen: makeFen(steps[4].before.toSetup()), pvUci: input.pvUci.slice(4),
            } : input);
            expect(result.motifs[0]).toMatchObject({ id: local ? "deflection" : "forcingAttack", value: 400 });
            const payoff = result.timeline?.find(m => m.ply === (local ? 3 : 7) && m.id === "hangingPiece");
            expect(payoff).toMatchObject({ label: "Deflection Payoff" });
            expect(payoff?.value).toBeUndefined();
            expect(payoff?.evidence).toMatch(/offered|sacrificed|exchange costs/);
            expect(payoff?.evidence).not.toContain("wins the loose queen");
        });
    }
    test(`verified game history keeps the same compensated payoff, mirror=${mirror}`, () => {
        const input = row(gainFen, gainLine, mirror);
        const steps = replayTacticalLine(input.fen, input.pvUci);
        const current = { fen: makeFen(steps[6].before.toSetup()), pvUci: input.pvUci.slice(6) };
        const result = classifyPositionTacticalMotifs({ ...current,
            tacticalHistory: { fen: input.fen, moves: input.pvUci.slice(0, 6) } });
        expect(result.motifs[0]).toMatchObject({ label: "Deflection Payoff" });
        expect(result.motifs[0]?.value).toBeUndefined();
    });
    test(`missing history cannot invent compensation, mirror=${mirror}`, () => {
        const input = row(gainFen, gainLine, mirror);
        const steps = replayTacticalLine(input.fen, input.pvUci);
        const result = classifyPositionTacticalMotifs({ fen: makeFen(steps[6].before.toSetup()), pvUci: input.pvUci.slice(6) });
        expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", value: 900 });
    });
    test(`material-preserving declines are not forced mate, mirror=${mirror}`, () => {
        const input = row("8/3Q4/6pp/5n1k/2B1N1pq/8/3B4/6K1 w - - 0 1", ["d7f5"], mirror);
        const result = classifyPositionTacticalMotifs(input);
        expect(result.motifs[0]).toMatchObject({ id: "deflection", label: "Deflection", value: 320 });
        expect(result.motifs[0]?.evidence).toContain("not a forced-mate claim");
    });
}
