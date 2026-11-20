import { expect, test } from "vitest";
import cases from "../../../benchmarks/decision-evidence/castling-interruption/fixtures.json";
import { assessChessDecision, type DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import {
    confirmCastleDisplacement,
    nominateCastleDisplacement,
} from "@/utils/tacticalMotifs/decisionCastleDisplacement";

function comparison(row: DecisionAssessmentInput) {
    const [best, played] = row.comparisonCandidates!;
    return [row.fen, best, played, row.replyProbes!.find(item => item.moveUci === row.playedMoveUci)!.lines[0]] as const;
}

test("a forcing check removes an originally legal castle", () => {
    const row = cases.checked;
    expect(nominateCastleDisplacement(...comparison(row))?.replyUci).toBe("b5d6");
    const evidence = confirmCastleDisplacement(...comparison(row), row.sharedReply);
    expect(evidence?.playedLineUci).toEqual(["c7c6", "b5d6", "e8d7"]);
    expect(evidence?.controlLineUci?.slice(0, 2)).toEqual(["e8c8", "b5d6"]);
    expect(evidence?.tactical).toMatch(/Nd6\+.*Every legal reply moves the king.*Kd7.*O-O-O/s);
});

test("a voluntary king move after a quiet attack is outside the legal proof", () => {
    const row = cases.quiet;
    expect(nominateCastleDisplacement(...comparison(row))).toBeUndefined();
    expect(confirmCastleDisplacement(...comparison(row), row.sharedReply)).toBeUndefined();
});

test("an exact reply must be independently scored on the reached castle board", () => {
    const row = cases.checked;
    expect(confirmCastleDisplacement(...comparison(row))).toBeUndefined();
    expect(confirmCastleDisplacement(...comparison(row), {
        ...row.sharedReply, line: { ...row.sharedReply.line, fen: row.fen },
    })).toBeUndefined();
});

test("a castling interruption updates only the played mistake assessment", () => {
    const row = cases.checked;
    const base = assessChessDecision({ ...row, sharedReply: undefined });
    const result = assessChessDecision(row);
    expect(result?.mistake?.category).toBe("mixed");
    expect(result?.mistake?.positional.reasons[0]).toMatch(/permanently gives up castling/);
    expect(result?.position).toEqual(base?.position);
    expect(result?.moves).toEqual(base?.moves);
    expect(result?.mistake?.evaluationLossCp).toBe(base?.mistake?.evaluationLossCp);
});
