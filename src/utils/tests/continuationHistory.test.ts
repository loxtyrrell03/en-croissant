import { expect, test } from "vitest";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    filterRepetitionBoundaries,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { classifyProvedMistakeNature } from "../tacticalMotifs/mistakeNature";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { filterContinuationHistory } from "../tacticalMotifs/continuationHistory";
import {
    readTacticalRepetitionContext,
    advanceTacticalRepetitionContext,
    tacticalRepetitionClaim,
    tacticalRepetitionBoundary,
} from "../tacticalMotifs/repetitionHistory";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";
import { repetitionHistory, repetitionFlip } from "./fixtures/repetitionHistory";
import {
    continuationOrigin,
    continuationCycle,
    continuationClean,
    continuationApproach,
    continuationLine,
} from "./fixtures/continuationHistory";

// Constructed histories, not independent public puzzles or engine labels.
// The first Ne6+ does not repeat. Nc7+ at ply3 gives the defender a claim,
// defeating the conditional queen-winning story and its later payoff badge.

for (const mirrored of [false, true]) {
    const flip = (move: string) => (mirrored ? repetitionFlip(move) : move);
    const repeated = repetitionHistory(
        continuationOrigin,
        [...continuationCycle, ...continuationCycle, ...continuationApproach],
        mirrored,
    );
    const clean = repetitionHistory(
        continuationOrigin,
        [...continuationClean, ...continuationApproach],
        mirrored,
    );
    const line = continuationLine.map(flip);
    test(`identical board/clocks, actual claim belongs to ply3, mirrored=${mirrored}`, () => {
        expect(repeated.fen).toBe(clean.fen);
        for (const row of [repeated, clean]) {
            expect(tacticalRepetitionBoundary(row.fen, line[0], row.tacticalHistory)).toBeNull();
            let state = readTacticalRepetitionContext(row.fen, row.tacticalHistory)!;
            for (let ply = 0; ply < 3; ply++) {
                state = advanceTacticalRepetitionContext(state, line[ply])!;
                expect(tacticalRepetitionClaim(state)).toBe(
                    row !== repeated || ply === 0
                        ? null
                        : ply === 1
                          ? "announced-threefold"
                          : "current-threefold",
                );
            }
        }
    });
    for (const length of [3, 5])
        test(`later fork and payoff cannot become a false root lesson, length=${length}, mirrored=${mirrored}`, () => {
            for (const row of [repeated, clean, repeated, clean]) {
                const pvUci = line.slice(0, length),
                    blocked = row === repeated;
                const position = classifyPositionTacticalMotifs({ ...row, pvUci });
                expect(position.motifs.some((m) => m.id === "fork")).toBe(!blocked && length === 5);
                expect(position.timeline?.some((m) => m.label === "Fork Payoff") ?? false).toBe(
                    !blocked && length === 5,
                );
                const live = buildLiveTacticalScan({
                    ...row,
                    pvUci,
                    depth: 16,
                    engineName: "Conditional history regression",
                });
                expect(live.motifs.some((m) => m.id === "fork")).toBe(!blocked && length === 5);
                const input = { ...row, pvUci, bestMoveUci: line[0], playedMoveUci: flip("h2h3") };
                const review = classifyMistakeReviewMotifs(input);
                expect(review.missedMotifs.some((m) => m.id === "fork")).toBe(
                    !blocked && length === 5,
                );
                // The later fork alone does not establish a tactical first move.
                expect(classifyProvedMistakeNature(input).nature).toBe("unknown");
            }
            const blocked = buildLiveTacticalScan({
                ...repeated,
                pvUci: line.slice(0, length),
                depth: 16,
                engineName: "Conditional history regression",
            });
            expect(blocked.arrows).toEqual([]);
            expect(blocked.labels).toEqual([]);
        });
    test(`absent or mismatched history cannot invent the claim, mirrored=${mirrored}`, () => {
        const baseline = classifyPositionTacticalMotifs({ fen: repeated.fen, pvUci: line });
        expect(baseline.motifs.some((m) => m.id === "fork")).toBe(true);
        expect(
            classifyPositionTacticalMotifs({
                fen: repeated.fen,
                pvUci: line,
                tacticalHistory: {
                    ...repeated.tacticalHistory,
                    moves: repeated.tacticalHistory.moves.slice(0, -1),
                },
            }),
        ).toEqual(baseline);
    });
    test(`fresh scan after a declined claim can retain an actual capture, mirrored=${mirrored}`, () => {
        const row = repetitionHistory(
            continuationOrigin,
            [
                ...continuationCycle,
                ...continuationCycle,
                ...continuationApproach,
                ...continuationLine.slice(0, 4),
            ],
            mirrored,
        );
        const result = classifyPositionTacticalMotifs({ ...row, pvUci: [line[4]] });
        expect(result.motifs.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(true);
    });
    test(`draw/observation evidence survives, an independent root certificate is untouched, mirrored=${mirrored}`, () => {
        const base: TacticalMotifEvidence = {
            id: "fork",
            label: "Fork",
            confidence: "high",
            source: "available",
            evidence: "Synthetic path-boundary contract",
            ply: 3,
            moveUci: line[2],
            value: 900,
        };
        const root = { ...base, ply: 1, moveUci: line[0] };
        const draw = { ...base, id: "drawingCapture", label: "Drawing Capture", value: 0 };
        const observation = {
            ...base,
            id: "matingThreat",
            label: "Mating Threat",
            value: undefined,
        };
        expect(
            filterRepetitionBoundaries(repeated.fen, line, repeated.tacticalHistory, [
                root,
                base,
                draw,
                observation,
            ]),
        ).toEqual([root, draw, observation]);
        // A concession reverses the beneficiary: White's announced claim at
        // ply2 also prevents claiming a forced opponent win at ply3.
        const concession = { ...base, id: "selfInterference", label: "Self-Interference" };
        expect(
            filterContinuationHistory(repeated.fen, line, repeated.tacticalHistory, [concession]),
        ).toEqual([]);
    });
    test(`a different local alternative is not defeated by the principal move's claim, mirrored=${mirrored}`, () => {
        const reached = repetitionHistory(
            continuationOrigin,
            [
                ...continuationCycle,
                ...continuationCycle,
                ...continuationApproach,
                ...continuationLine.slice(0, 2),
            ],
            mirrored,
        );
        const alternative = flip("e6c5");
        expect(
            tacticalRepetitionBoundary(reached.fen, alternative, reached.tacticalHistory),
        ).toBeNull();
        const motif: TacticalMotifEvidence = {
            id: "fork",
            label: "Fork",
            confidence: "high",
            source: "available",
            evidence:
                "Synthetic independent-alternative binding contract; no win asserted by this fixture",
            ply: 3,
            moveUci: alternative,
            value: 300,
            alternativeLine: { fen: reached.fen, uci: [alternative], san: [] },
        };
        expect(
            filterRepetitionBoundaries(repeated.fen, line, repeated.tacticalHistory, [motif]),
        ).toEqual([motif]);
    });
    test(`automatic termination in the prefix cannot be revived by a later capture, mirrored=${mirrored}`, () => {
        const fen = clean.fen.replace(" 14 8", " 146 8");
        const history = { fen, moves: [] };
        const motif: TacticalMotifEvidence = {
            id: "hangingPiece",
            label: "Capture",
            confidence: "high",
            source: "available",
            evidence: "Synthetic automatic termination contract",
            ply: 5,
            moveUci: line[4],
        };
        expect(filterContinuationHistory(fen, line, history, [motif])).toEqual([]);
    });
}
