import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { proveDefensiveMatingInterposition, proveQuietMatingAttack, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Public development nomination Kn14A. Source labels are not gold: independent
// legal enumeration finds 27 replies, 19 mate-in-one and two mate-in-two.
// Rxc3+ Kxc3 earns only 500-320=180. Qxe4 loses to Rxe8#, while Qe1+/Qc1+
// require actual king flights before every remaining checker can be captured.
const fen = "1k2b2R/2p5/Qp1p4/3Pp3/N3P3/PK3r2/1P6/1q6 w - - 15 40";
const line = ["a4c3", "f3c3", "b3c3", "b1c1", "c3b3"];
function reflected(position: string, moves: string[], mirror: boolean) {
    if (!mirror) return { fen: position, pvUci: moves };
    const flip = (s: string) => s.replace(/[1-8]/g, r => String(9 - Number(r)));
    const fields = position.split(" ");
    fields[0] = fields[0].split("/").reverse().join("/").replace(/[a-zA-Z]/g,
        c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
    fields[1] = fields[1] === "w" ? "b" : "w";
    if (fields[3] !== "-") fields[3] = flip(fields[3]);
    return { fen: fields.join(" "), pvUci: moves.map(flip) };
}

for (const mirror of [false, true]) {
    for (const length of [1, 2, 3, 5]) {
        test(`defensive mating interposition is independent of PV length ${length}, mirror=${mirror}`, () => {
            const row = reflected(fen, line.slice(0, length), mirror);
            expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(length);
            const result = classifyPositionTacticalMotifs(row);
            expect(result.motifs[0]).toMatchObject({ id: "forcingAttack", label: "Mating Attack", ply: 1, value: 180 });
            expect(result.motifs[0].evidence).toContain("blocks check and restores the threat");
            expect(result.motifs[0].evidence).toContain("All 27 legal replies");
            expect(result.motifs[0].evidence).toContain("not a forced-mate claim");
            expect(result.motifs.some(m => m.ply === 1 && ["pin", "fork", "sacrifice", "interference"].includes(m.id))).toBe(false);
            expect(buildLiveTacticalScan({ ...row, depth: 16, engineName: "Independent public control" }).motifs[0]?.id).toBe("forcingAttack");
        });
    }
    test(`covers all replies, debits blocker and records real king evasions, mirror=${mirror}`, () => {
        const row = reflected(fen, line, mirror);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        const proof = proveDefensiveMatingInterposition(steps[0]);
        expect(proof).toMatchObject({ gain: 180, defensiveInterposition: true });
        expect(proof?.branches).toHaveLength(27);
        expect([...steps[0].after.allDests()].reduce((count, [, destinations]) => count + destinations.size(), 0)).toBe(27);
        expect(proof?.branches.find(b => b.reply === (mirror ? "Rxc6+" : "Rxc3+"))?.gain).toBe(500 - 320);
        expect(proof?.visits).toBeGreaterThan(0);
        expect(proof?.visits).toBeLessThanOrEqual(8192);
        expect(proof?.decisions).toContainEqual({ fen: makeFen(steps[4].before.toSetup()), move: steps[4].uci });
        const follow = reflected(fen, ["a4c3", "f3c3", "b3c3", "b1c1", "c3b3", "c1d1", "b3a2"], mirror);
        const secondFlight = replayTacticalLine(follow.fen, follow.pvUci)[6];
        expect(proof?.decisions).toContainEqual({ fen: makeFen(secondFlight.before.toSetup()), move: secondFlight.uci });
        // The original attacking entry point keeps its in-check exclusion.
        expect(proveQuietMatingAttack(steps[0])).toBeNull();
    });
    for (const [name, position, move] of [
        ["missing mating rook", fen.replace("1k2b2R", "1k2b3"), "a4c3"],
        ["missing mating queen", fen.replace("Qp1p4", "1p1p4"), "a4c3"],
        ["unsettled third check without pawn capture guard", fen.replace("N3P3", "N7"), "a4c3"],
        ["old mate without initial check", fen.replace("N3P3/PK3r2", "N3Pr2/PK6"), "a4c3"],
        ["losing king flight", fen, "b3b4"],
        ["king flight allows mate", fen, "b3c4"],
        ["nonthreatening interposition", fen, "a6d3"],
        ["queen interposer costs more than rook", fen.replace("N3P3", "4P3").replace("1P6/1q6", "1PQ5/1q6"), "c2c3"],
        ["equal rook exchange is not profit", fen.replace("N3P3", "4P3").replace("1P6/1q6", "1PR5/1q6"), "c2c3"],
        ["promotion defence remains unresolved", fen.replace("1P6/1q6", "1P4p1/1q6"), "a4c3"],
        ["fifty-move claim by announced reply", fen.replace("15 40", "98 40"), "a4c3"],
        ["immediate fifty-move claim", fen.replace("15 40", "99 40"), "a4c3"],
        ["deeper defensive setup is not proved", "6k1/5p1p/2n1pP2/3pPp1Q/2n5/7P/5RB1/q5K1 w - - 2 30", "g2f1"],
    ]) {
        test(`no defensive certificate: ${name}, mirror=${mirror}`, () => {
            const row = reflected(position, [move], mirror);
            const steps = replayTacticalLine(row.fen, row.pvUci);
            expect(steps).toHaveLength(1);
            expect(proveDefensiveMatingInterposition(steps[0])).toBeNull();
            expect(classifyPositionTacticalMotifs(row).motifs.some(m => m.ply === 1 && m.evidence.includes("blocks check and restores"))).toBe(false);
        });
    }
    test(`invalid or exhausted budgets do not reuse a successful certificate, mirror=${mirror}`, () => {
        const row = reflected(fen, [line[0]], mirror);
        const root = replayTacticalLine(row.fen, row.pvUci)[0];
        expect(proveDefensiveMatingInterposition(root)?.gain).toBe(180);
        for (const budget of [0, -1, 1, 16, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
            expect(proveDefensiveMatingInterposition(root, budget)).toBeNull();
        expect(proveDefensiveMatingInterposition(root, 8192)?.gain).toBe(180);
    });
}
