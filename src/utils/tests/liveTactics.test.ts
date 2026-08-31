import { describe, expect, test } from "vitest";
import type { BestMoves } from "@/bindings";
import {
    buildLiveTacticalScan,
    buildTacticalEngineOptions,
    hasUsableLiveTacticalFallback,
    isLiveTacticalScanTerminal,
    isLiveTacticalTheme,
    selectLiveTacticalScanLine,
    selectLiveTacticalMotifs,
} from "@/utils/tacticalMotifs/liveTactics";
import type { TacticalMotifEvidence } from "@/utils/tacticalMotifs/types";

function engineLine(depth: number, multipv = 1, uciMoves = ["e2e4"]): BestMoves {
    return {
        nodes: 10_000,
        depth,
        score: { value: { type: "cp", value: 20 }, wdl: null },
        uciMoves,
        sanMoves: ["e4"],
        multipv,
        nps: 100_000,
    };
}

describe("live tactical classifier", () => {
    test("turns a named mating pattern into board labels and forcing arrows", () => {
        const scan = buildLiveTacticalScan({
            fen: "rr6/p3p2k/3pNpp1/1pp5/2q1P3/5R2/P2Q2PP/6K1 w - - 0 27",
            pvUci: ["d2h6", "h7h6", "f3h3"],
            pvSan: ["Qh6+", "Kxh6", "Rh3#"],
            engineName: "Stockfish 18",
            depth: 18,
        });

        expect(scan.motifs.map((motif) => motif.id)).toContain("anastasiaMate");
        expect(scan.labels).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ text: "Anastasia Mate", square: "h3" }),
            ]),
        );
        expect(scan.arrows).toEqual([
            expect.objectContaining({ from: "d2", to: "h6", ply: 1 }),
            expect.objectContaining({ from: "h7", to: "h6", ply: 2 }),
            expect.objectContaining({ from: "f3", to: "h3", ply: 3, role: "trigger" }),
        ]);
        expect(scan.side).toBe("white");
    });

    test("does not call an ordinary opening line a tactic", () => {
        const scan = buildLiveTacticalScan({
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            pvUci: ["e2e4", "e7e5", "g1f3", "b8c6"],
            pvSan: ["e4", "e5", "Nf3", "Nc6"],
            engineName: "Stockfish 18",
            depth: 16,
        });

        expect(scan.motifs).toEqual([]);
        expect(scan.labels).toEqual([]);
        expect(scan.arrows).toEqual([]);
    });

    test("identifies a fork and anchors the Fork label to its landing square", () => {
        const scan = buildLiveTacticalScan({
            fen: "r1bqrnk1/1p3ppp/p2p1n2/b1pP4/P3PB2/2NB1N1P/1PQ2PP1/R2R2K1 b - - 6 14",
            pvUci: ["a5c3", "b2c3", "c5c4", "d3c4", "e8e4", "d1d4", "e4d4"],
            engineName: "Stockfish 18",
            depth: 16,
            previousFen: "r1bqrnk1/1p3ppp/p2p1n2/b1pP4/P3PB2/2NB1N1P/1PQ2PP1/R4RK1 w - - 5 14",
            previousMoveUci: "f1d1",
        });

        expect(scan.motifs.map((motif) => motif.id)).toContain("fork");
        expect(scan.labels).toEqual(
            expect.arrayContaining([expect.objectContaining({ text: "Fork", square: "e4" })]),
        );
        expect(scan.arrows[4]).toMatchObject({ from: "e8", to: "e4", role: "trigger" });
    });

    test("filters generic engine-line tags and keeps specific motifs", () => {
        const motif = (id: string, label: string): TacticalMotifEvidence => ({
            id,
            label,
            confidence: "high",
            evidence: `${label} evidence`,
            source: "available",
            ply: 1,
            moveUci: "e2e4",
        });
        const selected = selectLiveTacticalMotifs([
            motif("capture", "Capture"),
            motif("check", "Check"),
            motif("fork", "Fork"),
            motif("interference", "Interference"),
        ]);

        expect(selected.map((item) => item.id)).toEqual(["interference", "fork"]);
        expect(isLiveTacticalTheme("quietMove")).toBe(false);
        expect(isLiveTacticalTheme("smotheredMate")).toBe(true);
    });

    test("preserves profile options while forcing a single classifier PV", () => {
        const options = buildTacticalEngineOptions([
            { name: "WeightsFile", value: "C:/networks/BT4-it332.pb.gz" },
            { name: "MinibatchSize", value: 256 },
            { name: "NNCacheSize", value: 200000 },
            { name: "MultiPV", value: 7 },
        ]);

        expect(options).toEqual([
            { name: "WeightsFile", value: "C:/networks/BT4-it332.pb.gz" },
            { name: "MinibatchSize", value: "256" },
            { name: "NNCacheSize", value: "200000" },
            { name: "MultiPV", value: "1" },
        ]);
    });

    test("accepts a completed engine event without waiting for the command promise", () => {
        const lines = [engineLine(16)];

        expect(isLiveTacticalScanTerminal(99.99, lines)).toBe(false);
        expect(isLiveTacticalScanTerminal(100, lines)).toBe(true);
        expect(selectLiveTacticalScanLine(lines)).toBe(lines[0]);
    });

    test("uses only a sufficiently deep principal variation at the scan deadline", () => {
        const secondary = engineLine(10, 2);
        const principal = engineLine(9, 1);
        const emptyPrincipal = engineLine(14, 1, []);

        expect(selectLiveTacticalScanLine([secondary, principal])).toBe(principal);
        expect(selectLiveTacticalScanLine([emptyPrincipal, secondary])).toBe(secondary);
        expect(hasUsableLiveTacticalFallback([engineLine(7)], 8)).toBe(false);
        expect(hasUsableLiveTacticalFallback([principal], 8)).toBe(true);
    });
});
