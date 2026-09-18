import assert from "node:assert/strict";
import { describe, expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import { provePerpetualCheck, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs, classifyMistakeReviewMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Constructed five-piece positions. The king has genuinely different escape
// routes; a single repeating engine line would not establish this resource.
const positions = [
    { fen: "Q7/8/8/8/3k4/8/q4R2/4K3 b - - 0 1", move: "a2b1" },
    { fen: "7Q/8/8/8/4k3/8/2R4q/3K4 b - - 0 1", move: "h2g1" },
];

describe.each(positions)("bounded saving checks from $move", ({ fen, move }) => {
    test.each([false, true])("root-only proof covers every defence, reflected=%s", reflected => {
        const rootFen = reflected ? reflectMixedForkFen(fen) : fen;
        const rootMove = reflected ? reflectMixedForkMove(move) : move;
        const steps = replayTacticalLine(rootFen, [rootMove]);
        const budget = { nodes: 4096 };
        const proof = provePerpetualCheck(steps, 4096, { budget, captureStrategy: true });
        expect(proof).not.toBeNull();
        expect(budget.nodes).toBeGreaterThanOrEqual(0);
        let cycles = 0, replies = 0;
        const key = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
        const verify = (position: typeof steps[0]["after"], node: NonNullable<typeof proof>["strategy"],
            path: string[], depth: number) => {
            expect(node).toBeDefined();
            expect(node!.fen).toBe(makeFen(position.toSetup()));
            expect(position.isCheck()).toBe(true);
            expect(depth).toBeLessThanOrEqual(5);
            if ("terminal" in node!) {
                if (node.terminal === "mate") assert.ok(position.isCheckmate());
                else { assert.ok(path.includes(key(node.fen))); cycles++; }
                return;
            }
            expect(path).not.toContain(key(node!.fen));
            const legal = [...position.allDests()].flatMap(([from, tos]) =>
                [...tos].map(to => makeUci({ from, to })));
            expect(node!.replies.map(branch => branch.replyUci).sort()).toEqual(legal.sort());
            for (const branch of node!.replies) {
                const next = position.clone();
                expect(next.isLegal(parseUci(branch.replyUci)!)).toBe(true);
                next.play(parseUci(branch.replyUci)!);
                expect(next.isLegal(parseUci(branch.checkUci)!)).toBe(true);
                next.play(parseUci(branch.checkUci)!);
                replies++;
                verify(next, branch.next, [...path, key(node!.fen)], depth + 1);
            }
        };
        verify(steps[0].after, proof!.strategy, [], 0);
        expect(cycles).toBeGreaterThan(0);
        expect(replies).toBeGreaterThan(2);
        expect(provePerpetualCheck(steps)).not.toHaveProperty("strategy");
        expect(classifyPositionTacticalMotifs({ fen: rootFen, pvUci: [rootMove], rootCp: 0 }).motifs[0])
            .toMatchObject({ id: "perpetualCheck", value: 0, ply: 1 });
        const scan = buildLiveTacticalScan({ fen: rootFen, pvUci: [rootMove],
            depth: 16, engineName: "Regression" });
        expect(scan.labels[0]?.id).toBe("perpetualCheck");
        expect(scan.arrows).toHaveLength(2);
        expect(proof!.cycle.length).toBeGreaterThan(0);
    });
});

test("an interposing/capturing bishop refutes the cycle even with a supplied zero score", () => {
    const fen = positions[0].fen.replace("q4R2", "q1B2R2");
    const steps = replayTacticalLine(fen, ["a2b1", "c2b1"]);
    expect(steps).toHaveLength(2);
    expect(provePerpetualCheck(steps.slice(0, 1))).toBeNull();
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["a2b1"], rootCp: 0 }).motifs
        .some(m => m.id === "perpetualCheck")).toBe(false);
});

test("warm witnesses cannot bypass the shared allowance or manufacture a winning lesson", () => {
    const { fen, move } = positions[0];
    const steps = replayTacticalLine(fen, [move]);
    expect(provePerpetualCheck(steps)).not.toBeNull();
    for (const nodes of [0, 1, 10, 50]) {
        const budget = { nodes };
        expect(provePerpetualCheck(steps, 4096, { budget, captureStrategy: true })).toBeNull();
        expect(budget.nodes).toBeGreaterThanOrEqual(-1);
    }
    expect(classifyPositionTacticalMotifs({ fen, pvUci: [move], rootCp: 600 }).motifs
        .some(m => m.id === "perpetualCheck")).toBe(false);
});

test.each([false, true])("a missed drawing resource requires losing actual-play evidence, reflected=%s", reflected => {
    const original = positions[0];
    const fen = reflected ? reflectMixedForkFen(original.fen) : original.fen;
    const move = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
    const input = { fen, bestMoveUci: move(original.move), playedMoveUci: move("d4e3"),
        pvUci: [move(original.move)], refutationUci: [move("f2a2")], cpBefore: 0 };
    expect(replayTacticalLine(fen, [input.playedMoveUci, ...input.refutationUci])).toHaveLength(2);
    const side = reflected ? 1 : -1;
    for (const [cpAfter, cpLoss] of [[0, 0], [20 * side, 100], [-49 * side, 100],
        [undefined, 500], [NaN, 500], [-500 * side, 0]] as const) {
        const result = classifyMistakeReviewMotifs({ ...input, cpAfter, cpLoss });
        expect(result.missedMotifs.some(m => m.id === "perpetualCheck")).toBe(false);
        expect(result.missedTimeline?.some(m => m.id === "perpetualCheck")).toBe(false);
    }
    const actualLoss = classifyMistakeReviewMotifs({ ...input, cpAfter: -500 * side, cpLoss: 500 });
    expect(actualLoss.missedMotifs[0]).toMatchObject({ id: "perpetualCheck", value: 0 });
    expect(actualLoss.allowedMotifs[0]).toMatchObject({ id: "hangingPiece", value: 900 });
});
