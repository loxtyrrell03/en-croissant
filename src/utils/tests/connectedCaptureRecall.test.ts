import { expect, test } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import {
    proveCaptureCounterattack,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { forkCountercaptureFen, forkCountercaptureLine } from "./fixtures/forkCountercapture";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test.each([false, true])(
    "a capture's connected counterattack preserves its real gain (%s)",
    (reflected) => {
        const initial = reflected
            ? reflectMixedForkFen(forkCountercaptureFen)
            : forkCountercaptureFen;
        const line = reflected
            ? forkCountercaptureLine.map(reflectMixedForkMove)
            : forkCountercaptureLine;
        const steps = replayTacticalLine(initial, line);
        const fen = makeFen(steps[2].before.toSetup());
        expect(tacticalCaptureGain(steps[2])).toBeGreaterThanOrEqual(90);
        for (const pvUci of [[line[2]], line.slice(2)]) {
            const result = classifyPositionTacticalMotifs({ fen, pvUci });
            expect(result.motifs[0]).toMatchObject({
                id: "hangingPiece",
                label: "Material Gain",
                ply: 1,
            });
            expect(result.motifs[0].evidence).toContain("counterattack");
            const square = (s: string) => (reflected ? reflectMixedForkMove(s + s).slice(0, 2) : s);
            expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])).toEqual({
                square: square("d8"),
                arrows: [
                    { from: square("f7"), to: square("d8") },
                    { from: square("d8"), to: square("b7") },
                ],
            });
            expect(
                buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Constructed capture" })
                    .motifs[0]?.label,
            ).toBe("Material Gain");
        }
        const bad = reflected ? reflectMixedForkMove("f7h8") : "f7h8";
        const args = { fen, bestMoveUci: line[2], pvUci: line.slice(2), playedMoveUci: bad };
        expect(classifyMistakeReviewMotifs(args).missedMotifs).toContainEqual(
            expect.objectContaining({ id: "hangingPiece", ply: 1 }),
        );
        expect(
            classifyMistakeReviewMotifs({ ...args, playedMoveUci: line[2] }).missedMotifs,
        ).toEqual([]);
        expect(tacticalCaptureGain(replayTacticalLine(fen, [bad])[0])).toBeLessThan(0);
    },
);

test("countercaptured queens belong to the initiating capture, not two additional wins", () => {
    const prefix = replayTacticalLine(forkCountercaptureFen, forkCountercaptureLine.slice(0, 2));
    const fen = makeFen(prefix[1].after.toSetup());
    const result = classifyPositionTacticalMotifs({ fen, pvUci: forkCountercaptureLine.slice(2) });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ ply: 2, label: "Countercapture", value: undefined }),
    );
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ ply: 3, label: "Countercapture Payoff", value: undefined }),
    );
});

test.each([false, true])("an unavailable queen cannot finance a capture (%s)", (reflected) => {
    for (const initial of [forkCountercaptureFen.replace("1q2pppp", "q3pppp")]) {
        const line = reflected
            ? forkCountercaptureLine.map(reflectMixedForkMove)
            : forkCountercaptureLine;
        const steps = replayTacticalLine(
            reflected ? reflectMixedForkFen(initial) : initial,
            line.slice(0, 3),
        );
        expect(steps).toHaveLength(3);
        expect(proveCaptureCounterattack(steps[2])?.gain ?? null).toBeNull();
    }
});

test.each([false, true])(
    "a legal king flight alone cannot certify retention through a longer attack (%s)",
    (reflected) => {
        const initial = forkCountercaptureFen.replace("Q1PPP3", "Q3P3");
        const line = reflected
            ? forkCountercaptureLine.map(reflectMixedForkMove)
            : forkCountercaptureLine;
        const root = replayTacticalLine(
            reflected ? reflectMixedForkFen(initial) : initial,
            line.slice(0, 3),
        )[2];
        // The root still wins in Stockfish, but the old Qa4 / ...Qd3+ / Kc1
        // witness loses to ...Bd2+. Withhold this incomplete certificate,
        // not label the entire position non-tactical or the root losing.
        expect(proveCaptureCounterattack(root)).toBeNull();
    },
);

test("bounded failures cannot contaminate a complete certificate", () => {
    const root = replayTacticalLine(forkCountercaptureFen, forkCountercaptureLine)[2];
    for (const limit of [0, 1, -1, NaN, Infinity, 1.5]) {
        expect(proveCaptureCounterattack(root, limit)).toBeNull();
    }
    expect(proveCaptureCounterattack(root)?.gain).toBe(180);
    expect(tacticalCaptureGain(root)).toBe(180);
});

test.skipIf(
    !process.env.TACTICAL_CONNECTED_CAPTURE_REPLAY ||
        !process.env.TACTICAL_CONNECTED_CAPTURE_REPORT,
)("export connected-capture decisions for independent engine review", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const output = privateReportPath(process.env.TACTICAL_CONNECTED_CAPTURE_REPORT!);
    expect(existsSync(output)).toBe(false);
    const input = JSON.parse(readFileSync(process.env.TACTICAL_CONNECTED_CAPTURE_REPLAY!, "utf8"));
    const roots = new Map<string, { id: string; fen: string; uci: string }>();
    for (const row of input.results) {
        for (const lane of [
            { line: row.sourceUci, motifs: row.source.timeline ?? [] },
            ...row.scan.variations.map((v: any) => ({
                line: v.lineUci,
                motifs: v.timeline ?? v.motifs,
            })),
        ]) {
            const steps = replayTacticalLine(row.fen, lane.line);
            for (const motif of lane.motifs) {
                if (
                    (!motif.evidence?.includes("with a counterattack on") &&
                        !(
                            motif.label === "Fork Payoff" &&
                            motif.evidence?.includes("connected counterattack")
                        )) ||
                    !motif.ply
                )
                    continue;
                const root = steps[motif.ply - 1];
                const fen = makeFen(root.before.toSetup());
                roots.set(`${fen}:${root.uci}`, {
                    id: `${row.id}:${root.uci}`,
                    fen,
                    uci: root.uci,
                });
            }
        }
    }
    const construct = replayTacticalLine(forkCountercaptureFen, forkCountercaptureLine)[2];
    for (const [id, root] of [["constructed", construct]] as const) {
        const fen = makeFen(root.before.toSetup());
        roots.set(`${fen}:${root.uci}`, { id, fen, uci: root.uci });
    }
    const cases = [];
    const probes: { id: string; fen: string; searchMove: string; expectedSign?: -1 | 1 }[] = [];
    const seen = new Set<string>();
    const add = (id: string, fen: string, searchMove: string, expectedSign?: -1 | 1) => {
        const key = `${fen}:${searchMove}`;
        if (!seen.has(key)) {
            seen.add(key);
            probes.push({ id, fen, searchMove, expectedSign });
        }
    };
    for (const row of roots.values()) {
        const root = replayTacticalLine(row.fen, [row.uci])[0];
        const budget = { nodes: 4096 };
        const proof = proveCaptureCounterattack(root, 4096, budget);
        expect({ id: row.id, remaining: budget.nodes, proved: Boolean(proof) }).toEqual({
            id: row.id,
            remaining: expect.any(Number),
            proved: true,
        });
        expect({ id: row.id, gain: tacticalCaptureGain(root) }).toEqual({
            id: row.id,
            gain: proof!.gain,
        });
        add(`${row.id}:root`, row.fen, row.uci, 1);
        for (const [i, leaf] of proof!.leaves.entries()) {
            expect(replayTacticalLine(leaf.fen, [leaf.moveUci])).toHaveLength(1);
            add(`${row.id}:answer-${i}`, leaf.fen, leaf.moveUci, 1);
            for (const [j, answer] of (leaf.counterchecks ?? []).entries())
                add(`${row.id}:countercheck-${i}-${j}`, answer.fen, answer.moveUci, 1);
        }
        cases.push({ ...row, proof });
    }
    // Inspect controls separately, without assuming that a withheld
    // certificate proves a losing or non-tactical whole position.
    for (const [id, fen, uci] of [
        ["wrong-rook", makeFen(construct.before.toSetup()), "f7h8"],
        [
            "missing-queen",
            makeFen(
                replayTacticalLine(
                    forkCountercaptureFen.replace("1q2pppp", "q3pppp"),
                    forkCountercaptureLine.slice(0, 2),
                )[1].after.toSetup(),
            ),
            "f7d8",
        ],
    ])
        add(id, fen, uci);
    const flight = replayTacticalLine(
        forkCountercaptureFen.replace("Q1PPP3", "Q3P3"),
        forkCountercaptureLine,
    )[2];
    add("checking-flight-winning-root-withheld", makeFen(flight.before.toSetup()), flight.uci, 1);
    add(
        "rejected-Qa4-loses-by-mate",
        "2kN3r/6pp/q3p3/3p4/1b6/Q3P3/1P3PPP/R2K3R w - - 3 4",
        "a3a4",
        -1,
    );
    add(
        "rejected-Kc1-loses-by-mate",
        "2kN3r/6pp/4p3/3p4/Qb6/3qP3/1P3PPP/R2K3R w - - 5 5",
        "d1c1",
        -1,
    );
    writeFileSync(
        output,
        JSON.stringify(
            {
                scope: "Independent decision audit, not exhaustive chess minimax or accuracy.",
                samplePath: process.env.TACTICAL_CONNECTED_CAPTURE_REPLAY,
                cases,
                probes,
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
    console.log(
        JSON.stringify({
            cases: cases.map((c) => ({
                id: c.id,
                gain: c.proof!.gain,
                leaves: c.proof!.leaves.length,
            })),
            probes: probes.length,
        }),
    );
});
