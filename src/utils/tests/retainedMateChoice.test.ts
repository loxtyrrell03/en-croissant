import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const knightMate = "3q2rk/6pp/7N/6N1/8/8/5PPP/6K1 w - - 0 1";
const differentMate = "3q2rk/6pp/8/6N1/8/8/5PP1/6KR w - - 0 1";
for (const reflected of [false, true]) {
    const move = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
    const position = (fen: string) => reflected ? reflectMixedForkFen(fen) : fen;
    for (const rook of [false, true]) {
        test(`actual mate cannot miss a named mate: reflected=${reflected}, rook=${rook}`, () => {
            const fen = position(rook ? differentMate : knightMate);
            const best = move("g5f7"), played = move(rook ? "h1h7" : "h6f7");
            for (const candidate of [best, played]) {
                const line = replayTacticalLine(fen, [candidate]);
                expect(line).toHaveLength(1);
                expect(line[0].after.isCheckmate()).toBe(true);
            }
            const bestPattern = classifyPositionTacticalMotifs({ fen, pvUci: [best] }).motifs[0];
            const playedPattern = classifyPositionTacticalMotifs({ fen, pvUci: [played] }).motifs[0];
            expect(bestPattern.id).toBe("smotheredMate");
            expect(playedPattern.id === bestPattern.id).toBe(!rook);
            const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
            expect(result.missedMotifs).toEqual([]);
            expect(result.allowedMotifs).toEqual([]);
            expect(result.missedTimeline).toEqual([]);
            expect(buildMistakeReviewTacticalExplanation(result)).toBeNull();
        });
    }

    test(`a genuine missed named mate is preserved: reflected=${reflected}`, () => {
        const fen = position(knightMate), best = move("g5f7"), played = move("h6f5");
        const escape = [played, move("h7h6"), best, move("h8h7")];
        const replay = replayTacticalLine(fen, escape);
        expect(replay).toHaveLength(escape.length);
        expect(replay[0].after.isCheckmate()).toBe(false);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played,
            pvUci: [best], refutationUci: escape.slice(1) });
        expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
            id: "smotheredMate", source: "missed", ply: 1,
        });
    });

    test(`invalid played evidence cannot inherit a mating win: reflected=${reflected}`, () => {
        const fen = position(knightMate), best = move("g5f7"), played = move("g5g7");
        expect(replayTacticalLine(fen, [played])).toHaveLength(0);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
        expect(result.missedMotifs.some(m => m.id === "smotheredMate")).toBe(true);
    });

    test(`a named pattern later in a legal line is not actual played checkmate: reflected=${reflected}`, () => {
        const fen = position("rr6/p3p2k/3pNpp1/1pp5/2q1P3/5R2/P2Q2PP/6K1 w - - 0 27");
        const best = move("d2h6"), played = move("h2h4");
        const pvUci = [best, move("h7h6"), move("f3h3")];
        const replay = replayTacticalLine(fen, pvUci);
        expect(replay).toHaveLength(3);
        expect(replay[0].after.isCheckmate()).toBe(false);
        expect(replay[2].after.isCheckmate()).toBe(true);
        expect(replayTacticalLine(fen, [played])[0].after.isCheckmate()).toBe(false);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played,
            pvUci, refutationUci: [move("h7g8")] });
        expect(result.missedMotifs.length).toBeGreaterThan(0);
        expect(result.missedTimeline?.some(m => m.id === "anastasiaMate" && m.ply === 3)).toBe(true);
    });
}
