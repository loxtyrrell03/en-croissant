import { expect, test } from "vitest";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
    isImmediateTacticalLesson,
    isRetainedForkChoice,
    tacticalMotifPerspective,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { proveImmediateFork, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Both knights can land on f7, attacking the same original queen and rook.
// The local bounds differ (170/180), so this cannot be an equality-of-values
// test. The retained fact is the independently proved mechanism, not a score.
const sameForkFen = "1k1q3r/pppp4/3N3N/8/2B5/8/5PPP/6K1 w - - 0 1";
const unsafeForkFen = "1k1q3r/pppp4/3N3N/8/2B5/8/5PP1/6KQ w - - 0 1";
const differentForkFen = "1k1r1r1r/pp6/8/8/3N1N2/4P3/3P1PPP/3R1RK1 w - - 0 1";

function fixture(fen: string, reflected: boolean) {
    return {
        fen: reflected ? reflectMixedForkFen(fen) : fen,
        move: (uci: string) => reflected ? reflectMixedForkMove(uci) : uci,
    };
}

for (const reflected of [false, true]) {
    for (const reverse of [false, true]) {
        for (const full of [false, true]) {
            test(`the played fork is retained context without comparing its bound: reflected=${reflected}, reverse=${reverse}, full=${full}`, () => {
                const { fen, move } = fixture(sameForkFen, reflected);
                const best = move(reverse ? "h6f7" : "d6f7");
                const played = move(reverse ? "d6f7" : "h6f7");
                const pvUci = [best, ...(full ? [move("d8e7"), move("f7h8")] : [])];
                expect(replayTacticalLine(fen, pvUci)).toHaveLength(pvUci.length);
                const bestProof = proveImmediateFork(replayTacticalLine(fen, [best])[0]);
                const playedProof = proveImmediateFork(replayTacticalLine(fen, [played])[0]);
                expect(bestProof).not.toBeNull();
                expect(playedProof).not.toBeNull();
                expect([...bestProof!.targets].sort()).toEqual([...playedProof!.targets].sort());
                expect(bestProof!.gain).not.toBe(playedProof!.gain);
                const input = { fen, bestMoveUci: best, playedMoveUci: played, pvUci,
                    refutationUci: full ? [move("d8e7")] : [] };
                // No engine score or supplied evaluation drop nominates this comparison.
                const result = classifyMistakeReviewMotifs(input);
                const explanation = buildMistakeReviewTacticalExplanation(result)!;
                expect(explanation).toMatchObject({ title: "Both moves create this fork", source: "mixed" });
                expect(isRetainedForkChoice(explanation.primary)).toBe(true);
                expect(explanation.primary.source).toBe("available");
                expect(isImmediateTacticalLesson(explanation.primary)).toBe(false);
                expect(tacticalMotifPerspective(explanation.primary)).toBe("Fork in both moves");
                expect(explanation.text).toContain("does not establish that the moves are equally good");
                expect(explanation.text).not.toMatch(/missed|also allowed/i);
                expect(explanation.secondary).toBeUndefined();
                expect(result.allowedMotifs).toEqual([]);
                const rootTimeline = result.missedTimeline?.filter(m => m.ply === 1 && m.id === "fork");
                expect(rootTimeline).toHaveLength(1);
                expect(rootTimeline?.every(isRetainedForkChoice)).toBe(true);
                // Position/live classification still owns the real fork; only
                // the review's claim that this played move missed it changes.
                for (const candidate of [best, played]) {
                    const available = classifyPositionTacticalMotifs({ fen, pvUci: [candidate] }).motifs[0];
                    expect(available).toMatchObject({ id: "fork", source: "available", ply: 1 });
                    expect(isRetainedForkChoice(available)).toBe(false);
                }
            });
        }
    }

    test(`actually missing the fork remains a missed lesson: reflected=${reflected}`, () => {
        const { fen, move } = fixture(sameForkFen, reflected);
        const best = move("d6f7"), played = move("g1f1");
        expect(replayTacticalLine(fen, [played, move("d8e7")])).toHaveLength(2);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played,
            pvUci: [best], refutationUci: [move("d8e7")] });
        expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(false);
        expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
            title: "What you missed: Fork", source: "missed", primary: { id: "fork" },
        });
    });

    test(`vacating the queen's shield is not a safe retained fork: reflected=${reflected}`, () => {
        const { fen, move } = fixture(unsafeForkFen, reflected);
        const best = move("d6f7"), played = move("h6f7");
        const steps = replayTacticalLine(fen, [played, move("h8h1")]);
        expect(steps).toHaveLength(2);
        expect(steps[1].capture).toBe(900);
        expect(proveImmediateFork(replayTacticalLine(fen, [best])[0])).not.toBeNull();
        expect(proveImmediateFork(steps[0])).toBeNull();
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
        expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(false);
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe("What you missed: Fork");
    });

    test(`same motif and equal bounds do not merge different victims: reflected=${reflected}`, () => {
        const { fen, move } = fixture(differentForkFen, reflected);
        const best = move("d4e6"), played = move("f4g6");
        const bestProof = proveImmediateFork(replayTacticalLine(fen, [best])[0]);
        const playedProof = proveImmediateFork(replayTacticalLine(fen, [played])[0]);
        expect(bestProof).not.toBeNull();
        expect(playedProof).not.toBeNull();
        expect(bestProof!.gain).toBe(playedProof!.gain);
        expect([...bestProof!.targets].sort()).not.toEqual([...playedProof!.targets].sort());
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
        expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(false);
        expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe("What you missed: Fork");
    });

    test(`checking forks stay outside the material-only comparison: reflected=${reflected}`, () => {
        const { fen, move } = fixture("3k3r/pppp4/3N3N/8/2B5/8/5PPP/6K1 w - - 0 1", reflected);
        const best = move("d6f7"), played = move("h6f7");
        for (const candidate of [best, played]) {
            const step = replayTacticalLine(fen, [candidate])[0];
            expect(step.after.isCheck()).toBe(true);
            expect(proveImmediateFork(step)).not.toBeNull();
        }
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
        expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(false);
        // Unchanged evidence outside this narrow comparison, not an
        // adjudication that its current missed-opportunity wording is right.
        expect(result.missedMotifs.some(m => m.id === "fork")).toBe(true);
    });

    test(`a matching compound fork needs its own comparison: reflected=${reflected}`, () => {
        const { fen, move } = fixture("3r2qk/6pr/5p1P/7N/4N3/2B5/5PPP/5RK1 w - - 0 1", reflected);
        const best = move("e4f6"), played = move("h5f6");
        for (const candidate of [best, played]) {
            expect(proveImmediateFork(replayTacticalLine(fen, [candidate])[0])).toBeNull();
            const motif = classifyPositionTacticalMotifs({ fen, pvUci: [candidate] }).motifs[0];
            expect(motif.id).toBe("fork");
            expect(motif.evidence).toContain("checking recapture");
        }
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played, pvUci: [best] });
        expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(false);
        // Comparing compound branches needs its own certificate. Retaining
        // their evidence is not a new gold label for their blame wording.
        expect(result.missedMotifs.some(m => m.id === "fork")).toBe(true);
    });

    test(`an engine-nominated option cannot accuse an already played fork: reflected=${reflected}`, () => {
        const { fen, move } = fixture(sameForkFen, reflected);
        const best = move("g1f1"), played = move("h6f7"), other = move("d6f7");
        expect(replayTacticalLine(fen, [best])).toHaveLength(1);
        for (const candidate of [played, other])
            expect(proveImmediateFork(replayTacticalLine(fen, [candidate])[0])).not.toBeNull();
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played,
            pvUci: [best], cpLoss: 300, bestCandidates: [
                { fen, pvUci: [best], cp: 500, depth: 18 },
                { fen, pvUci: [other], cp: 490, depth: 18 },
            ] });
        expect(result.missedMotifs.some(m => m.alternativeLine)).toBe(false);
        expect(result.missedMotifs.some(isImmediateTacticalLesson)).toBe(false);
        expect(buildMistakeReviewTacticalExplanation(result)).toBeNull();
    });

    test(`a separately nominated fork of other victims still qualifies: reflected=${reflected}`, () => {
        const { fen, move } = fixture(differentForkFen, reflected);
        const best = move("g1h1"), played = move("f4g6"), other = move("d4e6");
        expect(replayTacticalLine(fen, [best])).toHaveLength(1);
        const result = classifyMistakeReviewMotifs({ fen, bestMoveUci: best, playedMoveUci: played,
            pvUci: [best], cpLoss: 300, bestCandidates: [
                { fen, pvUci: [best], cp: 500, depth: 18 },
                { fen, pvUci: [other], cp: 490, depth: 18 },
            ] });
        expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(false);
        expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
            id: "fork", source: "missed", alternativeLine: { uci: [other] },
        });
    });
}

test("retained context cannot displace or become secondary blame beside a separately proved allowed loss", () => {
    const retained = classifyMistakeReviewMotifs({ fen: sameForkFen,
        bestMoveUci: "d6f7", playedMoveUci: "h6f7", pvUci: ["d6f7"] });
    // A consumer-composition control: obtain the separate opponent evidence
    // through a fully legal review rather than inventing its certificate.
    const danger = classifyMistakeReviewMotifs({
        fen: "r5k1/5ppp/8/8/Q7/8/5PPP/6K1 w - - 0 1",
        bestMoveUci: "a4b3", playedMoveUci: "h2h4", pvUci: ["a4b3"], refutationUci: ["a8a4"],
    });
    expect(danger.allowedMotifs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "hangingPiece", value: 900, comparison: "prevented" }),
    ]));
    const original = structuredClone(danger.allowedMotifs);
    const input = { missedMotifs: retained.missedMotifs, allowedMotifs: danger.allowedMotifs };
    const explanation = buildMistakeReviewTacticalExplanation(input)!;
    expect(explanation).toMatchObject({ source: "allowed", primary: { id: "hangingPiece", comparison: "prevented" } });
    expect(explanation.secondary).toBeUndefined();
    expect(explanation.text).not.toContain("also missed");
    expect(danger.allowedMotifs).toEqual(original);
});
