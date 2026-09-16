import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import {
    proveCheckingCombination,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    checkingPawnPreparationCases,
    checkingPawnPreparationFen,
    checkingPawnPreparationLine,
} from "./fixtures/checkingPawnPreparation";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "./fixtures/mixedTargetFork";
import {
    matingMechanismControls,
    matingMechanismExamples,
} from "./fixtures/matingMechanismRelevance";

test("a king flight refutes mate without erasing the forcing pawn concession", () => {
    const { fen } = matingMechanismControls.find(
        (row) => row.id === "king-flight",
    )!;
    const pvUci = matingMechanismExamples[0].pvUci;
    const steps = replayTacticalLine(fen, pvUci);
    const proof = proveCheckingCombination(steps)!;
    expect(proof).toMatchObject({
        gain: 100,
        pawnPayoff: true,
        branches: [{ reply: "Kg5", gain: 100, line: ["Rxg7+"] }],
    });
    const scan = buildLiveTacticalScan({
        fen,
        pvUci,
        depth: 16,
        engineName: "Stockfish 18",
    });
    expect(scan.motifs.map((motif) => motif.id)).toEqual(["forcingAttack"]);
    // The king can escape after the capture; the source puzzle's mating
    // self-interference no longer proves mate in this constructed variant.
    expect(replayTacticalLine(fen, [...pvUci, "g5h5"])).toHaveLength(4);
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/checking-pawn-king-flight-stockfish-18.json",
            "utf8",
        ),
    );
    for (const decision of [{ fen, move: pvUci[0] }, ...proof.decisions]) {
        const record = receipt.searches.find(
            (row: any) =>
                row.fen === decision.fen && row.searchMove === decision.move,
        );
        expect(record).toBeDefined();
        expect(record.lines[0]).toMatchObject({ depth: 16, mate: null });
        expect(record.lines[0].pvUci[0]).toBe(decision.move);
        expect(record.lines[0].cp).toBeGreaterThan(0);
    }
});

test.each([false, true])(
    "checking pawn concessions cover defences, not a cooperative line: reflected=%s",
    (reflected) => {
        for (const row of checkingPawnPreparationCases) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const pvUci = reflected
                ? row.pvUci.map(reflectMixedForkMove)
                : row.pvUci;
            const steps = replayTacticalLine(fen, pvUci);
            expect(steps).toHaveLength(pvUci.length);
            const proof = proveCheckingCombination(steps);
            expect({ id: row.id, proved: !!proof }).toEqual({
                id: row.id,
                proved: row.positive,
            });
            const result = classifyPositionTacticalMotifs({
                fen,
                pvUci,
                rootCp: 400,
            });
            expect(result.motifs.map((m) => m.id)).toEqual(
                row.positive ? ["forcingAttack"] : [],
            );
            if (!proof) continue;
            expect(proof.gain).toBe(100);
            expect(proof.visits).toBeLessThanOrEqual(32768);
            expect(proof.branches).toHaveLength(
                [...steps[0].after.allDests()].reduce(
                    (n, [, dests]) => n + dests.size(),
                    0,
                ),
            );
            for (const decision of proof.decisions) {
                const replay = replayTacticalLine(decision.fen, [
                    decision.move,
                ]);
                expect(replay).toHaveLength(1);
            }
            const input = {
                fen,
                pvUci,
                depth: 16,
                engineName: "Constructed",
            };
            const live = buildLiveTacticalScan(input);
            expect(live.motifs).toEqual(result.motifs);
            const rootCheck = reflected ? reflectMixedForkMove("c8e8") : "c8e8";
            expect(
                live.arrows.map((arrow) => `${arrow.from}${arrow.to}`),
            ).toEqual([pvUci[0], rootCheck]);
            // The later capture is not advertised or drawn as already available.
            expect(live.labels).toHaveLength(1);
            const played = reflected ? reflectMixedForkMove("d2d3") : "d2d3";
            expect(replayTacticalLine(fen, [played])).toHaveLength(1);
            const review = classifyMistakeReviewMotifs({
                fen,
                playedMoveUci: played,
                bestMoveUci: pvUci[0],
                pvUci,
            });
            expect(
                buildMistakeReviewTacticalExplanation(review)?.primary,
            ).toMatchObject({
                id: "forcingAttack",
                source: "missed",
                ply: 1,
                value: 100,
            });
        }
    },
);

test("pawn nomination preserves budgets and excludes quiet or absent payoffs", () => {
    const steps = replayTacticalLine(
        checkingPawnPreparationFen,
        checkingPawnPreparationLine,
    );
    const proof = proveCheckingCombination(steps);
    expect(proof).not.toBeNull();
    for (const limit of [0, -1, 1, NaN, Infinity, 1.5])
        expect(proveCheckingCombination(steps, limit)).toBeNull();
    expect(proveCheckingCombination(steps.slice(0, 1))).toBeNull();
    const quiet = replayTacticalLine(checkingPawnPreparationFen, [
        "h3c8",
        "d6d8",
        "c8c7",
        "g8f6",
        "c7a7",
    ]);
    expect(quiet).toHaveLength(5);
    expect(proveCheckingCombination(quiet)).toBeNull();
    expect(proveCheckingCombination(steps)).toEqual(proof);
});

test.each([false, true])(
    "forcing pawn recovery after a sacrificed piece is not another win: reflected=%s",
    (reflected) => {
        const before = "4k1nr/p2p1ppp/2Br4/8/8/7Q/3P1P2/5R1K b - - 0 1";
        const previousFen = reflected ? reflectMixedForkFen(before) : before;
        const previousMoveUci = reflected
            ? reflectMixedForkMove("d7c6")
            : "d7c6";
        const fen = makeFen(
            replayTacticalLine(previousFen, [
                previousMoveUci,
            ])[0].after.toSetup(),
        );
        const pvUci = reflected
            ? checkingPawnPreparationLine.map(reflectMixedForkMove)
            : checkingPawnPreparationLine;
        expect(
            proveCheckingCombination(replayTacticalLine(fen, pvUci)),
        ).toMatchObject({ gain: 100, pawnPayoff: true });
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]?.id,
        ).toBe("forcingAttack");
        expect(
            classifyPositionTacticalMotifs({
                fen,
                pvUci,
                previousFen,
                previousMoveUci,
            }).motifs,
        ).toEqual([]);
        const live = buildLiveTacticalScan({
            fen,
            pvUci,
            previousFen,
            previousMoveUci,
            depth: 16,
            engineName: "Constructed",
        });
        expect(live.motifs).toEqual([]);
        expect(live.arrows).toEqual([]);
        const full = classifyPositionTacticalMotifs({
            fen: previousFen,
            pvUci: [previousMoveUci, ...pvUci],
        });
        expect(
            full.timeline?.some(
                (motif) => motif.id === "forcingAttack" && motif.ply === 2,
            ),
        ).not.toBe(true);
    },
);

test("fresh Stockfish searches cover every selected public preparation answer", () => {
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/checking-pawn-preparation-stockfish-18.json",
            "utf8",
        ),
    );
    const records = new Map(
        receipt.searches.map((row: any) => [
            `${row.fen}:${row.searchMove ?? ""}`,
            row,
        ]),
    );
    for (const row of checkingPawnPreparationCases.filter(
        (row) => row.positive,
    ))
        for (const reflected of [false, true]) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const pvUci = reflected
                ? row.pvUci.map(reflectMixedForkMove)
                : row.pvUci;
            const proof = proveCheckingCombination(
                replayTacticalLine(fen, pvUci),
            )!;
            for (const decision of [
                { fen, move: pvUci[0] },
                ...proof.decisions,
            ]) {
                const record: any = records.get(
                    `${decision.fen}:${decision.move}`,
                );
                expect(record).toBeDefined();
                expect(record.lines[0].depth).toBe(16);
                expect(record.lines[0].pvUci[0]).toBe(decision.move);
                expect(
                    record.lines[0].mate === null
                        ? record.lines[0].cp > 0
                        : record.lines[0].mate > 0,
                ).toBe(true);
            }
        }
});
