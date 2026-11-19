import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import { classifyProvedMistakeNature } from "@/utils/tacticalMotifs/mistakeNature";
import { measurePositionDecision } from "@/utils/tacticalMotifs/decisionEvidence";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";
import type { DecisionReportMessage, DecisionReportRequest } from "./decisionReportWorker";

function classify(
    input: DecisionAssessmentInput,
    engineName: string,
    tacticalHistory?: TacticalGameHistory,
) {
    const best = input.candidates[0];
    const scan = buildLiveTacticalScan({
        fen: input.fen,
        pvUci: best.pvUci,
        depth: best.depth,
        engineName,
        tacticalHistory,
        variations: input.candidates.map((line, index) => ({ ...line, multipv: index + 1 })),
    });
    const comparison = input.comparisonCandidates ?? input.candidates;
    const played = comparison.find((line) => line.pvUci[0] === input.playedMoveUci);
    const reply = input.replyProbes?.find((probe) => probe.moveUci === played?.pvUci[0])?.lines;
    const gap = measurePositionDecision(input.fen, comparison)?.bestSecondGapCp;
    if (
        played &&
        played.cp !== null &&
        comparison[0]?.cp != null &&
        gap != null &&
        comparison[0].pvUci[0] === best.pvUci[0] &&
        played !== comparison[0] &&
        reply?.length
    ) {
        const sign = input.fen.split(" ")[1] === "w" ? 1 : -1;
        const old = classifyProvedMistakeNature({
            fen: input.fen,
            bestMoveUci: best.pvUci[0],
            playedMoveUci: played.pvUci[0],
            pvUci: comparison[0].pvUci,
            refutationUci: reply[0].pvUci,
            tacticalHistory,
            bestCandidates: comparison,
            refutationCandidates: reply,
            cpLoss: comparison[0].cp - played.cp,
            cpBefore: sign * comparison[0].cp,
            cpAfter: sign * played.cp,
            reachedDepth: Math.min(comparison[0].depth, reply[0].depth),
        });
        if (old.nature === "tactical")
            input = {
                ...input,
                mistakeCertificate: {
                    fen: input.fen,
                    bestMoveUci: best.pvUci[0],
                    playedMoveUci: played.pvUci[0],
                    tactical: true,
                    reasons: [old.reason],
                },
            };
    }
    return assessChessDecision({
        ...input,
        rootCertificates: scan.variations.map((line) => ({
            fen: input.fen,
            moveUci: line.lineUci[0],
            motifs: line.motifs,
        })),
    });
}

self.onmessage = ({ data }: MessageEvent<DecisionReportRequest>) => {
    self.postMessage({ type: "started" } satisfies DecisionReportMessage);
    try {
        const report = classify(data.input, data.engineName, data.history);
        self.postMessage({ type: "result", report } satisfies DecisionReportMessage);
    } catch (error) {
        self.postMessage({
            type: "error",
            message: error instanceof Error ? error.message : "Decision analysis failed.",
        } satisfies DecisionReportMessage);
    }
};
