import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci, parseSquare } from "chessops/util";
import { legalMoves, play, position, balance } from "./ltbye-intermediate-audit.mjs";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork";
import {
    proveDefenderCombination,
    replayTacticalLine,
} from "../../src/utils/tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
const observations: unknown[] = [];
const sourceRef = process.env.EPYOT_SOURCE_INDEX
    ? "index"
    : (process.env.RARE_CAUSAL_COHORT_V2_REF ?? "working-source");
const hashes = () =>
    Object.fromEntries(
        ["causalTactics.ts", "mistakeReviewAdapter.ts", "quietIntermediateCapture.ts"].map(
            (file) => [
                file,
                createHash("sha256")
                    .update(
                        sourceRef === "working-source"
                            ? readFileSync(`src/utils/tacticalMotifs/${file}`)
                            : execFileSync("git", [
                                  "-c",
                                  "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
                                  "show",
                                  `${sourceRef === "index" ? "" : sourceRef}:src/utils/tacticalMotifs/${file}`,
                              ]),
                    )
                    .digest("hex"),
            ],
        ),
    );
const initialHashes = hashes();
// Frozen nomination: bishop versus queen/rook, protected by Pc2. A rear
// recapture still yields rook500 minus bishop330. Countercheck Qxf1+ is
// explicitly capturable by Kg1 while Pf2 blocks the rook's f-file.
for (const capture of [false, true])
    for (const reflected of [false, true]) {
        test(`bishop-pinner rear collection capture=${capture} reflected=${reflected}`, () => {
            const base = capture
                ? "7k/5r2/8/8/2q5/1p6/B1P2PPP/5BK1 w - - 0 1"
                : "7k/5r2/8/8/2q5/8/B1P2PPP/5BK1 w - - 0 1";
            const fen = reflected ? reflectMixedForkFen(base) : base;
            const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
            const s = (square: string) => parseSquare(m(square))!;
            const pos = position(fen),
                root = replayTacticalLine(fen, [m("a2b3")])[0];
            expect(root.after.isCheck()).toBe(false);
            const leaves: any[] = [],
                budget = { nodes: 16384 };
            const gain = proveDefenderCombination(
                root,
                [s("c4"), s("f7")],
                [s("b3")],
                16384,
                budget,
                1,
                true,
                100,
                (leaf) => leaves.push(leaf),
                true,
                undefined,
                true,
                1,
            );
            expect(gain).toBe(capture ? 270 : 170);
            expect(budget.nodes).toBeGreaterThanOrEqual(-1);
            expect([...new Set(leaves.map((leaf) => leaf.lineUci[0]))].sort()).toEqual(
                legalMoves(root.after).map(makeUci).sort(),
            );
            for (const leaf of leaves) {
                let leafPosition = root.after;
                for (const move of leaf.lineUci.slice(0, -1))
                    leafPosition = play(leafPosition, move);
                assert.equal(makeFen(leafPosition.toSetup()), leaf.fen);
                assert.equal(
                    balance(leafPosition, pos.turn) - balance(pos, pos.turn),
                    leaf.balance,
                );
                play(leafPosition, leaf.moveUci);
            }
            const afterFront = play(root.after, m("c4d4")),
                rear = play(afterFront, m("b3f7"));
            expect(balance(rear, pos.turn) - balance(afterFront, pos.turn)).toBe(500);
            const afterCheck = play(root.after, m("c4f1")),
                takeQueen = play(afterCheck, m("g1f1"));
            expect(afterCheck.isCheck()).toBe(true);
            expect(balance(takeQueen, pos.turn) - balance(pos, pos.turn)).toBe(capture ? 670 : 570);
            const classification = classifyPositionTacticalMotifs({ fen, pvUci: [m("a2b3")] });
            expect(classification.motifs[0]).toMatchObject({
                id: "skewer",
                value: capture ? 270 : 170,
            });
            observations.push({
                capture,
                reflected,
                fen,
                gain,
                visits: 16384 - budget.nodes,
                rootReplies: legalMoves(root.after).map(makeUci),
                leaves: leaves.map(({ lineUci, moveUci, balance, gain, quiet }) => ({
                    lineUci,
                    moveUci,
                    balance,
                    gain,
                    quiet,
                })),
                classification,
            });
        });
    }
test("retain the independent positive nomination result", () => {
    expect(observations).toHaveLength(4);
    expect(hashes()).toEqual(initialHashes);
    if (process.env.EPYOT_POSITIVE_REPORT)
        writeFileSync(
            process.env.EPYOT_POSITIVE_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    sourceRef,
                    sourceHashes: initialHashes,
                    version: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
                    scope: "Independent genuine nonking-front skewer preservation controls, both colours with and without initiating pawn capture. Bounded material proof, not whole-game result.",
                    observations,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});
