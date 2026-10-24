import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseSquare, parseUci } from "chessops/util";
import { legalMoves, play, position, balance, captureValue } from "./ltbye-intermediate-audit.mjs";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork";
import {
    proveDefenderCombination,
    replayTacticalLine,
    intermediateCaptureProof,
} from "../../src/utils/tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";

const selection = JSON.parse(
    readFileSync(
        "benchmarks/tactical-relevance/quiet-intermediate-development-selection.json",
        "utf8",
    ),
);
const hypotheses = JSON.parse(
    readFileSync(
        "benchmarks/tactical-relevance/quiet-intermediate-development-hypotheses.json",
        "utf8",
    ),
);
const results: unknown[] = [],
    controls: unknown[] = [];
const sourceRef = process.env.RARE_CAUSAL_COHORT_V2_REF ?? "working-source";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const readSource = (file: string) =>
    sourceRef === "working-source"
        ? readFileSync(`src/utils/tacticalMotifs/${file}`)
        : execFileSync("git", [
              "-c",
              "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
              "show",
              `${sourceRef}:src/utils/tacticalMotifs/${file}`,
          ]);
const watchedSources = ["causalTactics.ts", "mistakeReviewAdapter.ts"];
if (readSource("causalTactics.ts").includes("./quietIntermediateCapture"))
    watchedSources.push("quietIntermediateCapture.ts");
const sourceHashes = () =>
    Object.fromEntries(watchedSources.map((file) => [file, hash(readSource(file))]));
const before = sourceHashes();
function kernel(
    step: ReturnType<typeof replayTacticalLine>[number],
    targets: number[],
    capturers: number[],
    minimum: number,
    budget: { nodes: number },
) {
    const leaves: any[] = [],
        start = budget.nodes;
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
        undefined,
        true,
        1,
    );
    if (gain !== null) {
        const actual = [...new Set(leaves.map((leaf) => leaf.lineUci[0]))].sort();
        assert.deepEqual(actual, legalMoves(step.after).map(makeUci).sort());
        for (const leaf of leaves) {
            let pos = step.after;
            for (const uci of leaf.lineUci.slice(0, -1)) pos = play(pos, uci);
            assert.equal(makeFen(pos.toSetup()), leaf.fen);
            assert.equal(
                balance(pos, step.before.turn) - balance(step.before, step.before.turn),
                leaf.balance,
            );
            assert.equal(pos.isLegal(parseUci(leaf.moveUci)!), true);
        }
    }
    return { gain, visits: start - budget.nodes, exhausted: budget.nodes < 0, leaves };
}
for (const row of selection.cases)
    for (const reflected of [false, true]) {
        test(`${row.id} independent legal coverage and bounded contrast reflected=${reflected}`, () => {
            const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
            const original = reflected ? reflectMixedForkFen(row.sourceFen) : row.sourceFen;
            const before = position(original),
                pos = play(before, m(row.precedingMove)),
                fen = makeFen(pos.toSetup());
            const hypothesis = hypotheses.cases.find((item: any) => item.id === row.id);
            const root = replayTacticalLine(fen, [m(row.bestLine[0])])[0];
            expect(root.after.isCheck()).toBe(false);
            expect(root.capture).toBe(900);
            expect(captureValue(before, parseUci(m(row.precedingMove))!)).toBe(100);
            let end = pos;
            for (const move of row.bestLine) end = play(end, m(move));
            const sourceMaterial = balance(end, pos.turn) - balance(pos, pos.turn);
            expect(sourceMaterial).toBe(320);
            const deferred = parseUci(m(hypothesis.deferred))!;
            expect("from" in deferred).toBe(true);
            if (!("from" in deferred)) throw Error("Unexpected drop");
            expect(pos.isLegal(deferred)).toBe(true);
            const reversed = replayTacticalLine(fen, [
                m(hypothesis.deferred),
                m(hypothesis.reversedRecoveryCandidate),
            ])[1];
            expect(reversed.capture).toBe(900);
            const budget = { nodes: 16384 };
            const forward = kernel(root, [deferred.to], [deferred.from, root.move.to], 90, budget);
            const reverse = kernel(reversed, [], [reversed.move.to], 90, budget);
            const replies = legalMoves(root.after).map((reply) => ({
                uci: makeUci(reply),
                san: makeSan(root.after, reply),
                check: play(root.after, reply).isCheck(),
            }));
            const recaptures = legalMoves(reversed.after)
                .filter((move) => move.to === reversed.move.to)
                .map((move) => ({
                    uci: makeUci(move),
                    san: makeSan(reversed.after, move),
                    capture: captureValue(reversed.after, move),
                }));
            if (row.id === "lichess:EpYOT") {
                const returned = play(reversed.after, m("a7b6"));
                assert.equal(balance(returned, pos.turn) - balance(pos, pos.turn), 320);
                assert.equal(
                    recaptures.some((item) => item.uci === m("a7b6")),
                    true,
                );
            } else assert.deepEqual(recaptures, []);
            const rootOnly = classifyPositionTacticalMotifs({ fen, pvUci: [root.uci] });
            const full = classifyPositionTacticalMotifs({
                fen,
                pvUci: row.bestLine.map(m),
                previousFen: original,
                previousMoveUci: m(row.precedingMove),
            });
            if (
                row.id === "lichess:Qq0JW" &&
                !/adapter-173$/.test(MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION)
            ) {
                assert.equal(rootOnly.motifs[0]?.id, "intermezzo");
                assert.equal(rootOnly.motifs[0]?.value, 320);
                assert.equal(full.motifs[0]?.id, "intermezzo");
                assert.equal(full.motifs[0]?.value, 220);
                const payoff = full.timeline?.filter((motif) => motif.ply === 3);
                assert.ok(payoff?.length);
                assert.equal(
                    payoff.some(
                        (motif) =>
                            motif.id === "hangingPiece" &&
                            typeof motif.value === "number" &&
                            motif.value > 0,
                    ),
                    false,
                );
            }
            results.push({
                id: row.id,
                reflected,
                fen,
                root: root.uci,
                deferred: m(hypothesis.deferred),
                reverseRecovery: m(hypothesis.reversedRecoveryCandidate),
                sourceMaterial,
                priorPawnDebt: 100,
                rootReplies: replies,
                reverseImmediateRecaptures: recaptures,
                forward,
                reverse,
                totalVisits: 16384 - budget.nodes,
                existingAdmission: intermediateCaptureProof(root),
                rootOnly,
                full,
            });
        });
    }
for (const reflected of [false, true]) {
    test(`independent hanging capture is not an extra causal gain reflected=${reflected}`, () => {
        const base = "7k/8/4b3/3B4/8/8/2Q5/2b3K1 w - - 0 1";
        const fen = reflected ? reflectMixedForkFen(base) : base;
        const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const root = replayTacticalLine(fen, [m("d5e6")])[0];
        expect(root.after.isCheck()).toBe(false);
        const take = legalMoves(root.after).filter((move) => move.to === root.move.to);
        expect(take).toEqual([]);
        expect(balance(root.after, root.before.turn) - balance(root.before, root.before.turn)).toBe(
            330,
        );
        const reverse = replayTacticalLine(fen, [m("c2c1"), m("e6d5")])[1];
        const s = (square: string) =>
            parseSquare(reflected ? reflectMixedForkMove(square) : square)!;
        const budget = { nodes: 16384 };
        const forward = kernel(root, [s("c1")], [s("c2"), s("e6")], 90, budget);
        const reversed = kernel(reverse, [], [s("d5")], 90, budget);
        controls.push({
            kind: "free-root-capture",
            reflected,
            fen,
            root: root.uci,
            rootImmediateMaterial: 330,
            forward,
            reversed,
            rawComparison:
                forward.gain === null || reversed.gain === null
                    ? null
                    : forward.gain - (330 - reversed.gain),
            rootOnly: classifyPositionTacticalMotifs({ fen, pvUci: [root.uci] }),
        });
    });
}
test("retain output without converting unknown nominations to ground truth", () => {
    expect(results).toHaveLength(4);
    expect(controls).toHaveLength(2);
    expect(sourceHashes()).toEqual(before);
    if (process.env.QUIET_INTERMEDIATE_REPORT)
        writeFileSync(
            process.env.QUIET_INTERMEDIATE_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    scope: "Two output-blind public development nominations and one synthetic adverse control, both colours; shared bounded kernel outputs are not independent all-game proofs or accuracy scores.",
                    sourceRef,
                    sourceCoreSha256: before["causalTactics.ts"],
                    sourceHashes: before,
                    version: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
                    selectionSha256: hash(
                        readFileSync(
                            "benchmarks/tactical-relevance/quiet-intermediate-development-selection.json",
                        ),
                    ),
                    hypothesesSha256: hash(
                        readFileSync(
                            "benchmarks/tactical-relevance/quiet-intermediate-development-hypotheses.json",
                        ),
                    ),
                    results,
                    controls,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});
