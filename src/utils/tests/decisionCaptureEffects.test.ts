import { expect, test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import fixtures from "../../../benchmarks/decision-evidence/capture-structural-dependence/fixtures.json";

function report(input: DecisionAssessmentInput) {
    const root = input.candidates[0];
    const scan = buildLiveTacticalScan({
        fen: input.fen,
        pvUci: root.pvUci,
        depth: root.depth,
        engineName: "Stockfish 19",
        variations: input.candidates.map((line, index) => ({ ...line, multipv: index + 1 })),
    });
    return assessChessDecision({
        ...input,
        rootCertificates: scan.variations.map((line) => ({
            fen: input.fen,
            moveUci: line.lineUci[0],
            motifs: line.motifs,
        })),
    });
}

test("a bishop won by the fork does not independently support a strategic verdict", () => {
    const actual = report(fixtures.forkCapture)?.moves[0];
    expect(actual).toMatchObject({
        category: "tactical",
        tactical: { support: "supported" },
        positional: { support: "suggestive" },
    });
    expect(actual?.limitations).toEqual(
        expect.arrayContaining([expect.stringMatching(/bishop pair.*Qxb2.*uncertain/)]),
    );
});

test("keeps a genuinely used passed pawn alongside the material tactic", () => {
    const actual = report(fixtures.mixedPasser);
    expect(actual?.position.category).toBe("mixed");
    expect(actual?.moves[0]).toMatchObject({
        category: "mixed",
        positionalFactors: [expect.objectContaining({ feature: "passed-pawn", squareOrFile: "c" })],
    });
});

test.each(["delayedTrade", "consecutiveTrade"] as const)(
    "keeps the observed bishop trade when its gain is not independently settled in %s",
    (example) => {
        expect(report(fixtures[example])?.moves[0].positionalFactors).toEqual(
            expect.arrayContaining([expect.objectContaining({ feature: "bishop-pair-removal" })]),
        );
    },
);
