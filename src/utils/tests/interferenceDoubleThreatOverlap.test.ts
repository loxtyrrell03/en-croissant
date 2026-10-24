import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveQuietDoubleThreat,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const original = "4r2n/6RP/8/8/4k1K1/8/8/8 w - - 3 74";
const extraVictim = "1n2r2n/6RP/8/8/4k1K1/8/8/8 w - - 3 74";
const line = ["g7g8", "e8e7", "g8h8"];

for (const reflected of [false, true]) {
    const flip = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
    const position = (fen: string) => reflected ? reflectMixedForkFen(fen) : fen;
    const square = (index: number) => reflected ? index ^ 56 : index;
    const fen = position(original), pvUci = line.map(flip);

    test(`overlap suppression keeps the independently proved raw threat; reflected=${reflected}`, () => {
        const root = replayTacticalLine(fen, pvUci)[0];
        const proof = proveQuietDoubleThreat(root)!;
        expect(proof).not.toBeNull();
        expect(proof.gain).toBe(320);
        expect(new Set(proof.targets)).toEqual(new Set([square(60), square(63)]));
        expect(proof.directTargets).toEqual([square(60)]);
        expect(makeUci(proof.threat)).toBe(flip("g8e8"));
        expect(proof.branches).toHaveLength(16);
        expect(proof.branches.map(branch => branch.kind)).toEqual(expect.arrayContaining(["capture", "fork"]));
        expect([...root.after.allDests()].reduce((count, [, dests]) => count + dests.size(), 0)).toBe(16);
        const output = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(output.motifs[0]).toMatchObject({ id: "interference", value: proof.gain, ply: 1 });
        expect(output.motifs.some(motif => motif.id === "doubleThreat" && motif.ply === 1)).toBe(false);
    });

    test(`live arrows retain the actual severed guard and both targets; reflected=${reflected}`, () => {
        for (const moves of [pvUci.slice(0, 1), pvUci]) {
            const output = classifyPositionTacticalMotifs({ fen, pvUci: moves });
            expect(tacticalBoardEvidence(fen, moves, output.motifs[0])).toEqual({
                square: flip("g8"),
                arrows: [
                    { from: flip("e8"), to: flip("g8") },
                    { from: flip("g8"), to: flip("h8") },
                    { from: flip("g8"), to: flip("e8") },
                ],
            });
            const scan = buildLiveTacticalScan({ fen, pvUci: moves, depth: 16, engineName: "Regression" });
            expect(scan.motifs[0]).toMatchObject({ id: "interference", value: 320, ply: 1 });
            expect(scan.labels.map(label => label.id)).toEqual(["interference"]);
            expect(scan.arrows.map(arrow => arrow.from + arrow.to)).toContain(flip("g7g8"));
            expect(scan.arrows.map(arrow => arrow.from + arrow.to)).toContain(flip("g8h8"));
        }
    });

    test(`an additional original fork victim keeps its distinct double threat; reflected=${reflected}`, () => {
        const extraFen = position(extraVictim), root = replayTacticalLine(extraFen, pvUci)[0];
        const proof = proveQuietDoubleThreat(root)!;
        expect(proof).not.toBeNull();
        expect(proof.gain).toBe(320);
        expect(new Set(proof.targets)).toEqual(new Set([square(60), square(57), square(63)]));
        expect(proof.branches).toHaveLength(17);
        for (const moves of [pvUci.slice(0, 1), pvUci]) {
            const output = classifyPositionTacticalMotifs({ fen: extraFen, pvUci: moves });
            expect(output.motifs).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: "interference", value: 320, ply: 1 }),
                expect.objectContaining({ id: "doubleThreat", value: 320, ply: 1 }),
            ]));
        }
    });

    test(`a checking fork stays at its actual later ply; reflected=${reflected}`, () => {
        const moves = ["g7g8", "e4e3", "g8e8", "e3d3", "e8h8"].map(flip);
        expect(replayTacticalLine(fen, moves)).toHaveLength(moves.length);
        const output = classifyPositionTacticalMotifs({ fen, pvUci: moves });
        expect(output.motifs[0]).toMatchObject({ id: "interference", ply: 1, value: 320 });
        expect(output.motifs.some(motif => motif.id === "doubleThreat" && motif.ply === 1)).toBe(false);
        expect(output.timeline).toContainEqual(expect.objectContaining({
            id: "fork", ply: 3, moveUci: flip("g8e8"), relevance: "secondary",
        }));
    });
}
