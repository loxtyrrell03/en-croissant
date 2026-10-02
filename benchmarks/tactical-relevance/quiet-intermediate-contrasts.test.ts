import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci, parseSquare, parseUci } from "chessops/util";
import { balance, legalMoves, play, position } from "./ltbye-intermediate-audit.mjs";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork";
import {
    proveDefenderCombination,
    replayTacticalLine,
} from "../../src/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
const selection = JSON.parse(
    readFileSync(
        "benchmarks/tactical-relevance/quiet-intermediate-development-selection.json",
        "utf8",
    ),
);
const observations: unknown[] = [];
for (const reflected of [false, true]) {
    const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
    const s = (square: string) => parseSquare(m(square))!;
    test(`EpYOT rear-pawn removal preserves the connected collection reflected=${reflected}`, () => {
        const row = selection.cases.find((item: any) => item.id === "lichess:EpYOT");
        for (const removed of [[], ["c3"], ["g3"], ["c3", "g3"], ["c3", "g3", "b2", "h2"]]) {
            const pos = position(reflected ? reflectMixedForkFen(row.startFen) : row.startFen);
            for (const square of removed) pos.board.take(s(square));
            const fen = makeFen(pos.toSetup());
            const root = replayTacticalLine(fen, [m("b6d6")])[0];
            const leaves: any[] = [],
                trace: any[] = [];
            const budget = { nodes: 16384 };
            const gain = proveDefenderCombination(
                root,
                [s("e5")],
                [s("g7"), s("d6")],
                16384,
                budget,
                1,
                true,
                320,
                (leaf) => leaves.push(leaf),
                true,
                (item) => trace.push(item),
                true,
                1,
            );
            if (removed.length < 4) assert.equal(gain, 320);
            if (gain !== null)
                assert.deepEqual(
                    [...new Set(leaves.map((leaf) => leaf.lineUci[0]))].sort(),
                    legalMoves(root.after).map(makeUci).sort(),
                );
            expect(budget.nodes).toBeGreaterThanOrEqual(-1);
            let end = pos;
            for (const uci of ["b6d6", "d1d6", "g7e5"]) end = play(end, m(uci));
            expect(balance(end, pos.turn) - balance(pos, pos.turn)).toBe(320);
            expect(end.board.get(s("d6"))?.role).toBe("rook");
            expect(end.isLegal(parseUci(m("b1b7"))!)).toBe(removed.length === 4);
            if (removed.length === 4) {
                const grabbedPawn = play(end, m("b1b7"));
                assert.equal(balance(grabbedPawn, pos.turn) - balance(pos, pos.turn), 220);
            }
            observations.push({
                kind: "rear-pawn-removal",
                reflected,
                removed,
                fen,
                gain,
                replyCount: legalMoves(root.after).length,
                visits: 16384 - budget.nodes,
                exhausted: budget.nodes < 0,
                trace,
                selected: classifyPositionTacticalMotifs({
                    fen,
                    pvUci: [m("b6d6"), m("d1d6"), m("g7e5")],
                }),
            });
        }
    });
    test(`Qq0JW stronger requested bounds are evidence not nominal900 credit reflected=${reflected}`, () => {
        const row = selection.cases.find((item: any) => item.id === "lichess:Qq0JW");
        const fen = reflected ? reflectMixedForkFen(row.startFen) : row.startFen;
        const root = replayTacticalLine(fen, [m("g4f3")])[0];
        const reverse = replayTacticalLine(fen, [m("f6d5"), m("f3g4")])[1];
        for (const [which, minimum] of [
            ["forward", 320],
            ["reverse", 310],
            ["reverse", 900],
        ] as const) {
            const step = which === "forward" ? root : reverse;
            const budget = { nodes: 16384 },
                leaves: any[] = [];
            const gain = proveDefenderCombination(
                step,
                which === "forward" ? [s("d5")] : [],
                which === "forward" ? [s("f6"), s("f3")] : [s("g4")],
                16384,
                budget,
                1,
                true,
                minimum,
                (leaf) => leaves.push(leaf),
                true,
                undefined,
                true,
                1,
            );
            expect(budget.nodes).toBeGreaterThanOrEqual(-1);
            if (gain !== null)
                assert.deepEqual(
                    [...new Set(leaves.map((leaf) => leaf.lineUci[0]))].sort(),
                    legalMoves(step.after).map(makeUci).sort(),
                );
            observations.push({
                kind: "stronger-bound",
                reflected,
                fen,
                which,
                minimum,
                gain,
                visits: 16384 - budget.nodes,
                exhausted: budget.nodes < 0,
                leaves,
            });
        }
    });
}
test("retain later contrasts separately from frozen initial hypotheses", () => {
    expect(observations).toHaveLength(16);
    if (process.env.QUIET_INTERMEDIATE_CONTRAST_REPORT)
        writeFileSync(
            process.env.QUIET_INTERMEDIATE_CONTRAST_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    sourceRef: process.env.RARE_CAUSAL_COHORT_V2_REF ?? "working-source",
                    scope: "Post-baseline independently legal counterfactuals and stronger bounded proof requests; no production changes or population accuracy credit.",
                    observations,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});
