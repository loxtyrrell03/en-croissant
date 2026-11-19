import { describe, expect, it } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { findImmediateMateDefence } from "../tacticalMotifs/decisionMateDefence";

const fen = "4r1k1/1p5p/p3p1pP/3RR1P1/2n2P2/1qP1Q3/1P6/1K6 w - - 1 32";
const defence: DecisionEngineLine = { fen, depth: 21, cp: 485, pvUci: ["e3e2"] };
const ignoresThreat: DecisionEngineLine = {
    fen,
    depth: 21,
    cp: null,
    mate: -1,
    pvUci: ["e3e1", "b3b2"],
};

describe("verified defence against immediate mate", () => {
    it("contrasts a legal quiet alternative with the actual defence", () => {
        const report = findImmediateMateDefence(fen, [defence]);
        expect(report).toMatchObject({
            defenceUci: "e3e2",
            exampleLineUci: ["e3e1", "b3b2"],
            exampleWasSearched: false,
            defendedLineUci: ["e3e2", "b3b2", "e2b2"],
        });
        expect(replayTacticalLine(fen, report!.exampleLineUci).at(-1)?.after.isCheckmate()).toBe(
            true,
        );
        expect(replayTacticalLine(fen, report!.defendedLineUci!).map((step) => step.san)).toEqual([
            "Qe2",
            "Qxb2+",
            "Qxb2",
        ]);
    });

    it("prefers an engine candidate and can abstain without a searched example", () => {
        expect(findImmediateMateDefence(fen, [defence], false)).toBeNull();
        expect(findImmediateMateDefence(fen, [defence, ignoresThreat], false)).toMatchObject({
            exampleLineUci: ["e3e1", "b3b2"],
            exampleWasSearched: true,
        });
    });

    it("does not call a temporary checking tempo a defence", () => {
        const attack = "2r3k1/1b3p2/p2p1n2/4p1P1/1qPpN3/1P1BQP2/P5PP/2R3K1 w - - 0 25";
        const givesCheck = "e4f6";
        expect(replayTacticalLine(attack, [givesCheck])[0]?.after.isCheck()).toBe(true);
        expect(
            findImmediateMateDefence(attack, [
                { fen: attack, depth: 21, cp: 0, pvUci: [givesCheck] },
            ]),
        ).toBeNull();
    });

    it("requires a legal, non-terminal defence and a usable engine evaluation", () => {
        expect(findImmediateMateDefence(fen, [ignoresThreat])).toBeNull();
        expect(findImmediateMateDefence(fen, [{ ...defence, pvUci: ["e3e1"] }])).toBeNull();
        expect(findImmediateMateDefence(fen, [{ ...defence, depth: 15 }])).toBeNull();
        expect(findImmediateMateDefence(fen, [{ ...defence, lowerbound: true }])).toBeNull();
        expect(findImmediateMateDefence(fen, [{ ...defence, pvUci: ["e3e5"] }])).toBeNull();
    });

    it("does not invent a pre-existing threat when a different move creates the mate", () => {
        const before = "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2";
        const example = ["g2g4", "d8h4"];
        expect(replayTacticalLine(before, example).at(-1)?.after.isCheckmate()).toBe(true);
        expect(
            findImmediateMateDefence(before, [
                { fen: before, depth: 21, cp: -80, pvUci: ["g2g3"] },
                { fen: before, depth: 21, cp: null, mate: -1, pvUci: example },
            ]),
        ).toBeNull();
    });

    it("supports position and move evidence without transferring it into the played mistake", () => {
        const report = assessChessDecision({ fen, candidates: [defence] });
        expect(report?.position).toMatchObject({
            category: "tactical",
            tactical: { basis: "bounded-proof" },
            mateDefence: { defenceUci: "e3e2" },
        });
        expect(report?.moves[0]?.mateDefence).toEqual(report?.position.mateDefence);
        const compared = assessChessDecision({
            fen,
            candidates: [defence, ignoresThreat],
            playedMoveUci: "e3e1",
        });
        expect(compared?.position.mateDefence?.defenceUci).toBe("e3e2");
        expect(compared?.mistake?.mateDefence).toBeUndefined();
    });
});
