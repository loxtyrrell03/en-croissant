import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    buildLiveTacticalScan,
    previewLiveTacticalVariation,
    type LiveTacticalScanInput,
} from "../tacticalMotifs/liveTactics";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";

const fen = "6k1/2r2Npp/2q1P3/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1";
const direct = ["d1d5", "c6d5", "g3c7"];
const cycle = ["f7h6", "g8h8", "h6f7", "h8g8", ...direct];
const input: LiveTacticalScanInput = {
    fen,
    pvUci: cycle,
    depth: 16,
    engineName: "Constructed",
    variations: [
        { multipv: 1, pvUci: cycle, cp: 420 },
        { multipv: 2, pvUci: direct, cp: 413 },
    ],
};

test("prefer the independently verified immediate tactic over a closed checking cycle", () => {
    expect(replayTacticalLine(fen, cycle)).toHaveLength(cycle.length);
    const scan = buildLiveTacticalScan(input);
    expect(scan.variations[0].motifs[0]).toMatchObject({ id: "capturingDefender", ply: 5 });
    expect(scan.variations[1].motifs[0]).toMatchObject({ id: "capturingDefender", ply: 1 });
    expect(scan.lineUci).toEqual(direct);
    expect(scan.preferredMultipv).toBe(2);
    expect(scan.motifs[0]?.ply).toBe(1);
    expect(
        scan.arrows.some((a) => ["f7h6", "h6f7", "g8h8", "h8g8"].includes(`${a.from}${a.to}`)),
    ).toBe(false);
});

test.each([
    ["unknown alternative score", 420, undefined],
    ["nonfinite alternative score", 420, NaN],
    ["unknown main score", undefined, 413],
    ["nonfinite main score", Infinity, 413],
    ["materially weaker alternative", 420, 200],
    ["drawing main line", 0, 0],
    ["losing alternatives", -420, -413],
])("do not substitute when %s", (_name, cp, alternativeCp) => {
    const scan = buildLiveTacticalScan({
        ...input,
        variations: [
            { multipv: 1, pvUci: cycle, cp },
            { multipv: 2, pvUci: direct, cp: alternativeCp },
        ],
    });
    expect(scan.preferredMultipv).toBeUndefined();
    expect(scan.lineUci).toEqual(cycle);
});

test("a line ending at a different king square is not a closed cycle", () => {
    const position = fen.replace("2r2Npp", "2r2Np1");
    const moves = ["f7h6", "g8h8", "h6f7", "h8h7", ...direct];
    expect(replayTacticalLine(position, moves)).toHaveLength(moves.length);
    const scan = buildLiveTacticalScan({
        ...input,
        fen: position,
        pvUci: moves,
        variations: [
            { multipv: 1, pvUci: moves, cp: 420 },
            { multipv: 2, pvUci: direct, cp: 413 },
        ],
    });
    expect(scan.preferredMultipv).toBeUndefined();
    expect(scan.lineUci).toEqual(moves);
});

test("a root-only input cannot invent a separately scored candidate", () => {
    const scan = buildLiveTacticalScan({ ...input, variations: undefined });
    expect(scan.preferredMultipv).toBeUndefined();
    expect(scan.lineUci).toEqual(cycle);
});

test.each([1, 2])("mate-valued candidate %i is not compared using a centipawn margin", (rank) => {
    const scan = buildLiveTacticalScan({
        ...input,
        variations: input.variations!.map((v) => ({
            ...v,
            ...(v.multipv === rank ? { mate: 8 } : {}),
        })),
    });
    expect(scan.preferredMultipv).toBeUndefined();
    expect(scan.lineUci).toEqual(cycle);
});

test("an immediate tactic already in the main line keeps its engine rank", () => {
    const scan = buildLiveTacticalScan({
        ...input,
        pvUci: direct,
        variations: [
            { multipv: 1, pvUci: direct, cp: 420 },
            { multipv: 2, pvUci: cycle, cp: 413 },
        ],
    });
    expect(scan.preferredMultipv).toBeUndefined();
    expect(scan.lineUci).toEqual(direct);
});

test("a quiet unrelated alternative cannot borrow the repeated line's certificate", () => {
    const scan = buildLiveTacticalScan({
        ...input,
        variations: [input.variations![0], { multipv: 2, pvUci: ["g1h1"], cp: 413 }],
    });
    expect(scan.preferredMultipv).toBeUndefined();
    expect(scan.lineUci).toEqual(cycle);
});

test("colour reflection preserves the immediate preference", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const reflect = (moves: string[]) =>
        moves.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const scan = buildLiveTacticalScan({
        ...input,
        fen: fields.join(" "),
        pvUci: reflect(cycle),
        variations: [
            { multipv: 1, pvUci: reflect(cycle), cp: 420 },
            { multipv: 2, pvUci: reflect(direct), cp: 413 },
        ],
    });
    expect(scan.preferredMultipv).toBe(2);
    expect(scan.lineUci).toEqual(reflect(direct));
});

test("the engine's original line remains available and scan inputs are not mutated", () => {
    const before = JSON.stringify(input);
    const scan = buildLiveTacticalScan(input);
    expect(previewLiveTacticalVariation(scan, 1).lineUci).toEqual(cycle);
    expect(previewLiveTacticalVariation(scan, 2).lineUci).toEqual(direct);
    expect(JSON.stringify(input)).toBe(before);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_REPORT)(
    "the real course repetition gives way to its measured immediate alternative",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_REPORT!, "utf8"));
        const row = report.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 172);
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci: row.engineLines[0].pvUci,
            variations: row.engineLines,
            depth: 16,
            engineName: "Stockfish 18",
        });
        expect(scan.lineUci[0]).toBe(row.sourceUci?.[0] ?? "d1d5");
        expect(scan.motifs[0]).toMatchObject({ id: "capturingDefender", ply: 1 });
    },
);
