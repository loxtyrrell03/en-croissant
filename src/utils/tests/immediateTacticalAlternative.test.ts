import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { buildLiveTacticalScan, previewLiveTacticalVariation } from "../tacticalMotifs/liveTactics";
import { immediateAlternativeInputs } from "./fixtures/immediateTacticalAlternative";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";

test.each(immediateAlternativeInputs)("a verified immediate alternative replaces an empty preview: $fen", input => {
    const before = JSON.stringify(input);
    const scan = buildLiveTacticalScan(input);
    const candidate = input.variations!.at(-1)!;
    expect(scan.preferredReason).toBe("tactical-alternative");
    expect(scan.preferredMultipv).toBe(candidate.multipv);
    expect(scan.motifs[0]).toMatchObject({ confidence: "high", ply: 1, moveUci: candidate.pvUci[0] });
    expect(scan.labels[0].text).toBe(scan.motifs[0].label);
    expect(scan.arrows[0].from + scan.arrows[0].to).toBe(candidate.pvUci[0]);
    expect(scan.variations.map(v => v.multipv)).toEqual(input.variations!.map(v => v.multipv));
    expect(scan.variations.every(v => v.origin === undefined)).toBe(true);
    expect(previewLiveTacticalVariation(scan, 1).motifs).toEqual([]);
    expect(previewLiveTacticalVariation(scan, 1).lineUci).toEqual(input.pvUci);
    expect(JSON.stringify(input)).toBe(before);
});

test.each([
    { cp: 369 }, { cp: undefined }, { cp: NaN }, { cp: Infinity },
    { depth: 15 }, { depth: undefined }, { depth: NaN },
    { mate: 3 }, { mate: -3 }, { pvUci: ["e5e7"] },
])("a weaker, incomplete or incomparable option does not become the default: %j", change => {
    const input = immediateAlternativeInputs[0];
    const scan = buildLiveTacticalScan({ ...input, variations: [input.variations![0], { ...input.variations![1], ...change }] });
    expect(scan.preferredMultipv).toBeUndefined();
    expect(scan.motifs).toEqual([]);
});

test.each([{ cp: undefined }, { cp: Infinity }, { mate: 4 }, { depth: 13 }, { depth: undefined }])(
    "the principal comparison needs sufficient explicit evidence: %j", change => {
        const input = immediateAlternativeInputs[0];
        const scan = buildLiveTacticalScan({ ...input, variations: [{ ...input.variations![0], ...change }, input.variations![1]] });
        expect(scan.preferredMultipv).toBeUndefined();
    },
);

test("a substantially weaker winning idea stays optional instead of taking the headline", () => {
    const input = immediateAlternativeInputs[0];
    const scan = buildLiveTacticalScan({ ...input, variations: [input.variations![0], { ...input.variations![1], cp: 200 }] });
    expect(scan.variations[1].motifs[0].id).toBe("fork");
    expect(scan.preferredMultipv).toBeUndefined();
});

test("an established main theme is not displaced and a standard alternative is not relabelled targeted", () => {
    const input = immediateAlternativeInputs[0];
    const main = { ...input.variations![1], multipv: 1 };
    expect(buildLiveTacticalScan({ ...input, variations: [main] }).preferredMultipv).toBeUndefined();
    const scan = buildLiveTacticalScan({ ...input, supplementalVariations: [{ depth: 16, pvUci: ["c4f7"], cp: 400 }] });
    expect(scan.preferredMultipv).toBe(2);
    expect(scan.preferredReason).toBe("tactical-alternative");
    expect(scan.variations.at(-1)?.origin).toBe("targeted");
});

test("colour reflection keeps the same tactic and original engine ranks", () => {
    const input = immediateAlternativeInputs[0];
    const scan = buildLiveTacticalScan({ ...input, fen: reflectMixedForkFen(input.fen),
        pvUci: input.pvUci.map(reflectMixedForkMove),
        variations: input.variations!.map(v => ({ ...v, pvUci: v.pvUci.map(reflectMixedForkMove), pvSan: undefined })),
    });
    expect(scan.side).toBe("black");
    expect(scan.preferredMultipv).toBe(2);
    expect(scan.motifs[0].id).toBe("fork");
    expect(scan.lineUci).toEqual(["e4f2"]);
});

test.each([false, true])("a compensation-only countercapture is not promoted (targeted=%s)", targeted => {
    const previousFen = "3r1nk1/2q3p1/2nppb1p/8/2P1PPQ1/2N5/1B4PP/5R1K w - - 0 1";
    const step = replayTacticalLine(previousFen, ["c3d5"])[0];
    const scan = buildLiveTacticalScan({
        fen: makeFen(step.after.toSetup()), previousFen, previousMoveUci: "c3d5",
        depth: 16, engineName: "Constructed selection", pvUci: ["g8h8"],
        variations: [{ multipv: 1, depth: 16, pvUci: ["g8h8"], cp: 200 },
            ...(targeted ? [] : [{ multipv: 2, depth: 16, pvUci: ["f6b2", "d5c7"], cp: 195 }])],
        ...(targeted ? { supplementalVariations: [{ depth: 16, pvUci: ["f6b2", "d5c7"], cp: 195 }] } : {}),
    });
    expect(scan.variations[1].motifs[0]).toMatchObject({ label: "Countercapture", value: 0 });
    expect(scan.motifs).toEqual([]);
    expect(scan.preferredMultipv).toBeUndefined();
});

test("a verified theme reached only after a checking cycle is not an immediate alternative", () => {
    const scan = buildLiveTacticalScan({
        fen: "6k1/2r2Npp/2q1P3/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1",
        depth: 16, engineName: "Constructed selection", pvUci: ["g1h1"],
        variations: [
            { multipv: 1, depth: 16, pvUci: ["g1h1"], cp: 420 },
            { multipv: 2, depth: 16, pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "d1d5", "c6d5", "g3c7"], cp: 413 },
        ],
    });
    expect(scan.variations[1].motifs[0].ply).toBe(5);
    expect(scan.motifs).toEqual([]);
    expect(scan.preferredMultipv).toBeUndefined();
});

test("a real exchange-winning alternative precedes an unthemed equal bishop trade", () => {
    const report = JSON.parse(readFileSync("benchmarks/tactical-relevance/castling-stockfish-18.json", "utf8"));
    const row = report.cases.find((r: { id: string }) => r.id === "castle:zJqoVvf1:26:a");
    const scan = buildLiveTacticalScan({ fen: row.fen, pvUci: row.engineLines[0].pvUci,
        variations: row.engineLines, depth: 16, engineName: "Frozen Stockfish 18" });
    expect(scan.variations[0].lineSan[0]).toBe("Bxd6");
    expect(scan.variations[0].motifs).toEqual([]);
    expect(scan.preferredMultipv).toBe(2);
    expect(scan.lineSan.slice(0, 2)).toEqual(["Nxb8", "Rxb8"]);
    expect(scan.motifs[0]).toMatchObject({ id: "hangingPiece", label: "Material Gain", value: 180, ply: 1 });
});
