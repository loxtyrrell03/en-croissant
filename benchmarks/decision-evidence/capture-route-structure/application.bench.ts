import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { captureRouteStructureRequest } from "@/utils/tacticalMotifs/decisionCaptureRouteStructure";

test("replays the ordinary app inputs and supplies the requested capture reply", () => {
    const rows = JSON.parse(readFileSync(process.env.CAPTURE_ROUTE_INPUT!, "utf8")) as
        Array<DecisionAssessmentInput & { id: string }>;
    const enabled = process.env.CAPTURE_ROUTE_CANDIDATE === "1";
    expect(rows.length).toBe(new Set(rows.map(row => row.id)).size);
    const results = rows.map(({ id, ...input }) => {
        if (!input.candidates.length) return { id, report: null };
        const replies = input.replyProbes ?? [];
        const usual = new Set([input.candidates[0].pvUci[0], input.playedMoveUci]);
        const clean = { ...input, replyProbes: replies.filter(probe => usual.has(probe.moveUci)) };
        const started = performance.now();
        let report = classify(clean, "Stockfish 19", input.history);
        const lead = report?.moves[0];
        const request = enabled && lead?.tactical.support === "supported" && lead.positional.support !== "supported"
            ? captureRouteStructureRequest(input.fen, input.candidates, clean.replyProbes)
            : undefined;
        const captured = request && replies.find(probe => probe.moveUci === request.moveUci);
        if (captured) report = classify({ ...clean, captureRouteReply: captured }, "Stockfish 19", input.history);
        return { id, report, request: request?.moveUci, reusedFrame: !!captured, ms: performance.now() - started };
    });
    writeFileSync(process.env.CAPTURE_ROUTE_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 420_000);
