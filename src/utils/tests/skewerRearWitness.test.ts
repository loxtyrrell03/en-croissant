import { expect, test } from "vitest";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine, tacticalExchangeGain } from "../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const epYot = "r1b2r2/pp4bk/1q1Qp2p/4Npp1/8/2P3P1/PP2PPBP/1R1R2K1 b - - 0 19";
for (const reflected of [false, true]) {
    const fen = (value: string) => reflected ? reflectMixedForkFen(value) : value;
    const moves = (line: string[]) => reflected ? line.map(reflectMixedForkMove) : line;
    test(`rear captures cannot spend an already captured queen to invent skewers, reflected=${reflected}`, () => {
        for (const [answer, exchange] of [["d6g3", -800], ["g7c3", -230]] as const) {
            const steps = replayTacticalLine(fen(epYot), moves(["b6d6", "e5f3", answer]));
            expect(steps).toHaveLength(3);
            expect(tacticalExchangeGain(steps[2].before, steps[2].move)).toBe(exchange);
        }
        for (const line of [["b6d6"], ["b6d6", "d1d6", "g7e5"]]) {
            const result = classifyPositionTacticalMotifs({ fen: fen(epYot), pvUci: moves(line) });
            expect(result.motifs.some(m => m.id === "skewer")).toBe(false);
            expect(result.timeline?.some(m => m.id === "skewer")).toBe(false);
            expect(result.motifs.some(m => m.ply === 1 && m.value === 320)).toBe(true);
        }
    });
    test(`a genuine queen-front skewer still takes its rear rook, reflected=${reflected}`, () => {
        const root = "7k/5r2/8/8/2q5/8/B1P2PPP/5BK1 w - - 0 1";
        const result = classifyPositionTacticalMotifs({ fen: fen(root), pvUci: moves(["a2b3"]) });
        expect(result.motifs.find(m => m.id === "skewer")).toMatchObject({ ply: 1, value: 170 });
    });
    test(`a capture initiating a real skewer retains its rear witness, reflected=${reflected}`, () => {
        const root = "7k/5r2/8/8/2q5/1p6/B1P2PPP/5BK1 w - - 0 1";
        const result = classifyPositionTacticalMotifs({ fen: fen(root), pvUci: moves(["a2b3"]) });
        expect(result.motifs.find(m => m.id === "skewer")).toMatchObject({ ply: 1, value: 270 });
    });
    test(`an already free queen is not rebranded as its incidental rear skewer, reflected=${reflected}`, () => {
        const root = "7k/5r2/8/8/2q5/1q6/B1P2PPP/5BK1 w - - 0 1";
        const steps = replayTacticalLine(fen(root), moves(["a2b3"]));
        expect(tacticalExchangeGain(steps[0].before, steps[0].move)).toBe(900);
        const result = classifyPositionTacticalMotifs({ fen: fen(root), pvUci: moves(["a2b3"]) });
        expect(result.motifs[0]).toMatchObject({ id: "hangingPiece" });
        expect(result.motifs.some(m => m.id === "skewer")).toBe(false);
    });
}
