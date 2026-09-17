import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveConnectedPin,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    connectedPinCase as battery,
    connectedPinControls as controls,
} from "./fixtures/connectedPin";

// Constructed rook/queen battery. A checking queen offer is not an escape
// from the new bishop pin, but requires an answer other than taking the rook.

test("a new pin accounts for checking counterplay and preserves both colours", () => {
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(battery.fen) : battery.fen;
        const move = reflected ? reflectMixedForkMove(battery.move) : battery.move;
        const root = replayTacticalLine(fen, [move])[0];
        expect(root).toBeDefined();
        const failures: string[] = [];
        const proof = proveConnectedPin(root, 32768, (failure) => failures.push(failure));
        assert.ok(proof, failures.join("; "));
        expect(proof!.gain).toBeGreaterThanOrEqual(100);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [move] }).motifs[0]?.id).toBe("pin");
    }
});

test.each(controls)("does not invent a connected material gain: $id", (row) => {
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const move = reflected ? reflectMixedForkMove(row.move) : row.move;
        const root = replayTacticalLine(fen, [move])[0];
        expect(root).toBeDefined();
        expect(proveConnectedPin(root)).toBeNull();
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: [move] }).motifs.some(
                (m) => m.id === "pin",
            ),
        ).toBe(false);
    }
});

test("invalid or exhausted budgets cannot use a cached pin certificate", () => {
    const root = replayTacticalLine(battery.fen, [battery.move])[0];
    expect(proveConnectedPin(root)).not.toBeNull();
    for (const limit of [0, -1, 1, NaN, Infinity, 1.5])
        expect(proveConnectedPin(root, limit)).toBeNull();
    expect(proveConnectedPin(root)).not.toBeNull();
});

test("a quiet pin cannot override an available fifty-move draw claim", () => {
    for (const reflected of [false, true]) {
        const fen = (reflected ? reflectMixedForkFen(battery.fen) : battery.fen).replace(
            " 0 1",
            " 99 1",
        );
        const move = reflected ? reflectMixedForkMove(battery.move) : battery.move;
        expect(proveConnectedPin(replayTacticalLine(fen, [move])[0])).toBeNull();
    }
});

test("current pin geometry does not draw a conditional later capture", () => {
    const scan = buildLiveTacticalScan({
        fen: battery.fen,
        pvUci: [battery.move],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.motifs.map((m) => m.id)).toEqual(["pin"]);
    expect(scan.motifs[0]).toMatchObject({
        value: 500,
        confidence: "high",
        verifiedCombination: true,
    });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["f7d5", "d5h1"]);
    expect(scan.labels[0].square).toBe("f3");
    expect(scan.arrows.every((a) => a.ply === 1)).toBe(true);
});

test("the missed saving pin remains a lesson without claiming a winning position", () => {
    for (const reflected of [false, true]) {
        const flip = (move: string) => (reflected ? reflectMixedForkMove(move) : move);
        const result = classifyMistakeReviewMotifs({
            fen: reflected ? reflectMixedForkFen(battery.fen) : battery.fen,
            bestMoveUci: flip(battery.move),
            playedMoveUci: flip("h8g8"),
            pvUci: [flip(battery.move)],
            refutationUci: [flip("h1h2")],
            cpBefore: 0,
            cpAfter: reflected ? -382 : 359,
            cpLoss: reflected ? 382 : 359,
        });
        expect(result.missedMotifs[0]).toMatchObject({ id: "pin", value: 500, ply: 1 });
        expect(buildMistakeReviewTacticalExplanation(result)?.source).toBe("missed");
    }
});

test.skipIf(!process.env.TACTICAL_CONNECTED_PIN_REPLAY)(
    "the real missed pin remains secondary to the queen loss",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_CONNECTED_PIN_REPLAY!, "utf8"));
        const row = report.results.find((r: any) => r.id === "recall:169947640250:ply25");
        expect(row).toBeDefined();
        const source = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: [row.before[0].pvUci[0]],
        });
        expect(source.motifs).toHaveLength(1);
        expect(source.motifs[0]).toMatchObject({ id: "pin", confidence: "high", value: 100 });
        const result = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: row.playedMoveUci,
            bestMoveUci: row.before[0].pvUci[0],
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            cpBefore: -row.before[0].cp,
            cpAfter: row.after[0].cp,
            cpLoss: row.before[0].cp + row.after[0].cp,
        });
        const explanation = buildMistakeReviewTacticalExplanation(result);
        expect(explanation?.primary.id).toBe("hangingPiece");
        expect(explanation?.secondary?.id).toBe("pin");
        expect(explanation?.secondary?.evidence).toContain("Kd2 permits Bxe2");
        const proof = proveConnectedPin(replayTacticalLine(row.fen, [row.before[0].pvUci[0]])[0]);
        expect(proof?.branches).toHaveLength(37);
        expect(proof?.branches.find((b) => b.reply === "Bxg4")).toMatchObject({
            kind: "countercapture",
            gain: 160,
        });
        const other = report.results.find((r: any) => r.id === "recall:170709695630:ply29");
        const continuation = classifyPositionTacticalMotifs({
            fen: other.fen,
            pvUci: other.before[1].pvUci,
        });
        expect(continuation.timeline).toContainEqual(
            expect.objectContaining({ id: "pin", ply: 3, value: 170, confidence: "high" }),
        );
        const intermediate = continuation.timeline?.find(
            (m) => m.id === "intermezzo" && m.ply === 5,
        );
        expect(intermediate).toBeDefined();
        expect(intermediate?.value).toBeUndefined();
        expect(intermediate?.evidence).toContain("already included");
    },
);

test.skipIf(!process.env.TACTICAL_CONNECTED_PIN_REPORT)(
    "record independent connected-pin decisions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CONNECTED_PIN_REPORT!);
        expect(existsSync(output)).toBe(false);
        const inputs = [battery, ...controls].flatMap((row) =>
            [false, true].map((reflected) => ({
                id: `${row.id}:${reflected ? "reflected" : "original"}`,
                fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
                move: reflected ? reflectMixedForkMove(row.move) : row.move,
                expected: row === battery,
            })),
        );
        if (process.env.TACTICAL_CONNECTED_PIN_OWNER_INPUT) {
            const original = JSON.parse(
                readFileSync(process.env.TACTICAL_CONNECTED_PIN_OWNER_INPUT, "utf8"),
            );
            inputs.push(
                { id: "owner-quiet-pin", fen: original.fen, move: original.root, expected: true },
                {
                    id: "owner-quiet-pin-reflected",
                    fen: reflectMixedForkFen(original.fen),
                    move: reflectMixedForkMove(original.root),
                    expected: true,
                },
            );
        }
        if (process.env.TACTICAL_CONNECTED_PIN_REPLAY) {
            const replay = JSON.parse(
                readFileSync(process.env.TACTICAL_CONNECTED_PIN_REPLAY, "utf8"),
            );
            for (const selected of [
                { id: "recall:170709695630:ply29", variation: 1, ply: 3 },
                { id: "recall:169947640250:ply38", variation: 2, ply: 2 },
            ]) {
                const row = replay.results.find((r: any) => r.id === selected.id);
                assert.ok(row);
                const step = replayTacticalLine(row.fen, row.before[selected.variation].pvUci)[
                    selected.ply - 1
                ];
                assert.ok(step);
                inputs.push({
                    id: `owner-secondary:${selected.id}`,
                    fen: makeFen(step.before.toSetup()),
                    move: step.uci,
                    expected: true,
                });
            }
        }
        const probes: { id: string; fen: string; searchMove?: string }[] = [];
        const cases = inputs.map((row) => {
            const root = replayTacticalLine(row.fen, [row.move])[0];
            const failures: string[] = [];
            const proof = proveConnectedPin(root, 32768, (failure) => failures.push(failure));
            if (row.expected) assert.ok(proof, failures.join("; "));
            else assert.equal(proof, null);
            const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.move] });
            probes.push(
                { id: `${row.id}:best`, fen: row.fen },
                { id: `${row.id}:held`, fen: row.fen, searchMove: row.move },
            );
            if (!proof)
                return {
                    ...row,
                    proof,
                    result,
                    board: tacticalBoardEvidence(row.fen, [row.move], result.motifs[0]),
                    failures,
                };
            const replies = [...root.after.allDests()].flatMap(([from, dests]) =>
                [...dests].map((to) => makeUci({ from, to })),
            );
            expect(proof!.branches.map((b) => b.replyUci).sort()).toEqual(replies.sort());
            for (const branch of proof!.branches) {
                const pos = root.after.clone();
                const reply = parseSan(pos, branch.reply);
                expect(reply).toBeDefined();
                pos.play(reply!);
                const answer = parseSan(pos, branch.answer);
                expect(answer).toBeDefined();
                expect(makeUci(answer!)).toBe(branch.answerUci);
                probes.push({
                    id: `${row.id}:reply:${branch.replyUci}:held`,
                    fen: makeFen(pos.toSetup()),
                    searchMove: branch.answerUci,
                });
                for (const [index, leaf] of (branch.collection ?? []).entries()) {
                    probes.push({
                        id: `${row.id}:reply:${branch.replyUci}:leaf:${index}`,
                        fen: leaf.fen,
                        searchMove: leaf.moveUci,
                    });
                    for (const [j, prep] of (leaf.preparations ?? []).entries())
                        probes.push({
                            id: `${row.id}:reply:${branch.replyUci}:leaf:${index}:prep:${j}`,
                            fen: prep.fen,
                            searchMove: prep.moveUci,
                        });
                    for (const [j, check] of (leaf.counterchecks ?? []).entries())
                        probes.push({
                            id: `${row.id}:reply:${branch.replyUci}:leaf:${index}:countercheck:${j}`,
                            fen: check.fen,
                            searchMove: check.moveUci,
                        });
                }
            }
            return {
                ...row,
                proof,
                result,
                board: tacticalBoardEvidence(row.fen, [row.move], result.motifs[0]),
            };
        });
        for (const reflected of [false, true]) {
            const fen = reflected ? reflectMixedForkFen(battery.fen) : battery.fen;
            const move = reflected ? reflectMixedForkMove("h8g8") : "h8g8";
            const step = replayTacticalLine(fen, [move])[0];
            expect(step).toBeDefined();
            probes.push(
                { id: `review:${reflected}:played`, fen, searchMove: move },
                { id: `review:${reflected}:after`, fen: makeFen(step.after.toSetup()) },
            );
        }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Selected connected-pin decisions, not independent puzzles or broad accuracy.",
                    samplePath: process.env.TACTICAL_CONNECTED_PIN_OWNER_INPUT ?? output,
                    cases,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    120000,
);
