import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { findKingShelterTradeoff } from "../tacticalMotifs/decisionKingShelter";

const fen = "2r2rk1/ppq2ppp/2n1pn2/3p4/2PP1b2/PP1B1b1P/1B1N1PP1/2RQR1K1 w - - 0 15";
const candidate = (cp: number, moves: string): DecisionEngineLine => ({
    fen,
    cp,
    depth: 20,
    pvUci: moves.split(" "),
});
const knight = candidate(-136, "d2f3 f4c1 b2c1 f8e8 c1g5 f6d7 g5h4 d5c4 b3c4 d7f8");
const pawn = candidate(-455, "g2f3 c7d8 d3f1 f6h5 c1c2 d8g5 g1h1 c6e7 c4c5 g5h4");

function probe(line: DecisionEngineLine, cp: number, moves: string) {
    const [step] = replayTacticalLine(fen, line.pvUci.slice(0, 1));
    return {
        moveUci: step.uci,
        lines: [{ ...candidate(cp, moves), fen: makeFen(step.after.toSetup()) }],
    };
}
const knightProbe = probe(knight, 106, "f4c1 b2c1 d5c4 b3c4 f8d8 c1b2 c6a5 f3d2");
const pawnProbe = probe(pawn, 496, "c7d8 d3f1 f6h5 c1c2 d8g5 g1h1 g5h4 h1g1 c6e7");

test("two legal recaptures can differ in both tactical consequences and pawn shelter", () => {
    const report = assessChessDecision({
        fen,
        candidates: [knight, pawn],
        playedMoveUci: "g2f3",
        replyProbes: [knightProbe, pawnProbe],
        rootCertificates: [
            {
                fen,
                moveUci: "d2f3",
                motifs: [
                    {
                        id: "hangingPiece",
                        label: "Material Gain",
                        value: 160,
                        evidence: "Checked exchanges gain 1.6 pawns.",
                        source: "available",
                        confidence: "high",
                        ply: 1,
                        moveUci: "d2f3",
                        relevance: "primary",
                    },
                ],
            },
        ],
    });
    expect(report?.position.category).toBe("mixed");
    expect(report?.position.strategicPlan?.description).toContain("Qg5+ checks down that file");
    expect(report?.position.strategicPlan?.linesUci[1].at(-1)).toBe("d8g5");
    expect(report?.mistake?.positionalFactors).toEqual(
        expect.arrayContaining([expect.objectContaining({ feature: "king-file-shelter" })]),
    );
});

test("a shelter loss without a concrete use of the open file stays uncertain", () => {
    const noInvasion = candidate(-455, "g2f3 c7d8 d3f1 f6h5 c1c2 c6e7 c4c5 d8c7");
    expect(replayTacticalLine(fen, noInvasion.pvUci)).toHaveLength(8);
    expect(findKingShelterTradeoff(fen, [knight, noInvasion])).toBeNull();
});

test("the played move needs separate reply evidence for a shelter diagnosis", () => {
    const weakProbe = probe(pawn, 496, "c7d8 d3f1 f6h5 c1c2 c6e7 c4c5 d8c7");
    const report = assessChessDecision({
        fen,
        candidates: [knight, pawn],
        playedMoveUci: "g2f3",
        replyProbes: [knightProbe, weakProbe],
    });
    expect(report?.position.strategicPlan?.description).toContain("Qg5+");
    expect(report?.mistake?.positionalFactors.map((factor) => factor.feature)).not.toContain(
        "king-file-shelter",
    );
});
