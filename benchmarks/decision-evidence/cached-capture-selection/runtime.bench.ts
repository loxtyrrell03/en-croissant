import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { availableCaptureOrders } from "@/utils/tacticalMotifs/captureOrderEvidence";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { ChessDecisionReport, DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";

type Input = DecisionAssessmentInput & { id: string };
type Question = {
    id: string;
    proposal: { root: string; reply: string; remove: string; take: string; guard: number; target: number; preparer: number };
};

test("replays the same capture order selected in Decision Evidence", () => {
    const input = JSON.parse(readFileSync(process.env.CAPTURE_REPLAY_INPUT!, "utf8")) as Input[];
    const baseline = JSON.parse(readFileSync(process.env.CAPTURE_REPLAY_BASELINE!, "utf8")) as
        { id: string; report: ChessDecisionReport | null }[];
    const base = new Map(baseline.map(({ id, report }) => [id, report]));
    const probes = process.env.CAPTURE_REPLAY_PROBES
        ? new Map((JSON.parse(readFileSync(process.env.CAPTURE_REPLAY_PROBES, "utf8")) as
            (Question & { lines: DecisionEngineLine[] })[]).map(row => [row.id, row]))
        : null;
    const result = input.flatMap(row => {
        const previous = base.get(row.id);
        if (!previous) return [];
        const allowed = new Set(previous.moves.filter(m => m.tactical.support !== "supported").map(m => m.moveUci));
        const [order] = availableCaptureOrders(row, allowed);
        if (!order) {
            if (probes) expect(classify(row, "Stockfish 19", row.history)?.mistake).toEqual(previous.mistake);
            return [];
        }
        const proposal = {
            root: order.root.uci, reply: order.reply.uci, remove: order.remove.uci, take: order.take.uci,
            guard: order.remove.move.to, target: order.take.move.to, preparer: order.remove.move.from,
        };
        if (!probes) return [{ id: row.id, proposal }];
        const probe = probes.get(row.id);
        expect(probe?.proposal).toEqual(proposal);
        const report = classify({
            ...row, captureOrder: { moveUci: proposal.root, replyUci: proposal.reply, lines: probe!.lines },
        }, "Stockfish 19", row.history);
        expect(report?.mistake).toEqual(previous.mistake);
        const position = report?.position;
        const move = report?.moves.find(item => item.moveUci === proposal.root);
        return [{
            id: row.id, proposal, position: position?.category, move: move?.category,
            oldPosition: previous.position.category,
            oldMove: previous.moves.find(item => item.moveUci === proposal.root)?.category,
            positionEvidence: position?.captureOrder, moveEvidence: move?.captureOrder,
        }];
    });
    writeFileSync(process.env.CAPTURE_REPLAY_OUTPUT!, JSON.stringify(result), { flag: "wx" });
}, 120_000);
