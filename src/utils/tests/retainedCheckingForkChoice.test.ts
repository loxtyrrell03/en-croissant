import { expect, test } from "vitest";
import { proveImmediateFork, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    isImmediateTacticalLesson,
    isRetainedForkChoice,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const checkingFork = "3k3r/pppp4/3N3N/8/2B5/8/5PPP/6K1 w - - 0 1";
const protectedKnight = "3k3r/pp1p4/3N3N/2P5/2B5/8/5PPP/6K1 w - - 0 1";

for (const reflected of [false, true]) {
    const move = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
    const position = (fen: string) => reflected ? reflectMixedForkFen(fen) : fen;
    for (const fenSource of [checkingFork, protectedKnight]) for (const reverse of [false, true]) {
        test(`same checked king and rook are retained, not equal outcomes: reflected=${reflected}, protected=${fenSource === protectedKnight}, reverse=${reverse}`, () => {
            const fen = position(fenSource);
            const best = move(reverse ? "h6f7" : "d6f7"), played = move(reverse ? "d6f7" : "h6f7");
            const roots = [best, played].map(uci => replayTacticalLine(fen, [uci])[0]);
            const proofs = roots.map(root => proveImmediateFork(root));
            for (const root of roots) {
                expect(root.after.isCheck()).toBe(true);
                expect([...root.after.ctx().checkers]).toEqual([root.move.to]);
            }
            expect(proofs.every(Boolean)).toBe(true);
            expect(proofs[0]!.targets).toEqual(proofs[1]!.targets);
            expect(proofs[0]!.targets).toContain(roots[0].before.board.kingOf(roots[0].after.turn));
            // This is an actual separate loss, not a difference inferred by
            // subtracting the proof's local lower bounds. The pawn can also
            // take Nd6 in the original case; removing it and protecting d6
            // removes both immediate capture resources in the control.
            const exposed = replayTacticalLine(fen, [move("h6f7"), move("d8e7"), move("f7h8"), move("e7d6")]);
            expect(exposed.length).toBe(fenSource === checkingFork ? 4 : 3);
            const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best,
                playedMoveUci: played, pvUci: [best] });
            const explanation = buildMistakeReviewTacticalExplanation(result)!;
            expect(explanation.title).toBe("Both moves create this fork");
            expect(isRetainedForkChoice(explanation.primary)).toBe(true);
            expect(isImmediateTacticalLesson(explanation.primary)).toBe(false);
            expect(explanation.text).toContain("king on");
            expect(explanation.text).toContain("rook on");
            expect(explanation.text).toContain("does not establish that the moves are equally good");
            expect(explanation.secondary).toBeUndefined();
            const rootsInTimeline = result.missedTimeline?.filter(m => m.ply === 1 && m.id === "fork");
            expect(rootsInTimeline).toHaveLength(1);
            expect(rootsInTimeline?.every(isRetainedForkChoice)).toBe(true);
        });
    }

    test(`a complete checking line has the same neutral root comparison: reflected=${reflected}`, () => {
        const fen = position(checkingFork), best = move("d6f7"), played = move("h6f7");
        const pvUci = [best, move("d8e7"), move("f7h8")];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played,
            pvUci, refutationUci: [move("d8e7")] });
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe("Both moves create this fork");
    });

    test(`a different original rook is not the retained checking fork: reflected=${reflected}`, () => {
        const fen = position("1r1k3r/p1p5/3N3N/4N3/2B5/8/5PPP/6K1 w - - 0 1");
        const best = move("d6f7"), played = move("e5c6");
        const proofs = [best, played].map(uci => proveImmediateFork(replayTacticalLine(fen, [uci])[0]));
        expect(proofs.every(Boolean)).toBe(true);
        expect(proofs[0]!.targets).not.toEqual(proofs[1]!.targets);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
        expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(false);
        expect(result.missedMotifs.some(m => m.id === "fork")).toBe(true);
    });

    test(`actually missing a checking fork retains its lesson: reflected=${reflected}`, () => {
        const fen = position(checkingFork), best = move("d6f7"), played = move("g1f1");
        expect(replayTacticalLine(fen, [played])).toHaveLength(1);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
        expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
            title: "What you missed: Fork", primary: { id: "fork", source: "missed" },
        });
    });

    test(`a discovered second check is a different mechanism: reflected=${reflected}`, () => {
        const fen = position("3k3r/ppp5/3N3N/8/2B5/8/5PPP/3R2K1 w - - 0 1");
        const best = move("d6f7"), played = move("h6f7");
        const roots = [best, played].map(uci => replayTacticalLine(fen, [uci])[0]);
        expect(roots.map(root => [...root.after.ctx().checkers].length)).toEqual([2, 1]);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
        expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(false);
        // Preserve the separate check evidence; this is not an assertion that
        // every existing blame label outside this comparison is adjudicated.
        expect(result.missedMotifs.length).toBeGreaterThan(0);
    });
}
