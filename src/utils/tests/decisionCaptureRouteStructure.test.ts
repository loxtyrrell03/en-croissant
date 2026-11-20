import { describe, expect, test } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/capture-route-structure/fixtures.json";
import {
    captureRouteStructureRequest,
    verifyCaptureRouteStructure,
} from "@/utils/tacticalMotifs/decisionCaptureRouteStructure";

describe("pawn support retained by a checking capture", () => {
    test.each([
        [fixtures.candidates, "e6d5", /Ne7\+ Kb2 Nxd5.*pawn on e6.*f5.*exd5/],
        [fixtures.clubCup, "c6d5", /Qd4\+ Kh1 Qxd5.*pawn on b7.*c6.*cxd5/],
    ] as const)("verifies the two actual choices with independent replies", (row, capture, expected) => {
        const probes = row.replyProbes;
        const args = [row.fen, row.candidates] as const;
        expect(captureRouteStructureRequest(...args, probes)?.moveUci).toBe(capture);
        expect(verifyCaptureRouteStructure(...args, probes)).toBeUndefined();
        expect(verifyCaptureRouteStructure(...args, probes, row.captureRouteReply)?.description).toMatch(expected);
        const cached = [...probes, row.captureRouteReply];
        expect(captureRouteStructureRequest(...args, cached)).toBeUndefined();
        expect(verifyCaptureRouteStructure(...args, cached)?.description).toMatch(expected);
    });

    test("does not use a counterfactual from another board", () => {
        const row = fixtures.clubCup;
        const wrong = { ...row.captureRouteReply, lines: row.captureRouteReply.lines.map(line => ({ ...line, fen: row.fen })) };
        expect(verifyCaptureRouteStructure(row.fen, row.candidates, row.replyProbes, wrong)).toBeUndefined();
    });

    test("abstains if the independent search disagrees on the alternatives", () => {
        const row = fixtures.clubCup;
        const conflicting = { ...row.captureRouteReply, lines: row.captureRouteReply.lines.map(line => ({ ...line, cp: -250 })) };
        expect(verifyCaptureRouteStructure(row.fen, row.candidates, row.replyProbes, conflicting)).toBeUndefined();
    });
});
