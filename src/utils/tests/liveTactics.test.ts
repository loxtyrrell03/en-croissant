import { describe, expect, test } from "vitest";
import type { BestMoves } from "@/bindings";
import {
    buildLiveTacticalScan,
    buildTacticalEngineOptions,
    getLiveTacticalScanCacheKey,
    hasUsableLiveTacticalFallback,
    isLiveTacticalScanTerminal,
    isLiveTacticalTheme,
    LIVE_TACTICAL_SCAN_MULTIPV,
    selectLiveTacticalScanLine,
    selectLiveTacticalScanLines,
    selectLiveTacticalMotifs,
    tacticalMotifDescription,
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

        expect(selected.map((item) => item.id)).toEqual(["fork", "interference"]);
        expect(isLiveTacticalTheme("quietMove")).toBe(false);
        expect(isLiveTacticalTheme("smotheredMate")).toBe(true);
    });

    test("preserves profile options while requesting three classifier candidates", () => {
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
            { name: "MultiPV", value: "3" },
        ]);
        expect(LIVE_TACTICAL_SCAN_MULTIPV).toBe(3);
    });

    test("accepts only a requested-depth terminal event without waiting for the command promise", () => {
        const lines = [engineLine(16)];

        expect(isLiveTacticalScanTerminal(99.99, lines, 16)).toBe(false);
        expect(isLiveTacticalScanTerminal(100, [engineLine(1)], 16)).toBe(false);
        expect(isLiveTacticalScanTerminal(100, lines, 16)).toBe(true);
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

    test("keeps up to three distinct root moves in engine priority order", () => {
        const principal = engineLine(16, 1, ["e5f7", "d7d5"]);
        const duplicateRoot = engineLine(16, 2, ["e5f7", "e8f7"]);
        const second = engineLine(16, 3, ["c4f7", "e8f8"]);
        const fourth = engineLine(16, 4, ["d1h5", "f6h5"]);

        expect(
            selectLiveTacticalScanLines([fourth, second, duplicateRoot, principal], 3, 16),
        ).toEqual([principal, second, fourth]);
    });

    test("classifies the Nxf7 fork and Bxf7+ weak-f7 alternative independently", () => {
        const scan = buildLiveTacticalScan({
            fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
            pvUci: ["e5f7", "d7d5", "f7d8"],
            pvSan: ["Nxf7", "d5", "Nxd8"],
            engineName: "Stockfish 18",
            depth: 16,
            variations: [
                {
                    multipv: 1,
                    depth: 16,
                    pvUci: ["e5f7", "d7d5", "f7d8"],
                    pvSan: ["Nxf7", "d5", "Nxd8"],
                },
                {
                    multipv: 2,
                    depth: 16,
                    pvUci: ["c4f7", "e8f8", "f7b3"],
                    pvSan: ["Bxf7+", "Kf8", "Bb3"],
                },
            ],
        });

        expect(scan.variations).toHaveLength(2);
        const fork = scan.variations[0]?.motifs.find((motif) => motif.id === "fork");
        const weakF7 = scan.variations[1]?.motifs.find(
            (motif) => motif.id === "attackingF2F7",
        );
        expect(fork?.evidence).toMatch(/Nxf7 forks the queen on d8 and rook on h8/i);
        expect(weakF7?.evidence).toMatch(
            /Bxf7\+ exploits f7, which is attacked twice and defended once, and gives check/i,
        );
        expect(tacticalMotifDescription(fork!)).toBe(fork?.evidence);
        expect(tacticalMotifDescription(weakF7!)).toBe(weakF7?.evidence);
        expect(scan.motifs.map((motif) => motif.id).slice(0, 2)).toEqual(["fork", "attackingF2F7"]);
        expect(scan.labels).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ text: "Nxf7 · Fork", square: "f7" }),
                expect.objectContaining({ text: "Bxf7+ · Weak f7", square: "f7" }),
            ]),
        );
        expect(scan.arrows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ from: "e5", to: "f7" }),
                expect.objectContaining({ from: "c4", to: "f7" }),
            ]),
        );
    });

    test("keeps a one-ply Nxf7 prefix as a provisional Weak f7 warning", () => {
        const scan = buildLiveTacticalScan({
            fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
            pvUci: ["e5f7"],
            pvSan: ["Nxf7"],
            engineName: "Stockfish 18",
            depth: 8,
        });

        expect(scan.motifs.map((motif) => motif.id)).toEqual(["attackingF2F7"]);
        expect(scan.labels).toEqual([
            expect.objectContaining({ text: "Weak f7", square: "f7" }),
        ]);
        expect(scan.arrows).toEqual([expect.objectContaining({ from: "e5", to: "f7" })]);
    });

    test("cache identity includes both the live pipeline version and MultiPV width", () => {
        const input = {
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            engineId: "stockfish-18",
            depth: 16,
        };

        const threeLineKey = getLiveTacticalScanCacheKey({ ...input, multipv: 3 });
        const oneLineKey = getLiveTacticalScanCacheKey({ ...input, multipv: 1 });

        expect(threeLineKey).not.toBe(oneLineKey);
        expect(JSON.parse(threeLineKey)).toEqual(
            expect.arrayContaining([LIVE_TACTICAL_SCAN_MULTIPV]),
        );
    });
});
