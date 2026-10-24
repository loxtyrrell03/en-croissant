import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { tacticalRepetitionBoundary, tacticalRepetitionKey } from "../tacticalMotifs/repetitionHistory";
import { verifiedTacticalHistory } from "../tacticalMotifs/gameHistory";
import { classifyProvedMistakeNature } from "../tacticalMotifs/mistakeNature";
import { classifyPositionTacticalMotifs, classifyMistakeReviewMotifs, buildMistakeReviewTacticalExplanation,
    filterRepetitionBoundaries } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan, getLiveTacticalScanCacheKey } from "../tacticalMotifs/liveTactics";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";
import { repetitionOrigin, repetitionCycle, repetitionClean, repetitionMateLine, repetitionAnnouncedOrigin,
    repetitionAnnounced, repetitionFlip, repetitionHistory } from "./fixtures/repetitionHistory";

for (const mirrored of [false, true]) {
    const move = (uci: string) => mirrored ? repetitionFlip(uci) : uci;
    const repeated = repetitionHistory(repetitionOrigin, [...repetitionCycle, ...repetitionCycle], mirrored);
    const clean = repetitionHistory(repetitionOrigin, repetitionClean, mirrored);
    const line = repetitionMateLine.map(move);
    test(`identical exact FEN, different proved defender claim, mirrored=${mirrored}`, () => {
        expect(repeated.fen).toBe(clean.fen);
        expect(tacticalRepetitionBoundary(repeated.fen, line[0], repeated.tacticalHistory))
            .toEqual({ kind: "defender-draw", reason: "current-threefold" });
        expect(tacticalRepetitionBoundary(clean.fen, line[0], clean.tacticalHistory)).toBeNull();
        // Capture-debt validation remains intentionally stricter.
        expect(verifiedTacticalHistory(repeated.tacticalHistory, repeated.fen)).toBeNull();
    });
    for (const length of [1, 3]) test(`public root/live/review do not claim a repetition-defeated mate, length=${length}, mirrored=${mirrored}`, () => {
        for (const row of [repeated, clean, repeated, clean]) {
            const pvUci = line.slice(0, length), blocked = row === repeated;
            const position = classifyPositionTacticalMotifs({ ...row, pvUci });
            expect(position.motifs[0]?.id ?? null).toBe(blocked ? null : "mateIn2");
            const live = buildLiveTacticalScan({ ...row, pvUci, depth: 16, engineName: "Legal history regression" });
            expect(live.motifs[0]?.id ?? null).toBe(blocked ? null : "mateIn2");
            const input = { ...row, pvUci, bestMoveUci: line[0], playedMoveUci: move("a3a4") };
            const review = classifyMistakeReviewMotifs(input);
            expect(buildMistakeReviewTacticalExplanation(review)?.primary.id ?? null).toBe(blocked ? null : "mateIn2");
            expect(classifyProvedMistakeNature(input).nature).toBe(blocked ? "unknown" : "tactical");
        }
        const blockedInput = { ...repeated, pvUci: line.slice(0, length) };
        expect(classifyPositionTacticalMotifs(blockedInput).timeline ?? []).toEqual([]);
        const blockedLive = buildLiveTacticalScan({ ...blockedInput, depth: 16, engineName: "Legal history regression" });
        expect(blockedLive.arrows).toEqual([]);
        expect(blockedLive.labels).toEqual([]);
        const blockedReview = classifyMistakeReviewMotifs({ ...blockedInput, bestMoveUci: line[0], playedMoveUci: move("a3a4") });
        expect(blockedReview.missedTimeline ?? []).toEqual([]);
    });
    test(`announced defender move also stops the forced-win claim, mirrored=${mirrored}`, () => {
        const row = repetitionHistory(repetitionAnnouncedOrigin, repetitionAnnounced, mirrored);
        expect(tacticalRepetitionBoundary(row.fen, line[0], row.tacticalHistory))
            .toEqual({ kind: "defender-draw", reason: "announced-threefold", moveUci: move("h7h8") });
        expect(classifyPositionTacticalMotifs({ ...row, pvUci: line }).motifs).toEqual([]);
    });
    test(`allowed reply receives the actual played move exactly once, mirrored=${mirrored}`, () => {
        const row = repetitionHistory(repetitionOrigin, [...repetitionCycle, ...repetitionCycle].slice(0, -1), mirrored);
        const input = { ...row, bestMoveUci: move("a7a6"), playedMoveUci: move("h8h7"),
            pvUci: [move("a7a6")], refutationUci: line };
        expect(classifyMistakeReviewMotifs({ ...input, tacticalHistory: undefined }).allowedMotifs.some(m => m.value === 10000)).toBe(true);
        const result = classifyMistakeReviewMotifs(input);
        expect(result.allowedMotifs).toEqual([]); expect(result.allowedTimeline ?? []).toEqual([]);
    });
    test(`fifth occurrence caused by the root move is an automatic draw, mirrored=${mirrored}`, () => {
        const cycle = ["h7h8", "g7g1", "h8h7", "g1g7"];
        const row = repetitionHistory("r2q1r2/p4pRk/1p2pP1n/2p4R/3p1P2/P2P1N1P/1PP4K/8 b - - 0 30",
            [...Array(3).fill(cycle).flat(), ...cycle.slice(0, 3)], mirrored);
        expect(tacticalRepetitionBoundary(row.fen, line[0], row.tacticalHistory)).toEqual({ kind: "defender-draw", reason: "fivefold" });
        expect(classifyPositionTacticalMotifs({ ...row, pvUci: line }).motifs).toEqual([]);
    });
    for (const tail of [[], ["g1g2", "h7h8"]]) test(`automatic fivefold cannot be revived, continuation=${tail.length}, mirrored=${mirrored}`, () => {
        const row = repetitionHistory(repetitionOrigin, [...Array(4).fill(repetitionCycle).flat(), ...tail], mirrored);
        const root = move(tail.length ? "g2g7" : "g1g7");
        expect(tacticalRepetitionBoundary(row.fen, root, row.tacticalHistory)).toEqual({ kind: "game-over", endedAtPly: 16 });
        expect(classifyPositionTacticalMotifs({ ...row, pvUci: [root] }).motifs).toEqual([]);
        expect(buildLiveTacticalScan({ ...row, pvUci: [root], depth: 16, engineName: "Terminal history" }).motifs).toEqual([]);
        const result = classifyMistakeReviewMotifs({ ...row, bestMoveUci: root, playedMoveUci: move("a3a4"), pvUci: [root] });
        expect(result.missedMotifs).toEqual([]); expect(result.allowedMotifs).toEqual([]);
    });
    test(`attacker's optional claim does not prevent immediate mate, mirrored=${mirrored}`, () => {
        const row = repetitionHistory("7k/8/5KQ1/8/8/8/8/8 w - - 0 1",
            Array(2).fill(["g6h5", "h8g8", "h5g6", "g8h8"]).flat(), mirrored);
        const root = move("g6g7");
        expect(tacticalRepetitionBoundary(row.fen, root, row.tacticalHistory)).toBeNull();
        expect(classifyPositionTacticalMotifs({ ...row, pvUci: [root] }).motifs.some(m => m.value === 10000)).toBe(true);
    });
    test(`a repeating PV does not invalidate an independent non-repeating mate proof, mirrored=${mirrored}`, () => {
        const row = repetitionHistory(repetitionOrigin, [], mirrored);
        const pvUci = [...repetitionCycle, ...repetitionCycle, ...repetitionMateLine].map(move);
        expect(classifyPositionTacticalMotifs({ ...row, pvUci }).motifs[0]?.id).toBe("mateIn2");
    });
    test(`independently proved perpetual draw survives an optional defender claim, mirrored=${mirrored}`, () => {
        const cycle = ["f7f6", "h8g8", "f6f7", "g8h8"];
        const row = repetitionHistory("r6k/5Q1p/6p1/8/q7/8/8/5R1K w - - 0 1", [...cycle, ...cycle], mirrored);
        const pvUci = [...cycle, cycle[0]].map(move);
        expect(tacticalRepetitionBoundary(row.fen, pvUci[0], row.tacticalHistory)?.kind).toBe("defender-draw");
        expect(classifyPositionTacticalMotifs({ ...row, pvUci, rootCp: 0 }).motifs[0]?.id).toBe("perpetualCheck");
    });
    test(`zero-value defensive deflection is not itself a drawing resource, mirrored=${mirrored}`, () => {
        const cycle = ["f8f6", "g6h5", "f6f8", "h5g6"];
        const row = repetitionHistory("5rk1/7R/6KP/8/8/8/Pr6/8 b - - 0 1", [...cycle, ...cycle], mirrored);
        const root = move("f8f6");
        expect(classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [root], rootCp: 300 }).motifs.some(m => m.id === "defensiveDeflection")).toBe(true);
        expect(tacticalRepetitionBoundary(row.fen, root, row.tacticalHistory)?.kind).toBe("defender-draw");
        expect(classifyPositionTacticalMotifs({ ...row, pvUci: [root], rootCp: 300 }).motifs.some(m => m.id === "defensiveDeflection")).toBe(false);
    });
    test(`missing, malformed, wrong-root and incomplete history cannot invent a claim, mirrored=${mirrored}`, () => {
        const invalid = [undefined, null, { fen: repeated.fen, moves: [] },
            { ...repeated.tacticalHistory, moves: [...repeated.tacticalHistory.moves, "bad"] },
            { ...repeated.tacticalHistory, moves: repeated.tacticalHistory.moves.slice(0, -1) },
            { ...repeated.tacticalHistory, moves: ["a1a8"] },
            { ...repeated.tacticalHistory, moves: Array(1025).fill("g1g7") },
            { ...repeated.tacticalHistory, fen: repeated.tacticalHistory.fen.replace("0 30", "1 30") },
            { ...repeated.tacticalHistory, fen: repeated.tacticalHistory.fen.replace("0 30", "0 31") }];
        for (const tacticalHistory of invalid) {
            expect(tacticalRepetitionBoundary(repeated.fen, line[0], tacticalHistory)).toBeNull();
            expect(classifyPositionTacticalMotifs({ fen: repeated.fen, pvUci: line, tacticalHistory }).motifs[0]?.id).toBe("mateIn2");
        }
    });
    test(`alternative moves are checked on their own exact root, not a later board, mirrored=${mirrored}`, () => {
        const base: TacticalMotifEvidence = { id: "forcingAttack", label: "Forced gain", evidence: "Synthetic filtering contract, not a tactical certificate", confidence: "high", source: "available", ply: 1, moveUci: line[0], value: 100 };
        const materialReset = move("h5h6");
        const sameRoot = { ...base, alternativeLine: { fen: repeated.fen, uci: [materialReset], san: [] } };
        const laterRoot = { ...base, alternativeLine: { fen: repeated.fen.replace(" 8 ", " 10 "), uci: [materialReset], san: [] } };
        expect(tacticalRepetitionBoundary(repeated.fen, materialReset, repeated.tacticalHistory)).toBeNull();
        expect(filterRepetitionBoundaries(repeated.fen, line, repeated.tacticalHistory, [sameRoot, laterRoot])).toEqual([sameRoot]);
        const neutral = { ...base, id: "matingThreat", label: "Mating threat" };
        expect(filterRepetitionBoundaries(repeated.fen, line, repeated.tacticalHistory, [neutral])).toEqual([neutral]);
    });
    test(`live cache identity includes the exact history, mirrored=${mirrored}`, () => {
        expect(getLiveTacticalScanCacheKey({ ...repeated, engineId: "Regression", depth: 16 }))
            .not.toEqual(getLiveTacticalScanCacheKey({ ...clean, engineId: "Regression", depth: 16 }));
    });
}

const key = (fen: string) => tacticalRepetitionKey(Chess.fromSetup(parseFen(fen).unwrap()).unwrap());
test.each([
    ["castling rights", "4k2r/8/8/8/8/8/8/4K2R w Kk - 0 1", "4k2r/8/8/8/8/8/8/4K2R w - - 0 1", false],
    ["legal en passant", "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1", false],
    ["uncapturable en passant", "4k3/8/8/3p4/8/8/8/4K3 w - d6 0 1", "4k3/8/8/3p4/8/8/8/4K3 w - - 0 1", true],
    ["pinned en passant", "k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "k3r3/8/8/3pP3/8/8/8/4K3 w - - 0 1", true],
    ["clocks", "4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1", "4k3/8/8/3pP3/8/8/8/4K3 w - - 9 40", true],
    ["side to move", "4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1", "4k3/8/8/3pP3/8/8/8/4K3 b - - 0 1", false],
])("FIDE repetition identity: %s", (_name, first, second, equal) => {
    expect(key(first as string) === key(second as string)).toBe(equal);
});
