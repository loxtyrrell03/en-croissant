import { expect, test } from "vitest";
import fixture from "../../../benchmarks/decision-evidence/deferred-pawn-capture/fixture.json";
import { assessChessDecision, type DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { findDeferredPawnCapture } from "@/utils/tacticalMotifs/decisionCaptureOpportunity";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

const [capture, second, defer] = fixture.candidates;

function input(candidates = fixture.candidates): DecisionAssessmentInput {
    const scan = buildLiveTacticalScan({
        fen: fixture.fen,
        pvUci: capture.pvUci,
        depth: capture.depth,
        engineName: "Stockfish 19",
        tacticalHistory: fixture.history,
        variations: candidates.map((line, index) => ({ ...line, multipv: index + 1 })),
    });
    return {
        ...fixture,
        candidates,
        rootCertificates: scan.variations.map((line) => ({
            fen: fixture.fen, moveUci: line.lineUci[0], motifs: line.motifs,
        })),
    };
}

test("a deferred capture qualifies the loose-pawn certificate without losing the positional effect", () => {
    const evidence = input();
    expect(evidence.rootCertificates?.[0].motifs.some((motif) => motif.label === "Hanging Pawn")).toBe(true);
    const result = assessChessDecision(evidence);
    const actual = result?.moves[0];
    expect(actual?.category).toBe("positional");
    expect(actual?.positionalFactors[0].feature).toBe("isolated-pawn");
    expect(actual?.verifiedMotifs).toEqual([]);
    expect(actual?.deferredPawnCapture?.description).toMatch(/pawn on g4.*Bb2.*Kxg4/);
    expect(actual?.deferredPawnCapture?.linesUci).toEqual([
        ["g3g4"], ["e5b2", "e7d7", "d3c4", "a7c6", "g3g4"],
    ]);
    expect(result?.mistake).toBeNull();
    expect(result?.moves[1]).toEqual(assessChessDecision(input([capture, second]))?.moves[1]);
});

test("a losing, illegal or incomplete alternative cannot qualify the observed pawn capture", () => {
    for (const alternative of [
        { ...defer, cp: 280 },
        { ...defer, depth: defer.depth - 1 },
        { ...defer, pvUci: defer.pvUci.slice(0, 4) },
        { ...defer, pvUci: [...defer.pvUci.slice(0, 4), "g3g8"] },
    ]) {
        expect(findDeferredPawnCapture(fixture.fen, capture, [capture, second, alternative])).toBeUndefined();
    }
    const control = assessChessDecision(input([capture, second, { ...defer, cp: 280 }]));
    expect(control?.moves[0].tactical.support).toBe("supported");
    expect(control?.moves[0].verifiedMotifs[0].label).toBe("Hanging Pawn");
});
