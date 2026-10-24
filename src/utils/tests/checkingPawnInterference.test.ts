import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { proveForcedSelfInterference, proveSelfInterference, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Public GrHPv REACHED board, after Ra1 Rc8 Ra7 Qxa7. This does not prove
// Ra1 or Ra7. Qh8+ forces Ke7/Kf7 across Qa7's protection of h7; Qxh7+
// then wins that exact guard against every reply. The other rook skewer is
// real, but does not explain this connected queen-winning continuation.
const fen = "2r2k2/q6p/6p1/3pQp2/1p1P4/7P/6P1/6K1 w - - 0 45";
const line = ["e5h8", "f8f7", "h8h7", "f7f6", "h7a7"];
function reflected(position: string, moves: string[], mirror: boolean) {
    if (!mirror) return { fen: position, pvUci: moves };
    const fields = position.split(" ");
    fields[0] = fields[0].split("/").reverse().join("/").replace(/[a-zA-Z]/g,
        c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
    fields[1] = fields[1] === "w" ? "b" : "w";
    return { fen: fields.join(" "), pvUci: moves.map(m => m.replace(/[1-8]/g, r => String(9 - Number(r)))) };
}

for (const mirror of [false, true]) {
    for (const length of [1, 5]) test(`connected interference owns the checking root, ${length} plies, mirror=${mirror}`, () => {
        const input = reflected(fen, line.slice(0, length), mirror);
        expect(replayTacticalLine(input.fen, input.pvUci)).toHaveLength(length);
        const result = classifyPositionTacticalMotifs(input);
        expect(result.motifs[0]).toMatchObject({ id: "interference", label: "Forced Interference", ply: 1, value: 1000 });
        expect(result.motifs[0].evidence).toContain(mirror ? "Qxh2+" : "Qxh7+");
        expect(result.motifs[0].evidence).toContain(mirror ? "Qxa2" : "Qxa7");
        expect(result.motifs.find(m => m.id === "skewer" && m.ply === 1)?.relevance).toBe("secondary");
        expect(buildLiveTacticalScan({ ...input, depth: 16, engineName: "Public proof contract" }).motifs[0]?.id).toBe("interference");
    });
    test(`every checking evasion cuts the same guard and every following evasion loses it, mirror=${mirror}`, () => {
        const input = reflected(fen, line, mirror), steps = replayTacticalLine(input.fen, input.pvUci);
        const proof = proveForcedSelfInterference(steps[0]);
        expect(proof).toMatchObject({ gain: 1000, branches: [expect.any(Object), expect.any(Object)] });
        expect(proof?.branches.map(b => b.reply).sort()).toEqual(mirror ? ["Ke2", "Kf2"] : ["Ke7", "Kf7"]);
        for (const branch of proof?.branches ?? []) {
            expect(branch.proof).toMatchObject({ captureSan: mirror ? "Qxh2+" : "Qxh7+", gain: 1000,
                continuation: { captureSan: mirror ? "Qxa2" : "Qxa7", branches: expect.any(Array) } });
        }
        // Independently enumerate both levels from the legal board, not a PV.
        let count = 0;
        for (const [from, destinations] of steps[0].after.allDests()) for (const to of destinations) {
            const evasion = steps[0].after.clone(); evasion.play({ from, to });
            const pawn = parseUci(input.pvUci[2])!; expect(evasion.isLegal(pawn)).toBe(true); evasion.play(pawn);
            expect(evasion.isCheck()).toBe(true);
            for (const [kingFrom, kingDestinations] of evasion.allDests()) for (const kingTo of kingDestinations) {
                const final = evasion.clone(); final.play({ from: kingFrom, to: kingTo });
                const collect = parseUci(input.pvUci[4])!;
                expect(final.isLegal(collect)).toBe(true);
                expect("to" in collect && final.board.get(collect.to)?.role).toBe("queen");
                count++;
            }
        }
        expect(count).toBe(10);
    });
    test(`the same connection can win a rook guard without a queen-specific rule, mirror=${mirror}`, () => {
        const input = reflected(fen.replace("q6p", "r6p"), line, mirror);
        expect(replayTacticalLine(input.fen, input.pvUci)).toHaveLength(5);
        expect(classifyPositionTacticalMotifs(input).motifs[0]).toMatchObject({ id: "interference", ply: 1, value: 600 });
    });
    for (const [name, position] of [
        ["no guarding slider", fen.replace("q6p", "7p")],
        ["no guarded pawn", fen.replace("q6p", "q7")],
        ["another bishop legally recaptures the pawn capture", fen.replace("6p1", "6b1")],
        ["a legal bishop block avoids the forced king interference", fen.replace("6p1", "4b1p1")],
        ["a promotion reply defeats the local material leaf", fen.replace("1p1P4", "3P4").replace("6P1", "1p4P1")],
        ["the defender can claim fifty moves by announcing an evasion", fen.replace("0 45", "98 45")],
    ]) test(`no forced pawn-interference certificate: ${name}, mirror=${mirror}`, () => {
        const input = reflected(position, [line[0]], mirror), steps = replayTacticalLine(input.fen, input.pvUci);
        expect(steps).toHaveLength(1);
        expect(proveForcedSelfInterference(steps[0])).toBeNull();
        expect(classifyPositionTacticalMotifs(input).motifs.some(m => m.id === "interference" && m.ply === 1)).toBe(false);
    });
    test(`actual defender's concession belongs on the following timeline row, mirror=${mirror}`, () => {
        const input = reflected(fen, line, mirror), steps = replayTacticalLine(input.fen, input.pvUci);
        expect(proveSelfInterference(steps[1])).toMatchObject({ gain: 1000 });
        const result = classifyPositionTacticalMotifs(input);
        expect(result.timeline?.some(m => m.id === "selfInterference" && m.ply === 2 && m.actor === (mirror ? "white" : "black"))).toBe(true);
        const reached = classifyPositionTacticalMotifs({ fen: makeFen(steps[0].after.toSetup()), pvUci: input.pvUci.slice(1) });
        expect(reached.motifs.some(m => m.id === "selfInterference")).toBe(false);
    });
    test(`the quiet parent is not relabelled by its optional continuation, mirror=${mirror}`, () => {
        const input = reflected("5k2/5q1p/6p1/3pQp2/1prP4/7P/6P1/1R4K1 w - - 3 43",
            ["b1a1", "c4c8", "a1a7", "f7a7", ...line], mirror);
        const result = classifyPositionTacticalMotifs(input);
        expect(result.motifs.some(m => m.id === "interference" && m.ply === 1)).toBe(false);
    });
}

test("invalid/exhausted proof bounds never borrow a cached complete certificate", () => {
    const steps = replayTacticalLine(fen, line);
    expect(proveForcedSelfInterference(steps[0])).toMatchObject({ gain: 1000 });
    for (const limit of [0, 1, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(proveForcedSelfInterference(steps[0], limit)).toBeNull();
        expect(proveSelfInterference(steps[1], limit)).toBeNull();
    }
});
