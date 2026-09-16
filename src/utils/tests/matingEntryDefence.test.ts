import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveCapturableMatingEntryDefence,
    replayTacticalLine,
    proveQuietMateThreat,
    tacticalExchangeGain,
    type MateAvoidanceStrategy,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { matingEntryDefence, poisonedMatingEntries } from "./fixtures/matingEntryDefence";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

function verify(strategy: MateAvoidanceStrategy) {
    const seen = new Set<string>();
    const walk = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        const node = strategy.nodes[id];
        assert(node);
        const pos = Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
        assert(!pos.isCheckmate() || pos.turn === strategy.attacker);
        if (pos.isEnd() || node.remaining === 0) return;
        const moves = [...pos.allDests()].flatMap(([from, dests]) =>
            [...dests].flatMap((to) =>
                pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                    ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) => ({
                          from,
                          to,
                          promotion,
                      }))
                    : [{ from, to }],
            ),
        );
        if (pos.turn === strategy.attacker && node.remaining === 1) {
            // Deliberately do not reuse the production check nomination helper.
            for (const move of moves) {
                const next = pos.clone();
                next.play(move);
                assert(!next.isCheckmate());
            }
            return;
        }
        assert(node.children?.length);
        if (pos.turn === strategy.attacker)
            assert.deepEqual(node.children.map((c) => c.move).sort(), moves.map(makeUci).sort());
        else assert.equal(node.children.length, 1);
        for (const child of node.children) {
            const move = parseUci(child.move)!;
            assert(pos.isLegal(move));
            const next = pos.clone();
            next.play(move);
            assert.equal(strategy.nodes[child.next]?.fen, makeFen(next.toSetup()));
            assert.equal(
                strategy.nodes[child.next]?.remaining,
                node.remaining - Number(pos.turn === strategy.attacker),
            );
            walk(child.next);
        }
    };
    walk(strategy.start);
    assert.equal(seen.size, Object.keys(strategy.nodes).length);
    return seen.size;
}

function reflectedInput(reflected: boolean) {
    const move = (m: string) => (reflected ? reflectMixedForkMove(m) : m);
    return {
        ...matingEntryDefence,
        fen: reflected ? reflectMixedForkFen(matingEntryDefence.fen) : matingEntryDefence.fen,
        playedMoveUci: move(matingEntryDefence.playedMoveUci),
        bestMoveUci: move(matingEntryDefence.bestMoveUci),
        pvUci: matingEntryDefence.pvUci.map(move),
        refutationUci: matingEntryDefence.refutationUci.map(move),
    };
}

test.each([false, true])(
    "a guarding knight refutes the same mating entry: reflected=%s",
    (reflected) => {
        const input = reflectedInput(reflected);
        const step = replayTacticalLine(input.fen, [input.bestMoveUci, input.refutationUci[0]])[1];
        expect(step.after.isCheck()).toBe(true);
        const proof = proveCapturableMatingEntryDefence(step, 4, 32768, true);
        assert(proof?.strategy);
        expect(proof.move).toBe(reflected ? "c6e7" : "c3e2");
        expect(proof.visits).toBeLessThanOrEqual(32768);
        expect(verify(proof.strategy)).toBeGreaterThan(100);
        const incomplete = structuredClone(proof.strategy);
        incomplete.nodes[incomplete.start].children!.pop();
        assert.throws(() => verify(incomplete), assert.AssertionError);
        expect(proveCapturableMatingEntryDefence(step, 4, proof.visits - 1)).toBeNull();
        expect(proveCapturableMatingEntryDefence(step, 4, proof.visits)?.move).toBe(proof.move);
        const result = classifyMistakeReviewMotifs(input);
        expect(result.allowedMotifs[0]).toMatchObject({ id: "mateIn4", comparison: "prevented" });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("longer or different attacks");
        expect(buildMistakeReviewTacticalExplanation(result)?.source).toBe("allowed");
        const same = classifyMistakeReviewMotifs({
            ...input,
            bestMoveUci: input.playedMoveUci,
            pvUci: [input.playedMoveUci, ...input.refutationUci],
        });
        expect(same.allowedMotifs[0]?.comparison).toBe("persists");
    },
);

test.each(poisonedMatingEntries)("capturing the entry is not safety: $id", (row) => {
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const moves = [row.move, row.capture, ...row.mate].map((m) =>
            reflected ? reflectMixedForkMove(m) : m,
        );
        const steps = replayTacticalLine(fen, moves);
        expect(steps).toHaveLength(moves.length);
        expect(steps.at(-1)!.after.isCheckmate()).toBe(true);
        expect(
            tacticalExchangeGain(steps[1].before, steps[1].move) - steps[0].capture,
        ).toBeGreaterThanOrEqual(90);
        if (row.id.includes("quiet")) {
            assert.equal(steps[2].after.isCheck(), false);
            assert(proveQuietMateThreat(steps[2]));
            // Avoiding a shorter mate window is not a claim of general safety:
            // the verified quiet continuation still mates one move later.
            const shorter = proveCapturableMatingEntryDefence(steps[0], 2, 32768, true);
            assert(shorter?.strategy);
            verify(shorter.strategy);
        }
        expect(proveCapturableMatingEntryDefence(steps[0], row.distance)).toBeNull();
    }
});

test("missing capture, invalid horizon or exhausted budget cannot prove prevention", () => {
    const input = reflectedInput(false);
    const actual = replayTacticalLine(input.fen, [input.playedMoveUci, input.refutationUci[0]])[1];
    expect(proveCapturableMatingEntryDefence(actual, 4)).toBeNull();
    const step = replayTacticalLine(input.fen, [input.bestMoveUci, input.refutationUci[0]])[1];
    for (const value of [-1, 0, 1.5, NaN, Infinity])
        expect(proveCapturableMatingEntryDefence(step, 4, value)).toBeNull();
    for (const value of [-1, 0, 1, 1.5, 5, NaN, Infinity])
        expect(proveCapturableMatingEntryDefence(step, value)).toBeNull();
    expect(proveCapturableMatingEntryDefence(step, 4, 1)).toBeNull();
});

test.each([false, true])(
    "a different slower forced mate is still existing danger: reflected=%s",
    (reflected) => {
        const fen = "7k/7p/5KQ1/8/8/8/8/8 b - - 0 1";
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const result = classifyMistakeReviewMotifs({
            fen: reflected ? reflectMixedForkFen(fen) : fen,
            playedMoveUci: move("h7h6"),
            bestMoveUci: move("h7h5"),
            pvUci: ["h7h5", "g6h6", "h8g8", "h6g7"].map(move),
            refutationUci: [move("g6g7")],
        });
        expect(result.allowedMotifs[0]).toMatchObject({ id: "mateIn1", comparison: "persists" });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("within 2 moves");
        expect(result.allowedMotifs[0].comparisonEvidence).toContain(
            "does not remove the forced-mate outcome",
        );
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
            "Tactical danger in the position",
        );
    },
);

test("fresh engine probes match the current defence witnesses and poisoned captures", () => {
    const receipt = JSON.parse(
        readFileSync(
            "benchmarks/tactical-relevance/mating-entry-defence-stockfish-18.json",
            "utf8",
        ),
    );
    assert.equal(receipt.completed, 90);
    assert.equal(receipt.searches.length, 90);
    const used = new Set<string>();
    const check = (id: string, fen: string, move?: string) => {
        const row = receipt.searches.find((r: any) => r.id === id);
        assert(row, `Missing current witness ${id}`);
        assert.equal(row.fen, fen);
        assert.equal(row.searchMove, move);
        assert.equal(row.lines[0].depth, 16);
        if (move) assert.equal(row.lines[0].pvUci[0], move);
        used.add(id);
        return row.lines[0];
    };
    for (const reflected of [false, true]) {
        const input = reflectedInput(reflected);
        const step = replayTacticalLine(input.fen, [input.bestMoveUci, input.refutationUci[0]])[1];
        const proof = proveCapturableMatingEntryDefence(step, 4, 32768, true);
        assert(proof?.strategy);
        const prefix = `constructed:${reflected}`;
        assert(check(`${prefix}:entry`, makeFen(step.before.toSetup()), step.uci).cp < 0);
        assert(check(`${prefix}:capture`, makeFen(step.after.toSetup()), proof.move).cp > 0);
        const strategy = proof.strategy;
        const first = strategy.nodes[strategy.start];
        assert(check(`${prefix}:after-capture`, first.fen).cp < 0);
        for (const child of first.children!) {
            const node = strategy.nodes[child.next];
            assert(node.children?.length);
            const line = check(`${prefix}:answer:${child.move}`, node.fen, node.children[0].move);
            // A finite avoidance witness need not be engine-best or preserve
            // all material. It must not contradict the certified mate window.
            assert(!(line.mate < 0 && Math.abs(line.mate) <= node.remaining));
        }
        for (const row of poisonedMatingEntries) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const moves = [row.move, row.capture, ...row.mate].map((m) =>
                reflected ? reflectMixedForkMove(m) : m,
            );
            const steps = replayTacticalLine(fen, moves);
            for (let i = 0; i < 3; i++) {
                const line = check(
                    `${row.id}:${reflected}:prefix${i}`,
                    makeFen(steps[i].before.toSetup()),
                    moves[i],
                );
                if (i === 1) assert(line.mate < 0);
                if (i === 2) assert(line.mate > 0);
            }
        }
    }
    assert.equal(used.size, receipt.completed);
});

test.skipIf(!process.env.TACTICAL_MATE_DEFENCE_REPORT)(
    "export defensive strategies for independent legal replay",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const inputs: { id: string; fen: string; bestMoveUci: string; refutationUci: string[] }[] =
            [false, true].map((reflected) => ({
                id: `constructed:${reflected}`,
                ...reflectedInput(reflected),
            }));
        if (process.env.TACTICAL_MATE_DEFENCE_OWNER_REPLAY) {
            const report = JSON.parse(
                readFileSync(process.env.TACTICAL_MATE_DEFENCE_OWNER_REPLAY, "utf8"),
            );
            const row = report.results.find(
                (r: any) => r.id === process.env.TACTICAL_MATE_DEFENCE_OWNER_CASE,
            );
            assert(row, "Supply an exact owner case ID");
            inputs.push({
                id: "owner",
                fen: row.fen,
                bestMoveUci: row.before[0].pvUci[0],
                refutationUci: row.after[0].pvUci,
            });
        }
        const cases = inputs.map((input) => {
            const step = replayTacticalLine(input.fen, [
                input.bestMoveUci,
                input.refutationUci[0],
            ])[1];
            const proof = proveCapturableMatingEntryDefence(step, 4, 32768, true);
            assert(proof?.strategy);
            return {
                id: input.id,
                rootFen: makeFen(step.before.toSetup()),
                entry: step.uci,
                proof,
                verifiedNodes: verify(proof.strategy),
            };
        });
        if (process.env.TACTICAL_MATE_DEFENCE_PYTHON) {
            const result = spawnSync(
                process.env.TACTICAL_MATE_DEFENCE_PYTHON,
                ["scripts/benchmarks/verify-mate-avoidance.py"],
                { input: JSON.stringify({ cases }), encoding: "utf8", windowsHide: true },
            );
            assert.equal(result.status, 0, result.stderr);
            console.log(result.stdout);
        }
        writeFileSync(
            privateReportPath(process.env.TACTICAL_MATE_DEFENCE_REPORT!),
            JSON.stringify({ cases }, null, 2),
            { flag: "wx" },
        );
    },
);
