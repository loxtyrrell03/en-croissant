import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { proveShortCheckingMate, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Public development YvGsE, nominated before this classifier audit. The later
// Rxf8+ opens Rh1's attack on Qc1, but neither Qc1 nor Bc8 is needed for the
// independently forced promotion mate. The capture of Rf8 IS required.
const fen = "2b1Qn1k/7P/p2p2p1/q1pP1r2/2P5/8/Pr2B1K1/2q2R1R w - - 2 28";
const line = ["e8f8", "f5f8", "f1f8", "h8g7", "h7h8q"];
const input = (position: string, moves: string[], flip: boolean) => ({
    fen: flip ? reflectMixedForkFen(position) : position,
    pvUci: flip ? moves.map(reflectMixedForkMove) : moves,
});

for (const flip of [false, true]) {
    for (const removed of ["none", "queen", "bishop", "both"]) test(`mate is independently unchanged after removing ${removed}, reflected=${flip}`, () => {
        let position = fen;
        if (["queen", "both"].includes(removed)) position = position.replace("2q2R1R", "5R1R");
        if (["bishop", "both"].includes(removed)) position = position.replace("2b1Qn1k", "4Qn1k");
        const row = input(position, line, flip), steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(5);
        expect(steps.at(-1)?.after.isCheckmate()).toBe(true);
        expect(proveShortCheckingMate(steps[0])?.maxMoves).toBe(3);
        expect(proveShortCheckingMate(steps[2])?.maxMoves).toBe(2);
        expect([...steps[2].after.allDests()].reduce((n, [, d]) => n + d.size(), 0)).toBe(1);
    });
    for (const plies of [3, 5]) test(`the actual-ply material discovery does not compete with its independent mate, plies=${plies}, reflected=${flip}`, () => {
        const row = input(fen, line.slice(0, plies), flip), result = classifyPositionTacticalMotifs(row);
        expect(result.motifs[0]?.id).toBe("mateIn3");
        expect(result.motifs.some(m => m.id === "deflection")).toBe(true);
        expect(result.motifs.some(m => m.id === "discoveredAttack")).toBe(false);
        expect(result.timeline?.some(m => m.id === "discoveredAttack")).toBe(false);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        const reached = classifyPositionTacticalMotifs({ fen: makeFen(steps[2].before.toSetup()), pvUci: row.pvUci.slice(2) });
        expect(reached.motifs.some(m => m.id === "discoveredAttack")).toBe(false);
    });
    test(`a displayed capture of the discovered queen cannot be erased by removing that victim, reflected=${flip}`, () => {
        const row = input(fen, [...line.slice(0, 4), "h1c1"], flip), steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(5);
        expect(steps.at(-1)?.capture).toBe(900);
        const result = classifyPositionTacticalMotifs(row);
        expect(result.timeline?.some(m => m.id === "discoveredAttack" && m.ply === 3)).toBe(true);
    });
}
