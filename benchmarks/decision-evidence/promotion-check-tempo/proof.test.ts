import { describe, expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { comparePromotionCheckTempo } from "@/utils/tacticalMotifs/decisionPromotionCheckTempo";
import fixture from "./fixture.json";

const board = fixture.fen;
const [best, played] = fixture.comparisonCandidates;
const reply = fixture.replyProbes.find((probe) => probe.moveUci === best.pvUci[0])!.lines[0];

describe("a promotion that depends on avoiding check", () => {
    test("supports both reasons for the leading move and gives the legal contrasting lines", () => {
        const evidence = comparePromotionCheckTempo(board, best, played, reply, fixture.history);
        expect(evidence).toMatchObject({ sameContinuation: true });
        expect(evidence?.tactic.linesUci).toEqual([
            ["f2g1", "c6d6", "b6b7", "d6d3", "b7b8q"],
            ["f2f3", "c6d6", "b6b7", "d6d3"],
        ]);
        const report = classify(fixture, "Stockfish 19", fixture.history)!;
        expect(report.moves[0]).toMatchObject({
            category: "mixed",
            tactical: { basis: "engine-supported" },
            positional: { basis: "heuristic" },
            promotionTactic: evidence?.tactic,
        });
        expect(report.mistake?.category).toBe("unclear");
    });

    test("rejects a control king square where the same capture gives no check", () => {
        const otherSafeChoice = fixture.candidates.find((line) => line.pvUci[0] === "f2f1")!;
        expect(
            comparePromotionCheckTempo(board, fixture.candidates[0], otherSafeChoice, reply),
        ).toBeNull();
    });

    test("does not accept the wrong reached board, a bound, or a short PV", () => {
        expect(
            comparePromotionCheckTempo(board, best, played, { ...reply, fen: board }),
        ).toBeNull();
        expect(
            comparePromotionCheckTempo(board, best, played, { ...reply, lowerbound: true }),
        ).toBeNull();
        expect(
            comparePromotionCheckTempo(board, best, played, {
                ...reply,
                pvUci: reply.pvUci.slice(0, 4),
            }),
        ).toBeNull();
    });

    test("leaves the exact move explanation unresolved when the repeat shows a different defence", () => {
        const otherReply = fixture.replyProbes.find((probe) => probe.moveUci === best.pvUci[0])!
            .lines[1];
        const independent = { ...otherReply, cp: reply.cp };
        const evidence = comparePromotionCheckTempo(board, best, played, independent);
        expect(evidence?.sameContinuation).toBe(false);
        const inputs = {
            ...fixture,
            replyProbes: [{ moveUci: best.pvUci[0], lines: [independent] }],
        };
        expect(classify(inputs, "Stockfish 19")?.moves[0].promotionTactic).toBeUndefined();
    });
});
