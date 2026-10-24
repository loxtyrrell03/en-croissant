import { expect, test } from "vitest";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { proveCheckingMatingPreparation, proveMatingCaptureAttack, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// KmpJY / QPNg8ZHh is a public development nomination, not a gold source tag.
// Independently checked: Qxg6+ has only Kf8. Nxg5 then meets all 28 replies;
// Ne5 concedes dxe5, while other replies allow mate. Not forced mate at root.
const fen = "r1bqk2r/pppnp1b1/3p2p1/6p1/2PPQ3/5N2/PP4PP/R3KB1R w KQkq - 0 12";
const line = ["e4g6", "e8f8", "f3g5", "d7e5", "d4e5"];
function reflected(position: string, moves: string[], mirror: boolean) {
    if (!mirror) return { fen: position, pvUci: moves };
    const flip = (s: string) => s.replace(/[1-8]/g, r => String(9 - Number(r)));
    const swap = (s: string) => s.replace(/[a-zA-Z]/g, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
    const fields = position.split(" ");
    fields[0] = swap(fields[0].split("/").reverse().join("/"));
    fields[1] = fields[1] === "w" ? "b" : "w";
    fields[2] = swap(fields[2]);
    if (fields[3] !== "-") fields[3] = flip(fields[3]);
    return { fen: fields.join(" "), pvUci: moves.map(flip) };
}

for (const mirror of [false, true]) {
    for (const length of [1, 2, 3, 5]) {
        test(`checking mating preparation does not depend on PV length=${length}, mirror=${mirror}`, () => {
            const row = reflected(fen, line.slice(0, length), mirror);
            expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(length);
            const result = classifyPositionTacticalMotifs(row);
            expect(result.motifs[0]).toMatchObject({ id: "forcingAttack", label: "Mating Attack Preparation", ply: 1, value: 420 });
            expect(result.motifs[0]?.evidence).toMatch(/not a forced.mate claim/);
            expect(result.motifs.some(m => m.ply === 1 && ["fork", "intermezzo", "pin"].includes(m.id))).toBe(false);
            expect(buildLiveTacticalScan({ ...row, depth: 16, engineName: "Fixed public control" }).motifs[0]?.id).toBe("forcingAttack");
        });
    }
    for (const [name, position] of [
        ["missing preparer", fen.replace("5N2", "8")],
        ["missing collector", fen.replace("2PPQ3", "2P1Q3")],
        ["extra king flight", fen.replace("r1bqk2r", "r1b1k2r")],
        ["claim before resetting capture", fen.replace("3p2p1", "3p4").replace(" - 0 12", " - 98 12")],
    ]) {
        test(`no preparation certificate with ${name}, mirror=${mirror}`, () => {
            const row = reflected(position, line.slice(0, 1), mirror);
            expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(1);
            expect(classifyPositionTacticalMotifs(row).motifs.some(m => m.label === "Mating Attack Preparation")).toBe(false);
        });
    }
    test(`a root capture resets the fifty-move clock, mirror=${mirror}`, () => {
        const row = reflected(fen.replace(" - 0 12", " - 100 12"), line.slice(0, 1), mirror);
        expect(classifyPositionTacticalMotifs(row).motifs[0]).toMatchObject({ label: "Mating Attack Preparation", value: 420 });
    });
    test(`the connected child counts its capture once and covers every reply, mirror=${mirror}`, () => {
        const row = reflected(fen, line.slice(0, 1), mirror);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(1);
        const proof = proveCheckingMatingPreparation(steps[0]);
        expect(proof?.gain).toBe(420);
        expect(proof?.branches).toHaveLength(1);
        expect(proof?.branches[0]).toMatchObject({
            reply: mirror ? "Kf1" : "Kf8", setup: mirror ? "Nxg4" : "Nxg5",
            threat: mirror ? "Qf2#" : "Qf7#", gain: 420, replies: 28,
        });
        expect(proof?.visits).toBeGreaterThan(0);
        expect(proof?.visits).toBeLessThanOrEqual(8192);
    });
    test(`capturing the original checker defeats the composition, mirror=${mirror}`, () => {
        const row = reflected(fen.replace("pppnp1b1", "pppnp1bp"), ["e4g6", "h7g6"], mirror);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(2);
        expect(steps[1].capture).toBe(900);
        expect(proveCheckingMatingPreparation(steps[0])).toBeNull();
        expect(classifyPositionTacticalMotifs(row).motifs.some(m => m.label === "Mating Attack Preparation")).toBe(false);
    });
    test(`the forced king reply charges its capture before reusing the identical child, mirror=${mirror}`, () => {
        const row = reflected(fen.replace("r1bqk2r", "r1bqkN1r"), line.slice(0, 3), mirror);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(3);
        expect(steps[0].capture).toBe(100);
        expect(steps[1].capture).toBe(320);
        // Kxf8 removes the extra knight, leaving the original positive child.
        // Its 320 gain now merely repays that loss; it cannot be added as 420.
        expect(proveMatingCaptureAttack(steps[2])?.gain).toBe(320);
        expect(proveCheckingMatingPreparation(steps[0])).toBeNull();
        expect(classifyPositionTacticalMotifs(row).motifs.some(m => m.label === "Mating Attack Preparation")).toBe(false);
    });
    test(`a later resetting capture is valid before, but not after, the claim boundary, mirror=${mirror}`, () => {
        for (const clock of [0, 97, 98, 99, 100]) {
            const position = fen.replace("3p2p1", "3p4").replace(" - 0 12", ` - ${clock} 12`);
            const row = reflected(position, line.slice(0, 1), mirror);
            const steps = replayTacticalLine(row.fen, row.pvUci);
            expect(steps).toHaveLength(1);
            expect(steps[0].capture).toBe(0);
            const proof = proveCheckingMatingPreparation(steps[0]);
            expect(proof?.gain ?? null).toBe(clock <= 97 ? 320 : null);
        }
    });
    test(`incomplete and invalid budgets cannot reuse the successful cached proof, mirror=${mirror}`, () => {
        const row = reflected(fen, line.slice(0, 1), mirror);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(1);
        expect(proveCheckingMatingPreparation(steps[0])?.gain).toBe(420);
        for (const budget of [0, -1, 1, 16, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
            expect(proveCheckingMatingPreparation(steps[0], budget)).toBeNull();
        expect(proveCheckingMatingPreparation(steps[0], 8192)?.gain).toBe(420);
    });
}
