import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseSquare, parseUci } from "chessops/util";
import { balance, captureValue, legalMoves, play, position } from "./ltbye-intermediate-audit.mjs";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork";
import {
    proveDefenderCombination,
    replayTacticalLine,
    tacticalExchangeGain,
} from "../../src/utils/tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";

const hypotheses = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/epyot-causal-hypotheses.json", "utf8"),
);
const sourceRef = process.env.EPYOT_SOURCE_INDEX
    ? "index"
    : (process.env.RARE_CAUSAL_COHORT_V2_REF ?? "working-source");
const observations: unknown[] = [];
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
function bounded(
    step: ReturnType<typeof replayTacticalLine>[number],
    targets: number[],
    capturers: number[],
    minimum: number,
) {
    const budget = { nodes: 16384 },
        leaves: any[] = [],
        trace: any[] = [];
    const gain = proveDefenderCombination(
        step,
        targets,
        capturers,
        16384,
        budget,
        1,
        true,
        minimum,
        (leaf) => leaves.push(leaf),
        true,
        (failure) => trace.push(failure),
        true,
        1,
    );
    if (gain !== null) {
        assert.deepEqual(
            [...new Set(leaves.map((leaf) => leaf.lineUci[0]))].sort(),
            legalMoves(step.after).map(makeUci).sort(),
        );
        for (const leaf of leaves) {
            let pos = step.after;
            for (const uci of leaf.lineUci.slice(0, -1)) pos = play(pos, uci);
            assert.equal(makeFen(pos.toSetup()), leaf.fen);
            assert.equal(
                balance(pos, step.before.turn) - balance(step.before, step.before.turn),
                leaf.balance,
            );
            assert.ok(pos.isLegal(parseUci(leaf.moveUci)!));
        }
    }
    return {
        minimum,
        gain,
        visits: 16384 - budget.nodes,
        exhausted: budget.nodes < 0,
        leaves: leaves.map(({ lineUci, moveUci, balance, gain, quiet }) => ({
            lineUci,
            moveUci,
            balance,
            gain,
            quiet,
        })),
        trace,
    };
}
for (const reflected of [false, true]) {
    const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
    const s = (square: string) => parseSquare(m(square))!;
    const original = reflected ? reflectMixedForkFen(hypotheses.fen) : hypotheses.fen;
    test(`controlled rear-ray removal and collection reflected=${reflected}`, () => {
        for (const kind of ["original", "remove-rear-keep-b3-block", "relocate-four-pawns"]) {
            const pos = position(original);
            if (kind !== "original") {
                for (const square of ["c3", "g3", "b2", "h2"]) pos.board.take(s(square));
                for (const square of kind === "remove-rear-keep-b3-block"
                    ? ["b3"]
                    : ["c4", "g4", "b3", "h3"])
                    pos.board.set(s(square), {
                        color: pos.turn === "black" ? "white" : "black",
                        role: "pawn",
                    });
            }
            const fen = makeFen(pos.toSetup());
            expect(makeFen(position(fen).toSetup())).toBe(fen);
            const root = replayTacticalLine(fen, [m("b6d6")])[0];
            expect(root.after.isCheck()).toBe(false);
            const proof = bounded(root, [s("e5")], [s("g7"), s("d6")], 320);
            expect(proof.visits).toBeLessThanOrEqual(16385);
            expect(proof.gain).toBe(320);
            let end = pos;
            for (const uci of hypotheses.line) end = play(end, m(uci));
            expect(balance(end, pos.turn) - balance(pos, pos.turn)).toBe(320);
            expect(end.isLegal(parseUci(m("b1b7"))!)).toBe(false);
            const frontDepartures = legalMoves(root.after)
                .filter((move) => move.from === s("e5"))
                .map((reply) => {
                    const next = play(root.after, reply);
                    const rearCaptures = legalMoves(next)
                        .filter(
                            (move) =>
                                captureValue(next, move) > 0 &&
                                [s("c3"), s("g3"), s("b2"), s("h2")].includes(move.to),
                        )
                        .map((move) => ({
                            uci: makeUci(move),
                            san: makeSan(next, move),
                            capture: captureValue(next, move),
                            see: tacticalExchangeGain(next, move),
                            delta: balance(play(next, move), pos.turn) - balance(pos, pos.turn),
                        }));
                    const queenEscapes = legalMoves(next)
                        .filter((move) => move.from === s("d6") && captureValue(next, move) === 0)
                        .map((move) => {
                            const after = play(next, move);
                            return {
                                uci: makeUci(move),
                                san: makeSan(next, move),
                                directTakers: legalMoves(after)
                                    .filter((take) => take.to === move.to)
                                    .map(makeUci),
                            };
                        });
                    if (kind === "original") {
                        assert.deepEqual(
                            rearCaptures.map((item) => item.uci).sort(),
                            [m("d6g3"), m("g7c3")].sort(),
                        );
                        for (const [take, reply, loss] of [
                            ["d6g3", "h2g3", -800],
                            ["g7c3", "b2c3", -230],
                        ] as const) {
                            const afterTake = play(next, m(take)),
                                afterReply = play(afterTake, m(reply));
                            assert.equal(
                                balance(afterReply, pos.turn) - balance(next, pos.turn),
                                loss,
                            );
                        }
                    }
                    const safeFlights = queenEscapes.filter(
                        (item) => item.directTakers.length === 0,
                    );
                    return {
                        uci: makeUci(reply),
                        san: makeSan(root.after, reply),
                        rearCaptures,
                        queenFlightCount: safeFlights.length,
                        queenFlightExample: safeFlights[0] ?? null,
                    };
                });
            observations.push({
                kind,
                reflected,
                fen,
                rootReplyCount: legalMoves(root.after).length,
                proof,
                frontDepartures,
                classification: classifyPositionTacticalMotifs({
                    fen,
                    pvUci: hypotheses.line.map(m),
                }),
            });
        }
    });
    test(`reversed target recapture versus queen recovery reflected=${reflected}`, () => {
        const pos = position(original);
        for (const recapture of ["d6e5", "d6b6"]) {
            const line = [m("g7e5"), m(recapture)];
            const step = replayTacticalLine(original, line)[1];
            expect(step).toBeDefined();
            const taken = recapture === "d6e5" ? 330 : 900;
            expect(step.capture).toBe(taken);
            const proof = bounded(step, [], [step.move.to], taken);
            const recovery = bounded(step, [], [step.move.to], 90);
            expect(proof.gain).toBe(recapture === "d6e5" ? 330 : null);
            observations.push({
                kind: "reversed-order",
                reflected,
                fen: original,
                line,
                after: makeFen(step.after.toSetup()),
                materialForOriginalSide: balance(step.after, pos.turn) - balance(pos, pos.turn),
                replyCount: legalMoves(step.after).length,
                requestedCapturedValue: proof,
                minimum90: recovery,
            });
        }
    });
    test(`removal needs both the actual capturer and loss of the sole guard reflected=${reflected}`, () => {
        for (const kind of ["original", "missing-g7-bishop", "additional-f4-guard"]) {
            const pos = position(original);
            if (kind === "missing-g7-bishop") pos.board.take(s("g7"));
            if (kind === "additional-f4-guard")
                pos.board.set(s("f4"), {
                    color: pos.turn === "black" ? "white" : "black",
                    role: "pawn",
                });
            const fen = makeFen(pos.toSetup());
            expect(makeFen(position(fen).toSetup())).toBe(fen);
            const root = replayTacticalLine(fen, [m("b6d6")])[0];
            const accepted = play(root.after, m("d1d6"));
            const proof = bounded(root, [s("e5")], [s("g7"), s("d6")], 320);
            expect(proof.gain).toBe(kind === "original" ? 320 : null);
            const withoutGuard = pos.clone();
            withoutGuard.board.take(s("d6"));
            const capture = parseUci(m("g7e5"))!;
            const captures = legalMoves(accepted)
                .filter((move) => move.to === s("e5"))
                .map(makeUci);
            if (kind === "missing-g7-bishop") assert.deepEqual(captures, []);
            else {
                assert.ok("from" in capture);
                assert.equal(tacticalExchangeGain(pos, capture), -10);
                assert.equal(
                    tacticalExchangeGain(withoutGuard, capture),
                    kind === "original" ? 320 : -10,
                );
                const taken = play(withoutGuard, capture);
                assert.equal(taken.isLegal(parseUci(m("f4e5"))!), kind === "additional-f4-guard");
            }
            observations.push({
                kind: "guard-contrast",
                contrast: kind,
                reflected,
                fen,
                proof,
                acceptedTargetCaptures: captures,
            });
        }
    });
}
test("retain bounded evidence without asserting provisional causal labels", () => {
    expect(observations).toHaveLength(16);
    expect(hashes()).toEqual(initialHashes);
    if (process.env.EPYOT_CAUSAL_REPORT)
        writeFileSync(
            process.env.EPYOT_CAUSAL_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    scope: "Benchmark-only bounded legal/material adjudication, not whole-game proof or accuracy. Relocated boards are counterfactual positions, not legal variations.",
                    sourceRef,
                    sourceHashes: initialHashes,
                    version: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
                    hypothesesSha256: createHash("sha256")
                        .update(
                            readFileSync(
                                "benchmarks/tactical-relevance/epyot-causal-hypotheses.json",
                            ),
                        )
                        .digest("hex"),
                    observations,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});
